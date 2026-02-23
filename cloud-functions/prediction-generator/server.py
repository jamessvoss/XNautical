#!/usr/bin/env python3
"""
Prediction Generator - Cloud Run Service

Fetches NOAA tide and current predictions for all stations in a region,
builds SQLite databases from in-memory data, and uploads compressed
databases plus readable JSON inspection files to Firebase Storage.
Lightweight station metadata is written to Firestore for the
getStationLocations cloud function.

Processes stations sequentially but fetches each station's date chunks
concurrently (3 at a time) for ~3x speedup while respecting NOAA rate limits.

Data window: 1 year historical + 2 years forward (3-year rolling window).

Endpoints:
  POST /generate  - Generate predictions for a region
  GET  /status    - Get generation status for a region
  GET  /          - Health check

Request body for /generate:
  {
    "regionId": "11cgd",
    "type": "all",         // required: "tides", "currents", or "all"
    "yearsBack": 1,        // optional, default 1
    "yearsForward": 2,     // optional, default 2
    "maxStations": 10      // optional: limit stations for testing (omit for full generation)
  }

Pipeline:
  1. Fetch predictions from NOAA → collect in memory
  2. Write lightweight station metadata to Firestore (for getStationLocations)
  3. Write raw JSON + station summary JSON to Firebase Storage (for inspection)
  4. Build SQLite databases from in-memory data
  5. Compress SQLite + upload .db.zip to Firebase Storage (for app download)
  6. Update district document metadata in Firestore

Firestore writes (metadata only, no raw predictions):
  districts/{regionId}/tidal-stations/{stationId}    - id, name, lat, lng, type, predictionRange
  districts/{regionId}/current-stations/{stationId}  - id, name, lat, lng, bin, noaaType, etc.

Firebase Storage uploads:
  {regionId}/predictions/tides_{regionId}.db.zip       - SQLite database (app download)
  {regionId}/predictions/currents_{regionId}.db.zip    - SQLite database (app download)
  {regionId}/predictions/tide_stations.json            - Station metadata summary (inspection)
  {regionId}/predictions/current_stations.json         - Station metadata summary (inspection)
  {regionId}/predictions/tides_raw.json                - Raw tide predictions (inspection)
  {regionId}/predictions/currents_raw.json             - Raw current predictions (inspection)
"""

import os
import sys
import gc
import time
import json
import math
import sqlite3
import logging
import zipfile
import tempfile
import asyncio
import traceback
from pathlib import Path
from datetime import datetime, date, timedelta, timezone
from dateutil.relativedelta import relativedelta

import aiohttp
from flask import Flask, request, jsonify
from google.cloud import storage, firestore

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# ============================================================================
# Configuration
# ============================================================================

BUCKET_NAME = os.environ.get('STORAGE_BUCKET', 'xnautical-8a296.firebasestorage.app')

# NOAA API
NOAA_API_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
NOAA_REQUEST_TIMEOUT = 30  # seconds per request
NOAA_MAX_DAYS_PER_REQUEST = 365  # H/L and MAX_SLACK support up to 1 year per request
NOAA_CONCURRENT_CHUNKS = 3  # concurrent date-chunk fetches per station
NOAA_INTER_REQUEST_DELAY = 0.2  # seconds between concurrent requests

# Valid region IDs
VALID_REGIONS = ['01cgd', '05cgd', '07cgd', '08cgd', '09cgd', '11cgd', '13cgd', '14cgd', '17cgd', '17cgd-test']


# ============================================================================
# NOAA API helpers (async)
# ============================================================================

def format_date_noaa(d):
    """Format date as YYYYMMDD for NOAA API."""
    return d.strftime('%Y%m%d')


def format_date_key(d):
    """Format date as YYYY-MM-DD for storage keys."""
    return d.strftime('%Y-%m-%d')


async def fetch_tide_chunk(session, station_id, begin_date, end_date, semaphore):
    """
    Fetch tide predictions for a single date chunk.
    Returns dict keyed by date (YYYY-MM-DD) or None on error.
    """
    params = {
        'station': station_id,
        'begin_date': format_date_noaa(begin_date),
        'end_date': format_date_noaa(end_date),
        'product': 'predictions',
        'datum': 'MLLW',
        'units': 'english',
        'time_zone': 'lst_ldt',
        'format': 'json',
        'interval': 'hilo',
    }

    async with semaphore:
        await asyncio.sleep(NOAA_INTER_REQUEST_DELAY)
        for attempt in range(3):
            try:
                async with session.get(NOAA_API_BASE, params=params) as resp:
                    if resp.status in (429, 403):
                        backoff = (2 ** attempt) * 5 + 5  # 10s, 15s, 25s
                        logger.warning(f'HTTP {resp.status} for tide {station_id}, backing off {backoff}s')
                        await asyncio.sleep(backoff)
                        continue
                    if resp.status != 200:
                        return None
                    text = await resp.text()
                    data = json.loads(text)

                    if 'error' in data:
                        return None

                    predictions = data.get('predictions', [])
                    if not predictions:
                        return None

                    by_date = {}
                    for pred in predictions:
                        parts = pred.get('t', '').split(' ')
                        if len(parts) != 2:
                            continue
                        date_part, time_part = parts
                        if date_part not in by_date:
                            by_date[date_part] = []
                        by_date[date_part].append({
                            'time': time_part,
                            'height': round(float(pred.get('v', 0)), 2),
                            'type': pred.get('type', ''),
                        })
                    return by_date
            except asyncio.TimeoutError:
                if attempt < 2:
                    await asyncio.sleep(2)
                    continue
                return None
            except Exception as e:
                if attempt < 2:
                    await asyncio.sleep(2)
                    continue
                logger.warning(f'Error fetching tide {station_id} chunk: {e}')
                return None
    return None


