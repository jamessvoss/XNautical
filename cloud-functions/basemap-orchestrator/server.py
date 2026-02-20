"""
District Pipeline Orchestrator
===============================
Lightweight Cloud Run service that orchestrates the full data generation
pipeline for a USCG Coast Guard District.

Pipeline Steps:
  1. ENC Download   - Download S-57 source charts from NOAA
  2. ENC Convert    - Convert S-57 → MBTiles (parallel batches)
  3. Tile Generators - Satellite, Ocean, Terrain, Basemap (parallel)
  4. Predictions    - NOAA tide & current predictions (sequential)
  5. Metadata       - Aggregate download-metadata.json

Endpoints:
  POST /pipeline         - Run full pipeline for a district
  POST /generate-all     - Run tile generators only (satellite, ocean, terrain, basemap)
  POST /generate         - Run a single generator
  GET  /status           - Get status for a district
  GET  /                 - Health check
"""

import os
import json
import time
import logging
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Flask, request, jsonify

app = Flask(__name__)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# ============================================================================
# Configuration
# ============================================================================

# Service URLs (set via environment variables, with sensible defaults)
SERVICE_URLS = {
    'enc-downloader': os.environ.get('ENC_DOWNLOADER_URL', ''),
    'enc-converter': os.environ.get('ENC_CONVERTER_URL', ''),
    'satellite': os.environ.get('SATELLITE_GENERATOR_URL', ''),
    'ocean': os.environ.get('OCEAN_GENERATOR_URL', ''),
    'terrain': os.environ.get('TERRAIN_GENERATOR_URL', ''),
    'basemap': os.environ.get('BASEMAP_GENERATOR_URL', ''),
    'predictions': os.environ.get('PREDICTION_GENERATOR_URL', ''),
    'metadata': os.environ.get('METADATA_GENERATOR_URL', ''),
}

# Tile generator types (the subset that runs in parallel during step 3)
TILE_GENERATOR_TYPES = {'satellite', 'ocean', 'terrain', 'basemap'}

# Timeouts per step (seconds)
TIMEOUTS = {
    'enc-downloader': int(os.environ.get('ENC_DOWNLOAD_TIMEOUT', '1800')),   # 30 min
    'enc-converter': int(os.environ.get('ENC_CONVERT_TIMEOUT', '7200')),     # 2 hours
    'satellite': int(os.environ.get('GENERATOR_TIMEOUT', '3600')),           # 1 hour
    'ocean': int(os.environ.get('GENERATOR_TIMEOUT', '3600')),
    'terrain': int(os.environ.get('GENERATOR_TIMEOUT', '3600')),
    'basemap': int(os.environ.get('GENERATOR_TIMEOUT', '3600')),
    'predictions': int(os.environ.get('PREDICTION_TIMEOUT', '3600')),        # 1 hour
    'metadata': int(os.environ.get('METADATA_TIMEOUT', '300')),              # 5 min
}

# Valid region IDs
VALID_REGIONS = {
    '01cgd', '05cgd', '07cgd', '08cgd', '09cgd',
    '11cgd', '13cgd', '14cgd', '17cgd',
}

# Pipeline steps in order
PIPELINE_STEPS = [
    'enc-download',
    'enc-convert',
    'tile-generators',
    'predictions',
    'metadata',
]


# ============================================================================
# Helper: call a service endpoint
# ============================================================================

def call_service(service_name, endpoint, body, timeout=None):
    """
    POST to a service endpoint. Returns a result dict with success/failure info.
    """
    url = SERVICE_URLS.get(service_name)
    if not url:
        return {
            'step': service_name,
            'success': False,
            'error': f'No URL configured for {service_name}. '
                     f'Set the corresponding environment variable.',
        }

    full_url = f'{url.rstrip("/")}{endpoint}'
    timeout = timeout or TIMEOUTS.get(service_name, 600)

    logger.info(f'  POST {full_url}')
    logger.info(f'  Body: {json.dumps(body)}')

    start = time.time()
    try:
        response = requests.post(
            full_url,
            json=body,
            timeout=timeout,
            headers={'Content-Type': 'application/json'},
        )
        elapsed = time.time() - start

        if response.status_code == 200:
            try:
                result_data = response.json()
            except Exception:
                result_data = {'raw': response.text[:1000]}
            logger.info(f'  {service_name} completed in {elapsed:.1f}s')
            return {
                'step': service_name,
                'success': True,
                'elapsedSeconds': round(elapsed, 1),
                'data': result_data,
            }
        else:
            logger.error(f'  {service_name} failed: HTTP {response.status_code} - {response.text[:500]}')
            return {
                'step': service_name,
                'success': False,
                'statusCode': response.status_code,
                'error': response.text[:500],
                'elapsedSeconds': round(elapsed, 1),
            }
    except requests.exceptions.Timeout:
        elapsed = time.time() - start
        logger.error(f'  {service_name} timed out after {elapsed:.1f}s')
        return {
            'step': service_name,
            'success': False,
            'error': f'Request timed out after {timeout}s',
            'elapsedSeconds': round(elapsed, 1),
        }
    except Exception as e:
        elapsed = time.time() - start
        logger.error(f'  {service_name} error: {e}')
        return {
            'step': service_name,
            'success': False,
            'error': str(e),
            'elapsedSeconds': round(elapsed, 1),
        }


