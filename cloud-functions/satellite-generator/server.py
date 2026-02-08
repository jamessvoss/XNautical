#!/usr/bin/env python3
"""
Satellite Tile Generator - Cloud Run Service

Downloads satellite imagery tiles from ESRI World Imagery and packages them
into per-zoom-level MBTiles files for offline use in XNautical.

Uses Natural Earth 10m land polygons for coastal buffer filtering:
tiles are only downloaded if they fall within a configurable distance
(default 25nm) of the coastline, avoiding wasteful open-ocean downloads.

Endpoints:
  POST /generate  - Generate satellite tiles for a region
  GET  /estimate  - Estimate tile counts and sizes for a region
  GET  /status    - Get generation status for a region
  GET  /          - Health check

Request body for /generate:
  {
    "regionId": "11cgd",
    "bufferNm": 25          // optional, default 25 nautical miles
  }

Generates per-zoom-level packs uploaded to Firebase Storage:
  {regionId}/satellite/satellite_z0-5.mbtiles
  {regionId}/satellite/satellite_z6-7.mbtiles  
  {regionId}/satellite/satellite_z8.mbtiles
  ... up to satellite_z14.mbtiles

Download tiers in the app:
  Low    = z0-5 + z6-7
  Medium = Low + z8-11
  High   = Medium + z12-14

Data Source: ESRI World Imagery (free with attribution)
"""

import os
import sys
import time
import math
import json
import sqlite3
import logging
import asyncio
import tempfile
from pathlib import Path
from datetime import datetime, timezone

from flask import Flask, request, jsonify
from google.cloud import storage, firestore

import aiohttp
import shapefile
from shapely.geometry import shape, box as shapely_box
from shapely.ops import unary_union
from shapely.prepared import prep

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# ============================================================================
# Configuration
# ============================================================================

BUCKET_NAME = os.environ.get('STORAGE_BUCKET', 'xnautical-8a296.firebasestorage.app')

# ESRI World Imagery tile server
TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

# Download settings
MAX_CONCURRENT = 12
REQUEST_DELAY = 0.02  # seconds between requests
REQUEST_TIMEOUT = 30  # seconds per tile

# Natural Earth land data (bundled in Docker image)
LAND_SHAPEFILE = Path('/app/data/ne_10m_land/ne_10m_land.shp')

# Default coastal buffer in nautical miles
DEFAULT_BUFFER_NM = 25

# Zoom level threshold: below this, download full bounding box
# (tile counts are trivially small at low zoom levels)
COASTAL_BUFFER_MIN_ZOOM = 6

# Region bounds definitions [west, south, east, north]
REGION_BOUNDS = {
    '01cgd': {'name': 'Northeast', 'bounds': [
        {'west': -76, 'south': 39, 'east': -65, 'north': 48},
    ]},
    '05cgd': {'name': 'East', 'bounds': [
        {'west': -82, 'south': 32, 'east': -72, 'north': 42},
    ]},
    '07cgd': {'name': 'Southeast', 'bounds': [
        {'west': -85, 'south': 23, 'east': -63, 'north': 35},
    ]},
    '08cgd': {'name': 'Heartland', 'bounds': [
        {'west': -100, 'south': 23, 'east': -80, 'north': 33},
    ]},
    '09cgd': {'name': 'Great Lakes', 'bounds': [
        {'west': -94, 'south': 40, 'east': -75, 'north': 50},
    ]},
    '11cgd': {'name': 'Southwest', 'bounds': [
        {'west': -126, 'south': 30, 'east': -114, 'north': 39},
    ]},
    '13cgd': {'name': 'Northwest', 'bounds': [
        {'west': -130, 'south': 33, 'east': -119, 'north': 50},
    ]},
    '14cgd': {'name': 'Oceania', 'bounds': [
        {'west': -162, 'south': 17, 'east': -153, 'north': 24},
    ]},
    '17cgd': {'name': 'Arctic', 'bounds': [
        # Split across antimeridian
        {'west': -180, 'south': 50, 'east': -129, 'north': 72},
        {'west': 170, 'south': 50, 'east': 180, 'north': 65},
    ]},
}

