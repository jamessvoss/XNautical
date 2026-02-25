#!/usr/bin/env python3
"""
Reusable Test District Creator

Creates a complete working test district from a source (master) district by:
  1. Resolving bounds (from a chart's S-57 M_COVR extent or explicit bounding box)
  2. Discovering which charts intersect those bounds (reads S-57 files from enc-source/)
  3. Copying ENC source data (.000 files) to the new district
  4. Copying GNIS place name data
  5. Creating the Firestore district document
  6. Triggering ENC conversion (generates GeoJSON + MBTiles from copied enc-source)
  7. Triggering imagery generators (basemap, satellite, ocean, terrain)
  8. Triggering prediction generation (tides, currents)
  9. Generating download metadata
  10. Printing app config additions needed

Usage:
    # By chart coverage area
    python3 create_test_district.py \\
        --source 17cgd --chart US2PACZS --name 17cgd-test2

    # By bounding box
    python3 create_test_district.py \\
        --source 09cgd --bounds '{"south":41,"west":-85,"north":44,"east":-82}' --name 09cgd-test

    # Dry run (discover only, no copies or triggers)
    python3 create_test_district.py \\
        --source 17cgd --chart US2PACZS --name 17cgd-test2 --dry-run

    # Skip generators (only set up Storage + Firestore)
    python3 create_test_district.py \\
        --source 17cgd --chart US2PACZS --name 17cgd-test2 --skip-generators

Dependencies:
    pip install google-cloud-storage google-cloud-firestore requests
    # Optional for --chart mode: pip install gdal (osgeo)
"""

import argparse
import json
import os
import re
import subprocess
import sys
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from google.cloud import storage, firestore
from google.auth import default as auth_default
from google.auth.exceptions import DefaultCredentialsError

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

BUCKET_NAME = 'xnautical-8a296.firebasestorage.app'
GCP_PROJECT = 'xnautical-8a296'
GCP_REGION = 'us-central1'

# ============================================================================
# GCP client helpers — use gcloud user credentials (no ADC file needed)
# ============================================================================

_cached_credentials = None


def _get_gcloud_credentials():
    """Get credentials from gcloud CLI (works when user is logged in via gcloud auth login)."""
    global _cached_credentials
    if _cached_credentials is not None:
        return _cached_credentials

    try:
        creds, project = auth_default()
        _cached_credentials = (creds, project)
        return creds, project
    except DefaultCredentialsError:
        pass
    # Fallback: use gcloud CLI credentials directly
    from google.oauth2.credentials import Credentials as OAuth2Credentials
    token = subprocess.check_output(
        ['gcloud', 'auth', 'print-access-token'], text=True
    ).strip()
    result = (OAuth2Credentials(token=token), GCP_PROJECT)
    _cached_credentials = result
    return result


_cached_storage_client = None
_cached_firestore_client = None


def get_storage_client():
    """Get an authenticated Storage client (cached)."""
    global _cached_storage_client
    if _cached_storage_client is None:
        creds, project = _get_gcloud_credentials()
        _cached_storage_client = storage.Client(project=project or GCP_PROJECT, credentials=creds)
    return _cached_storage_client


def get_firestore_client():
    """Get an authenticated Firestore client (cached)."""
    global _cached_firestore_client
    if _cached_firestore_client is None:
        creds, project = _get_gcloud_credentials()
        _cached_firestore_client = firestore.Client(project=project or GCP_PROJECT, credentials=creds)
    return _cached_firestore_client


# Service name → Cloud Run service name mapping
SERVICE_NAMES = {
    'enc-converter': 'enc-converter',
    'basemap': 'basemap-generator',
    'satellite': 'satellite-generator',
    'ocean': 'ocean-generator',
    'terrain': 'terrain-generator',
    'predictions': 'prediction-generator',
    'metadata': 'generate-district-metadata',
}

# Known GNIS filenames per source district
GNIS_FILENAMES = {
    '01cgd': 'gnis_names_ne.mbtiles',
    '05cgd': 'gnis_names_east.mbtiles',
    '07cgd': 'gnis_names_se.mbtiles',
    '08cgd': 'gnis_names_gulf.mbtiles',
    '09cgd': 'gnis_names_gl.mbtiles',
    '11cgd': 'gnis_names_sw.mbtiles',
    '13cgd': 'gnis_names_nw.mbtiles',
    '14cgd': 'gnis_names_hi.mbtiles',
    '17cgd': 'gnis_names_ak.mbtiles',
}

