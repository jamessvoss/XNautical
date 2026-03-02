#!/usr/bin/env python3
"""
Basemap Vector Tile Generator - Cloud Run Service

Downloads OpenMapTiles-format PBF vector tiles from VersaTiles and packages
them into per-zoom MBTiles files for offline use in XNautical.

Uses Natural Earth 10m land polygons for coastal buffer filtering:
tiles are only downloaded within a configurable distance (default 50nm)
of the coastline, avoiding wasteful open-ocean downloads.

Endpoints:
  POST /generate  - Generate basemap tiles for a region
  POST /package   - Combine and zip existing per-zoom packs
  GET  /estimate  - Estimate tile counts and sizes
  GET  /status    - Get generation status
  GET  /          - Health check

Data Source: VersaTiles (OpenMapTiles-format PBF vector tiles)
"""

import os
import math
import gzip
import time
import shutil
import logging
import tempfile
from pathlib import Path

from flask import Flask, request, jsonify
from google.cloud import storage, firestore

from config import (
    BUCKET_NAME, REGION_BOUNDS, STANDARD_ZOOM_PACKS,
    get_basemap_filename,
)
from tile_utils import (
    get_all_tiles_for_region, download_and_store_tiles,
    zip_and_upload_pack, combine_and_zip, update_generator_status,
    check_pack_exists, LAND_SHAPEFILE, TileDownloadError,
)

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# -- Basemap-specific configuration ------------------------------------------
TILE_URL = "https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}"
MAX_CONCURRENT = 50
REQUEST_DELAY = 0          # VersaTiles is open infrastructure
DEFAULT_BUFFER_NM = 50     # Larger buffer -- basemap shows land features
GEOMETRY_MODE = 'coastal'
LAYER_NAME = 'basemap'
STORAGE_FOLDER = 'basemaps'
STATUS_FIELD = 'basemapStatus'
DATA_FIELD = 'basemapData'
TILE_FORMAT = 'pbf'
DESCRIPTION = 'OpenMapTiles vector basemap tiles'
ATTRIBUTION = 'OpenMapTiles, OpenStreetMap contributors'
EST_TILE_SIZE_KB = 15
SKIP_STATUSES = [204, 404]
ZOOM_PACKS = STANDARD_ZOOM_PACKS
HEADERS = {
    'User-Agent': 'XNautical/1.0 (Offline Nautical Charts)',
    'Accept': 'application/x-protobuf, application/vnd.mapbox-vector-tile',
}

def compress_pbf(data):
    """Gzip-compress PBF tile data if not already compressed."""
    return gzip.compress(data) if data[:2] != b'\x1f\x8b' else data

def _combined_zip_name(region_id):
    return f'{get_basemap_filename(region_id)}.mbtiles'


# -- /generate ----------------------------------------------------------------