# Zoom level pack definitions - one MBTiles per zoom level/range
# Follows the tiered strategy: Low = z0-5 + z6-7, Medium = Low + z8-11, High = Medium + z12-14
ZOOM_PACKS = [
    {'minZoom': 0, 'maxZoom': 5, 'filename': 'satellite_z0-5.mbtiles'},
    {'minZoom': 6, 'maxZoom': 7, 'filename': 'satellite_z6-7.mbtiles'},
    {'minZoom': 8, 'maxZoom': 8, 'filename': 'satellite_z8.mbtiles'},
    {'minZoom': 9, 'maxZoom': 9, 'filename': 'satellite_z9.mbtiles'},
    {'minZoom': 10, 'maxZoom': 10, 'filename': 'satellite_z10.mbtiles'},
    {'minZoom': 11, 'maxZoom': 11, 'filename': 'satellite_z11.mbtiles'},
    {'minZoom': 12, 'maxZoom': 12, 'filename': 'satellite_z12.mbtiles'},
    {'minZoom': 13, 'maxZoom': 13, 'filename': 'satellite_z13.mbtiles'},
    {'minZoom': 14, 'maxZoom': 14, 'filename': 'satellite_z14.mbtiles'},
]


# ============================================================================
# Tile math
# ============================================================================

def lon_to_tile_x(lon, zoom):
    return int((lon + 180.0) / 360.0 * (1 << zoom))

def lat_to_tile_y(lat, zoom):
    lat_rad = math.radians(lat)
    n = 1 << zoom
    return int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)

def tile_y_to_tms(y, zoom):
    return (1 << zoom) - 1 - y

def tile_to_bounds(z, x, y):
    """Convert XYZ tile coordinates to (west, south, east, north)."""
    n = 1 << z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return (west, south, east, north)

def get_tiles_for_bounds(bounds, zoom):
    """Get set of (z, x, y) XYZ tiles covering the bounds at a single zoom."""
    tiles = set()
    x_min = lon_to_tile_x(bounds['west'], zoom)
    x_max = lon_to_tile_x(bounds['east'], zoom)
    y_min = lat_to_tile_y(bounds['north'], zoom)
    y_max = lat_to_tile_y(bounds['south'], zoom)

    for x in range(x_min, x_max + 1):
        for y in range(y_min, y_max + 1):
            tiles.add((zoom, x, y))
    return tiles


def format_bytes(size):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


# ============================================================================
# Coastal buffer filtering using Natural Earth land polygons
# ============================================================================

# Cache the loaded land geometry per region to avoid re-loading
_land_cache = {}

def load_land_for_region(region_id, buffer_nm=DEFAULT_BUFFER_NM):
    """
    Load Natural Earth land polygons, clip to region bounds, and create
    a coastal buffer zone.

    Returns a prepared Shapely geometry representing the coastal zone
    (land boundary +/- buffer_nm nautical miles).
    """
    cache_key = f'{region_id}_{buffer_nm}'
    if cache_key in _land_cache:
        return _land_cache[cache_key]

    region = REGION_BOUNDS.get(region_id)
    if not region:
        return None

    logger.info(f'Loading Natural Earth land data for {region_id}...')
    start = time.time()

    # Create region clip box (union of all bounds for this region)
    # Expand by buffer to ensure we get land features near the edges
    buffer_deg = buffer_nm / 60.0 + 1.0  # Extra degree margin
    clip_boxes = []
    for b in region['bounds']:
        clip_boxes.append(shapely_box(
            b['west'] - buffer_deg,
            b['south'] - buffer_deg,
            b['east'] + buffer_deg,
            b['north'] + buffer_deg,
        ))
    clip_region = unary_union(clip_boxes)

    # Load shapefile and collect intersecting polygons
    reader = shapefile.Reader(str(LAND_SHAPEFILE))
    land_geometries = []

    for shape_rec in reader.iterShapeRecords():
        try:
            geom = shape(shape_rec.shape.__geo_interface__)
            if not geom.is_valid:
                geom = geom.buffer(0)
            if clip_region.intersects(geom):
                clipped = geom.intersection(clip_region)
                if not clipped.is_empty:
                    land_geometries.append(clipped)
        except Exception as e:
            continue

    if not land_geometries:
        logger.warning(f'No land features found for {region_id}')
        _land_cache[cache_key] = None
        return None

    logger.info(f'  Found {len(land_geometries)} land features for {region_id}')

    # Union all land features
    land = unary_union(land_geometries)

    # Get the coastline (boundary of land polygons)
    coastline = land.boundary

    # Buffer the coastline by the requested distance
    # 1 nautical mile = 1/60 degree of latitude
    buffer_deg = buffer_nm / 60.0
    coastal_zone = coastline.buffer(buffer_deg)

    # Prepare for fast intersection tests
    prepared = prep(coastal_zone)

    load_time = time.time() - start
    logger.info(f'  Coastal zone prepared in {load_time:.1f}s '
                f'(buffer: {buffer_nm}nm = {buffer_deg:.4f}°)')

    _land_cache[cache_key] = prepared
    return prepared