# Region display names
REGION_DISPLAY_NAMES = {
    '01cgd': 'Northeast', '05cgd': 'East', '07cgd': 'Southeast',
    '08cgd': 'Heartland', '09cgd': 'Great Lakes', '11cgd': 'Southwest',
    '13cgd': 'Northwest', '14cgd': 'Oceania', '17cgd': 'Arctic',
}

# Region IDs used in app config
REGION_APP_IDS = {
    '01cgd': 'northeast', '05cgd': 'east', '07cgd': 'southeast',
    '08cgd': 'heartland', '09cgd': 'great_lakes', '11cgd': 'southwest',
    '13cgd': 'northwest', '14cgd': 'oceania', '17cgd': 'arctic',
}


# ============================================================================
# Service URL discovery and auth
# ============================================================================

_service_url_cache = {}


def _populate_service_url_cache():
    """Fetch all Cloud Run service URLs at once via gcloud run services list."""
    if _service_url_cache:
        return
    try:
        output = subprocess.check_output([
            'gcloud', 'run', 'services', 'list',
            '--region', GCP_REGION,
            '--project', GCP_PROJECT,
            '--format', 'csv[no-heading](SERVICE,URL)',
        ], text=True).strip()
        for line in output.splitlines():
            if ',' in line:
                name, url = line.split(',', 1)
                _service_url_cache[name.strip()] = url.strip()
        logger.info(f'  Discovered {len(_service_url_cache)} Cloud Run services')
    except subprocess.CalledProcessError as e:
        logger.error(f'Failed to list Cloud Run services: {e}')


def get_service_url(service_key):
    """Discover Cloud Run service URL via gcloud."""
    _populate_service_url_cache()

    service_name = SERVICE_NAMES.get(service_key, service_key)
    url = _service_url_cache.get(service_name)
    if not url:
        logger.error(f'Service URL not found for {service_name}')
    return url


def get_auth_token():
    """Get identity token for authenticated Cloud Run calls."""
    try:
        return subprocess.check_output(
            ['gcloud', 'auth', 'print-identity-token'],
            text=True,
        ).strip()
    except subprocess.CalledProcessError as e:
        logger.error(f'Failed to get auth token: {e}')
        return None


def call_service(service_key, endpoint, body, timeout=7200):
    """POST to a Cloud Run service with authentication."""
    url = get_service_url(service_key)
    if not url:
        return None

    token = get_auth_token()
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'

    full_url = f'{url.rstrip("/")}{endpoint}'
    logger.info(f'  POST {full_url}')
    logger.info(f'  Body: {json.dumps(body)}')

    try:
        resp = requests.post(full_url, json=body, headers=headers, timeout=timeout)
        if resp.status_code == 200:
            return resp.json()
        else:
            logger.error(f'  HTTP {resp.status_code}: {resp.text[:500]}')
            return None
    except requests.exceptions.Timeout:
        logger.error(f'  Request timed out after {timeout}s')
        return None
    except Exception as e:
        logger.error(f'  Error: {e}')
        return None


# ============================================================================
# Phase 1: Resolve Bounds
# ============================================================================


def get_chart_extent_from_s57(s57_path):
    """Read M_COVR extent from an S-57 .000 file using GDAL/OGR.

    Returns (west, east, south, north) or None if no coverage found.
    Also returns the scale number (1-6) parsed from the chart ID.
    """
    from osgeo import ogr
    ogr.UseExceptions()
    try:
        ds = ogr.Open(s57_path)
        if ds is None:
            return None

        # Try M_COVR layer first (preferred — actual coverage polygon)
        layer = ds.GetLayerByName('M_COVR')
        if layer and layer.GetFeatureCount() > 0:
            ext = layer.GetExtent()
            return ext  # (minX, maxX, minY, maxY)

        # Fallback: use the union extent of all geometry layers
        best_ext = None
        for i in range(ds.GetLayerCount()):
            lyr = ds.GetLayerByIndex(i)
            if lyr.GetFeatureCount() > 0:
                try:
                    ext = lyr.GetExtent()
                    if best_ext is None:
                        best_ext = list(ext)
                    else:
                        best_ext[0] = min(best_ext[0], ext[0])
                        best_ext[1] = max(best_ext[1], ext[1])
                        best_ext[2] = min(best_ext[2], ext[2])
                        best_ext[3] = max(best_ext[3], ext[3])
                except Exception:
                    continue
        return tuple(best_ext) if best_ext else None
    except Exception:
        return None