def run_parallel(tasks):
    """
    Run multiple (service_name, endpoint, body) tuples in parallel.
    Returns list of result dicts.
    """
    results = []
    with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
        futures = {
            executor.submit(call_service, name, endpoint, body): name
            for name, endpoint, body in tasks
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                results.append(future.result())
            except Exception as e:
                results.append({'step': name, 'success': False, 'error': str(e)})
    return results


def extract_district_number(region_id):
    """Extract numeric district ID from region string (e.g. '05cgd' -> '05')."""
    return region_id.replace('cgd', '')


# ============================================================================
# POST /pipeline - Full district pipeline
# ============================================================================

@app.route('/pipeline', methods=['POST'])
def pipeline():
    """
    Run the full data generation pipeline for a district.

    Request body:
    {
        "regionId": "05cgd",
        "steps": ["enc-download", "enc-convert", "tile-generators", "predictions", "metadata"],
        "bufferNm": 25,          // optional, coastal buffer for tile generators
        "skipOnFailure": false   // optional, if true continue pipeline on step failure
    }

    Steps run in order. "tile-generators" runs satellite/ocean/terrain/basemap in parallel.
    Omit "steps" to run the full pipeline.
    """
    data = request.get_json() or {}
    region_id = data.get('regionId')
    steps = data.get('steps', PIPELINE_STEPS)
    buffer_nm = data.get('bufferNm')
    skip_on_failure = data.get('skipOnFailure', False)

    if not region_id:
        return jsonify({'error': 'regionId is required'}), 400
    if region_id not in VALID_REGIONS:
        return jsonify({'error': f'Invalid regionId. Valid: {sorted(VALID_REGIONS)}'}), 400

    invalid_steps = [s for s in steps if s not in PIPELINE_STEPS]
    if invalid_steps:
        return jsonify({'error': f'Invalid steps: {invalid_steps}. Valid: {PIPELINE_STEPS}'}), 400

    district_num = extract_district_number(region_id)

    logger.info(f'========================================')
    logger.info(f'PIPELINE START: {region_id}')
    logger.info(f'Steps: {steps}')
    logger.info(f'========================================')

    pipeline_start = time.time()
    step_results = []
    failed = False

    # --- Step 1: ENC Download ---
    if 'enc-download' in steps:
        logger.info(f'--- Step 1: ENC Download for district {district_num} ---')
        result = call_service('enc-downloader', '/download', {'districtId': district_num})
        step_results.append(result)
        if not result['success']:
            failed = True
            if not skip_on_failure:
                return _pipeline_response(region_id, pipeline_start, step_results, aborted='enc-download')

    # --- Step 2: ENC Convert ---
    if 'enc-convert' in steps:
        logger.info(f'--- Step 2: ENC Convert for district {district_num} ---')
        result = call_service('enc-converter', '/convert-district-parallel', {
            'districtId': district_num,
            'batchSize': 10,
            'maxParallel': 80,
        })
        step_results.append(result)
        if not result['success']:
            failed = True
            if not skip_on_failure:
                return _pipeline_response(region_id, pipeline_start, step_results, aborted='enc-convert')

    # --- Step 3: Tile Generators (parallel) ---
    if 'tile-generators' in steps:
        logger.info(f'--- Step 3: Tile Generators (parallel) for {region_id} ---')
        gen_body = {'regionId': region_id}
        if buffer_nm is not None:
            gen_body['bufferNm'] = buffer_nm

        tasks = [
            (gen_type, '/generate', gen_body.copy())
            for gen_type in ['satellite', 'ocean', 'terrain', 'basemap']
        ]
        gen_results = run_parallel(tasks)
        step_results.extend(gen_results)

        gen_failures = [r for r in gen_results if not r['success']]
        if gen_failures:
            failed = True
            logger.warning(f'  {len(gen_failures)} generator(s) failed: '
                         f'{[r["step"] for r in gen_failures]}')
            if not skip_on_failure:
                return _pipeline_response(region_id, pipeline_start, step_results,
                                        aborted='tile-generators')

    # --- Step 4: Predictions (tides then currents) ---
    if 'predictions' in steps:
        logger.info(f'--- Step 4: Predictions for {region_id} ---')
        for pred_type in ['tides', 'currents']:
            logger.info(f'  Running {pred_type}...')
            result = call_service('predictions', '/generate', {
                'regionId': region_id,
                'type': pred_type,
            })
            result['step'] = f'predictions-{pred_type}'
            step_results.append(result)
            if not result['success']:
                failed = True
                if not skip_on_failure:
                    return _pipeline_response(region_id, pipeline_start, step_results,
                                            aborted=f'predictions-{pred_type}')

    # --- Step 5: Metadata ---
    if 'metadata' in steps:
        logger.info(f'--- Step 5: Generate Metadata for {region_id} ---')
        result = call_service('metadata', '/generateMetadata', {'districtId': region_id})
        step_results.append(result)
        if not result['success']:
            failed = True

    return _pipeline_response(region_id, pipeline_start, step_results)


def _pipeline_response(region_id, start_time, results, aborted=None):
    """Build the pipeline response JSON."""
    elapsed = time.time() - start_time
    succeeded = sum(1 for r in results if r.get('success'))
    failed_count = len(results) - succeeded

    status = 'aborted' if aborted else ('success' if failed_count == 0 else 'partial')

    logger.info(f'========================================')
    logger.info(f'PIPELINE {status.upper()}: {region_id} in {elapsed:.1f}s')
    logger.info(f'  {succeeded}/{len(results)} steps succeeded')
    if aborted:
        logger.info(f'  Aborted at step: {aborted}')
    logger.info(f'========================================')

    response = {
        'regionId': region_id,
        'status': status,
        'totalElapsedSeconds': round(elapsed, 1),
        'succeeded': succeeded,
        'failed': failed_count,
        'results': results,
    }
    if aborted:
        response['abortedAt'] = aborted

    http_code = 200 if status == 'success' else 207
    return jsonify(response), http_code


# ============================================================================
# POST /generate-all - Tile generators only (backwards compatible)
# ============================================================================

@app.route('/generate-all', methods=['POST'])
def generate_all():
    """
    Trigger tile generators for a region (satellite, ocean, terrain, basemap).

    Request body:
    {
        "regionId": "17cgd",
        "bufferNm": 25,
        "types": ["satellite", "ocean", "terrain", "basemap"],
        "parallel": true
    }
    """
    data = request.get_json() or {}
    region_id = data.get('regionId')
    buffer_nm = data.get('bufferNm')
    types = data.get('types', list(TILE_GENERATOR_TYPES))
    parallel = data.get('parallel', True)

    if not region_id:
        return jsonify({'error': 'regionId is required'}), 400
    if region_id not in VALID_REGIONS:
        return jsonify({'error': f'Invalid regionId. Valid: {sorted(VALID_REGIONS)}'}), 400

    invalid = [t for t in types if t not in TILE_GENERATOR_TYPES]
    if invalid:
        return jsonify({'error': f'Invalid types: {invalid}. Valid: {sorted(TILE_GENERATOR_TYPES)}'}), 400

    logger.info(f'=== GENERATE ALL for {region_id} ===')
    logger.info(f'  Types: {types}, Parallel: {parallel}')

    start = time.time()
    body = {'regionId': region_id}
    if buffer_nm is not None:
        body['bufferNm'] = buffer_nm

    if parallel:
        tasks = [(t, '/generate', body.copy()) for t in types]
        results = run_parallel(tasks)
    else:
        results = []
        for t in types:
            results.append(call_service(t, '/generate', body.copy()))

    total_elapsed = time.time() - start
    succeeded = sum(1 for r in results if r.get('success'))
    failed_count = len(results) - succeeded

    logger.info(f'=== GENERATE ALL complete: {succeeded}/{len(results)} in {total_elapsed:.1f}s ===')

    return jsonify({
        'regionId': region_id,
        'totalElapsedSeconds': round(total_elapsed, 1),
        'succeeded': succeeded,
        'failed': failed_count,
        'results': results,
    })


# ============================================================================
# POST /generate - Single generator (backwards compatible)
# ============================================================================

@app.route('/generate', methods=['POST'])
def generate_single():
    """
    Trigger a specific generator.

    Request body:
    {
        "regionId": "17cgd",
        "type": "ocean",
        "bufferNm": 25
    }
    """
    data = request.get_json() or {}
    region_id = data.get('regionId')
    gen_type = data.get('type') or request.args.get('type')
    buffer_nm = data.get('bufferNm')

    if not region_id:
        return jsonify({'error': 'regionId is required'}), 400
    if region_id not in VALID_REGIONS:
        return jsonify({'error': f'Invalid regionId. Valid: {sorted(VALID_REGIONS)}'}), 400
    if not gen_type:
        return jsonify({'error': f'type is required. Valid: {sorted(TILE_GENERATOR_TYPES)}'}), 400
    if gen_type not in TILE_GENERATOR_TYPES:
        return jsonify({'error': f'Invalid type: {gen_type}. Valid: {sorted(TILE_GENERATOR_TYPES)}'}), 400

    body = {'regionId': region_id}
    if buffer_nm is not None:
        body['bufferNm'] = buffer_nm

    logger.info(f'=== GENERATE {gen_type} for {region_id} ===')
    result = call_service(gen_type, '/generate', body)

    status_code = 200 if result.get('success') else 502
    return jsonify({'regionId': region_id, **result}), status_code


# ============================================================================
# GET /status
# ============================================================================

@app.route('/status', methods=['GET'])
def status():
    """
    Get generation status for a region across all generators.

    Query parameters:
      regionId: required
      type: optional (filter to single type)
    """
    region_id = request.args.get('regionId')
    gen_type = request.args.get('type')

    if not region_id:
        return jsonify({'error': 'regionId query parameter is required'}), 400
    if region_id not in VALID_REGIONS:
        return jsonify({'error': f'Invalid regionId. Valid: {sorted(VALID_REGIONS)}'}), 400

    if gen_type:
        if gen_type not in TILE_GENERATOR_TYPES:
            return jsonify({'error': f'Invalid type. Valid: {sorted(TILE_GENERATOR_TYPES)}'}), 400
        url = SERVICE_URLS.get(gen_type)
        if not url:
            return jsonify({'regionId': region_id, 'status': [{'type': gen_type, 'error': 'Not configured'}]})
        try:
            resp = requests.get(f'{url.rstrip("/")}/status?regionId={region_id}', timeout=10)
            data = {'type': gen_type, **(resp.json() if resp.status_code == 200 else {'error': f'HTTP {resp.status_code}'})}
        except Exception as e:
            data = {'type': gen_type, 'error': str(e)}
        return jsonify({'regionId': region_id, 'status': [data]})

    # Get status from all tile generators
    statuses = []
    with ThreadPoolExecutor(max_workers=len(TILE_GENERATOR_TYPES)) as executor:
        def _get_status(t):
            url = SERVICE_URLS.get(t)
            if not url:
                return {'type': t, 'error': 'Not configured'}
            try:
                resp = requests.get(f'{url.rstrip("/")}/status?regionId={region_id}', timeout=10)
                return {'type': t, **(resp.json() if resp.status_code == 200 else {'error': f'HTTP {resp.status_code}'})}
            except Exception as e:
                return {'type': t, 'error': str(e)}

        futures = {executor.submit(_get_status, t): t for t in TILE_GENERATOR_TYPES}
        for future in as_completed(futures):
            statuses.append(future.result())

    return jsonify({'regionId': region_id, 'status': statuses})


# ============================================================================
# GET / - Health check
# ============================================================================

@app.route('/', methods=['GET'])
def health():
    """Health check endpoint."""
    configured = {name: bool(url) for name, url in SERVICE_URLS.items()}
    return jsonify({
        'service': 'district-pipeline',
        'status': 'healthy',
        'services': configured,
        'validRegions': sorted(VALID_REGIONS),
        'pipelineSteps': PIPELINE_STEPS,
        'endpoints': {
            'POST /pipeline': 'Run full district pipeline (all steps)',
            'POST /generate-all': 'Run tile generators only (parallel)',
            'POST /generate': 'Run a single tile generator',
            'GET /status': 'Get generation status',
            'GET /': 'Health check',
        },
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
