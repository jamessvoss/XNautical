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
import json
import math
import time
import logging
from pathlib import Path

from flask import Flask, request, jsonify
from google.cloud import storage, firestore
from google.cloud import run_v2

from tile_utils import (
    get_all_tiles_for_region, check_pack_exists,
    update_generator_status, combine_and_zip,
    LAND_SHAPEFILE, COASTAL_BUFFER_MIN_ZOOM,
    estimate_bbox_tile_count, split_bounds_by_longitude,
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


PROJECT_ID = 'xnautical-8a296'
REGION = 'us-central1'
JOB_NAME = f'{LAYER_NAME}-generator-job'


@app.route('/generate', methods=['POST'])
def generate_terrain():
    """Launch terrain tile generation as a Cloud Run Job."""
    data = request.get_json(silent=True) or {}
    region_id = data.get('regionId', '').strip()
    buffer_nm = float(data.get('bufferNm', DEFAULT_BUFFER_NM))
    if math.isnan(buffer_nm) or math.isinf(buffer_nm) or not (1 <= buffer_nm <= 200):
        return jsonify({'error': f'bufferNm must be between 1 and 200, got {buffer_nm}'}), 400
    skip_existing = data.get('skipExisting', True)

    if region_id not in REGION_BOUNDS:
        return jsonify({'error': f'Unknown regionId: {region_id}'}), 400

    region = REGION_BOUNDS[region_id]
    logger.info(f'=== Launching terrain job for {region_id} ({region["name"]}) ===')

    storage_client = storage.Client()
    bucket = storage_client.bucket(BUCKET_NAME)
    db = firestore.Client()

    # Build list of packs that need generation
    packs_to_generate = []
    for pack_id, pc in ZOOM_PACKS.items():
        filename = f'{LAYER_NAME}_{pack_id}.mbtiles'
        storage_path = f'{region_id}/{STORAGE_FOLDER}/{filename}'
        if skip_existing and check_pack_exists(bucket, storage_path):
            logger.info(f'  {pack_id}: exists, skipping')
            continue
        packs_to_generate.append({
            'packId': pack_id,
            'minZoom': pc['minZoom'],
            'maxZoom': pc['maxZoom'],
        })

    # Split oversized packs into longitude slices
    MAX_TILES_PER_TASK = 500_000
    final_packs = []
    for pack in packs_to_generate:
        est = estimate_bbox_tile_count(region['bounds'], pack['maxZoom'])
        if est <= MAX_TILES_PER_TASK:
            final_packs.append(pack)
        else:
            slices = split_bounds_by_longitude(region['bounds'], pack['maxZoom'], MAX_TILES_PER_TASK)
            logger.info(f'  {pack["packId"]}: ~{est:,} bbox tiles, splitting into {len(slices)} tasks')
            for i, sb in enumerate(slices):
                final_packs.append({
                    'packId': f'{pack["packId"]}_s{i}',
                    'minZoom': pack['minZoom'], 'maxZoom': pack['maxZoom'],
                    'parentPack': pack['packId'],
                    'bounds': [sb],
                })
    packs_to_generate = final_packs

    if not packs_to_generate:
        logger.info(f'  All packs exist, marking complete')
        update_generator_status(db, region_id, STATUS_FIELD, {
            'state': 'complete',
            'message': f'All terrain packs already exist for {region["name"]}',
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
        'message': f'Launching {len(packs_to_generate)} terrain tasks for {region["name"]}...',
        'totalPacks': len(packs_to_generate),
        'completedPacks': 0,
    })

    # Launch Cloud Run Job
    task_count = len(packs_to_generate)
    _launch_job(manifest_path, task_count)

    pack_ids = [p['packId'] for p in packs_to_generate]
    logger.info(f'=== Terrain job launched: {task_count} tasks for {region_id} ===')
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