def get_scale_from_chart_id(chart_id):
    """Extract scale number from chart ID (e.g. 'US4FL1FT' -> 4)."""
    m = re.match(r'US(\d)', chart_id)
    return int(m.group(1)) if m else None


def resolve_bounds_from_chart(source_district, chart_id):
    """Download a chart's S-57 file and extract bounds from M_COVR."""
    import tempfile
    logger.info(f'Phase 1: Resolving bounds from chart {chart_id}...')
    client = get_storage_client()
    bucket = client.bucket(BUCKET_NAME)

    blob = bucket.blob(f'{source_district}/enc-source/{chart_id}/{chart_id}.000')
    if not blob.exists():
        logger.error(f'Chart not found: {source_district}/enc-source/{chart_id}/{chart_id}.000')
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = os.path.join(tmpdir, f'{chart_id}.000')
        blob.download_to_filename(local_path)
        ext = get_chart_extent_from_s57(local_path)

    if ext is None:
        logger.error(f'No coverage found in {chart_id}')
        sys.exit(1)

    # ext is (minX, maxX, minY, maxY) = (west, east, south, north)
    bounds = {
        'west': round(ext[0], 6),
        'east': round(ext[1], 6),
        'south': round(ext[2], 6),
        'north': round(ext[3], 6),
    }
    logger.info(f'  Chart {chart_id} extent: S={bounds["south"]} W={bounds["west"]} '
                f'N={bounds["north"]} E={bounds["east"]}')
    return bounds


def resolve_bounds_from_json(bounds_json):
    """Parse bounds from JSON string or dict."""
    logger.info(f'Phase 1: Using provided bounds...')
    if isinstance(bounds_json, str):
        bounds = json.loads(bounds_json)
    else:
        bounds = bounds_json

    required = ['south', 'west', 'north', 'east']
    for key in required:
        if key not in bounds:
            logger.error(f'Missing required bounds key: {key}')
            sys.exit(1)

    logger.info(f'  Bounds: S={bounds["south"]} W={bounds["west"]} N={bounds["north"]} E={bounds["east"]}')
    return bounds


# ============================================================================
# Phase 2: Discover Charts
# ============================================================================

def _boxes_intersect(b1, b2):
    """Test if two bounding boxes intersect. Each is {south, west, north, east}."""
    return (b1['west'] <= b2['east'] and b1['east'] >= b2['west'] and
            b1['south'] <= b2['north'] and b1['north'] >= b2['south'])


