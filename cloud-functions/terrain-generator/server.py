#!/usr/bin/env python3
"""
Terrain Tile Generator - Cloud Run Service

Downloads OpenTopoMap terrain tiles and packages into MBTiles
for offline use in XNautical. Uses shared tile_utils and config
modules for tile math, coastal filtering, streaming downloads,
and packaging.

Endpoints:
  POST /generate  - Generate terrain tiles for a region
  POST /package   - Combine and zip existing per-zoom packs
  GET  /estimate  - Estimate tile counts and sizes
  GET  /status    - Get generation status
  GET  /          - Health check

Data Source: OpenTopoMap (CC-BY-SA)
"""

import os
import math
import time
import shutil
import logging
import tempfile
from pathlib import Path

from flask import Flask, request, jsonify
from google.cloud import storage, firestore

from tile_utils import (
    get_all_tiles_for_region, download_and_store_tiles,
    check_pack_exists, zip_and_upload_pack,
    update_generator_status, combine_and_zip,
    LAND_SHAPEFILE, COASTAL_BUFFER_MIN_ZOOM, TileDownloadError,
)
from config import (
    BUCKET_NAME, REGION_BOUNDS, STANDARD_ZOOM_PACKS,
    get_district_prefix,
)

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# Terrain-specific configuration
TILE_URL = "https://tile.opentopomap.org/{z}/{x}/{y}.png"
MAX_CONCURRENT = 8       # Low -- OpenTopoMap is rate-limited
REQUEST_DELAY = 0.05
DEFAULT_BUFFER_NM = 25
GEOMETRY_MODE = 'coastal'
LAYER_NAME = 'terrain'
STORAGE_FOLDER = 'terrain'
STATUS_FIELD = 'terrainStatus'
DATA_FIELD = 'terrainData'
TILE_FORMAT = 'png'
DESCRIPTION = 'OpenTopoMap terrain tiles'
ATTRIBUTION = ('Map data: OpenStreetMap contributors, SRTM | '
               'Map style: OpenTopoMap (CC-BY-SA)')
EST_TILE_SIZE_KB = 25
ZOOM_PACKS = STANDARD_ZOOM_PACKS


def _get_zip_internal_name(region_id):
    return f'{get_district_prefix(region_id)}_terrain.mbtiles'


@app.route('/generate', methods=['POST'])
def generate_terrain():
    """Generate terrain MBTiles packs for a region."""
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
    logger.info(f'=== Starting terrain generation for {region_id} ({region["name"]}) ===')

    storage_client = storage.Client()
    bucket = storage_client.bucket(BUCKET_NAME)
    db = firestore.Client()
    work_dir = tempfile.mkdtemp(prefix=f'terrain_{region_id}_')

    try:
        update_generator_status(db, region_id, STATUS_FIELD, {
            'state': 'generating', 'startedAt': firestore.SERVER_TIMESTAMP,
            'message': f'Generating terrain for {region["name"]} (+/-{buffer_nm}nm)...',
        })

        pack_results = {}
        for pack_id, pc in ZOOM_PACKS.items():
            min_z, max_z = pc['minZoom'], pc['maxZoom']
            filename = f'terrain_{pack_id}.mbtiles'
            storage_path = f'{region_id}/{STORAGE_FOLDER}/{filename}'

            if skip_existing and check_pack_exists(bucket, storage_path):
                logger.info(f'  {pack_id}: exists, skipping')
                continue

            logger.info(f'--- {pack_id} (z{min_z}-z{max_z}) ---')
            tiles = get_all_tiles_for_region(
                region['bounds'], min_z, max_z,
                buffer_nm=buffer_nm, geometry_mode=GEOMETRY_MODE)
            if not tiles:
                logger.warning(f'  No tiles for {pack_id}, skipping')
                continue

            logger.info(f'  {len(tiles):,} tiles after coastal filter')
            db_path = Path(work_dir) / filename

            try:
                file_size, stats = download_and_store_tiles(
                    tiles, db_path, min_z, max_z,
                    f'{region_id} Terrain ({pack_id})', region['bounds'],
                    tile_url=TILE_URL, max_concurrent=MAX_CONCURRENT,
                    request_delay=REQUEST_DELAY, description=DESCRIPTION,
                    format_=TILE_FORMAT, attribution=ATTRIBUTION)
            except TileDownloadError as e:
                logger.error(f'  {pack_id} aborted: {e}')
                continue

            size_mb = file_size / 1024 / 1024
            logger.info(f'  {pack_id}: {stats["completed"]}/{stats["total"]} tiles, '
                        f'{size_mb:.1f} MB, {stats["failed"]} failed')

            update_generator_status(db, region_id, STATUS_FIELD, {
                'state': 'uploading',
                'message': f'Uploading {pack_id} ({size_mb:.0f} MB)...',
            })
            bucket.blob(storage_path).upload_from_filename(str(db_path), timeout=600)

            dp = get_district_prefix(region_id)
            zip_and_upload_pack(bucket, region_id, STORAGE_FOLDER, db_path,
                                f'{dp}_terrain_{pack_id}.mbtiles', work_dir)

            pack_results[pack_id] = {
                'filename': filename, 'storagePath': storage_path,
                'sizeMB': round(size_mb, 1), 'sizeBytes': file_size,
                'tileCount': stats['completed'], 'failedTiles': stats['failed'],
                'minZoom': min_z, 'maxZoom': max_z,
            }
            db_path.unlink(missing_ok=True)
            logger.info(f'  {pack_id} complete.')

        # Combine per-zoom packs into single zip (best-effort)
        try:
            combine_and_zip(bucket, region_id, LAYER_NAME, STORAGE_FOLDER,
                            region['bounds'], db, STATUS_FIELD, _get_zip_internal_name)
        except Exception as e:
            logger.warning(f'  Combined zip failed (per-zoom zips still available): {e}')

        duration = time.time() - start_time
        db.collection('districts').document(region_id).set({
            DATA_FIELD: {
                'lastGenerated': firestore.SERVER_TIMESTAMP,
                'region': region['name'], 'bufferNm': buffer_nm,
                'packs': pack_results,
                'generationDurationSeconds': round(duration, 1),
            },
            STATUS_FIELD: {
                'state': 'complete',
                'message': f'Terrain generation complete for {region["name"]}',
                'completedAt': firestore.SERVER_TIMESTAMP,
            },
        }, merge=True)

        logger.info(f'=== Terrain complete for {region_id}: {duration:.1f}s ===')
        return jsonify({'status': 'success', 'regionId': region_id,
                        'regionName': region['name'], 'bufferNm': buffer_nm,
                        'packs': pack_results,
                        'durationSeconds': round(duration, 1)}), 200

    except Exception as e:
        logger.error(f'Error generating terrain for {region_id}: {e}', exc_info=True)
        update_generator_status(db, region_id, STATUS_FIELD, {
            'state': 'error', 'message': str(e)[:500],
            'failedAt': firestore.SERVER_TIMESTAMP,
        })
        return jsonify({'status': 'error', 'error': 'Internal generation error. Check logs for details.',
                        'regionId': region_id}), 500
    finally:
        if os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)


