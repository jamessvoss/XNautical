#!/usr/bin/env python3
"""
Reusable Test District Creator

Creates a complete working test district from a source district by:
  1. Resolving bounds (from a chart's M_COVR polygon or explicit bounding box)
  2. Discovering which charts intersect those bounds
  3. Copying ENC source data and chart GeoJSON
  4. Copying GNIS place name data
  5. Creating the Firestore district document
  6. Triggering ENC conversion
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
import time
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from google.cloud import storage, firestore

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

BUCKET_NAME = 'xnautical-8a296.firebasestorage.app'
GCP_PROJECT = 'xnautical-8a296'
GCP_REGION = 'us-central1'
M_COVR_OBJL = 302

# Service name → Cloud Run service name mapping
SERVICE_NAMES = {
    'enc-converter': 'enc-converter',
    'basemap': 'basemap-generator',
    'satellite': 'satellite-generator',
    'ocean': 'ocean-generator',
    'terrain': 'terrain-generator',
    'predictions': 'prediction-generator',
    'metadata': 'district-metadata',
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


def get_service_url(service_key):
    """Discover Cloud Run service URL via gcloud."""
    if service_key in _service_url_cache:
        return _service_url_cache[service_key]

    service_name = SERVICE_NAMES.get(service_key, service_key)
    try:
        url = subprocess.check_output([
            'gcloud', 'run', 'services', 'describe', service_name,
            '--region', GCP_REGION,
            '--project', GCP_PROJECT,
            '--format', 'value(status.url)',
        ], text=True).strip()
        _service_url_cache[service_key] = url
        return url
    except subprocess.CalledProcessError as e:
        logger.error(f'Failed to get URL for {service_name}: {e}')
        return None


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

def get_mcovr_polygon(geojson_data):
    """Extract the union of all M_COVR (OBJL=302) polygons from a GeoJSON FeatureCollection."""
    from osgeo import ogr
    polygons = []
    for feature in geojson_data.get('features', []):
        props = feature.get('properties', {})
        if props.get('OBJL') != M_COVR_OBJL:
            continue
        geom = feature.get('geometry')
        if not geom or geom.get('type') is None:
            continue
        ogr_geom = ogr.CreateGeometryFromJson(json.dumps(geom))
        if ogr_geom and not ogr_geom.IsEmpty():
            polygons.append(ogr_geom)

    if not polygons:
        return None

    union = polygons[0].Clone()
    for g in polygons[1:]:
        union = union.Union(g)
    return union


def resolve_bounds_from_chart(source_district, chart_id):
    """Download a chart's GeoJSON and extract bounds from M_COVR polygon."""
    logger.info(f'Phase 1: Resolving bounds from chart {chart_id}...')
    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)

    blob = bucket.blob(f'{source_district}/chart-geojson/{chart_id}/{chart_id}.geojson')
    if not blob.exists():
        logger.error(f'Chart GeoJSON not found: {source_district}/chart-geojson/{chart_id}/{chart_id}.geojson')
        sys.exit(1)

    data = json.loads(blob.download_as_text())
    coverage = get_mcovr_polygon(data)
    if coverage is None:
        logger.error(f'No M_COVR polygon found in {chart_id}')
        sys.exit(1)

    env = coverage.GetEnvelope()  # (minX, maxX, minY, maxY)
    bounds = {
        'south': round(env[2], 4),
        'west': round(env[0], 4),
        'north': round(env[3], 4),
        'east': round(env[1], 4),
    }
    area = coverage.GetArea()
    logger.info(f'  Chart {chart_id} M_COVR: {area:.2f} deg²')
    logger.info(f'  Bounds: S={bounds["south"]} W={bounds["west"]} N={bounds["north"]} E={bounds["east"]}')

    return bounds, coverage


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