@app.route('/generate', methods=['POST'])
def generate_basemap():
    data = request.get_json(silent=True) or {}
    region_id = data.get('regionId', '').strip()
    buffer_nm = float(data.get('bufferNm', DEFAULT_BUFFER_NM))
    if math.isnan(buffer_nm) or math.isinf(buffer_nm) or not (1 <= buffer_nm <= 200):
        return jsonify({'error': f'bufferNm must be between 1 and 200, got {buffer_nm}'}), 400
    skip_existing = data.get('skipExisting', True)

    if region_id not in REGION_BOUNDS:
        return jsonify({'error': f'Unknown regionId: {region_id}'}), 400

    region = REGION_BOUNDS[region_id]
    start_time = time.time()
    logger.info(f'=== Starting basemap generation for {region_id} ({region["name"]}) ===')

    storage_client = storage.Client()
    bucket = storage_client.bucket(BUCKET_NAME)
    db = firestore.Client()
    work_dir = tempfile.mkdtemp(prefix=f'basemap_{region_id}_')
    basemap_filename = get_basemap_filename(region_id)

    try:
        update_generator_status(db, region_id, STATUS_FIELD, {
            'state': 'generating', 'startedAt': firestore.SERVER_TIMESTAMP,
            'message': f'Generating basemap for {region["name"]} (+/- {buffer_nm}nm)...',
        })

        pack_results = {}
        for pack_id, pack_cfg in ZOOM_PACKS.items():
            min_z, max_z = pack_cfg['minZoom'], pack_cfg['maxZoom']
            filename = f'basemap_{pack_id}.mbtiles'
            storage_path = f'{region_id}/{STORAGE_FOLDER}/{filename}'

            if skip_existing and check_pack_exists(bucket, storage_path):
                logger.info(f'  {pack_id}: exists, skipping')
                continue

            logger.info(f'--- {pack_id} (z{min_z}-z{max_z}) ---')
            all_tiles = get_all_tiles_for_region(
                region['bounds'], min_z, max_z,
                buffer_nm=buffer_nm, geometry_mode=GEOMETRY_MODE)
            if not all_tiles:
                logger.warning(f'  No tiles for {pack_id}, skipping')
                continue

            logger.info(f'  {len(all_tiles):,} tiles after coastal filter')
            db_path = Path(work_dir) / filename

            try:
                file_size, stats = download_and_store_tiles(
                    all_tiles, db_path, min_z, max_z,
                    f'{region_id} Basemap ({pack_id})', region['bounds'],
                    tile_url=TILE_URL, max_concurrent=MAX_CONCURRENT,
                    request_delay=REQUEST_DELAY, headers=HEADERS,
                    description=DESCRIPTION, format_=TILE_FORMAT,
                    attribution=ATTRIBUTION, skip_statuses=SKIP_STATUSES,
                    tile_processor=compress_pbf)
            except TileDownloadError as e:
                logger.error(f'  {pack_id} aborted: {e}')
                continue

            size_mb = file_size / 1024 / 1024
            logger.info(f'  {pack_id}: {stats["completed"]}/{stats["total"]} tiles, '
                        f'{size_mb:.1f} MB, {stats["failed"]} failed')

            update_generator_status(db, region_id, STATUS_FIELD, {
                'state': 'uploading',
                'message': f'Uploading {pack_id} basemap ({size_mb:.0f} MB)...',
            })
            bucket.blob(storage_path).upload_from_filename(str(db_path), timeout=600)

            zip_internal = f'{basemap_filename}_{pack_id}.mbtiles'
            zip_and_upload_pack(bucket, region_id, STORAGE_FOLDER,
                                db_path, zip_internal, work_dir)

            pack_results[pack_id] = {
                'filename': filename, 'storagePath': storage_path,
                'sizeMB': round(size_mb, 1), 'sizeBytes': file_size,
                'tileCount': stats['completed'], 'failedTiles': stats['failed'],
                'minZoom': min_z, 'maxZoom': max_z,
            }
            db_path.unlink(missing_ok=True)

        # Combine per-zoom packs into single zip (best-effort)
        try:
            combine_and_zip(bucket, region_id, LAYER_NAME, STORAGE_FOLDER,
                            region['bounds'], db, STATUS_FIELD, _combined_zip_name)
        except Exception as e:
            logger.warning(f'  Combined zip failed (per-zoom zips available): {e}')

        total_duration = time.time() - start_time
        db.collection('districts').document(region_id).set({
            DATA_FIELD: {
                'lastGenerated': firestore.SERVER_TIMESTAMP,
                'region': region['name'], 'bufferNm': buffer_nm,
                'packs': pack_results,
                'generationDurationSeconds': round(total_duration, 1),
            },
            STATUS_FIELD: {
                'state': 'complete',
                'message': f'Basemap generation complete for {region["name"]}',
                'completedAt': firestore.SERVER_TIMESTAMP,
            },
        }, merge=True)

        logger.info(f'=== Basemap complete for {region_id}: {total_duration:.1f}s ===')
        return jsonify({
            'status': 'success', 'regionId': region_id,
            'regionName': region['name'], 'bufferNm': buffer_nm,
            'packs': pack_results, 'durationSeconds': round(total_duration, 1),
        }), 200

    except Exception as e:
        logger.error(f'Error generating basemap for {region_id}: {e}', exc_info=True)
        update_generator_status(db, region_id, STATUS_FIELD, {
            'state': 'error', 'message': str(e)[:500],
            'failedAt': firestore.SERVER_TIMESTAMP,
        })
        return jsonify({'status': 'error', 'error': 'Internal generation error. Check logs for details.', 'regionId': region_id}), 500
    finally:
        if os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)


