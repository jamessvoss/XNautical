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
import json
import math
import time
import logging
from pathlib import Path

from flask import Flask, request, jsonify
from google.cloud import storage, firestore
from google.cloud import run_v2

from config import (
    BUCKET_NAME, REGION_BOUNDS, SATELLITE_ZOOM_PACKS,
    get_district_prefix,
)
from tile_utils import (
    LAND_SHAPEFILE, COASTAL_BUFFER_MIN_ZOOM,
    get_all_tiles_for_region, check_pack_exists,
    combine_and_zip, update_generator_status,
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

PROJECT_ID = 'xnautical-8a296'
REGION = 'us-central1'
JOB_NAME = f'{LAYER_NAME}-generator-job'


# ============================================================================
# Main generation endpoint
# ============================================================================

@app.route('/generate', methods=['POST'])
def generate_satellite():
    """Launch satellite tile generation as a Cloud Run Job."""
    data = request.get_json(silent=True) or {}
    region_id = data.get('regionId', '').strip()
    buffer_nm = float(data.get('bufferNm', DEFAULT_BUFFER_NM))
    if math.isnan(buffer_nm) or math.isinf(buffer_nm) or not (1 <= buffer_nm <= 200):
        return jsonify({'error': f'bufferNm must be between 1 and 200, got {buffer_nm}'}), 400
    skip_existing = data.get('skipExisting', True)

    if region_id not in REGION_BOUNDS:
        return jsonify({'error': f'Unknown regionId: {region_id}'}), 400

    region = REGION_BOUNDS[region_id]
    logger.info(f'=== Launching satellite job for {region_id} ({region["name"]}) ===')

    storage_client = storage.Client()
    bucket = storage_client.bucket(BUCKET_NAME)
    db = firestore.Client()

    # Build list of packs that need generation
    packs_to_generate = []
    for pack_id, pack_config in ZOOM_PACKS.items():
        filename = f'{LAYER_NAME}_{pack_id}.mbtiles'
        storage_path = f'{region_id}/{STORAGE_FOLDER}/{filename}'
        if skip_existing and check_pack_exists(bucket, storage_path):
            logger.info(f'  {pack_id}: exists, skipping')
            continue
        packs_to_generate.append({
            'packId': pack_id,
            'minZoom': pack_config['minZoom'],
            'maxZoom': pack_config['maxZoom'],
        })

    if not packs_to_generate:
        logger.info(f'  All packs exist, marking complete')
        update_generator_status(db, region_id, STATUS_FIELD, {
            'state': 'complete',
            'message': f'All satellite packs already exist for {region["name"]}',
            'completedAt': firestore.SERVER_TIMESTAMP,
        })
        return jsonify({'status': 'complete', 'regionId': region_id,
                        'message': 'All packs already exist'}), 200

    # Upload manifest
    manifest = {
        'regionId': region_id,
        'regionName': region['name'],
        'bounds': region['bounds'],
        'bufferNm': buffer_nm,
        'config': {
            'tileUrl': TILE_URL,
            'maxConcurrent': MAX_CONCURRENT,
            'requestDelay': REQUEST_DELAY,
            'geometryMode': GEOMETRY_MODE,
            'format': TILE_FORMAT,
            'description': DESCRIPTION,
            'attribution': ATTRIBUTION,
            'layerName': LAYER_NAME,
            'storageFolder': STORAGE_FOLDER,
            'statusField': STATUS_FIELD,
            'dataField': DATA_FIELD,
        },
        'packs': packs_to_generate,
    }

    manifest_path = f'{region_id}/{STORAGE_FOLDER}/_manifest.json'
    bucket.blob(manifest_path).upload_from_string(
        json.dumps(manifest), content_type='application/json')

    # Clean stale job results
    for blob in bucket.list_blobs(prefix=f'{region_id}/{STORAGE_FOLDER}/_job_results/'):
        blob.delete()

    # Set Firestore status
    update_generator_status(db, region_id, STATUS_FIELD, {
        'state': 'generating',
        'startedAt': firestore.SERVER_TIMESTAMP,
        'message': f'Launching {len(packs_to_generate)} satellite tasks for {region["name"]}...',
        'totalPacks': len(packs_to_generate),
        'completedPacks': 0,
    })

    # Launch Cloud Run Job
    task_count = len(packs_to_generate)
    _launch_job(manifest_path, task_count)

    pack_ids = [p['packId'] for p in packs_to_generate]
    logger.info(f'=== Satellite job launched: {task_count} tasks for {region_id} ===')
    return jsonify({
        'status': 'launched', 'regionId': region_id,
        'taskCount': task_count, 'packs': pack_ids,
    }), 200


def _launch_job(manifest_path, task_count):
    """Launch a Cloud Run Job with the given manifest and task count."""
    client = run_v2.JobsClient()
    job_name = f'projects/{PROJECT_ID}/locations/{REGION}/jobs/{JOB_NAME}'

    override = run_v2.types.RunJobRequest.Overrides(
        task_count=task_count,
        container_overrides=[
            run_v2.types.RunJobRequest.Overrides.ContainerOverride(
                env=[
                    run_v2.types.EnvVar(name='MANIFEST_PATH', value=manifest_path),
                    run_v2.types.EnvVar(name='BUCKET_NAME', value=BUCKET_NAME),
                ],
            ),
        ],
    )

    req = run_v2.types.RunJobRequest(name=job_name, overrides=override)
    operation = client.run_job(request=req)
    logger.info(f'  Job launched: {operation.metadata.name if hasattr(operation, "metadata") else "ok"}')


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