async def fetch_current_chunk(session, station_id, bin_num, begin_date, end_date, semaphore, debug_first=False):
    """
    Fetch current predictions for a single date chunk.
    Returns raw prediction list or empty list.
    """
    params = {
        'station': station_id,
        'begin_date': format_date_noaa(begin_date),
        'end_date': format_date_noaa(end_date),
        'product': 'currents_predictions',
        'interval': 'MAX_SLACK',
        'units': 'english',
        'time_zone': 'lst_ldt',
        'format': 'json',
        'bin': str(bin_num),
    }

    async with semaphore:
        await asyncio.sleep(NOAA_INTER_REQUEST_DELAY)
        for attempt in range(3):
            try:
                async with session.get(NOAA_API_BASE, params=params) as resp:
                    if resp.status in (429, 403):
                        backoff = (2 ** attempt) * 5 + 5  # 10s, 15s, 25s
                        logger.warning(f'HTTP {resp.status} for {station_id}, backing off {backoff}s (attempt {attempt+1})')
                        await asyncio.sleep(backoff)
                        continue
                    if resp.status != 200:
                        if debug_first:
                            logger.warning(f'HTTP {resp.status} for current {station_id} bin={bin_num}')
                        return []
                    text = await resp.text()
                    data = json.loads(text)

                    if 'error' in data:
                        if debug_first:
                            logger.warning(f'NOAA error for {station_id}: {data["error"]}')
                        return []

                    cp = data.get('current_predictions', {})
                    if isinstance(cp, dict):
                        result = cp.get('cp', [])
                        if debug_first:
                            logger.info(f'  Debug {station_id}: got {len(result)} predictions for {begin_date}-{end_date}')
                        return result
                    elif isinstance(cp, list):
                        if debug_first:
                            logger.info(f'  Debug {station_id}: got {len(cp)} predictions (list)')
                        return cp
                    if debug_first:
                        logger.warning(f'  Debug {station_id}: unexpected response format: {list(data.keys())}')
                    return []
            except asyncio.TimeoutError:
                logger.warning(f'Timeout for current {station_id} attempt {attempt+1}')
                if attempt < 2:
                    await asyncio.sleep(2)
                    continue
                return []
            except Exception as e:
                logger.warning(f'Error fetching current {station_id} chunk ({begin_date}-{end_date}): {e}')
                if attempt < 2:
                    await asyncio.sleep(2)
                    continue
                return []
    return []


def organize_currents_by_month(predictions):
    """
    Organize raw NOAA current predictions by month and date.
    Returns dict: { 'YYYY-MM': { 'YYYY-MM-DD': [ {time, velocity, direction, type} ] } }
    """
    by_month = {}

    if not predictions or not isinstance(predictions, list):
        return by_month

    for pred in predictions:
        if not pred or not pred.get('Time'):
            continue

        parts = pred['Time'].split(' ')
        if len(parts) != 2:
            continue
        date_part, time_part = parts

        month_key = date_part[:7]

        if month_key not in by_month:
            by_month[month_key] = {}

        if date_part not in by_month[month_key]:
            by_month[month_key][date_part] = []

        pred_type = None
        if pred.get('Type'):
            pred_type = pred['Type'].lower()
        elif abs(float(pred.get('Velocity_Major', 0))) < 0.1:
            pred_type = 'slack'
        elif float(pred.get('Velocity_Major', 0)) > 0:
            pred_type = 'flood'
        else:
            pred_type = 'ebb'

        direction = 0
        if pred_type == 'flood':
            direction = float(pred.get('meanFloodDir', 0) or 0)
        elif pred_type == 'ebb':
            direction = float(pred.get('meanEbbDir', 0) or 0)
        else:
            direction = float(pred.get('meanFloodDir', 0) or pred.get('meanEbbDir', 0) or 0)

        by_month[month_key][date_part].append({
            'time': time_part[:5],
            'velocity': round(float(pred.get('Velocity_Major', 0)), 2),
            'direction': round(direction),
            'type': pred_type,
        })

    for month_key, days in by_month.items():
        for date_key in days:
            days[date_key].sort(key=lambda p: p['time'])

    return by_month


# ============================================================================
# Date range chunking
# ============================================================================

def date_range_chunks(start_date, end_date, max_days=NOAA_MAX_DAYS_PER_REQUEST):
    """Split a date range into chunks of at most max_days."""
    chunks = []
    current = start_date
    while current <= end_date:
        chunk_end = min(current + timedelta(days=max_days - 1), end_date)
        chunks.append((current, chunk_end))
        current = chunk_end + timedelta(days=1)
    return chunks


def month_range_list(start_date, end_date):
    """Generate list of (month_start, month_end) for each month in range."""
    months = []
    current = start_date.replace(day=1)
    while current <= end_date:
        month_start = current
        next_month = month_start + relativedelta(months=1)
        month_end = next_month - timedelta(days=1)
        if month_end > end_date:
            month_end = end_date
        months.append((month_start, month_end))
        current = next_month
    return months


# ============================================================================
# Firestore helpers
# ============================================================================

def update_status(db_client, region_id, status_dict):
    """Write prediction generation status to Firestore with automatic lastUpdated timestamp."""
    try:
        # Always include lastUpdated to detect crashed instances
        status_dict['lastUpdated'] = datetime.now(timezone.utc)
        doc_ref = db_client.collection('districts').document(region_id)
        doc_ref.set({'predictionStatus': status_dict}, merge=True)
    except Exception as e:
        logger.warning(f'Failed to update Firestore status: {e}')


# ============================================================================
# SQLite Database Initialization - Create Empty Databases Early
# ============================================================================