def discover_charts(source_district, bounds):
    """Find all charts in the source district that intersect the bounds.

    Downloads each chart's S-57 .000 file to read M_COVR extent via GDAL,
    then tests bounding box intersection with the target area.
    """
    import tempfile

    logger.info(f'\nPhase 2: Discovering charts in {source_district} via enc-source...')
    client = get_storage_client()
    bucket = client.bucket(BUCKET_NAME)

    # List all chart directories under enc-source/
    prefix = f'{source_district}/enc-source/'
    blobs = list(bucket.list_blobs(prefix=prefix))

    # Extract unique chart IDs from blob paths: enc-source/{chartId}/{chartId}.000
    chart_ids_found = set()
    chart_blobs = {}  # chartId -> blob for the .000 file
    for b in blobs:
        rel = b.name[len(prefix):]
        parts = rel.split('/')
        if len(parts) >= 2 and parts[1].endswith('.000'):
            chart_id = parts[0]
            chart_ids_found.add(chart_id)
            chart_blobs[chart_id] = b

    logger.info(f'  Found {len(chart_ids_found)} charts in {source_district}/enc-source/')

    results = {'match': [], 'no_intersect': 0, 'no_coverage': 0, 'error': 0}

    def check_chart(chart_id):
        """Download a chart's .000 file, read its extent, and test intersection."""
        blob = chart_blobs.get(chart_id)
        if not blob:
            return chart_id, None, 'error: no .000 blob'
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                local_path = os.path.join(tmpdir, f'{chart_id}.000')
                blob.download_to_filename(local_path)
                ext = get_chart_extent_from_s57(local_path)

            if ext is None:
                return chart_id, None, 'no_coverage'

            # ext = (minX, maxX, minY, maxY) = (west, east, south, north)
            chart_bounds = {
                'west': ext[0], 'east': ext[1],
                'south': ext[2], 'north': ext[3],
            }

            scale_num = get_scale_from_chart_id(chart_id)

            if _boxes_intersect(bounds, chart_bounds):
                return chart_id, scale_num, 'match'
            return chart_id, scale_num, 'no_intersect'
        except Exception as e:
            return chart_id, None, f'error: {e}'

    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(check_chart, cid): cid
                   for cid in sorted(chart_ids_found)}
        done = 0
        total = len(futures)
        for future in as_completed(futures):
            done += 1
            chart_id, scale_num, status = future.result()
            if status == 'match':
                results['match'].append((chart_id, scale_num))
            elif status == 'no_intersect':
                results['no_intersect'] += 1
            elif status == 'no_coverage':
                results['no_coverage'] += 1
            else:
                results['error'] += 1
                logger.warning(f'  Error checking {chart_id}: {status}')

            if done % 50 == 0 or done == total:
                logger.info(f'  Progress: {done}/{total} checked, '
                            f'{len(results["match"])} matches')

    results['match'].sort(key=lambda x: (x[1] or 0, x[0]))

    by_scale = defaultdict(list)
    for chart_id, scale_num in results['match']:
        by_scale[scale_num or 0].append(chart_id)

    logger.info(f'\n  === Discovery Results ===')
    logger.info(f'  Total checked: {total}')
    logger.info(f'  Matching: {len(results["match"])}')
    logger.info(f'  No intersection: {results["no_intersect"]}')
    logger.info(f'  No coverage data: {results["no_coverage"]}')
    logger.info(f'  Errors: {results["error"]}')

    for sn in sorted(by_scale.keys()):
        charts = by_scale[sn]
        label = f'US{sn}' if sn else 'Unknown'
        logger.info(f'  {label}: {len(charts)} charts')

    chart_ids = [cid for cid, _ in results['match']]
    return chart_ids, by_scale


# ============================================================================
# Phase 3: Copy ENC Data
# ============================================================================

def copy_enc_data(source_district, test_name, chart_ids):
    """Copy enc-source files for matching charts.

    Only copies enc-source (S-57 .000 files). Chart GeoJSON will be
    generated by the ENC converter during Phase 6.
    """
    logger.info(f'\nPhase 3: Copying ENC source data ({len(chart_ids)} charts)...')
    client = get_storage_client()
    bucket = client.bucket(BUCKET_NAME)

    copied = 0
    errors = 0

    def copy_chart(chart_id):
        chart_copied = 0
        chart_errors = 0
        src_prefix = f'{source_district}/enc-source/{chart_id}/'
        dst_prefix = f'{test_name}/enc-source/{chart_id}/'
        blobs = list(bucket.list_blobs(prefix=src_prefix))
        for blob in blobs:
            rel = blob.name[len(src_prefix):]
            dst_name = f'{dst_prefix}{rel}'
            try:
                bucket.copy_blob(blob, bucket, dst_name)
                chart_copied += 1
            except Exception as e:
                logger.error(f'  Failed: {blob.name} -> {dst_name}: {e}')
                chart_errors += 1
        return chart_copied, chart_errors

    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(copy_chart, cid): cid for cid in chart_ids}
        done = 0
        for future in as_completed(futures):
            done += 1
            c, e = future.result()
            copied += c
            errors += e
            if done % 20 == 0 or done == len(chart_ids):
                logger.info(f'  Progress: {done}/{len(chart_ids)} charts, '
                            f'{copied} files copied, {errors} errors')

    logger.info(f'  Total: {copied} files copied, {errors} errors')


# ============================================================================
# Phase 4: Copy GNIS Data
# ============================================================================

