"""
Basemap Orchestrator Service
=============================
Lightweight Cloud Run service that coordinates tile generation across
the individual generator services (satellite, ocean, terrain, basemap).

Endpoints:
  POST /generate-all   - Trigger all generators for a region
  POST /generate        - Trigger a specific generator
  GET  /status          - Get generation status for a region
  GET  /                - Health check

Each generator is called via HTTP POST to its Cloud Run URL.
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

# Generator service URLs (set via environment variables)
GENERATOR_URLS = {
    'satellite': os.environ.get('SATELLITE_GENERATOR_URL', ''),
    'ocean': os.environ.get('OCEAN_GENERATOR_URL', ''),
    'terrain': os.environ.get('TERRAIN_GENERATOR_URL', ''),
    'basemap': os.environ.get('BASEMAP_GENERATOR_URL', ''),
}

# Valid generator types
VALID_TYPES = set(GENERATOR_URLS.keys())

# Timeout for generator requests (10 minutes - generation takes a while)
GENERATOR_TIMEOUT = int(os.environ.get('GENERATOR_TIMEOUT', '600'))

# Valid region IDs
VALID_REGIONS = {
    '01cgd', '05cgd', '07cgd', '08cgd', '09cgd',
    '11cgd', '13cgd', '14cgd', '17cgd',
}


# ============================================================================
# Helper functions
# ============================================================================

def trigger_generator(gen_type, region_id, buffer_nm=None, extra_params=None):
    """
    Trigger a single generator service.
    Returns dict with status and response data.
    """
    url = GENERATOR_URLS.get(gen_type)
    if not url:
        return {
            'type': gen_type,
            'success': False,
            'error': f'No URL configured for {gen_type} generator. '
                     f'Set {gen_type.upper()}_GENERATOR_URL environment variable.',
        }

    generate_url = f'{url.rstrip("/")}/generate'
    
    # Build request body
    body = {'regionId': region_id}
    if buffer_nm is not None:
        body['bufferNm'] = buffer_nm
    if extra_params:
        body.update(extra_params)

    logger.info(f'Triggering {gen_type} generator: POST {generate_url}')
    logger.info(f'  Body: {json.dumps(body)}')

    start = time.time()
    try:
        response = requests.post(
            generate_url,
            json=body,
            timeout=GENERATOR_TIMEOUT,
            headers={'Content-Type': 'application/json'},
        )
        elapsed = time.time() - start

        if response.status_code == 200:
            result = response.json()
            logger.info(f'  {gen_type} completed in {elapsed:.1f}s')
            return {
                'type': gen_type,
                'success': True,
                'elapsed_seconds': round(elapsed, 1),
                'data': result,
            }
        else:
            logger.error(f'  {gen_type} failed with status {response.status_code}: {response.text[:500]}')
            return {
                'type': gen_type,
                'success': False,
                'status_code': response.status_code,
                'error': response.text[:500],
                'elapsed_seconds': round(elapsed, 1),
            }
    except requests.exceptions.Timeout:
        elapsed = time.time() - start
        logger.error(f'  {gen_type} timed out after {elapsed:.1f}s')
        return {
            'type': gen_type,
            'success': False,
            'error': f'Request timed out after {GENERATOR_TIMEOUT}s',
            'elapsed_seconds': round(elapsed, 1),
        }
    except Exception as e:
        elapsed = time.time() - start
        logger.error(f'  {gen_type} error: {e}')
        return {
            'type': gen_type,
            'success': False,
            'error': str(e),
            'elapsed_seconds': round(elapsed, 1),
        }


def get_generator_status(gen_type, region_id):
    """Check generation status from a generator service."""
    url = GENERATOR_URLS.get(gen_type)
    if not url:
        return {'type': gen_type, 'error': 'Not configured'}

    status_url = f'{url.rstrip("/")}/status?regionId={region_id}'
    try:
        response = requests.get(status_url, timeout=10)
        if response.status_code == 200:
            return {'type': gen_type, **response.json()}
        else:
            return {'type': gen_type, 'error': f'HTTP {response.status_code}'}
    except Exception as e:
        return {'type': gen_type, 'error': str(e)}


# ============================================================================
# Endpoints
# ============================================================================

@app.route('/generate-all', methods=['POST'])
def generate_all():
    """
    Trigger ALL generators for a region.
    
    Request body:
    {
        "regionId": "17cgd",
        "bufferNm": 25,              // optional, default per generator
        "types": ["satellite", "ocean", "terrain", "basemap"],  // optional, defaults to all
        "parallel": true              // optional, run in parallel (default: true)
    }
    """
    data = request.get_json() or {}
    region_id = data.get('regionId')
    buffer_nm = data.get('bufferNm')
    types = data.get('types', list(VALID_TYPES))
    parallel = data.get('parallel', True)

    if not region_id:
        return jsonify({'error': 'regionId is required'}), 400
    if region_id not in VALID_REGIONS:
        return jsonify({'error': f'Invalid regionId. Valid: {sorted(VALID_REGIONS)}'}), 400

    # Validate requested types
    invalid = [t for t in types if t not in VALID_TYPES]
    if invalid:
        return jsonify({'error': f'Invalid types: {invalid}. Valid: {sorted(VALID_TYPES)}'}), 400

    logger.info(f'=== GENERATE ALL for {region_id} ===')
    logger.info(f'  Types: {types}, Parallel: {parallel}')

    start = time.time()
    results = []

    if parallel:
        # Run generators in parallel using ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=len(types)) as executor:
            futures = {
                executor.submit(trigger_generator, t, region_id, buffer_nm): t
                for t in types
            }
            for future in as_completed(futures):
                gen_type = futures[future]
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    results.append({
                        'type': gen_type,
                        'success': False,
                        'error': str(e),
                    })
    else:
        # Run sequentially
        for t in types:
            result = trigger_generator(t, region_id, buffer_nm)
            results.append(result)

    total_elapsed = time.time() - start
    succeeded = sum(1 for r in results if r.get('success'))
    failed = len(results) - succeeded

    logger.info(f'=== GENERATE ALL complete: {succeeded}/{len(results)} succeeded in {total_elapsed:.1f}s ===')

    return jsonify({
        'regionId': region_id,
        'totalElapsedSeconds': round(total_elapsed, 1),
        'succeeded': succeeded,
        'failed': failed,
        'results': results,
    })


@app.route('/generate', methods=['POST'])
def generate_single():
    """
    Trigger a specific generator.
    
    Request body:
    {
        "regionId": "17cgd",
        "type": "ocean",
        "bufferNm": 25     // optional
    }
    
    Query parameter alternative:
      POST /generate?type=ocean
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
        return jsonify({'error': 'type is required (satellite, ocean, terrain, basemap)'}), 400
    if gen_type not in VALID_TYPES:
        return jsonify({'error': f'Invalid type: {gen_type}. Valid: {sorted(VALID_TYPES)}'}), 400

    logger.info(f'=== GENERATE {gen_type} for {region_id} ===')

    result = trigger_generator(gen_type, region_id, buffer_nm)

    status_code = 200 if result.get('success') else 502
    return jsonify({
        'regionId': region_id,
        **result,
    }), status_code


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
        if gen_type not in VALID_TYPES:
            return jsonify({'error': f'Invalid type: {gen_type}. Valid: {sorted(VALID_TYPES)}'}), 400
        status_data = get_generator_status(gen_type, region_id)
        return jsonify({'regionId': region_id, 'status': [status_data]})

    # Get status from all generators
    statuses = []
    with ThreadPoolExecutor(max_workers=len(VALID_TYPES)) as executor:
        futures = {
            executor.submit(get_generator_status, t, region_id): t
            for t in VALID_TYPES
        }
        for future in as_completed(futures):
            try:
                statuses.append(future.result())
            except Exception as e:
                gen_type = futures[future]
                statuses.append({'type': gen_type, 'error': str(e)})

    return jsonify({'regionId': region_id, 'status': statuses})


@app.route('/', methods=['GET'])
def health():
    """Health check endpoint."""
    configured = {t: bool(url) for t, url in GENERATOR_URLS.items()}
    return jsonify({
        'service': 'basemap-orchestrator',
        'status': 'healthy',
        'generators': configured,
        'validRegions': sorted(VALID_REGIONS),
        'endpoints': {
            'POST /generate-all': 'Trigger all generators for a region',
            'POST /generate': 'Trigger a specific generator (type param)',
            'GET /status': 'Get status for a region',
            'GET /': 'Health check',
        },
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
