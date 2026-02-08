#!/usr/bin/env python3
"""
Prediction Generator - Cloud Run Service

Fetches NOAA tide and current predictions for all stations in a region,
writes raw data to Firestore subcollections, builds SQLite databases,
and uploads compressed databases to Firebase Storage.

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
    "yearsBack": 1,       // optional, default 1
    "yearsForward": 2     // optional, default 2
  }

Firestore writes:
  districts/{regionId}/tidal-stations/{stationId}           - station metadata + predictions
  districts/{regionId}/current-stations/{stationId}         - station metadata
  districts/{regionId}/current-stations/{stationId}/predictions/{month} - packed daily strings

Firebase Storage uploads:
  {regionId}/predictions/tides.db.zip
  {regionId}/predictions/currents.db.zip
"""

import os
import sys
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
from datetime import datetime, date, timedelta
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
NOAA_MAX_DAYS_PER_REQUEST = 31  # NOAA's per-request limit
NOAA_CONCURRENT_CHUNKS = 3  # concurrent date-chunk fetches per station
NOAA_INTER_REQUEST_DELAY = 0.2  # seconds between concurrent requests

# Valid region IDs
VALID_REGIONS = ['01cgd', '05cgd', '07cgd', '08cgd', '09cgd', '11cgd', '13cgd', '14cgd', '17cgd']


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


def pack_predictions(predictions):
    """Pack current predictions into compact string: "HH:MM,f|e|s,velocity,direction|..." """
    if not predictions:
        return ''
    parts = []
    for p in predictions:
        type_char = 'f' if p['type'] == 'flood' else ('e' if p['type'] == 'ebb' else 's')
        parts.append(f"{p['time']},{type_char},{p['velocity']},{p['direction']}")
    return '|'.join(parts)


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
    """Write prediction generation status to Firestore."""
    try:
        doc_ref = db_client.collection('districts').document(region_id)
        doc_ref.set({'predictionStatus': status_dict}, merge=True)
    except Exception as e:
        logger.warning(f'Failed to update Firestore status: {e}')


# ============================================================================
# Tide processing: sequential stations, concurrent chunks
# ============================================================================