def copy_gnis_data(source_district, test_name):
    """Copy GNIS place name data."""
    logger.info(f'\nPhase 4: Copying GNIS data...')
    client = get_storage_client()
    bucket = client.bucket(BUCKET_NAME)

    # Try source district first, then global fallback
    src_prefix = f'{source_district}/gnis/'
    blobs = list(bucket.list_blobs(prefix=src_prefix))

    if not blobs:
        logger.info(f'  No GNIS data in {source_district}, trying global/gnis/...')
        src_prefix = 'global/gnis/'
        blobs = list(bucket.list_blobs(prefix=src_prefix))

    if not blobs:
        logger.warning(f'  No GNIS data found')
        return

    copied = 0
    for blob in blobs:
        rel = blob.name[len(src_prefix):]
        dst_name = f'{test_name}/gnis/{rel}'
        try:
            bucket.copy_blob(blob, bucket, dst_name)
            copied += 1
        except Exception as e:
            logger.error(f'  Failed: {blob.name} -> {dst_name}: {e}')

    logger.info(f'  Copied {copied} GNIS files')


# ============================================================================
# Phase 5: Create Firestore Document
# ============================================================================

def create_firestore_doc(source_district, test_name, bounds):
    """Create the Firestore district document with predictionConfig from source."""
    logger.info(f'\nPhase 5: Creating Firestore document...')
    db = get_firestore_client()

    # Read source district for predictionConfig
    source_doc = db.collection('districts').document(source_district).get()
    pred_config = {}
    if source_doc.exists:
        source_data = source_doc.to_dict()
        pred_config = source_data.get('predictionConfig', {})

        # Filter stations to within bounds + 0.5° buffer
        buffer = 0.5
        def in_bounds(station):
            lat = station.get('lat', 0)
            lng = station.get('lng', 0)
            return (bounds['south'] - buffer <= lat <= bounds['north'] + buffer and
                    bounds['west'] - buffer <= lng <= bounds['east'] + buffer)

        if 'tideStations' in pred_config:
            original = len(pred_config['tideStations'])
            pred_config['tideStations'] = [s for s in pred_config['tideStations'] if in_bounds(s)]
            logger.info(f'  Tide stations: {original} -> {len(pred_config["tideStations"])} (filtered to bounds)')

        if 'currentStations' in pred_config:
            original = len(pred_config['currentStations'])
            pred_config['currentStations'] = [s for s in pred_config['currentStations'] if in_bounds(s)]
            logger.info(f'  Current stations: {original} -> {len(pred_config["currentStations"])} (filtered to bounds)')

    # Extract district number for code
    m = re.match(r'^(\d+)', test_name.replace('cgd', ''))
    code = m.group(1) if m else test_name

    # Derive display name
    source_display = REGION_DISPLAY_NAMES.get(source_district, source_district)
    # Extract suffix from test_name (e.g., '17cgd-test2' -> 'test2')
    suffix = test_name.replace(source_district, '').lstrip('-')
    if not suffix:
        suffix = 'test'
    display_name = f'{source_display} ({suffix.title()})'

    doc_data = {
        'name': display_name,
        'code': code,
        'conversionStatus': {'state': 'pending'},
        'regionBoundary': {
            'south': bounds['south'],
            'west': bounds['west'],
            'north': bounds['north'],
            'east': bounds['east'],
        },
        'chartData': {},
    }

    if pred_config:
        doc_data['predictionConfig'] = pred_config

    doc_ref = db.collection('districts').document(test_name)
    doc_ref.set(doc_data)

    logger.info(f'  Created districts/{test_name}')
    logger.info(f'  Name: {display_name}')
    logger.info(f'  Bounds: {bounds}')
    if pred_config:
        logger.info(f'  Tide stations: {len(pred_config.get("tideStations", []))}')
        logger.info(f'  Current stations: {len(pred_config.get("currentStations", []))}')


# ============================================================================
# Phase 6: Trigger ENC Conversion
# ============================================================================

def trigger_enc_conversion(test_name, timeout=7200):
    """Trigger ENC conversion and poll for completion."""
    logger.info(f'\nPhase 6: Triggering ENC conversion...')

    # Extract district number
    m = re.match(r'^(\d+)', test_name.replace('cgd', ''))
    district_num = m.group(1) if m else test_name

    body = {
        'districtId': district_num,
        'districtLabel': test_name,
        'batchSize': 10,
        'maxParallel': 80,
    }

    result = call_service('enc-converter', '/convert-district-parallel', body, timeout=timeout)
    if result:
        logger.info(f'  ENC conversion complete')
        return True
    else:
        logger.error(f'  ENC conversion failed')
        return False