def discover_charts(source_district, bounds, coverage_geom=None):
    """Find all charts in the source district that intersect the bounds."""
    from osgeo import ogr

    logger.info(f'\nPhase 2: Discovering charts in {source_district}...')
    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)

    # If we don't have a coverage geometry (bounds-only mode), create a box
    if coverage_geom is None:
        ring = ogr.Geometry(ogr.wkbLinearRing)
        ring.AddPoint(bounds['west'], bounds['south'])
        ring.AddPoint(bounds['east'], bounds['south'])
        ring.AddPoint(bounds['east'], bounds['north'])
        ring.AddPoint(bounds['west'], bounds['north'])
        ring.AddPoint(bounds['west'], bounds['south'])
        coverage_geom = ogr.Geometry(ogr.wkbPolygon)
        coverage_geom.AddGeometry(ring)

    # List all chart GeoJSON files
    prefix = f'{source_district}/chart-geojson/'
    blobs = list(bucket.list_blobs(prefix=prefix))

    chart_blobs = {}
    for b in blobs:
        rel = b.name[len(prefix):]
        parts = rel.split('/')
        if len(parts) == 2 and parts[1].endswith('.geojson'):
            chart_blobs[parts[0]] = b

    logger.info(f'  Found {len(chart_blobs)} charts in {source_district}')

    def check_chart(chart_id_blob):
        chart_id, blob = chart_id_blob
        try:
            data = json.loads(blob.download_as_text())
            mcovr = get_mcovr_polygon(data)
            if mcovr is None:
                return chart_id, None, 'no_mcovr'

            # Always include US1 charts that cover the area
            scale_num = None
            for f in data.get('features', []):
                sn = f.get('properties', {}).get('_scaleNum')
                if sn:
                    scale_num = sn
                    break

            if coverage_geom.Intersects(mcovr):
                return chart_id, scale_num, 'match'
            # Also include US1 charts if they intersect at all
            if scale_num == 1 and coverage_geom.Intersects(mcovr):
                return chart_id, scale_num, 'match'
            return chart_id, scale_num, 'no_intersect'
        except Exception as e:
            return chart_id, None, f'error: {e}'

    results = {'match': [], 'no_intersect': 0, 'no_mcovr': 0, 'error': 0}

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(check_chart, item): item[0]
                   for item in chart_blobs.items()}
        done = 0
        total = len(futures)
        for future in as_completed(futures):
            done += 1
            chart_id, scale_num, status = future.result()
            if status == 'match':
                results['match'].append((chart_id, scale_num))
            elif status == 'no_intersect':
                results['no_intersect'] += 1
            elif status == 'no_mcovr':
                results['no_mcovr'] += 1
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
    logger.info(f'  Total checked: {len(chart_blobs)}')
    logger.info(f'  Matching: {len(results["match"])}')
    logger.info(f'  No intersection: {results["no_intersect"]}')
    logger.info(f'  No M_COVR: {results["no_mcovr"]}')
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
    """Copy enc-source and chart-geojson for matching charts."""
    logger.info(f'\nPhase 3: Copying ENC data ({len(chart_ids)} charts)...')
    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)

    copied = 0
    errors = 0

    def copy_chart(chart_id):
        nonlocal copied, errors
        chart_copied = 0
        chart_errors = 0
        for subdir in ['enc-source', 'chart-geojson']:
            src_prefix = f'{source_district}/{subdir}/{chart_id}/'
            dst_prefix = f'{test_name}/{subdir}/{chart_id}/'
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

    with ThreadPoolExecutor(max_workers=8) as pool:
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

    # Create _manifest.json
    manifest = {'chartIds': chart_ids}
    manifest_blob = bucket.blob(f'{test_name}/chart-geojson/_manifest.json')
    manifest_blob.upload_from_string(json.dumps(manifest, indent=2),
                                     content_type='application/json')
    logger.info(f'  Created _manifest.json with {len(chart_ids)} chart IDs')
    logger.info(f'  Total: {copied} files copied, {errors} errors')


# ============================================================================
# Phase 4: Copy GNIS Data
# ============================================================================

def copy_gnis_data(source_district, test_name):
    """Copy GNIS place name data."""
    logger.info(f'\nPhase 4: Copying GNIS data...')
    client = storage.Client()
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
    db = firestore.Client()

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
    coverage_geom = None
    if args.chart:
        bounds, coverage_geom = resolve_bounds_from_chart(args.source, args.chart)
    else:
        bounds = resolve_bounds_from_json(args.bounds)

    # Phase 2: Discover charts
    chart_ids, by_scale = discover_charts(args.source, bounds, coverage_geom)

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