async def process_all_tide_stations(db_client, region_id, stations, start_date, end_date):
    """
    Process all tide stations sequentially, but fetch each station's
    date chunks concurrently (NOAA_CONCURRENT_CHUNKS at a time).

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

            # Write to Firestore
            doc_ref = (db_client.collection('districts').document(region_id)
                       .collection('tidal-stations').document(station_id))

            doc_ref.set({
                'id': station_id,
                'name': station_name,
                'lat': station.get('lat', 0),
                'lng': station.get('lng', 0),
                'predictionRange': {
                    'begin': format_date_key(start_date),
                    'end': format_date_key(end_date),
                },
                'predictions': all_predictions,
                'eventCount': event_count,
                'dayCount': len(all_predictions),
                'updatedAt': firestore.SERVER_TIMESTAMP,
            })

            stations_processed += 1
            logger.info(f'  [{i+1}/{len(stations)}] {station_name}: {event_count} events, {len(all_predictions)} days')

    return stations_processed, total_events, stations_failed


# ============================================================================
# Current processing: sequential stations, concurrent month chunks
# ============================================================================

async def process_all_current_stations(db_client, region_id, stations, start_date, end_date):
    """
    Process all current stations sequentially, but fetch each station's
    month chunks concurrently (NOAA_CONCURRENT_CHUNKS at a time).

    Stations with noaaType='W' (weak and variable) are written to Firestore
    with metadata only -- no predictions are fetched since NOAA doesn't
    produce them for these stations.

    Returns (stations_processed, total_months, stations_failed, stations_weak).
    """
    semaphore = asyncio.Semaphore(NOAA_CONCURRENT_CHUNKS)
    timeout = aiohttp.ClientTimeout(total=NOAA_REQUEST_TIMEOUT, connect=10)
    connector = aiohttp.TCPConnector(limit=NOAA_CONCURRENT_CHUNKS + 2)

    stations_processed = 0
    stations_failed = 0
    stations_weak = 0
    total_months = 0

    months = month_range_list(start_date, end_date)

    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        for i, station in enumerate(stations):
            station_id = station['id']
            station_name = station.get('name', station_id)
            bin_num = station.get('bin', 1)
            noaa_type = station.get('noaaType', 'S')

            # Handle weak and variable stations: write metadata, skip predictions
            if noaa_type == 'W':
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

            # Fetch all months concurrently for this station
            debug = (i == 0)
            tasks = [
                fetch_current_chunk(session, station_id, bin_num, ms, me, semaphore, debug_first=debug)
                for ms, me in months
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

            # Calculate flood/ebb directions
            sample_days = []
            for month_data in all_monthly.values():
                for day_preds in month_data.values():
                    sample_days.extend(day_preds)
                if len(sample_days) > 100:
                    break

            floods = [p for p in sample_days if p['type'] == 'flood']
            ebbs = [p for p in sample_days if p['type'] == 'ebb']
            flood_dir = round(sum(p['direction'] for p in floods) / len(floods)) if floods else 0
            ebb_dir = round(sum(p['direction'] for p in ebbs) / len(ebbs)) if ebbs else 180

            # Write station metadata
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
                'floodDirection': flood_dir,
                'ebbDirection': ebb_dir,
                'predictionRange': {
                    'begin': format_date_key(start_date),
                    'end': format_date_key(end_date),
                },
                'monthsAvailable': sorted(all_monthly.keys()),
                'updatedAt': firestore.SERVER_TIMESTAMP,
            })

            # Write packed monthly predictions
            months_saved = 0
            for month_key, days_data in sorted(all_monthly.items()):
                packed_days = {}
                for date_str, preds in days_data.items():
                    day_num = int(date_str.split('-')[2])
                    packed_days[str(day_num)] = pack_predictions(preds)

                pred_doc_ref = station_doc_ref.collection('predictions').document(month_key)
                pred_doc_ref.set({
                    'month': month_key,
                    'd': packed_days,
                    'dayCount': len(packed_days),
                    'updatedAt': firestore.SERVER_TIMESTAMP,
                })
                months_saved += 1

            total_months += months_saved
            stations_processed += 1
            logger.info(f'  [{i+1}/{len(stations)}] {station_name}: {months_saved} months')

    return stations_processed, total_months, stations_failed, stations_weak


# ============================================================================
# SQLite database builders
# ============================================================================

def build_tide_database(db_client, region_id, stations, work_dir):
    """Build SQLite tide database from Firestore data."""
    db_path = os.path.join(work_dir, 'tides.db')
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

    station_count = 0
    event_count = 0

    for station in stations:
        station_id = station['id']
        doc = (db_client.collection('districts').document(region_id)
               .collection('tidal-stations').document(station_id)).get()

        if not doc.exists:
            continue

        data = doc.to_dict()
        predictions = data.get('predictions', {})
        if not predictions:
            continue

        cursor.execute(
            'INSERT OR IGNORE INTO stations (id, name, lat, lng) VALUES (?, ?, ?, ?)',
            (station_id, data.get('name', ''), data.get('lat', 0), data.get('lng', 0))
        )
        station_count += 1

        for date_key, events in predictions.items():
            for event in events:
                cursor.execute(
                    'INSERT OR IGNORE INTO tide_predictions (station_id, date, time, type, height) VALUES (?, ?, ?, ?, ?)',
                    (station_id, date_key, event['time'], event['type'], event['height'])
                )
                event_count += 1

    cursor.execute("INSERT INTO metadata (key, value) VALUES ('version', '1.0')")
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('generated', ?)", (datetime.utcnow().isoformat(),))
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('type', 'tides')")
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('stations', ?)", (str(station_count),))
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('events', ?)", (str(event_count),))
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('regionId', ?)", (region_id,))

    conn.commit()
    cursor.execute('VACUUM')
    cursor.execute('ANALYZE')
    conn.close()

    stats = {'stationCount': station_count, 'eventCount': event_count}
    logger.info(f'  Tide DB: {station_count} stations, {event_count} events')
    return db_path, stats


def build_current_database(db_client, region_id, stations, work_dir):
    """Build SQLite current database from Firestore data."""
    db_path = os.path.join(work_dir, 'currents.db')
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

    station_count = 0
    weak_count = 0
    event_count = 0

    for station in stations:
        station_id = station['id']
        station_doc = (db_client.collection('districts').document(region_id)
                      .collection('current-stations').document(station_id)).get()

        if not station_doc.exists:
            continue

        station_data = station_doc.to_dict()
        is_weak = station_data.get('weakAndVariable', False)
        noaa_type = station_data.get('noaaType', station.get('noaaType', 'S'))

        cursor.execute(
            'INSERT OR IGNORE INTO stations (id, name, lat, lng, noaa_type, weak_and_variable) VALUES (?, ?, ?, ?, ?, ?)',
            (station_id, station_data.get('name', ''), station_data.get('lat', 0),
             station_data.get('lng', 0), noaa_type, 1 if is_weak else 0)
        )
        station_count += 1
        if is_weak:
            weak_count += 1

        # Skip prediction fetching for weak & variable stations
        if is_weak:
            continue

        pred_docs = (db_client.collection('districts').document(region_id)
                    .collection('current-stations').document(station_id)
                    .collection('predictions').stream())

        for pred_doc in pred_docs:
            month_data = pred_doc.to_dict()
            month_key = month_data.get('month', pred_doc.id)
            packed_days = month_data.get('d', {})

            for day_num_str, packed_string in packed_days.items():
                if not isinstance(packed_string, str) or not packed_string:
                    continue

                date_str = f"{month_key}-{str(day_num_str).zfill(2)}"
                events = packed_string.split('|')

                for event_str in events:
                    parts = event_str.split(',')
                    if len(parts) >= 4:
                        event_time = parts[0]
                        event_type_char = parts[1]
                        velocity = float(parts[2])
                        direction = float(parts[3]) if parts[3] else None

                        event_type = 'flood' if event_type_char == 'f' else (
                            'ebb' if event_type_char == 'e' else 'slack')

                        cursor.execute(
                            'INSERT OR IGNORE INTO current_predictions '
                            '(station_id, date, time, type, velocity, direction) '
                            'VALUES (?, ?, ?, ?, ?, ?)',
                            (station_id, date_str, event_time, event_type, velocity, direction)
                        )
                        event_count += 1

    cursor.execute("INSERT INTO metadata (key, value) VALUES ('version', '1.0')")
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('generated', ?)", (datetime.utcnow().isoformat(),))
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('type', 'currents')")
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('stations', ?)", (str(station_count),))
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('stations_weak', ?)", (str(weak_count),))
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('events', ?)", (str(event_count),))
    cursor.execute("INSERT INTO metadata (key, value) VALUES ('regionId', ?)", (region_id,))

    conn.commit()
    cursor.execute('VACUUM')
    cursor.execute('ANALYZE')
    conn.close()

    stats = {'stationCount': station_count, 'weakCount': weak_count, 'eventCount': event_count}
    logger.info(f'  Current DB: {station_count} stations ({weak_count} weak & variable), {event_count} events')
    return db_path, stats


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

@app.route('/generate', methods=['POST'])
def generate_predictions():
    """
    Generate predictions for a region.

    Pipeline:
      1. Read station list from predictionConfig
      2. Fetch tide predictions from NOAA → write to Firestore
      3. Fetch current predictions from NOAA → write to Firestore
      4. Build SQLite databases from Firestore data
      5. Compress + upload to Firebase Storage
      6. Update region document with metadata
    """
    data = request.get_json(silent=True) or {}
    region_id = data.get('regionId', '').strip()
    years_back = int(data.get('yearsBack', 1))
    years_forward = int(data.get('yearsForward', 2))

    if region_id not in VALID_REGIONS:
        return jsonify({
            'error': f'Invalid regionId: {region_id}',
            'valid': VALID_REGIONS,
        }), 400

    today = date.today()
    start_date = today - relativedelta(years=years_back)
    end_date = today + relativedelta(years=years_forward)

    start_time = time.time()

    logger.info(f'=== Starting prediction generation for {region_id} ===')
    logger.info(f'  Date range: {start_date} to {end_date} ({years_back}y back, {years_forward}y forward)')
    logger.info(f'  Chunk concurrency: {NOAA_CONCURRENT_CHUNKS}, delay: {NOAA_INTER_REQUEST_DELAY}s')

    storage_client = storage.Client()
    db_client = firestore.Client()
    work_dir = tempfile.mkdtemp(prefix=f'predictions_{region_id}_')

    try:
        # 1. Read station list
        logger.info('Reading predictionConfig from Firestore...')
        region_doc = db_client.collection('districts').document(region_id).get()

        if not region_doc.exists:
            return jsonify({'error': f'Region {region_id} not found in Firestore'}), 404

        region_data = region_doc.to_dict()
        pred_config = region_data.get('predictionConfig', {})

        tide_stations = pred_config.get('tideStations', [])
        current_stations = pred_config.get('currentStations', [])

        if not tide_stations and not current_stations:
            return jsonify({
                'error': f'No stations in predictionConfig for {region_id}. Run discover-noaa-stations.js first.',
            }), 400

        logger.info(f'  Found {len(tide_stations)} tide stations, {len(current_stations)} current stations')

        update_status(db_client, region_id, {
            'state': 'generating',
            'startedAt': firestore.SERVER_TIMESTAMP,
            'message': f'Generating predictions: {len(tide_stations)} tide + {len(current_stations)} current stations...',
        })

        # 2. Fetch tide predictions
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
                    process_all_tide_stations(db_client, region_id, tide_stations, start_date, end_date)
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

        # 3. Fetch current predictions
        current_stats = {'stationsProcessed': 0, 'totalMonths': 0, 'stationsFailed': 0, 'stationsWeakAndVariable': 0}
        if current_stations:
            # Cooldown pause between tide and current phases to avoid NOAA rate limiting
            if tide_stations:
                cooldown = 60
                logger.info(f'\n--- Cooldown: waiting {cooldown}s before current processing (NOAA rate limit) ---')
                update_status(db_client, region_id, {
                    'state': 'cooldown',
                    'message': f'Waiting {cooldown}s cooldown before current predictions...',
                })
                time.sleep(cooldown)

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
                    process_all_current_stations(db_client, region_id, current_stations, start_date, end_date)
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

        # 4. Build SQLite databases
        logger.info('\n--- Building SQLite databases ---')
        update_status(db_client, region_id, {
            'state': 'building_databases',
            'message': 'Building SQLite databases...',
        })

        tide_db_stats = None
        current_db_stats = None
        tide_zip_size = 0
        current_zip_size = 0

        if tide_stations:
            tide_db_path, tide_db_stats = build_tide_database(
                db_client, region_id, tide_stations, work_dir
            )

        if current_stations:
            current_db_path, current_db_stats = build_current_database(
                db_client, region_id, current_stations, work_dir
            )

        # 5. Compress and upload
        logger.info('\n--- Compressing and uploading ---')
        update_status(db_client, region_id, {
            'state': 'uploading',
            'message': 'Uploading prediction databases...',
        })

        if tide_stations and tide_db_stats and tide_db_stats['stationCount'] > 0:
            tide_zip_size = compress_and_upload(
                tide_db_path,
                f'{region_id}/predictions/tides.db.zip',
                storage_client
            )

        if current_stations and current_db_stats and current_db_stats['stationCount'] > 0:
            current_zip_size = compress_and_upload(
                current_db_path,
                f'{region_id}/predictions/currents.db.zip',
                storage_client
            )

        # 6. Update region document
        total_duration = time.time() - start_time

        prediction_data = {
            'lastGenerated': firestore.SERVER_TIMESTAMP,
            'dateRange': {
                'begin': format_date_key(start_date),
                'end': format_date_key(end_date),
                'yearsBack': years_back,
                'yearsForward': years_forward,
            },
            'tides': {
                'stationCount': tide_stats['stationsProcessed'],
                'stationsFailed': tide_stats['stationsFailed'],
                'totalEvents': tide_stats['totalEvents'],
                'dbSizeBytes': tide_zip_size,
                'dbSizeMB': round(tide_zip_size / 1024 / 1024, 1),
                'storagePath': f'{region_id}/predictions/tides.db.zip',
            },
            'currents': {
                'stationCount': current_stats['stationsProcessed'],
                'stationsFailed': current_stats['stationsFailed'],
                'stationsWeakAndVariable': current_stats.get('stationsWeakAndVariable', 0),
                'totalMonths': current_stats.get('totalMonths', 0),
                'dbSizeBytes': current_zip_size,
                'dbSizeMB': round(current_zip_size / 1024 / 1024, 1),
                'storagePath': f'{region_id}/predictions/currents.db.zip',
            },
            'generationDurationSeconds': round(total_duration, 1),
        }

        region_doc_ref = db_client.collection('districts').document(region_id)
        region_doc_ref.set({
            'predictionData': prediction_data,
            'predictionStatus': {
                'state': 'complete',
                'message': f'Prediction generation complete for {region_id}',
                'completedAt': firestore.SERVER_TIMESTAMP,
            },
        }, merge=True)

        summary = {
            'status': 'success',
            'regionId': region_id,
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

        logger.info(f'\n=== Prediction generation complete for {region_id}: {total_duration:.1f}s ===')
        return jsonify(summary), 200

    except Exception as e:
        logger.error(f'Error generating predictions for {region_id}: {e}', exc_info=True)
        update_status(db_client, region_id, {
            'state': 'error',
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
# Status endpoint
# ============================================================================

@app.route('/status', methods=['GET'])
def get_status():
    """Get prediction generation status for a region."""
    region_id = request.args.get('regionId', '').strip()

    if region_id not in VALID_REGIONS:
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