# ============================================================================
# Phase 7: Trigger Imagery Generators
# ============================================================================

def trigger_imagery_generators(test_name, bounds, timeout=7200):
    """Trigger basemap, satellite, ocean, terrain generators in parallel."""
    logger.info(f'\nPhase 7: Triggering imagery generators...')

    generators = ['basemap', 'satellite', 'ocean', 'terrain']
    body = {
        'regionId': test_name,
        'bounds': bounds,
    }

    results = {}

    def run_generator(gen_type):
        logger.info(f'  Starting {gen_type}...')
        result = call_service(gen_type, '/generate', body.copy(), timeout=timeout)
        return gen_type, result

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(run_generator, g): g for g in generators}
        for future in as_completed(futures):
            gen_type, result = future.result()
            results[gen_type] = result
            status = 'OK' if result else 'FAILED'
            logger.info(f'  {gen_type}: {status}')

    succeeded = sum(1 for r in results.values() if r is not None)
    logger.info(f'  Imagery generators: {succeeded}/{len(generators)} succeeded')
    return results


# ============================================================================
# Phase 8: Trigger Predictions
# ============================================================================

def trigger_predictions(test_name, timeout=7200):
    """Trigger tide and current prediction generation."""
    logger.info(f'\nPhase 8: Triggering predictions...')

    for pred_type in ['tides', 'currents']:
        logger.info(f'  Starting {pred_type}...')
        body = {
            'regionId': test_name,
            'type': pred_type,
            'allowCustomRegion': True,
        }
        result = call_service('predictions', '/generate', body, timeout=timeout)
        status = 'OK' if result else 'FAILED'
        logger.info(f'  {pred_type}: {status}')


# ============================================================================
# Phase 9: Generate Metadata
# ============================================================================

def generate_metadata(test_name):
    """Trigger metadata generation."""
    logger.info(f'\nPhase 9: Generating metadata...')
    result = call_service('metadata', '/generateMetadata', {'districtId': test_name}, timeout=300)
    if result:
        logger.info(f'  Metadata generated')
    else:
        logger.warning(f'  Metadata generation failed (non-critical)')


# ============================================================================
# Phase 10: Output App Config
# ============================================================================