def get_coastal_tiles_for_bounds(bounds, zoom, prepared_zone):
    """
    Get tiles covering a bounding box, filtered to only those
    that intersect the coastal zone.
    """
    tiles = set()
    x_min = lon_to_tile_x(bounds['west'], zoom)
    x_max = lon_to_tile_x(bounds['east'], zoom)
    y_min = lat_to_tile_y(bounds['north'], zoom)
    y_max = lat_to_tile_y(bounds['south'], zoom)

    checked = 0
    for x in range(x_min, x_max + 1):
        for y in range(y_min, y_max + 1):
            west, south, east, north = tile_to_bounds(zoom, x, y)
            tile_box = shapely_box(west, south, east, north)
            if prepared_zone.intersects(tile_box):
                tiles.add((zoom, x, y))
            checked += 1

    return tiles, checked


def get_all_tiles_for_region(region_id, min_zoom, max_zoom, buffer_nm=DEFAULT_BUFFER_NM):
    """
    Get all tiles needed for a region across zoom levels.

    For zoom < COASTAL_BUFFER_MIN_ZOOM: full bounding box (trivial counts)
    For zoom >= COASTAL_BUFFER_MIN_ZOOM: coastal buffer filtering
    """
    region = REGION_BOUNDS.get(region_id)
    if not region:
        return set()

    # Load coastal zone geometry (cached after first call)
    coastal_zone = load_land_for_region(region_id, buffer_nm)

    all_tiles = set()

    for z in range(min_zoom, max_zoom + 1):
        if z < COASTAL_BUFFER_MIN_ZOOM or coastal_zone is None:
            # Low zoom or no coastline data: full bounding box
            for bounds in region['bounds']:
                all_tiles.update(get_tiles_for_bounds(bounds, z))
            zoom_count = sum(1 for t in all_tiles if t[0] == z)
            logger.info(f'  z{z}: {zoom_count:,} tiles (full bbox)')
        else:
            # Higher zoom: filter by coastal buffer
            zoom_tiles = set()
            total_checked = 0
            for bounds in region['bounds']:
                filtered, checked = get_coastal_tiles_for_bounds(bounds, z, coastal_zone)
                zoom_tiles.update(filtered)
                total_checked += checked
            all_tiles.update(zoom_tiles)
            pct = len(zoom_tiles) / total_checked * 100 if total_checked > 0 else 0
            logger.info(f'  z{z}: {len(zoom_tiles):,} / {total_checked:,} tiles '
                        f'({pct:.1f}% of bbox, coastal buffer)')

    return all_tiles


# ============================================================================
# MBTiles management
# ============================================================================

