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
  POST /package   - Zip existing per-zoom MBTiles individually
  GET  /estimate  - Estimate tile counts and sizes for a region
  GET  /status    - Get generation status for a region
  GET  /          - Health check

Data Source: ESRI World Imagery (free with attribution)
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

from config import (
    BUCKET_NAME, REGION_BOUNDS, SATELLITE_ZOOM_PACKS,
    get_district_prefix,
)
from tile_utils import (
    LAND_SHAPEFILE, COASTAL_BUFFER_MIN_ZOOM,
    get_all_tiles_for_region, download_and_store_tiles,
    check_pack_exists, zip_and_upload_pack, combine_and_zip,
    update_generator_status, format_bytes, TileDownloadError,
)

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# ============================================================================
# Satellite-specific configuration
# ============================================================================

TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
MAX_CONCURRENT = 30
REQUEST_DELAY = 0.05
DEFAULT_BUFFER_NM = 25
GEOMETRY_MODE = 'coastal'
LAYER_NAME = 'satellite'
STORAGE_FOLDER = 'satellite'
STATUS_FIELD = 'satelliteStatus'
DATA_FIELD = 'satelliteData'
TILE_FORMAT = 'jpg'
DESCRIPTION = 'ESRI World Imagery satellite tiles'
ATTRIBUTION = 'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
EST_TILE_SIZE_KB = 25

ZOOM_PACKS = SATELLITE_ZOOM_PACKS


# ============================================================================
# Main generation endpoint
# ============================================================================

@app.route('/generate', methods=['POST'])
def generate_satellite():
    """Generate satellite MBTiles packs for a region."""
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

    logger.info(f'=== Starting satellite generation for {region_id} ({region["name"]}) ===')
    logger.info(f'  Coastal buffer: +/- {buffer_nm}nm from coastline')

    storage_client = storage.Client()
    bucket = storage_client.bucket(BUCKET_NAME)
    db = firestore.Client()
    work_dir = tempfile.mkdtemp(prefix=f'satellite_{region_id}_')

    try:
        update_generator_status(db, region_id, STATUS_FIELD, {
            'state': 'generating',
            'startedAt': firestore.SERVER_TIMESTAMP,
            'message': f'Generating satellite tiles for {region["name"]} '
                       f'(+/- {buffer_nm}nm coastal buffer)...',
        })

        pack_results = {}
        district_prefix = get_district_prefix(region_id)

        for pack_id, pack_config in ZOOM_PACKS.items():
            min_zoom = pack_config['minZoom']
            max_zoom = pack_config['maxZoom']
            filename = f'satellite_{pack_id}.mbtiles'

            # Skip if already exists in Storage
            storage_path = f'{region_id}/{STORAGE_FOLDER}/{filename}'
            if skip_existing and check_pack_exists(bucket, storage_path):
                logger.info(f'  {pack_id}: already exists at {storage_path}, skipping')
                continue

            logger.info(f'--- Generating {pack_id} (z{min_zoom}-z{max_zoom}) ---')

            # Calculate tiles with coastal filtering
            all_tiles = get_all_tiles_for_region(
                region['bounds'], min_zoom, max_zoom,
                buffer_nm=buffer_nm, geometry_mode=GEOMETRY_MODE)
            total_count = len(all_tiles)
            logger.info(f'  Total tiles (after coastal filter): {total_count:,}')

            if total_count == 0:
                logger.warning(f'  No tiles to download for {pack_id}, skipping')
                continue

            # Download with streaming writes
            db_path = Path(work_dir) / filename
            mbtiles_name = f'{region_id} Satellite ({pack_id})'

            try:
                file_size, stats = download_and_store_tiles(
                    all_tiles, db_path, min_zoom, max_zoom, mbtiles_name,
                    region['bounds'],
                    tile_url=TILE_URL,
                    max_concurrent=MAX_CONCURRENT,
                    request_delay=REQUEST_DELAY,
                    description=DESCRIPTION,
                    format_=TILE_FORMAT,
                    attribution=ATTRIBUTION,
                )
            except TileDownloadError as e:
                logger.error(f'  {pack_id} aborted: {e}')
                db_path.unlink(missing_ok=True)
                continue

            size_mb = file_size / 1024 / 1024
            logger.info(f'  {pack_id}: {stats["completed"]}/{stats["total"]} tiles, '
                        f'{size_mb:.1f} MB, {stats["failed"]} failed')

            # Upload raw MBTiles
            logger.info(f'  Uploading to {storage_path} ({size_mb:.1f} MB)...')
            update_generator_status(db, region_id, STATUS_FIELD, {
                'state': 'uploading',
                'message': f'Uploading {pack_id} satellite pack ({size_mb:.0f} MB)...',
            })
            blob = bucket.blob(storage_path)
            blob.upload_from_filename(str(db_path), timeout=600)

            # Zip and upload
            zip_internal_name = f'{district_prefix}_satellite_{pack_id}.mbtiles'
            zip_and_upload_pack(bucket, region_id, STORAGE_FOLDER, db_path,
                                zip_internal_name, work_dir)

            pack_results[pack_id] = {
                'filename': filename,
                'storagePath': storage_path,
                'sizeMB': round(size_mb, 1),
                'sizeBytes': file_size,
                'tileCount': stats['completed'],
                'failedTiles': stats['failed'],
                'minZoom': min_zoom,
                'maxZoom': max_zoom,
            }

            db_path.unlink(missing_ok=True)
            logger.info(f'  {pack_id} complete and uploaded.')

        # Combine per-zoom packs into single zip (best-effort)
        try:
            combine_and_zip(
                bucket, region_id, LAYER_NAME, STORAGE_FOLDER,
                region['bounds'], db, STATUS_FIELD,
                get_zip_internal_name=lambda rid: f'{get_district_prefix(rid)}_{LAYER_NAME}.mbtiles',
            )
        except Exception as e:
            logger.warning(f'  Combined zip failed (per-zoom zips still available): {e}')

        # Update Firestore with results
        total_duration = time.time() - start_time
        doc_ref = db.collection('districts').document(region_id)
        doc_ref.set({
            DATA_FIELD: {
                'lastGenerated': firestore.SERVER_TIMESTAMP,
                'region': region['name'],
                'bufferNm': buffer_nm,
                'packs': pack_results,
                'generationDurationSeconds': round(total_duration, 1),
            },
            STATUS_FIELD: {
                'state': 'complete',
                'message': f'Satellite generation complete for {region["name"]}',
                'completedAt': firestore.SERVER_TIMESTAMP,
            },
        }, merge=True)

        logger.info(f'=== Satellite generation complete for {region_id}: '
                     f'{total_duration:.1f}s ===')

        return jsonify({
            'status': 'success',
            'regionId': region_id,
            'regionName': region['name'],
            'bufferNm': buffer_nm,
            'packs': pack_results,
            'durationSeconds': round(total_duration, 1),
        }), 200

    except Exception as e:
        logger.error(f'Error generating satellite for {region_id}: {e}', exc_info=True)
        update_generator_status(db, region_id, STATUS_FIELD, {
            'state': 'error',
            'message': str(e)[:500],
            'failedAt': firestore.SERVER_TIMESTAMP,
        })
        return jsonify({
            'status': 'error',
            'error': 'Internal generation error. Check logs for details.',
            'regionId': region_id,
        }), 500

    finally:
        if os.path.exists(work_dir):
            logger.info(f'Cleaning up: {work_dir}')
            shutil.rmtree(work_dir, ignore_errors=True)