@app.route('/package', methods=['POST'])
def package_terrain():
    """Combine and zip existing per-zoom MBTiles from storage."""
    data = request.get_json(silent=True) or {}
    region_id = data.get('regionId', '').strip()

    if region_id not in REGION_BOUNDS:
        return jsonify({'error': f'Invalid regionId: {region_id}',
                        'valid': sorted(REGION_BOUNDS.keys())}), 400

    region = REGION_BOUNDS[region_id]
    start_time = time.time()
    logger.info(f'=== Packaging terrain for {region_id} ({region["name"]}) ===')

    bucket = storage.Client().bucket(BUCKET_NAME)
    db = firestore.Client()

    try:
        combine_and_zip(bucket, region_id, LAYER_NAME, STORAGE_FOLDER,
                        region['bounds'], db, STATUS_FIELD, _get_zip_internal_name)
        duration = time.time() - start_time
        logger.info(f'=== Terrain packaging complete: {duration:.1f}s ===')
        return jsonify({'status': 'success', 'regionId': region_id,
                        'durationSeconds': round(duration, 1)}), 200
    except Exception as e:
        logger.error(f'Error packaging terrain for {region_id}: {e}', exc_info=True)
        return jsonify({'status': 'error', 'error': str(e)}), 500


@app.route('/estimate', methods=['GET'])
def estimate():
    """Estimate tile counts and sizes for a region."""
    region_id = request.args.get('regionId', '').strip()
    buffer_nm = float(request.args.get('bufferNm', DEFAULT_BUFFER_NM))

    if region_id not in REGION_BOUNDS:
        return jsonify({'error': f'Invalid regionId: {region_id}',
                        'valid': sorted(REGION_BOUNDS.keys())}), 400

    region = REGION_BOUNDS[region_id]
    estimates = {}
    for pack_id, pc in ZOOM_PACKS.items():
        tiles = get_all_tiles_for_region(
            region['bounds'], pc['minZoom'], pc['maxZoom'],
            buffer_nm=buffer_nm, geometry_mode=GEOMETRY_MODE)
        tile_count = len(tiles)
        zoom_breakdown = {}
        for z in range(pc['minZoom'], pc['maxZoom'] + 1):
            zc = sum(1 for t in tiles if t[0] == z)
            if zc > 0:
                zoom_breakdown[f'z{z}'] = zc
        estimates[pack_id] = {
            'tileCount': tile_count,
            'estimatedSizeMB': round(tile_count * EST_TILE_SIZE_KB / 1024, 1),
            'minZoom': pc['minZoom'], 'maxZoom': pc['maxZoom'],
            'zoomBreakdown': zoom_breakdown,
        }

    return jsonify({'regionId': region_id, 'regionName': region['name'],
                    'bufferNm': buffer_nm, 'estimates': estimates})


@app.route('/status', methods=['GET'])
def get_status():
    """Get terrain generation status for a region."""
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


@app.route('/', methods=['GET'])
def health():
    return jsonify({
        'service': 'terrain-generator',
        'status': 'healthy',
        'landDataAvailable': LAND_SHAPEFILE.exists(),
        'defaultBufferNm': DEFAULT_BUFFER_NM,
        'coastalFilterMinZoom': COASTAL_BUFFER_MIN_ZOOM,
        'validRegions': sorted(REGION_BOUNDS.keys()),
        'zoomPacks': list(ZOOM_PACKS.keys()),
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