# -- /package -----------------------------------------------------------------

@app.route('/package', methods=['POST'])
def package_basemap():
    """Combine and zip existing per-zoom MBTiles without re-downloading."""
    data = request.get_json(silent=True) or {}
    region_id = data.get('regionId', '').strip()
    if region_id not in REGION_BOUNDS:
        return jsonify({'error': f'Invalid regionId: {region_id}',
                        'valid': sorted(REGION_BOUNDS.keys())}), 400

    region = REGION_BOUNDS[region_id]
    start_time = time.time()
    logger.info(f'=== Packaging basemap for {region_id} ===')

    bucket = storage.Client().bucket(BUCKET_NAME)
    db = firestore.Client()
    try:
        combine_and_zip(bucket, region_id, LAYER_NAME, STORAGE_FOLDER,
                        region['bounds'], db, STATUS_FIELD, _combined_zip_name)
        duration = time.time() - start_time
        return jsonify({'status': 'success', 'regionId': region_id,
                        'durationSeconds': round(duration, 1)}), 200
    except Exception as e:
        logger.error(f'Error packaging basemap for {region_id}: {e}', exc_info=True)
        return jsonify({'status': 'error', 'error': str(e)}), 500


# -- /estimate ----------------------------------------------------------------

@app.route('/estimate', methods=['GET'])
def estimate():
    """Estimate tile counts and sizes. Query: ?regionId=17cgd&bufferNm=50"""
    region_id = request.args.get('regionId', '').strip()
    buffer_nm = float(request.args.get('bufferNm', DEFAULT_BUFFER_NM))
    if region_id not in REGION_BOUNDS:
        return jsonify({'error': f'Invalid regionId: {region_id}',
                        'valid': sorted(REGION_BOUNDS.keys())}), 400

    region = REGION_BOUNDS[region_id]
    estimates = {}
    for pack_id, pack_cfg in ZOOM_PACKS.items():
        tiles = get_all_tiles_for_region(
            region['bounds'], pack_cfg['minZoom'], pack_cfg['maxZoom'],
            buffer_nm=buffer_nm, geometry_mode=GEOMETRY_MODE)
        tile_count = len(tiles)
        zoom_breakdown = {}
        for z in range(pack_cfg['minZoom'], pack_cfg['maxZoom'] + 1):
            zc = sum(1 for t in tiles if t[0] == z)
            if zc > 0:
                zoom_breakdown[f'z{z}'] = zc
        estimates[pack_id] = {
            'tileCount': tile_count,
            'estimatedSizeMB': round(tile_count * EST_TILE_SIZE_KB / 1024, 1),
            'minZoom': pack_cfg['minZoom'], 'maxZoom': pack_cfg['maxZoom'],
            'zoomBreakdown': zoom_breakdown,
        }
    return jsonify({'regionId': region_id, 'regionName': region['name'],
                    'bufferNm': buffer_nm, 'estimates': estimates})


# -- /status ------------------------------------------------------------------

@app.route('/status', methods=['GET'])
def get_status():
    """Get basemap generation status for a region."""
    region_id = request.args.get('regionId', '').strip()
    if region_id not in REGION_BOUNDS:
        return jsonify({'error': f'Invalid regionId: {region_id}',
                        'valid': sorted(REGION_BOUNDS.keys())}), 400
    try:
        doc = firestore.Client().collection('districts').document(region_id).get()
        if not doc.exists:
            return jsonify({'regionId': region_id,
                            STATUS_FIELD: None, DATA_FIELD: None})
        d = doc.to_dict()
        return jsonify({'regionId': region_id,
                        STATUS_FIELD: d.get(STATUS_FIELD),
                        DATA_FIELD: d.get(DATA_FIELD)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# -- Health check -------------------------------------------------------------

@app.route('/', methods=['GET'])
def health():
    return jsonify({
        'service': 'Basemap Vector Tile Generator', 'status': 'healthy',
        'tileSource': TILE_URL, 'tileFormat': TILE_FORMAT,
        'landDataAvailable': LAND_SHAPEFILE.exists(),
        'defaultBufferNm': DEFAULT_BUFFER_NM,
        'validRegions': sorted(REGION_BOUNDS.keys()),
        'zoomPacks': list(ZOOM_PACKS.keys()),
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