# ============================================================================
# Package endpoint - zip existing per-zoom MBTiles individually
# ============================================================================

@app.route('/package', methods=['POST'])
def package_satellite():
    """Combine and zip existing per-zoom satellite MBTiles from storage."""
    data = request.get_json(silent=True) or {}
    region_id = data.get('regionId', '').strip()

    if region_id not in REGION_BOUNDS:
        return jsonify({
            'error': f'Invalid regionId: {region_id}',
            'valid': sorted(REGION_BOUNDS.keys()),
        }), 400

    region = REGION_BOUNDS[region_id]
    start_time = time.time()
    logger.info(f'=== Packaging satellite for {region_id} ({region["name"]}) ===')

    bucket = storage.Client().bucket(BUCKET_NAME)
    db = firestore.Client()

    try:
        combine_and_zip(
            bucket, region_id, LAYER_NAME, STORAGE_FOLDER,
            region['bounds'], db, STATUS_FIELD,
            get_zip_internal_name=lambda rid: f'{get_district_prefix(rid)}_{LAYER_NAME}.mbtiles',
        )
        duration = time.time() - start_time
        logger.info(f'=== Satellite packaging complete for {region_id}: {duration:.1f}s ===')
        return jsonify({
            'status': 'success',
            'regionId': region_id,
            'durationSeconds': round(duration, 1),
        }), 200

    except Exception as e:
        logger.error(f'Error packaging satellite for {region_id}: {e}', exc_info=True)
        return jsonify({'status': 'error', 'error': str(e)}), 500


# ============================================================================
# Estimate endpoint
# ============================================================================

@app.route('/estimate', methods=['GET'])
def estimate():
    """Estimate tile counts and sizes for a region (with coastal filtering)."""
    region_id = request.args.get('regionId', '').strip()
    buffer_nm = float(request.args.get('bufferNm', DEFAULT_BUFFER_NM))

    if region_id not in REGION_BOUNDS:
        return jsonify({
            'error': f'Invalid regionId: {region_id}',
            'valid': sorted(REGION_BOUNDS.keys()),
        }), 400

    region = REGION_BOUNDS[region_id]
    estimates = {}

    for pack_id, pack_config in ZOOM_PACKS.items():
        min_zoom = pack_config['minZoom']
        max_zoom = pack_config['maxZoom']

        tiles = get_all_tiles_for_region(
            region['bounds'], min_zoom, max_zoom,
            buffer_nm=buffer_nm, geometry_mode=GEOMETRY_MODE)
        tile_count = len(tiles)
        est_size_mb = tile_count * EST_TILE_SIZE_KB / 1024

        zoom_breakdown = {}
        for z in range(min_zoom, max_zoom + 1):
            zc = sum(1 for t in tiles if t[0] == z)
            if zc > 0:
                zoom_breakdown[f'z{z}'] = zc

        estimates[pack_id] = {
            'tileCount': tile_count,
            'estimatedSizeMB': round(est_size_mb, 1),
            'minZoom': min_zoom,
            'maxZoom': max_zoom,
            'zoomBreakdown': zoom_breakdown,
        }

    return jsonify({
        'regionId': region_id,
        'regionName': region['name'],
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
                STATUS_FIELD: None,
                DATA_FIELD: None,
            })

        doc_data = doc.to_dict()
        return jsonify({
            'regionId': region_id,
            STATUS_FIELD: doc_data.get(STATUS_FIELD),
            DATA_FIELD: doc_data.get(DATA_FIELD),
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
        'zoomPacks': list(ZOOM_PACKS.keys()),
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