def init_tide_database(region_id, work_dir):
    """Create and initialize empty tide SQLite database."""
    db_path = os.path.join(work_dir, f'tides_{region_id}.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.executescript('''
        CREATE TABLE stations (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL
        );
        CREATE INDEX idx_stations_location ON stations(lat, lng);

        CREATE TABLE tide_predictions (
            station_id TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            type TEXT NOT NULL,
            height REAL NOT NULL,
            PRIMARY KEY (station_id, date, time)
        );
        CREATE INDEX idx_tide_date ON tide_predictions(station_id, date);

        CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    ''')
    
    # Pre-populate metadata
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('version', '1.0')")
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('type', 'tides')")
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('regionId', ?)", (region_id,))
    conn.commit()
    conn.close()
    
    logger.info(f'  Initialized tide database: {db_path}')
    return db_path


def init_current_database(region_id, work_dir):
    """Create and initialize empty current SQLite database."""
    db_path = os.path.join(work_dir, f'currents_{region_id}.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.executescript('''
        CREATE TABLE stations (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            noaa_type TEXT DEFAULT 'S',
            weak_and_variable INTEGER DEFAULT 0
        );
        CREATE INDEX idx_stations_location ON stations(lat, lng);

        CREATE TABLE current_predictions (
            station_id TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            type TEXT NOT NULL,
            velocity REAL NOT NULL,
            direction REAL,
            PRIMARY KEY (station_id, date, time)
        );
        CREATE INDEX idx_current_date ON current_predictions(station_id, date);

        CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    ''')
    
    # Pre-populate metadata
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('version', '1.0')")
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('type', 'currents')")
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('regionId', ?)", (region_id,))
    conn.commit()
    conn.close()
    
    logger.info(f'  Initialized current database: {db_path}')
    return db_path


def write_station_to_tide_db(db_path, station_id, station_name, lat, lng, predictions):
    """Write a single station's tide predictions directly to SQLite."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Insert station metadata
    cursor.execute(
        'INSERT OR IGNORE INTO stations (id, name, lat, lng) VALUES (?, ?, ?, ?)',
        (station_id, station_name, lat, lng)
    )
    
    # Insert all predictions for this station
    event_count = 0
    for date_key, events in predictions.items():
        for event in events:
            cursor.execute(
                'INSERT OR IGNORE INTO tide_predictions (station_id, date, time, type, height) VALUES (?, ?, ?, ?, ?)',
                (station_id, date_key, event['time'], event['type'], event['height'])
            )
            event_count += 1
    
    conn.commit()
    conn.close()
    return event_count


def write_station_to_current_db(db_path, station_id, station_name, lat, lng, noaa_type, monthly_predictions):
    """Write a single station's current predictions directly to SQLite."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Insert station metadata
    weak_and_variable = 1 if noaa_type == 'W' else 0
    cursor.execute(
        'INSERT OR IGNORE INTO stations (id, name, lat, lng, noaa_type, weak_and_variable) VALUES (?, ?, ?, ?, ?, ?)',
        (station_id, station_name, lat, lng, noaa_type, weak_and_variable)
    )
    
    # Insert all predictions for this station
    event_count = 0
    for month_key, daily_preds in monthly_predictions.items():
        for date_str, predictions in daily_preds.items():
            for pred in predictions:
                cursor.execute(
                    'INSERT OR IGNORE INTO current_predictions '
                    '(station_id, date, time, type, velocity, direction) '
                    'VALUES (?, ?, ?, ?, ?, ?)',
                    (station_id, date_str, pred['time'], pred['type'],
                     pred['velocity'], pred.get('direction'))
                )
                event_count += 1
    
    conn.commit()
    conn.close()
    return event_count


def finalize_tide_database(db_path, station_count, event_count):
    """Finalize tide database with metadata and optimization."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('generated', ?)", (datetime.utcnow().isoformat(),))
    cursor.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('stations', ?)", (str(station_count),))
    cursor.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('events', ?)", (str(event_count),))
    
    conn.commit()
    cursor.execute('VACUUM')
    cursor.execute('ANALYZE')
    conn.close()
    logger.info(f'  Finalized tide database: {station_count} stations, {event_count} events')


def finalize_current_database(db_path, station_count, weak_count, event_count):
    """Finalize current database with metadata and optimization."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('generated', ?)", (datetime.utcnow().isoformat(),))
    cursor.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('stations', ?)", (str(station_count),))
    cursor.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('stations_weak', ?)", (str(weak_count),))
    cursor.execute("INSERT OR REPLACE INTO metadata (key, value) VALUES ('events', ?)", (str(event_count),))
    
    conn.commit()
    cursor.execute('VACUUM')
    cursor.execute('ANALYZE')
    conn.close()
    logger.info(f'  Finalized current database: {station_count} stations ({weak_count} weak & variable), {event_count} events')


# ============================================================================
# Tide processing: sequential stations, concurrent chunks, stream to SQLite
# ============================================================================

async def process_all_tide_stations(db_client, region_id, stations, start_date, end_date, db_path):
    """
    Process all tide stations sequentially, fetching chunks concurrently
    and streaming directly to SQLite (no in-memory collection).

    Writes only lightweight metadata to Firestore (no prediction data).
    
    Checks for termination flag every 10 stations to allow graceful stopping.

    Returns (stations_processed, total_events, stations_failed).
    """
    semaphore = asyncio.Semaphore(NOAA_CONCURRENT_CHUNKS)
    timeout = aiohttp.ClientTimeout(total=NOAA_REQUEST_TIMEOUT, connect=10)
    connector = aiohttp.TCPConnector(limit=NOAA_CONCURRENT_CHUNKS + 2)

    stations_processed = 0
    stations_failed = 0
    total_events = 0

    chunks = date_range_chunks(start_date, end_date)

    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        for i, station in enumerate(stations):
            # Check for termination flag every 10 stations
            if i > 0 and i % 10 == 0:
                district_ref = db_client.collection('districts').document(region_id)
                district_doc = district_ref.get()
                if district_doc.exists:
                    pred_status = district_doc.to_dict().get('predictionStatus', {})
                    if pred_status.get('terminate', False):
                        logger.warning(f'  [TIDES {region_id}] Termination requested at station {i}/{len(stations)}')
                        raise Exception(f'Generation terminated by user request at station {i}/{len(stations)}')
            
            station_id = station['id']
            station_name = station.get('name', station_id)

            # Fetch all chunks concurrently for this station
            tasks = [
                fetch_tide_chunk(session, station_id, cs, ce, semaphore)
                for cs, ce in chunks
            ]
            results = await asyncio.gather(*tasks)

            # Merge results
            all_predictions = {}
            for result in results:
                if result and isinstance(result, dict):
                    all_predictions.update(result)

            if not all_predictions:
                logger.warning(f'  [{i+1}/{len(stations)}] No data: {station_name} ({station_id})')
                stations_failed += 1
                continue

            event_count = sum(len(events) for events in all_predictions.values())
            total_events += event_count
            day_count = len(all_predictions)

            # STREAM: Write directly to SQLite, then discard from memory
            write_station_to_tide_db(
                db_path, station_id, station_name,
                station.get('lat', 0), station.get('lng', 0),
                all_predictions
            )
            all_predictions.clear()  # Free memory immediately
            all_predictions = None

            # Write lightweight metadata to Firestore (for getStationLocations)
            doc_ref = (db_client.collection('districts').document(region_id)
                       .collection('tidal-stations').document(station_id))

            doc_ref.set({
                'id': station_id,
                'name': station_name,
                'lat': station.get('lat', 0),
                'lng': station.get('lng', 0),
                'type': station.get('type', 'S'),
                'predictionRange': {
                    'begin': format_date_key(start_date),
                    'end': format_date_key(end_date),
                },
                'eventCount': event_count,
                'dayCount': day_count,
                'updatedAt': firestore.SERVER_TIMESTAMP,
            })

            stations_processed += 1
            instance_id = os.environ.get('K_REVISION', 'unknown')
            logger.info(f'  [TIDES {region_id}] [{i+1}/{len(stations)}] {station_name}: {event_count} events, {day_count} days (revision: {instance_id})')


    return stations_processed, total_events, stations_failed


# ============================================================================
# Current processing: sequential stations, concurrent month chunks
# ============================================================================

async def process_all_current_stations(db_client, region_id, stations, start_date, end_date, db_path):
    """
    Process all current stations sequentially, fetching 365-day chunks concurrently
    and streaming directly to SQLite (no in-memory collection).

    Stations with noaaType='W' (weak and variable) are written to Firestore
    with metadata only -- no predictions are fetched since NOAA doesn't
    produce them for these stations.

    Writes only lightweight metadata to Firestore (no prediction data).
    
    Checks for termination flag every 10 stations to allow graceful stopping.

    Returns (stations_processed, total_months, stations_failed, stations_weak).
    """
    semaphore = asyncio.Semaphore(NOAA_CONCURRENT_CHUNKS)
    timeout = aiohttp.ClientTimeout(total=NOAA_REQUEST_TIMEOUT, connect=10)
    connector = aiohttp.TCPConnector(limit=NOAA_CONCURRENT_CHUNKS + 2)

    stations_processed = 0
    stations_failed = 0
    stations_weak = 0
    total_months = 0

    chunks = date_range_chunks(start_date, end_date)

    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        for i, station in enumerate(stations):
            # Check for termination flag every 10 stations
            if i > 0 and i % 10 == 0:
                district_ref = db_client.collection('districts').document(region_id)
                district_doc = district_ref.get()
                if district_doc.exists:
                    pred_status = district_doc.to_dict().get('predictionStatus', {})
                    if pred_status.get('terminate', False):
                        logger.warning(f'  [CURRENTS {region_id}] Termination requested at station {i}/{len(stations)}')
                        raise Exception(f'Generation terminated by user request at station {i}/{len(stations)}')
            
            station_id = station['id']
            station_name = station.get('name', station_id)
            bin_num = station.get('bin', 1)
            noaa_type = station.get('noaaType', 'S')

            # Handle weak and variable stations: write metadata, skip predictions
            if noaa_type == 'W':
                # Write to SQLite (no predictions)
                write_station_to_current_db(
                    db_path, station_id, station_name,
                    station.get('lat', 0), station.get('lng', 0),
                    'W', {}
                )

                # Write lightweight metadata to Firestore
                station_doc_ref = (db_client.collection('districts').document(region_id)
                                  .collection('current-stations').document(station_id))

                station_doc_ref.set({
                    'id': station_id,
                    'name': station_name,
                    'lat': station.get('lat', 0),
                    'lng': station.get('lng', 0),
                    'bin': bin_num,
                    'depth': station.get('depth'),
                    'depthType': station.get('depthType', 'surface'),
                    'noaaType': 'W',
                    'weakAndVariable': True,
                    'predictionRange': {
                        'begin': format_date_key(start_date),
                        'end': format_date_key(end_date),
                    },
                    'monthsAvailable': [],
                    'updatedAt': firestore.SERVER_TIMESTAMP,
                })

                stations_weak += 1
                logger.info(f'  [{i+1}/{len(stations)}] {station_name}: weak & variable (no predictions)')
                continue

            # Fetch all chunks concurrently for this station (365-day chunks)
            debug = (i == 0)
            tasks = [
                fetch_current_chunk(session, station_id, bin_num, cs, ce, semaphore, debug_first=debug)
                for cs, ce in chunks
            ]
            results = await asyncio.gather(*tasks)

            if debug:
                non_empty = sum(1 for r in results if r and len(r) > 0)
                logger.info(f'  Debug first station: {len(results)} chunks, {non_empty} non-empty')

            # Organize results by month
            all_monthly = {}
            for result in results:
                if result and isinstance(result, list) and len(result) > 0:
                    month_data = organize_currents_by_month(result)
                    for month_key, days in month_data.items():
                        if month_key not in all_monthly:
                            all_monthly[month_key] = {}
                        all_monthly[month_key].update(days)

            if not all_monthly:
                logger.warning(f'  [{i+1}/{len(stations)}] No data: {station_name} ({station_id})')
                stations_failed += 1
                continue

            # STREAM: Write directly to SQLite, then discard from memory
            event_count = write_station_to_current_db(
                db_path, station_id, station_name,
                station.get('lat', 0), station.get('lng', 0),
                noaa_type, all_monthly
            )
            months_count = len(all_monthly)
            month_keys = sorted(all_monthly.keys())
            all_monthly.clear()  # Free memory immediately
            all_monthly = None

            # Write lightweight metadata to Firestore (no predictions, no flood/ebb dirs)
            station_doc_ref = (db_client.collection('districts').document(region_id)
                              .collection('current-stations').document(station_id))

            station_doc_ref.set({
                'id': station_id,
                'name': station_name,
                'lat': station.get('lat', 0),
                'lng': station.get('lng', 0),
                'bin': bin_num,
                'depth': station.get('depth'),
                'depthType': station.get('depthType', 'surface'),
                'noaaType': noaa_type,
                'weakAndVariable': False,
                'predictionRange': {
                    'begin': format_date_key(start_date),
                    'end': format_date_key(end_date),
                },
                'monthsAvailable': month_keys,
                'updatedAt': firestore.SERVER_TIMESTAMP,
            })

            total_months += months_count
            stations_processed += 1
            instance_id = os.environ.get('K_REVISION', 'unknown')
            logger.info(f'  [CURRENTS {region_id}] [{i+1}/{len(stations)}] {station_name}: {months_count} months (revision: {instance_id})')


    return stations_processed, total_months, stations_failed, stations_weak


# ============================================================================
# JSON file helpers: write locally + upload to Storage
# ============================================================================

def upload_json_to_storage(data, storage_path, storage_client):
    """Upload a JSON-serializable object to Firebase Storage as a readable JSON file."""
    json_bytes = json.dumps(data, indent=2, ensure_ascii=False).encode('utf-8')
    bucket = storage_client.bucket(BUCKET_NAME)
    blob = bucket.blob(storage_path)
    blob.upload_from_string(json_bytes, content_type='application/json')
    size_kb = len(json_bytes) / 1024
    logger.info(f'  Uploaded JSON: {storage_path} ({size_kb:.1f} KB)')
    return len(json_bytes)


def write_tide_json_files(db_path, region_id, work_dir, storage_client):
    """
    Write tide prediction data as JSON files (reading from SQLite database).

    Produces two files:
      - tide_stations.json: station metadata summary for quick inspection
      - tides_raw.json: full raw tide predictions (station_id -> date -> events)

    Args:
        db_path: path to tide SQLite database
        region_id: district ID
        work_dir: temp directory for local files
        storage_client: GCS client

    Returns:
        dict with file sizes
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Build station metadata summary from SQLite
    station_summaries = []
    cursor.execute('SELECT id, name, lat, lng FROM stations')
    stations = cursor.fetchall()

    for station_id, name, lat, lng in stations:
        # Get date range and event count for this station
        cursor.execute(
            'SELECT MIN(date), MAX(date), COUNT(*) FROM tide_predictions WHERE station_id = ?',
            (station_id,)
        )
        min_date, max_date, event_count = cursor.fetchone()

        station_summaries.append({
            'id': station_id,
            'name': name,
            'lat': lat,
            'lng': lng,
            'type': 'S',
            'eventCount': event_count,
            'dateRange': {
                'begin': min_date if min_date else None,
                'end': max_date if max_date else None,
            },
        })

    # Write station summaries locally
    stations_path = os.path.join(work_dir, 'tide_stations.json')
    raw_path = os.path.join(work_dir, 'tides_raw.json')

    with open(stations_path, 'w') as f:
        json.dump(station_summaries, f, indent=2)

    # STREAM: Write raw predictions JSON incrementally to avoid memory issues
    with open(raw_path, 'w') as f:
        f.write('{\n')
        first_station = True
        
        for station_id, _, _, _ in stations:
            cursor.execute(
                'SELECT date, time, type, height FROM tide_predictions WHERE station_id = ? ORDER BY date, time',
                (station_id,)
            )
            predictions_by_date = {}
            for date_key, time, event_type, height in cursor.fetchall():
                if date_key not in predictions_by_date:
                    predictions_by_date[date_key] = []
                predictions_by_date[date_key].append({
                    'time': time,
                    'type': event_type,
                    'height': height,
                })
            
            if predictions_by_date:
                if not first_station:
                    f.write(',\n')
                first_station = False
                
                # Write station entry manually (indent=2 equivalent)
                f.write(f'  "{station_id}": ')
                json.dump(predictions_by_date, f, indent=2)
        
        f.write('\n}\n')

    conn.close()

    # Upload to Storage
    storage_prefix = f'{region_id}/predictions'
    stations_size = upload_json_to_storage(
        station_summaries, f'{storage_prefix}/tide_stations.json', storage_client
    )
    
    # Upload raw JSON file directly from disk (it was streamed, not built in memory)
    bucket = storage_client.bucket(BUCKET_NAME)
    blob = bucket.blob(f'{storage_prefix}/tides_raw.json')
    blob.upload_from_filename(raw_path)
    raw_size = os.path.getsize(raw_path)

    logger.info(f'  Tide JSON: stations={len(station_summaries)} (streamed to disk)')
    return {'stationsJsonBytes': stations_size, 'rawJsonBytes': raw_size}


def write_current_json_files(db_path, region_id, work_dir, storage_client):
    """
    Write current prediction data as JSON files (reading from SQLite database).

    Produces two files:
      - current_stations.json: station metadata summary for quick inspection
      - currents_raw.json: full raw current predictions (station_id -> month -> date -> events)

    Args:
        db_path: path to currents SQLite database
        region_id: district ID
        work_dir: temp directory for local files
        storage_client: GCS client

    Returns:
        dict with file sizes
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Build station metadata summary from SQLite
    station_summaries = []
    cursor.execute('SELECT id, name, lat, lng, noaa_type, weak_and_variable FROM stations')
    stations = cursor.fetchall()

    for station_id, name, lat, lng, noaa_type, weak_and_variable in stations:
        # Count months for this station (get distinct month keys from predictions)
        cursor.execute(
            'SELECT DISTINCT substr(date, 1, 7) FROM current_predictions WHERE station_id = ?',
            (station_id,)
        )
        months = cursor.fetchall()
        month_count = len(months)

        station_summaries.append({
            'id': station_id,
            'name': name,
            'lat': lat,
            'lng': lng,
            'bin': 1,  # Default, not stored in new schema
            'noaaType': noaa_type,
            'weakAndVariable': bool(weak_and_variable),
            'depth': None,  # Not stored in new schema
            'depthType': 'surface',  # Default
            'monthCount': month_count,
        })

    # Write station summaries locally
    stations_path = os.path.join(work_dir, 'current_stations.json')
    raw_path = os.path.join(work_dir, 'currents_raw.json')

    with open(stations_path, 'w') as f:
        json.dump(station_summaries, f, indent=2)

    # STREAM: Write raw predictions JSON incrementally to avoid memory issues
    # For large regions (01cgd: 724 stations × 37 months), loading all into memory
    # exceeds 4-8 GiB. Write JSON manually, one station at a time.
    raw_station_count = 0
    with open(raw_path, 'w') as f:
        f.write('{\n')
        first_station = True
        
        for station_id, _, _, _, noaa_type, weak_and_variable in stations:
            # Skip weak & variable stations (no predictions)
            if weak_and_variable:
                continue

            cursor.execute(
                'SELECT date, time, type, velocity, direction FROM current_predictions WHERE station_id = ? ORDER BY date, time',
                (station_id,)
            )

            monthly_predictions = {}
            for date_str, time, event_type, velocity, direction in cursor.fetchall():
                # Extract month key (YYYY-MM format)
                month_key = date_str[:7]
                if month_key not in monthly_predictions:
                    monthly_predictions[month_key] = {}
                if date_str not in monthly_predictions[month_key]:
                    monthly_predictions[month_key][date_str] = []

                monthly_predictions[month_key][date_str].append({
                    'time': time,
                    'type': event_type,
                    'velocity': velocity,
                    'direction': direction,
                })

            if monthly_predictions:
                if not first_station:
                    f.write(',\n')
                first_station = False
                
                # Write station entry manually (indent=2 equivalent)
                f.write(f'  "{station_id}": ')
                json.dump(monthly_predictions, f, indent=2)
                raw_station_count += 1
        
        f.write('\n}\n')
    
    conn.close()

    # Upload to Storage
    storage_prefix = f'{region_id}/predictions'
    stations_size = upload_json_to_storage(
        station_summaries, f'{storage_prefix}/current_stations.json', storage_client
    )
    
    # Upload raw JSON file directly from disk (it was streamed, not built in memory)
    bucket = storage_client.bucket(BUCKET_NAME)
    blob = bucket.blob(f'{storage_prefix}/currents_raw.json')
    blob.upload_from_filename(raw_path)
    raw_size = os.path.getsize(raw_path)

    logger.info(f'  Current JSON: stations={len(station_summaries)}, raw={raw_station_count} stations')
    return {'stationsJsonBytes': stations_size, 'rawJsonBytes': raw_size}


def compress_and_upload(db_path, storage_path, storage_client):
    """Compress SQLite database with ZIP and upload to Firebase Storage."""
    zip_path = db_path + '.zip'
    db_filename = os.path.basename(db_path)

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(db_path, db_filename)

    zip_size = os.path.getsize(zip_path)
    logger.info(f'  Compressed: {db_filename} → {zip_size / 1024 / 1024:.1f} MB')

    bucket = storage_client.bucket(BUCKET_NAME)
    blob = bucket.blob(storage_path)
    blob.upload_from_filename(zip_path, timeout=600)
    logger.info(f'  Uploaded to: {storage_path}')

    return zip_size


# ============================================================================
# Main generation endpoint
# ============================================================================

def run_prediction_generation(region_id, gen_type, years_back=1, years_forward=2, max_stations=None):
    """
    Core prediction generation logic (can be called from Flask endpoint or Job).
    
    Runs EITHER tides OR currents (not both). Each type is a completely independent
    operation that fetches data, exports metadata, compresses, and uploads.
    
    Returns: dict with results or raises exception on error
    """
    if gen_type not in ('tides', 'currents'):
        raise ValueError(f'gen_type must be "tides" or "currents", not "{gen_type}"')

    do_tides = (gen_type == 'tides')
    do_currents = (gen_type == 'currents')

    today = date.today()
    start_date = today - relativedelta(years=years_back)
    end_date = today + relativedelta(years=years_forward)

    start_time = time.time()

    # Log execution context
    instance_id = os.environ.get('K_REVISION', 'unknown')
    service_name = os.environ.get('K_SERVICE', 'unknown')
    execution_id = os.environ.get('CLOUD_RUN_EXECUTION', 'service-request')
    
    logger.info(f'=== Starting prediction generation for {region_id} (type={gen_type}) ===')
    logger.info(f'  Service: {service_name}, Revision: {instance_id}, Execution: {execution_id}')
    logger.info(f'  Date range: {start_date} to {end_date} ({years_back}y back, {years_forward}y forward)')
    logger.info(f'  Chunk concurrency: {NOAA_CONCURRENT_CHUNKS}, delay: {NOAA_INTER_REQUEST_DELAY}s')

    storage_client = storage.Client()
    db_client = firestore.Client()
    work_dir = tempfile.mkdtemp(prefix=f'predictions_{region_id}_')

    try:
        # 1. ATOMIC lock acquisition using Firestore transaction
        logger.info('Acquiring lock...')
        doc_ref = db_client.collection('districts').document(region_id)
        
        @firestore.transactional
        def acquire_lock(transaction, doc_ref):
            """Atomically check and acquire the lock."""
            snapshot = doc_ref.get(transaction=transaction)
            
            if not snapshot.exists:
                raise ValueError(f'Region {region_id} not found in Firestore')
            
            region_data = snapshot.to_dict()
            status = region_data.get('predictionStatus', {})
            
            # Check if already running
            if status.get('state') in ('generating', 'fetching_tides', 'fetching_currents', 'building_databases', 'uploading', 'cooldown'):
                started_at = status.get('startedAt')
                completed_at = status.get('completedAt')
                last_updated = status.get('lastUpdated')
                
                # If job has completedAt but state isn't 'complete', it's a stale lock
                if completed_at:
                    logger.warning(f'Found stale lock with completedAt set but state={status.get("state")}. Clearing...')
                # Check if lastUpdated is stale (>10 minutes with no update = crashed)
                elif last_updated and isinstance(last_updated, datetime):
                    idle_seconds = (datetime.now(timezone.utc) - last_updated).total_seconds()
                    if idle_seconds > 600:  # 10 minutes
                        logger.warning(f'Found stale lock with no updates for {round(idle_seconds/60, 1)} minutes. Assuming crashed. Clearing...')
                # If started_at is too recent, reject
                elif started_at and isinstance(started_at, datetime):
                    elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
                    if elapsed < 4500:  # 75 minutes
                        raise RuntimeError(json.dumps({
                            'error': 'Generation already in progress',
                            'currentState': status.get('state'),
                            'startedAt': started_at.isoformat(),
                            'elapsedSeconds': round(elapsed, 1),
                            'message': f'A {status.get("state")} job is already running for {region_id}. Started {round(elapsed/60, 1)} minutes ago.',
                        }))
            
            # Acquire lock by setting initial state
            transaction.update(doc_ref, {
                'predictionStatus': {
                    'state': 'generating',
                    'message': f'Starting {gen_type} generation...',
                    'startedAt': datetime.now(timezone.utc),
                    'lastUpdated': datetime.now(timezone.utc),
                }
            })
            
            return region_data
        
        # Execute atomic transaction
        transaction = db_client.transaction()
        try:
            region_data = acquire_lock(transaction, doc_ref)
            logger.info(f'Lock acquired for {region_id}')
        except RuntimeError as e:
            # Lock conflict - another job is running
            error_data = json.loads(str(e))
            return jsonify(error_data), 409
        except ValueError as e:
            return jsonify({'error': str(e)}), 404
        
        # 2. Read station list
        pred_config = region_data.get('predictionConfig', {})

        tide_stations = pred_config.get('tideStations', []) if do_tides else []
        current_stations = pred_config.get('currentStations', []) if do_currents else []

        if not tide_stations and not current_stations:
            return jsonify({
                'error': f'No stations in predictionConfig for {region_id} (type={gen_type}). Run discover-noaa-stations.js first.',
            }), 400

        # Limit stations if maxStations specified (for testing)
        if max_stations is not None:
            original_tide_count = len(tide_stations)
            original_current_count = len(current_stations)
            tide_stations = tide_stations[:max_stations]
            current_stations = current_stations[:max_stations]
            logger.warning(f'TEST MODE: Limited to {max_stations} stations per type')
            logger.warning(f'  Tides: {original_tide_count} → {len(tide_stations)}')
            logger.warning(f'  Currents: {original_current_count} → {len(current_stations)}')

        logger.info(f'  Found {len(tide_stations)} tide stations, {len(current_stations)} current stations (type={gen_type})')

        update_status(db_client, region_id, {
            'state': 'generating',
            'startedAt': firestore.SERVER_TIMESTAMP,
            'message': f'Generating {gen_type} predictions: {len(tide_stations)} tide + {len(current_stations)} current stations...',
        })

        # 2. Initialize SQLite databases early (streaming architecture)
        tide_db_path = None
        current_db_path = None
        
        if tide_stations:
            tide_db_path = init_tide_database(region_id, work_dir)
        if current_stations:
            current_db_path = init_current_database(region_id, work_dir)

        # 3. Fetch tide predictions from NOAA (stream directly to SQLite)
        tide_stats = {'stationsProcessed': 0, 'totalEvents': 0, 'stationsFailed': 0}
        if tide_stations:
            logger.info(f'\n--- Processing {len(tide_stations)} tide stations ---')
            update_status(db_client, region_id, {
                'state': 'fetching_tides',
                'message': f'Fetching tides: {len(tide_stations)} stations...',
            })

            loop = asyncio.new_event_loop()
            try:
                processed, events, failed = loop.run_until_complete(
                    process_all_tide_stations(db_client, region_id, tide_stations, start_date, end_date, tide_db_path)
                )
            finally:
                loop.close()

            tide_stats = {
                'stationsProcessed': processed,
                'totalEvents': events,
                'stationsFailed': failed,
            }
            elapsed = time.time() - start_time
            logger.info(f'  Tides complete: {processed} stations, {events} events, {failed} failed ({elapsed:.0f}s)')

        # 4. Fetch current predictions from NOAA (stream directly to SQLite)
        current_stats = {'stationsProcessed': 0, 'totalMonths': 0, 'stationsFailed': 0, 'stationsWeakAndVariable': 0}
        if current_stations:
            weak_station_count = sum(1 for s in current_stations if s.get('noaaType') == 'W')
            predictable_count = len(current_stations) - weak_station_count
            logger.info(f'\n--- Processing {len(current_stations)} current stations ({predictable_count} predictable, {weak_station_count} weak & variable) ---')
            update_status(db_client, region_id, {
                'state': 'fetching_currents',
                'message': f'Fetching currents: {predictable_count} predictable stations ({weak_station_count} weak & variable)...',
            })

            loop = asyncio.new_event_loop()
            try:
                processed, months, failed, weak = loop.run_until_complete(
                    process_all_current_stations(db_client, region_id, current_stations, start_date, end_date, current_db_path)
                )
            finally:
                loop.close()

            current_stats = {
                'stationsProcessed': processed,
                'totalMonths': months,
                'stationsFailed': failed,
                'stationsWeakAndVariable': weak,
            }
            elapsed = time.time() - start_time
            logger.info(f'  Currents complete: {processed} stations, {months} months, {failed} failed, {weak} weak & variable ({elapsed:.0f}s)')

        # 5. Finalize databases and write JSON files (read from SQLite)
        logger.info('\n--- Finalizing databases and writing JSON files ---')
        update_status(db_client, region_id, {
            'state': 'building_databases',
            'message': 'Finalizing SQLite databases and writing JSON inspection files...',
        })

        tide_zip_size = 0
        current_zip_size = 0

        if tide_db_path and tide_stats['stationsProcessed'] > 0:
            finalize_tide_database(tide_db_path, tide_stats['stationsProcessed'], tide_stats['totalEvents'])
            write_tide_json_files(tide_db_path, region_id, work_dir, storage_client)
            gc.collect()

        if current_db_path and current_stats['stationsProcessed'] > 0:
            finalize_current_database(
                current_db_path,
                current_stats['stationsProcessed'],
                current_stats['stationsWeakAndVariable'],
                current_stats.get('totalMonths', 0) * 30  # Approximate event count
            )
            write_current_json_files(current_db_path, region_id, work_dir, storage_client)
            gc.collect()

        # 6. Compress and upload .db.zip files
        logger.info('\n--- Compressing and uploading databases ---')
        update_status(db_client, region_id, {
            'state': 'uploading',
            'message': 'Uploading prediction databases...',
        })

        if tide_db_path and tide_stats['stationsProcessed'] > 0:
            tide_zip_size = compress_and_upload(
                tide_db_path,
                f'{region_id}/predictions/tides_{region_id}.db.zip',
                storage_client
            )

        if current_db_path and current_stats['stationsProcessed'] > 0:
            current_zip_size = compress_and_upload(
                current_db_path,
                f'{region_id}/predictions/currents_{region_id}.db.zip',
                storage_client
            )

        # 7. Update region document (merge so split runs don't overwrite each other)
        total_duration = time.time() - start_time

        prediction_data = {
            'lastGenerated': firestore.SERVER_TIMESTAMP,
            'dateRange': {
                'begin': format_date_key(start_date),
                'end': format_date_key(end_date),
                'yearsBack': years_back,
                'yearsForward': years_forward,
            },
            'generationDurationSeconds': round(total_duration, 1),
        }

        # Only update the type(s) that were actually generated
        if do_tides:
            prediction_data['tides'] = {
                'stationCount': tide_stats['stationsProcessed'],
                'stationsFailed': tide_stats['stationsFailed'],
                'totalEvents': tide_stats['totalEvents'],
                'dbSizeBytes': tide_zip_size,
                'dbSizeMB': round(tide_zip_size / 1024 / 1024, 1),
                'storagePath': f'{region_id}/predictions/tides_{region_id}.db.zip',
            }

        if do_currents:
            prediction_data['currents'] = {
                'stationCount': current_stats['stationsProcessed'],
                'stationsFailed': current_stats['stationsFailed'],
                'stationsWeakAndVariable': current_stats.get('stationsWeakAndVariable', 0),
                'totalMonths': current_stats.get('totalMonths', 0),
                'dbSizeBytes': current_zip_size,
                'dbSizeMB': round(current_zip_size / 1024 / 1024, 1),
                'storagePath': f'{region_id}/predictions/currents_{region_id}.db.zip',
            }

        region_doc_ref = db_client.collection('districts').document(region_id)
        region_doc_ref.set({
            'predictionData': prediction_data,
            'predictionStatus': {
                'state': 'complete',
                'message': f'Prediction generation ({gen_type}) complete for {region_id}',
                'completedAt': firestore.SERVER_TIMESTAMP,
            },
        }, merge=True)

        summary = {
            'status': 'success',
            'regionId': region_id,
            'type': gen_type,
            'dateRange': {
                'begin': format_date_key(start_date),
                'end': format_date_key(end_date),
            },
            'tides': tide_stats,
            'currents': current_stats,
            'tideDbSizeMB': round(tide_zip_size / 1024 / 1024, 1),
            'currentDbSizeMB': round(current_zip_size / 1024 / 1024, 1),
            'durationSeconds': round(total_duration, 1),
        }

        logger.info(f'\n=== Prediction generation ({gen_type}) complete for {region_id}: {total_duration:.1f}s ===')
        return jsonify(summary), 200

    except Exception as e:
        logger.error(f'Error generating predictions for {region_id}: {e}', exc_info=True)
        update_status(db_client, region_id, {
            'state': 'failed',
            'message': str(e)[:500],
            'failedAt': firestore.SERVER_TIMESTAMP,
        })
        return jsonify({
            'status': 'error',
            'error': str(e),
            'regionId': region_id,
        }), 500

    finally:
        import shutil
        if os.path.exists(work_dir):
            logger.info(f'Cleaning up: {work_dir}')
            shutil.rmtree(work_dir, ignore_errors=True)


# ============================================================================
# Flask endpoints
# ============================================================================

@app.route('/generate', methods=['POST'])
def generate():
    """
    HTTP endpoint to trigger prediction generation.
    
    POST body: {
        "regionId": "07cgd",
        "type": "tides"|"currents" (NOT "all" - run separately),
        "yearsBack": 1 (optional),
        "yearsForward": 2 (optional),
        "maxStations": null (optional, for testing)
    }
    
    NOTE: Tides and currents must be run as SEPARATE jobs to avoid timeout.
    """
    try:
        body = request.get_json(force=True) or {}
    except Exception:
        return jsonify({'error': 'Invalid JSON body'}), 400
    
    region_id = body.get('regionId', '').strip()
    gen_type = body.get('type', '').strip().lower()
    years_back = int(body.get('yearsBack', 1))
    years_forward = int(body.get('yearsForward', 2))
    max_stations = body.get('maxStations')
    
    if region_id not in VALID_REGIONS and not body.get('allowCustomRegion'):
        return jsonify({
            'error': f'Invalid regionId: {region_id}',
            'valid': VALID_REGIONS,
        }), 400

    if gen_type not in ('tides', 'currents'):
        return jsonify({
            'error': f'Invalid type: {gen_type}. Must be "tides" or "currents" (run separately, not "all")',
            'valid': ['tides', 'currents'],
        }), 400
    
    # Call the core generation function
    return run_prediction_generation(region_id, gen_type, years_back, years_forward, max_stations)


# ============================================================================
# Status endpoint
# ============================================================================

@app.route('/status', methods=['GET'])
def get_status():
    """Get prediction generation status for a region."""
    region_id = request.args.get('regionId', '').strip()
    allow_custom = request.args.get('allowCustomRegion', '').lower() in ('true', '1')

    if region_id not in VALID_REGIONS and not allow_custom:
        return jsonify({
            'error': f'Invalid regionId: {region_id}',
            'valid': VALID_REGIONS,
        }), 400

    try:
        db_client = firestore.Client()
        doc = db_client.collection('districts').document(region_id).get()

        if not doc.exists:
            return jsonify({
                'regionId': region_id,
                'predictionStatus': None,
                'predictionData': None,
            })

        data = doc.to_dict()
        return jsonify({
            'regionId': region_id,
            'predictionStatus': data.get('predictionStatus'),
            'predictionData': data.get('predictionData'),
            'predictionConfig': {
                'tideStationCount': len(data.get('predictionConfig', {}).get('tideStations', [])),
                'currentStationCount': len(data.get('predictionConfig', {}).get('currentStations', [])),
            },
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/clear-lock', methods=['POST'])
def clear_lock():
    """Manually clear a stale lock for a region.
    
    Use this when a generation has crashed/hung and you want to force-clear
    the lock without waiting for the 75-minute timeout.
    
    POST body: {"regionId": "07cgd"}
    """
    try:
        body = request.get_json(force=True) or {}
    except Exception:
        return jsonify({'error': 'Invalid JSON body'}), 400
    
    region_id = body.get('regionId', '').strip()

    if region_id not in VALID_REGIONS and not body.get('allowCustomRegion'):
        return jsonify({
            'error': f'Invalid regionId: {region_id}',
            'valid': VALID_REGIONS,
        }), 400

    try:
        db_client = firestore.Client()
        doc_ref = db_client.collection('districts').document(region_id)
        doc = doc_ref.get()

        if not doc.exists:
            return jsonify({'error': f'Region {region_id} not found in Firestore'}), 404

        data = doc.to_dict()
        old_status = data.get('predictionStatus', {})
        old_state = old_status.get('state')
        
        # Update to failed state to clear the lock
        doc_ref.set({
            'predictionStatus': {
                'state': 'failed',
                'message': 'Manually cleared via /clear-lock endpoint',
                'lastUpdated': datetime.now(timezone.utc),
                'clearedAt': datetime.now(timezone.utc),
                'previousState': old_state,
            }
        }, merge=True)
        
        logger.info(f'Manually cleared lock for {region_id} (was: {old_state})')
        
        return jsonify({
            'success': True,
            'regionId': region_id,
            'message': f'Lock cleared for {region_id}',
            'previousState': old_state,
            'newState': 'failed',
        })
        
    except Exception as e:
        logger.error(f'Error clearing lock: {e}')
        return jsonify({'error': str(e)}), 500


# ============================================================================
# Health check
# ============================================================================

@app.route('/', methods=['GET'])
def health():
    return jsonify({
        'service': 'prediction-generator',
        'status': 'healthy',
        'validRegions': VALID_REGIONS,
        'defaultConfig': {
            'yearsBack': 1,
            'yearsForward': 2,
        },
        'concurrency': {
            'chunksPerStation': NOAA_CONCURRENT_CHUNKS,
            'interRequestDelay': NOAA_INTER_REQUEST_DELAY,
        },
        'noaaApi': NOAA_API_BASE,
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