def output_app_config(source_district, test_name, bounds):
    """Print the TypeScript config additions needed in the app."""
    # Derive prefix
    prefix = test_name.replace('cgd', '')

    # Derive display name
    source_display = REGION_DISPLAY_NAMES.get(source_district, source_district)
    suffix = test_name.replace(source_district, '').lstrip('-')
    if not suffix:
        suffix = 'test'
    display_name = f'{source_display} ({suffix.title()})'

    # Derive app region ID
    source_app_id = REGION_APP_IDS.get(source_district, source_district)
    app_id = f'{source_app_id}_{suffix}'

    # GNIS filename
    gnis_filename = GNIS_FILENAMES.get(source_district, 'gnis_names.mbtiles')

    # Basemap filename
    basemap_filename = f'{prefix}_basemap.mbtiles'

    print('\n' + '=' * 70)
    print('APP CONFIGURATION ADDITIONS')
    print('=' * 70)

    print(f'\n=== Add to src/config/regionData.ts REGIONS[] ===\n')
    print(f"""{{
  id: '{app_id}',
  name: '{display_name}',
  firestoreId: '{test_name}',
  bounds: {{
    south: {bounds['south']},
    west: {bounds['west']},
    north: {bounds['north']},
    east: {bounds['east']},
  }},
  center: {{
    latitude: {(bounds['south'] + bounds['north']) / 2},
    longitude: {(bounds['west'] + bounds['east']) / 2},
  }},
  initialZoom: 7,
}},""")

    print(f'\n=== Add to src/services/chartPackService.ts ===\n')
    print(f"DISTRICT_PREFIXES:  '{test_name}': '{prefix}'")
    print(f"GNIS_FILENAMES:     '{test_name}': '{gnis_filename}'")
    print(f"BASEMAP_FILENAMES:  '{test_name}': '{basemap_filename}'")
    print(f"DISTRICT_BOUNDS:    '{test_name}': {{south: {bounds['south']}, west: {bounds['west']}, north: {bounds['north']}, east: {bounds['east']}}}")

    print('\n' + '=' * 70)


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Create a reusable test district from a source district',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('--source', required=True,
                        help='Source district ID (e.g., 17cgd)')
    parser.add_argument('--chart',
                        help='Chart ID for coverage area (e.g., US2PACZS)')
    parser.add_argument('--bounds',
                        help='JSON bounding box: {"south":N,"west":N,"north":N,"east":N}')
    parser.add_argument('--name', required=True,
                        help='New test district ID (e.g., 17cgd-test2)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Discover and report only, no copies or triggers')
    parser.add_argument('--skip-generators', action='store_true',
                        help='Only set up Storage + Firestore, skip generation triggers')
    parser.add_argument('--skip-setup', action='store_true',
                        help='Skip phases 1-5 (discovery, copy, Firestore), jump to generators')
    parser.add_argument('--timeout', type=int, default=7200,
                        help='Max wait seconds per generator (default: 7200)')

    args = parser.parse_args()

    if not args.chart and not args.bounds:
        parser.error('Either --chart or --bounds is required')

    if args.chart and args.bounds:
        parser.error('Specify either --chart or --bounds, not both')

    logger.info(f'========================================')
    logger.info(f'Creating test district: {args.name}')
    logger.info(f'Source: {args.source}')
    if args.chart:
        logger.info(f'Coverage chart: {args.chart}')
    else:
        logger.info(f'Bounds: {args.bounds}')
    logger.info(f'Dry run: {args.dry_run}')
    logger.info(f'========================================')

    # Phase 1: Resolve bounds
    if args.chart:
        bounds = resolve_bounds_from_chart(args.source, args.chart)
    else:
        bounds = resolve_bounds_from_json(args.bounds)

    if not args.skip_setup:
        # Phase 2: Discover charts
        chart_ids, by_scale = discover_charts(args.source, bounds)

        if not chart_ids:
            logger.error('No charts found! Check your bounds or chart ID.')
            sys.exit(1)

        if args.dry_run:
            logger.info(f'\n=== DRY RUN COMPLETE ===')
            logger.info(f'Would create test district: {args.name}')
            logger.info(f'Charts to copy: {len(chart_ids)}')
            logger.info(f'Bounds: {bounds}')
            output_app_config(args.source, args.name, bounds)
            return

        # Phase 3: Copy ENC data
        copy_enc_data(args.source, args.name, chart_ids)

        # Phase 4: Copy GNIS data
        copy_gnis_data(args.source, args.name)

        # Phase 5: Create Firestore document
        create_firestore_doc(args.source, args.name, bounds)
    else:
        logger.info('Skipping phases 1-5 (--skip-setup)')
        chart_ids = []  # unknown when skipping

    if args.skip_generators:
        logger.info(f'\n=== SETUP COMPLETE (generators skipped) ===')
        logger.info(f'Test district: {args.name}')
        logger.info(f'Charts: {len(chart_ids)}')
        logger.info(f'\nTo trigger ENC conversion manually:')
        m = re.match(r'^(\d+)', args.name.replace('cgd', ''))
        district_num = m.group(1) if m else args.name
        logger.info(f'  curl -X POST <enc-converter-url>/convert-district-parallel \\')
        logger.info(f'    -H "Content-Type: application/json" \\')
        logger.info(f'    -H "Authorization: Bearer $(gcloud auth print-identity-token)" \\')
        logger.info(f'    -d \'{{"districtId": "{district_num}", "districtLabel": "{args.name}"}}\'')
        output_app_config(args.source, args.name, bounds)
        return

    # Phase 6: Trigger ENC conversion
    trigger_enc_conversion(args.name, timeout=args.timeout)

    # Phase 7: Trigger imagery generators
    trigger_imagery_generators(args.name, bounds, timeout=args.timeout)

    # Phase 8: Trigger predictions
    trigger_predictions(args.name, timeout=args.timeout)

    # Phase 9: Generate metadata
    generate_metadata(args.name)

    # Phase 10: Output app config
    logger.info(f'\n=== TEST DISTRICT CREATION COMPLETE ===')
    logger.info(f'District: {args.name}')
    logger.info(f'Charts: {len(chart_ids)}')
    logger.info(f'Bounds: {bounds}')
    output_app_config(args.source, args.name, bounds)


if __name__ == '__main__':
    main()