def init_mbtiles(db_path, min_zoom, max_zoom, name, region_bounds):
    """Initialize an MBTiles database."""
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS metadata (
            name TEXT PRIMARY KEY, value TEXT
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tiles (
            zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER,
            tile_data BLOB,
            PRIMARY KEY (zoom_level, tile_column, tile_row)
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS tiles_idx
        ON tiles (zoom_level, tile_column, tile_row)
    ''')

    west = min(b['west'] for b in region_bounds)
    south = min(b['south'] for b in region_bounds)
    east = max(b['east'] for b in region_bounds)
    north = max(b['north'] for b in region_bounds)
    center_lon = (west + east) / 2
    center_lat = (south + north) / 2

    metadata = {
        'name': name,
        'type': 'baselayer',
        'version': '1.0',
        'description': 'ESRI World Imagery satellite tiles',
        'format': 'jpg',
        'bounds': f'{west},{south},{east},{north}',
        'center': f'{center_lon},{center_lat},{min_zoom}',
        'minzoom': str(min_zoom),
        'maxzoom': str(max_zoom),
        'attribution': 'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    }

    for key, value in metadata.items():
        cursor.execute('INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)', (key, value))

    conn.commit()
    return conn


# ============================================================================
# Async tile downloader
# ============================================================================

async def download_tile(session, z, x, y, semaphore, stats):
    """Download a single tile. Returns (z, x, y, tile_data) or None."""
    async with semaphore:
        url = TILE_URL.format(z=z, y=y, x=x)
        retries = 2
        for attempt in range(retries + 1):
            try:
                await asyncio.sleep(REQUEST_DELAY)
                async with session.get(url) as response:
                    if response.status == 200:
                        data = await response.read()
                        stats['completed'] += 1
                        stats['bytes'] += len(data)
                        return (z, x, y, data)
                    elif response.status == 429:
                        # Rate limited - back off
                        await asyncio.sleep(2 ** attempt)
                        continue
                    else:
                        stats['failed'] += 1
                        return None
            except Exception:
                if attempt < retries:
                    await asyncio.sleep(1)
                    continue
                stats['failed'] += 1
                return None


async def download_tiles_async(tiles, stats):
    """Download all tiles asynchronously. Returns list of (z, x, y, data)."""
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT, connect=10)
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT * 2)
    headers = {
        'User-Agent': 'XNautical/1.0 (Offline Nautical Charts)',
        'Referer': 'https://xnautical.app',
    }

    results = []
    async with aiohttp.ClientSession(timeout=timeout, connector=connector, headers=headers) as session:
        batch_size = 5000
        tile_list = list(tiles)

        for i in range(0, len(tile_list), batch_size):
            batch = tile_list[i:i + batch_size]
            tasks = [download_tile(session, z, x, y, semaphore, stats) for z, x, y in batch]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)

            for r in batch_results:
                if r and not isinstance(r, Exception):
                    results.append(r)

            logger.info(f'  Batch {i // batch_size + 1}: '
                        f'{stats["completed"]}/{stats["total"]} downloaded, '
                        f'{stats["failed"]} failed, '
                        f'{format_bytes(stats["bytes"])}')

    return results


def download_and_store_tiles(tiles, db_path, min_zoom, max_zoom, name, region_bounds):
    """Download tiles and store in MBTiles. Returns (file_size, stats)."""
    conn = init_mbtiles(db_path, min_zoom, max_zoom, name, region_bounds)

    stats = {'total': len(tiles), 'completed': 0, 'failed': 0, 'bytes': 0}

    logger.info(f'Downloading {len(tiles):,} tiles for {name}...')

    loop = asyncio.new_event_loop()
    try:
        results = loop.run_until_complete(download_tiles_async(tiles, stats))
    finally:
        loop.close()

    # Store tiles in MBTiles (TMS y-coordinate)
    logger.info(f'Storing {len(results):,} tiles in MBTiles...')
    cursor = conn.cursor()

    # Use a transaction for faster inserts
    cursor.execute('BEGIN TRANSACTION')
    for z, x, y, data in results:
        tms_y = tile_y_to_tms(y, z)
        cursor.execute(
            'INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
            (z, x, tms_y, data)
        )
    cursor.execute('COMMIT')

    conn.close()

    file_size = db_path.stat().st_size if db_path.exists() else 0
    return file_size, stats


# ============================================================================
# Firestore helpers
# ============================================================================

def update_status(db, region_id, status):
    """Write satellite generation status to Firestore."""
    try:
        doc_ref = db.collection('districts').document(region_id)
        doc_ref.set({'satelliteStatus': status}, merge=True)
    except Exception as e:
        logger.warning(f'Failed to update Firestore status: {e}')


# ============================================================================
# Main generation endpoint
# ============================================================================

@app.route('/generate', methods=['POST'])
def generate_satellite():
    """
    Generate satellite MBTiles packs for a region.

    Request body:
      {
        "regionId": "11cgd",
        "bufferNm": 25    // optional, nautical miles from coastline
      }

    Generates three resolution packs (low/medium/high) with coastal
    buffer filtering, and uploads them to Firebase Storage.
    """
    data = request.get_json(silent=True) or {}
    region_id = data.get('regionId', '').strip()
    buffer_nm = float(data.get('bufferNm', DEFAULT_BUFFER_NM))

    if region_id not in REGION_BOUNDS:
        return jsonify({
            'error': f'Invalid regionId: {region_id}',
            'valid': sorted(REGION_BOUNDS.keys()),
        }), 400

    region = REGION_BOUNDS[region_id]
    start_time = time.time()

    logger.info(f'=== Starting satellite generation for {region_id} ({region["name"]}) ===')
    logger.info(f'  Coastal buffer: +/- {buffer_nm}nm from coastline')

    # Initialize clients
    storage_client = storage.Client()
    bucket = storage_client.bucket(BUCKET_NAME)
    db = firestore.Client()

    # Create temp working directory
    work_dir = tempfile.mkdtemp(prefix=f'satellite_{region_id}_')

    try:
        update_status(db, region_id, {
            'state': 'generating',
            'startedAt': firestore.SERVER_TIMESTAMP,
            'message': f'Generating satellite tiles for {region["name"]} '
                       f'(+/- {buffer_nm}nm coastal buffer)...',
        })

        # Pre-load coastal zone (shared across all packs)
        logger.info('Pre-loading coastal zone geometry...')
        load_land_for_region(region_id, buffer_nm)

        pack_results = {}

        for pack_config in ZOOM_PACKS:
            min_zoom = pack_config['minZoom']
            max_zoom = pack_config['maxZoom']
            filename = pack_config['filename']
            pack_name = f'z{min_zoom}' if min_zoom == max_zoom else f'z{min_zoom}-z{max_zoom}'

            logger.info(f'--- Generating {filename} ({pack_name}) ---')

            # Calculate tiles with coastal filtering
            all_tiles = get_all_tiles_for_region(region_id, min_zoom, max_zoom, buffer_nm)
            total_count = len(all_tiles)
            logger.info(f'  Total tiles (after coastal filter): {total_count:,}')

            if total_count == 0:
                logger.warning(f'  No tiles to download for {pack_name}, skipping')
                continue

            # Download and store
            db_path = Path(work_dir) / filename
            mbtiles_name = f'{region_id} Satellite ({pack_name})'

            file_size, stats = download_and_store_tiles(
                all_tiles, db_path, min_zoom, max_zoom, mbtiles_name, region['bounds']
            )

            size_mb = file_size / 1024 / 1024

            logger.info(f'  {pack_name}: {stats["completed"]}/{stats["total"]} tiles, '
                        f'{size_mb:.1f} MB, {stats["failed"]} failed')

            # Upload to Firebase Storage
            storage_path = f'{region_id}/satellite/{filename}'
            logger.info(f'  Uploading to {storage_path} ({size_mb:.1f} MB)...')

            update_status(db, region_id, {
                'state': 'uploading',
                'message': f'Uploading {pack_name} satellite pack ({size_mb:.0f} MB)...',
            })

            blob = bucket.blob(storage_path)
            blob.upload_from_filename(str(db_path), timeout=600)

            pack_results[pack_name] = {
                'filename': filename,
                'storagePath': storage_path,
                'sizeMB': round(size_mb, 1),
                'sizeBytes': file_size,
                'tileCount': stats['completed'],
                'failedTiles': stats['failed'],
                'minZoom': min_zoom,
                'maxZoom': max_zoom,
            }

            # Delete local file to free disk
            db_path.unlink(missing_ok=True)

            logger.info(f'  {pack_name} complete and uploaded.')

        # Update Firestore with results
        total_duration = time.time() - start_time

        doc_ref = db.collection('districts').document(region_id)
        doc_ref.set({
            'satelliteData': {
                'lastGenerated': firestore.SERVER_TIMESTAMP,
                'region': region['name'],
                'bufferNm': buffer_nm,
                'packs': pack_results,
                'generationDurationSeconds': round(total_duration, 1),
            },
            'satelliteStatus': {
                'state': 'complete',
                'message': f'Satellite generation complete for {region["name"]}',
                'completedAt': firestore.SERVER_TIMESTAMP,
            },
        }, merge=True)

        summary = {
            'status': 'success',
            'regionId': region_id,
            'regionName': region['name'],
            'bufferNm': buffer_nm,
            'packs': pack_results,
            'durationSeconds': round(total_duration, 1),
        }

        logger.info(f'=== Satellite generation complete for {region_id}: '
                     f'{total_duration:.1f}s ===')

        return jsonify(summary), 200

    except Exception as e:
        logger.error(f'Error generating satellite for {region_id}: {e}', exc_info=True)
        update_status(db, region_id, {
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
# Estimate endpoint
# ============================================================================

@app.route('/estimate', methods=['GET'])
def estimate():
    """
    Estimate tile counts and sizes for a region (with coastal filtering).

    Query params: ?regionId=11cgd&bufferNm=25
    """
    region_id = request.args.get('regionId', '').strip()
    buffer_nm = float(request.args.get('bufferNm', DEFAULT_BUFFER_NM))

    if region_id not in REGION_BOUNDS:
        return jsonify({
            'error': f'Invalid regionId: {region_id}',
            'valid': sorted(REGION_BOUNDS.keys()),
        }), 400

    estimates = {}
    for pack_config in ZOOM_PACKS:
        min_zoom = pack_config['minZoom']
        max_zoom = pack_config['maxZoom']
        pack_name = f'z{min_zoom}' if min_zoom == max_zoom else f'z{min_zoom}-z{max_zoom}'
        
        tiles = get_all_tiles_for_region(
            region_id, min_zoom, max_zoom, buffer_nm
        )
        tile_count = len(tiles)
        est_size_mb = tile_count * 25 / 1024  # ~25 KB avg per tile

        # Per-zoom breakdown
        zoom_breakdown = {}
        for z in range(min_zoom, max_zoom + 1):
            zc = sum(1 for t in tiles if t[0] == z)
            if zc > 0:
                zoom_breakdown[f'z{z}'] = zc

        estimates[pack_name] = {
            'filename': pack_config['filename'],
            'tileCount': tile_count,
            'estimatedSizeMB': round(est_size_mb, 1),
            'minZoom': min_zoom,
            'maxZoom': max_zoom,
            'zoomBreakdown': zoom_breakdown,
        }

    return jsonify({
        'regionId': region_id,
        'regionName': REGION_BOUNDS[region_id]['name'],
        'bufferNm': buffer_nm,
        'estimates': estimates,
    })


# ============================================================================
# Status endpoint
# ============================================================================

@app.route('/status', methods=['GET'])
def get_status():
    """Get satellite generation status for a region."""
    region_id = request.args.get('regionId', '').strip()

    if region_id not in REGION_BOUNDS:
        return jsonify({
            'error': f'Invalid regionId: {region_id}',
            'valid': sorted(REGION_BOUNDS.keys()),
        }), 400

    try:
        db = firestore.Client()
        doc = db.collection('districts').document(region_id).get()

        if not doc.exists:
            return jsonify({
                'regionId': region_id,
                'satelliteStatus': None,
                'satelliteData': None,
            })

        data = doc.to_dict()
        return jsonify({
            'regionId': region_id,
            'satelliteStatus': data.get('satelliteStatus'),
            'satelliteData': data.get('satelliteData'),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# Health check
# ============================================================================

@app.route('/', methods=['GET'])
def health():
    land_exists = LAND_SHAPEFILE.exists()
    return jsonify({
        'service': 'satellite-generator',
        'status': 'healthy',
        'landDataAvailable': land_exists,
        'defaultBufferNm': DEFAULT_BUFFER_NM,
        'coastalFilterMinZoom': COASTAL_BUFFER_MIN_ZOOM,
        'validRegions': sorted(REGION_BOUNDS.keys()),
        'zoomPacks': len(ZOOM_PACKS),
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
