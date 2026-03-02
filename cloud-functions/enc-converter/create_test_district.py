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
import time
import threading
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

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

# Load master config for GNIS filenames and display names
_MASTER_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'config', 'regions.json')
try:
    with open(_MASTER_CONFIG_PATH) as _f:
        _master_config = json.load(_f)
    GNIS_FILENAMES = {rid: cfg['gnisFile'] for rid, cfg in _master_config['regions'].items() if 'gnisFile' in cfg}
    REGION_DISPLAY_NAMES = {rid: cfg['name'] for rid, cfg in _master_config['regions'].items()}
    REGION_APP_IDS = {rid: cfg['appId'] for rid, cfg in _master_config['regions'].items() if 'appId' in cfg}
except (FileNotFoundError, json.JSONDecodeError) as e:
    logger.warning(f'Could not load master config ({e}), using fallbacks')
    GNIS_FILENAMES = {
        '01cgd': 'gnis_names_ne.mbtiles', '05cgd': 'gnis_names_ma.mbtiles',
        '07cgd': 'gnis_names_se.mbtiles', '08cgd': 'gnis_names_gc.mbtiles',
        '09cgd': 'gnis_names_gl.mbtiles', '11cgd': 'gnis_names_sw.mbtiles',
        '13cgd': 'gnis_names_pnw.mbtiles', '14cgd': 'gnis_names_hi.mbtiles',
        '17cgd': 'gnis_names_ak.mbtiles',
    }
    REGION_DISPLAY_NAMES = {
        '01cgd': 'Northeast', '05cgd': 'East', '07cgd': 'Southeast',
        '08cgd': 'Heartland', '09cgd': 'Great Lakes', '11cgd': 'Southwest',
        '13cgd': 'Northwest', '14cgd': 'Oceania', '17cgd': 'Arctic',
    }
    REGION_APP_IDS = {
        '01cgd': 'northeast', '05cgd': 'east', '07cgd': 'southeast',
        '08cgd': 'heartland', '09cgd': 'great_lakes', '11cgd': 'southwest',
        '13cgd': 'northwest', '14cgd': 'oceania', '17cgd': 'arctic',
    }


# ============================================================================
# Service URL discovery and auth
# ============================================================================

_service_url_cache = {}
_service_url_lock = threading.Lock()


def _populate_service_url_cache():
    """Fetch all Cloud Run service URLs at once via gcloud run services list.
    Thread-safe — only one thread will populate the cache.
    If CLOUD_RUN_SERVICE_URLS env var is set (by parent create_alaska_regions.py),
    uses that directly to avoid concurrent gcloud subprocess storms.
    Retries up to 3 times on SIGSEGV (Python 3.14 + gcloud subprocess instability)."""
    with _service_url_lock:
        if _service_url_cache:
            return
        # Check for pre-resolved URLs from parent process
        env_urls = os.environ.get('CLOUD_RUN_SERVICE_URLS')
        if env_urls:
            _service_url_cache.update(json.loads(env_urls))
            logger.info(f'  Using {len(_service_url_cache)} pre-resolved service URLs')
            return
        for attempt in range(3):
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
                return
            except subprocess.CalledProcessError as e:
                if e.returncode < 0 and attempt < 2:
                    logger.warning(f'  gcloud crashed (signal {-e.returncode}), retry {attempt+1}/3...')
                    time.sleep(2)
                    continue
                logger.error(f'Failed to list Cloud Run services: {e}')
            except FileNotFoundError as e:
                logger.error(f'Failed to list Cloud Run services: {e}')
                return


def get_service_url(service_key):
    """Discover Cloud Run service URL via gcloud."""
    _populate_service_url_cache()

    service_name = SERVICE_NAMES.get(service_key, service_key)
    url = _service_url_cache.get(service_name)
    if not url:
        logger.error(f'Service URL not found for {service_name}')
    return url


_auth_lock = threading.Lock()
_auth_token = None
_auth_token_time = 0


def get_auth_token(force_refresh=False):
    """Get identity token for authenticated Cloud Run calls.

    Caches token for 45 minutes (tokens expire after 60 min).
    Thread-safe for concurrent use from ThreadPoolExecutor.
    If CLOUD_RUN_AUTH_TOKEN env var is set (by parent create_alaska_regions.py),
    uses that as initial seed to avoid concurrent gcloud subprocess storms.
    Retries up to 3 times on SIGSEGV (Python 3.14 + gcloud subprocess instability).
    """
    global _auth_token, _auth_token_time
    with _auth_lock:
        # Seed from parent's pre-resolved token on first call
        if not _auth_token and not force_refresh:
            env_token = os.environ.get('CLOUD_RUN_AUTH_TOKEN')
            if env_token:
                _auth_token = env_token
                _auth_token_time = time.time()
                logger.info('  Using pre-resolved auth token')
                return _auth_token
        if not force_refresh and _auth_token and (time.time() - _auth_token_time) < 2700:
            return _auth_token
        for attempt in range(3):
            try:
                _auth_token = subprocess.check_output(
                    ['gcloud', 'auth', 'print-identity-token'],
                    text=True,
                ).strip()
                _auth_token_time = time.time()
                return _auth_token
            except subprocess.CalledProcessError as e:
                if e.returncode < 0 and attempt < 2:
                    logger.warning(f'  gcloud auth crashed (signal {-e.returncode}), retry {attempt+1}/3...')
                    time.sleep(2)
                    continue
                logger.error(f'Failed to get auth token: {e}')
                return None
            except FileNotFoundError as e:
                logger.error(f'Failed to get auth token: {e}')
                return None


def call_service(service_key, endpoint, body, timeout=7200, max_retries=3, retry_delay=30):
    """POST to a Cloud Run service with authentication and retry.

    Retries on transient HTTP errors (429, 500, 502, 503, 504) and timeouts
    with exponential backoff. Refreshes auth token on each retry attempt.
    Returns None on permanent failure, response dict on 409 (conflict), or
    response dict on 200 (success).
    """
    url = get_service_url(service_key)
    if not url:
        return None

    full_url = f'{url.rstrip("/")}{endpoint}'
    logger.info(f'  POST {full_url}')
    logger.info(f'  Body: {json.dumps(body)}')

    for attempt in range(max_retries + 1):
        token = get_auth_token(force_refresh=(attempt > 0))
        if not token:
            logger.error(f'  No auth token available')
            return None

        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        }

        try:
            resp = requests.post(full_url, json=body, headers=headers, timeout=timeout)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 409:
                # Conflict (e.g., prediction lock, conversion guard) — return info, don't retry
                try:
                    return {'status': 'conflict', 'http_status': 409, **resp.json()}
                except Exception:
                    return {'status': 'conflict', 'http_status': 409}
            if resp.status_code == 400:
                # Client error — return error body so callers can inspect (e.g., "no stations")
                try:
                    return {'status': 'error', 'http_status': 400, **resp.json()}
                except Exception:
                    return {'status': 'error', 'http_status': 400, 'error': resp.text[:500]}
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < max_retries:
                delay = retry_delay * (2 ** attempt)
                logger.warning(f'  [{service_key}] HTTP {resp.status_code}, retry {attempt+1}/{max_retries} in {delay}s...')
                time.sleep(delay)
                continue
            logger.error(f'  HTTP {resp.status_code}: {resp.text[:500]}')
            return None
        except requests.exceptions.Timeout:
            if attempt < max_retries:
                logger.warning(f'  [{service_key}] Timeout after {timeout}s, retry {attempt+1}/{max_retries}...')
                continue
            logger.error(f'  [{service_key}] Request timed out after {timeout}s (all retries exhausted)')
            return None
        except Exception as e:
            if attempt < max_retries:
                logger.warning(f'  [{service_key}] Error: {e}, retry {attempt+1}/{max_retries} in {retry_delay}s...')
                time.sleep(retry_delay)
                continue
            logger.error(f'  [{service_key}] Request failed: {e}')
            return None
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
    """Parse bounds from JSON string, dict, or list of dicts.

    For antimeridian-crossing regions (e.g., 17cgd-DutchHarbor), bounds may be
    a list of rectangles. These are merged into a single bounding box where
    west > east signals antimeridian crossing — which _lon_ranges_overlap and
    in_bounds already handle.
    """
    logger.info(f'Phase 1: Using provided bounds...')
    if isinstance(bounds_json, str):
        bounds = json.loads(bounds_json)
    else:
        bounds = bounds_json

    # Multi-rectangle bounds: merge into one antimeridian-crossing box
    if isinstance(bounds, list):
        if len(bounds) == 1:
            bounds = bounds[0]
        else:
            num_rects = len(bounds)
            # Find the overall extent across all rectangles.
            # For antimeridian regions the convention is: one rect has west=-180
            # and another has east=180. The merged box uses the non-180 edges
            # so that west > east signals the crossing.
            south = min(b['south'] for b in bounds)
            north = max(b['north'] for b in bounds)
            # Collect all west/east edges, pick the non-±180 boundaries
            wests = [b['west'] for b in bounds if b['west'] != -180]
            easts = [b['east'] for b in bounds if b['east'] != 180]
            west = min(wests) if wests else -180
            east = max(easts) if easts else 180
            bounds = {'south': south, 'west': west, 'north': north, 'east': east}
            logger.info(f'  Merged {num_rects} rectangles into antimeridian-crossing box')

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

def _lon_ranges_overlap(w1, e1, w2, e2):
    """Test if two longitude ranges overlap, handling antimeridian crossing."""
    # A range crosses the antimeridian when west > east (e.g., 170 to -170)
    cross1 = w1 > e1
    cross2 = w2 > e2
    if not cross1 and not cross2:
        # Neither crosses — simple overlap
        return w1 <= e2 and e1 >= w2
    if cross1 and not cross2:
        # b1 crosses antimeridian: overlaps if b2 is in either half
        return w2 <= e1 or e2 >= w1
    if not cross1 and cross2:
        # b2 crosses antimeridian
        return w1 <= e2 or e1 >= w2
    # Both cross — always overlap
    return True


def _boxes_intersect(b1, b2):
    """Test if two bounding boxes intersect. Each is {south, west, north, east}.
    Handles antimeridian-crossing bounds (where west > east)."""
    return (_lon_ranges_overlap(b1['west'], b1['east'], b2['west'], b2['east']) and
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
    Returns True on success, False if any files failed to copy.
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
    return errors == 0


# ============================================================================
# Phase 4: Copy GNIS Data
# ============================================================================

def copy_gnis_data(source_district, test_name):
    """Copy GNIS place name data. Returns True on success, False on error."""
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
        return True  # Not an error — some districts legitimately have no GNIS data

    copied = 0
    errors = 0
    for blob in blobs:
        rel = blob.name[len(src_prefix):]
        dst_name = f'{test_name}/gnis/{rel}'
        try:
            bucket.copy_blob(blob, bucket, dst_name)
            copied += 1
        except Exception as e:
            logger.error(f'  Failed: {blob.name} -> {dst_name}: {e}')
            errors += 1

    logger.info(f'  Copied {copied} GNIS files')
    return errors == 0


# ============================================================================
# Phase 5: Create Firestore Document
# ============================================================================

def create_firestore_doc(source_district, test_name, bounds):
    """Create the Firestore district document with predictionConfig from source.

    Returns True on success, False on error.
    """
    logger.info(f'\nPhase 5: Creating Firestore document...')
    try:
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
                if not (bounds['south'] - buffer <= lat <= bounds['north'] + buffer):
                    return False
                w = bounds['west'] - buffer
                e = bounds['east'] + buffer
                if w > e:
                    # Antimeridian crossing (e.g., Aleutians)
                    return lng >= w or lng <= e
                return w <= lng <= e

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

        # Derive display name — use master config first, then derive from source
        if test_name in REGION_DISPLAY_NAMES:
            display_name = REGION_DISPLAY_NAMES[test_name]
        else:
            source_display = REGION_DISPLAY_NAMES.get(source_district, source_district)
            suffix = test_name.replace(source_district, '').lstrip('-')
            if not suffix:
                suffix = 'test'
            display_name = f'{source_display} ({suffix.title()})'

        bounds_obj = {
            'south': bounds['south'],
            'west': bounds['west'],
            'north': bounds['north'],
            'east': bounds['east'],
        }

        doc_data = {
            'name': display_name,
            'code': code,
            'conversionStatus': {'state': 'pending'},
            'bounds': bounds_obj,
            'regionBoundary': bounds_obj,
        }

        if pred_config:
            doc_data['predictionConfig'] = pred_config

        doc_ref = db.collection('districts').document(test_name)
        # Use merge=True to avoid overwriting existing fields (e.g., chartData, downloadPacks)
        # This is critical for standard districts where source == destination
        doc_ref.set(doc_data, merge=True)

        logger.info(f'  Created districts/{test_name}')
        logger.info(f'  Name: {display_name}')
        logger.info(f'  Bounds: {bounds}')
        if pred_config:
            logger.info(f'  Tide stations: {len(pred_config.get("tideStations", []))}')
            logger.info(f'  Current stations: {len(pred_config.get("currentStations", []))}')
        return True
    except Exception as e:
        logger.error(f'  Failed to create Firestore doc: {e}')
        return False


# ============================================================================
# Phase 6: Trigger ENC Conversion
# ============================================================================

def _poll_compose_completion(district_label, timeout=7200):
    """Poll Firestore for compose job completion.

    The compose Cloud Run Job writes chartData.composedAt when it finishes.
    We poll for that field (or an error state) to determine completion.
    """
    db = get_firestore_client()
    doc_ref = db.collection('districts').document(district_label)
    start = time.time()
    poll_interval = 15

    while time.time() - start < timeout:
        time.sleep(poll_interval)
        elapsed = int(time.time() - start)

        try:
            doc = doc_ref.get()
            if not doc.exists:
                continue
            data = doc.to_dict()

            # Check for compose completion (compose job writes composedAt)
            chart_data = data.get('chartData', {})
            composed_at = chart_data.get('composedAt')
            if composed_at:
                try:
                    composed_epoch = composed_at.timestamp() if hasattr(composed_at, 'timestamp') else composed_at
                except Exception:
                    composed_epoch = 0

                if composed_epoch >= start - 30:
                    total = chart_data.get('totalCharts', '?')
                    size = chart_data.get('totalSizeMB', 0)
                    logger.info(f'  Compose complete: {total} charts, {size:.1f} MB ({elapsed}s)')
                    return True

            # Check for error state
            status = data.get('conversionStatus', {})
            if status.get('state') == 'error':
                logger.error(f'  Compose failed: {status.get("message", "unknown")}')
                return False
        except Exception as e:
            logger.warning(f'  Error polling Firestore: {e}')

        if elapsed % 60 < poll_interval:
            logger.info(f'  Waiting on compose job ({elapsed}s)...')

    logger.error(f'  Compose timed out after {timeout}s')
    return False


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
    if not result:
        logger.error(f'  ENC conversion: no response')
        return False
    # The endpoint returns HTTP 200 even on compose failure — check response body
    status = result.get('status', '')
    if status == 'error':
        error = result.get('error', '')
        compose_error = result.get('phases', {}).get('compose', {}).get('error', '')
        logger.error(f'  ENC conversion failed: {error or compose_error or "unknown error"}')
        return False
    if status == 'conflict':
        # 409 can mean "already running" or "already completed"
        conflict_msg = result.get('error', result.get('message', ''))
        if 'completed' in conflict_msg.lower() or 'already' in conflict_msg.lower():
            logger.info(f'  ENC conversion already completed (409)')
            return True
        logger.warning(f'  ENC conversion conflict: {conflict_msg or "in progress"}')
        return False
    # Compose job launched — poll Firestore locally (no Cloud Run timeout limit)
    if result.get('composeStatus') == 'launched':
        charts = result.get('summary', {}).get('successfulCharts', '?')
        logger.info(f'  Batch conversion done ({charts} charts), compose job launched — polling Firestore...')
        return _poll_compose_completion(test_name, timeout=timeout)
    total_charts = result.get('total_charts', result.get('report', {}).get('total_charts', '?'))
    logger.info(f'  ENC conversion complete: {total_charts} charts')
    return True


# ============================================================================
# Phase 7: Trigger Imagery Generators
# ============================================================================

def trigger_imagery_generators(test_name, bounds, timeout=7200):
    """Trigger basemap, satellite, ocean, terrain generators in parallel.

    Returns dict of {generator_name: bool} indicating success/failure per generator.
    """
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
            results[gen_type] = result is not None
            status = 'OK' if result else 'FAILED'
            logger.info(f'  {gen_type}: {status}')

    succeeded = sum(1 for ok in results.values() if ok)
    logger.info(f'  Imagery generators: {succeeded}/{len(generators)} succeeded')
    return results


# ============================================================================
# Phase 8: Trigger Predictions
# ============================================================================

def trigger_predictions(test_name, timeout=7200, prediction_delay=0):
    """Trigger tide and current prediction generation.

    Returns True if both tides and currents succeed, False otherwise.
    Supports prediction_delay for NOAA rate-limit staggering when
    running multiple districts in parallel.
    """
    logger.info(f'\nPhase 8: Triggering predictions...')

    if prediction_delay > 0:
        logger.info(f'  Waiting {prediction_delay}s before predictions (NOAA rate stagger)...')
        time.sleep(prediction_delay)

    all_ok = True
    for pred_type in ['tides', 'currents']:
        logger.info(f'  Starting {pred_type}...')
        body = {
            'regionId': test_name,
            'type': pred_type,
            'allowCustomRegion': True,
        }
        result = call_service('predictions', '/generate', body, timeout=timeout,
                              max_retries=3, retry_delay=120)
        if not result:
            # Check if the 400 error was "no stations" — that's expected for some regions
            logger.error(f'  {pred_type}: FAILED (no response)')
            all_ok = False
            continue
        if isinstance(result, dict) and result.get('status') == 'error':
            error_msg = result.get('error', 'unknown')
            if 'no stations' in error_msg.lower():
                logger.info(f'  {pred_type}: skipped (no stations in region)')
                continue
            logger.error(f'  {pred_type}: FAILED ({error_msg})')
            all_ok = False
            continue
        if isinstance(result, dict) and result.get('status') == 'conflict':
            conflict_msg = result.get('error', result.get('message', ''))
            if 'completed' in conflict_msg.lower() or 'already' in conflict_msg.lower():
                logger.info(f'  {pred_type}: already completed (409)')
                continue
            logger.error(f'  {pred_type}: FAILED (conflict: {conflict_msg or "in progress"})')
            all_ok = False
            continue
        logger.info(f'  {pred_type}: OK')
    return all_ok


# ============================================================================
# Phase 8b: Discover Marine Zones
# ============================================================================

def discover_marine_zones(test_name):
    """Discover and upload marine zones via the Node.js script.

    Runs as a subprocess since the discovery logic is in discover-marine-zones.js.
    Returns True on success, False on failure.
    """
    logger.info(f'\nPhase 8b: Discovering marine zones...')
    script_path = os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'discover-marine-zones.js')
    script_path = os.path.normpath(script_path)

    if not os.path.exists(script_path):
        logger.error(f'  Marine zones script not found: {script_path}')
        return False

    try:
        result = subprocess.run(
            ['node', script_path, f'--district={test_name}'],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode == 0:
            # Extract zone count from output
            for line in result.stdout.splitlines():
                if test_name in line and 'zone' in line.lower():
                    logger.info(f'  {line.strip()}')
            logger.info(f'  Marine zones: OK')
            return True
        else:
            logger.error(f'  Marine zones failed (exit {result.returncode})')
            if result.stderr:
                for line in result.stderr.strip().splitlines()[-3:]:
                    logger.error(f'    {line}')
            return False
    except subprocess.TimeoutExpired:
        logger.error(f'  Marine zones timed out (300s)')
        return False
    except Exception as e:
        logger.error(f'  Marine zones exception: {e}')
        return False


# ============================================================================
# Phase 9: Generate Metadata
# ============================================================================

def generate_metadata(test_name):
    """Trigger metadata generation. Returns True on success, False on failure."""
    logger.info(f'\nPhase 9: Generating metadata...')
    result = call_service('metadata', '/generateMetadata', {'districtId': test_name}, timeout=300)
    if result and result.get('status') != 'error':
        logger.info(f'  Metadata generated')
        return True
    logger.warning(f'  Metadata generation failed (non-critical)')
    return False


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
# Resume State Tracking
# ============================================================================

_state_lock = threading.Lock()
STATE_DIR = os.path.dirname(os.path.abspath(__file__))


def _state_file(district_id):
    """Per-district state file to avoid cross-process race conditions."""
    return os.path.join(STATE_DIR, f'.pipeline-state-{district_id}.json')


def load_state(district_id):
    """Load pipeline state from disk for a specific district."""
    path = _state_file(district_id)
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def save_state(district_id, state):
    """Save pipeline state to disk for a specific district."""
    path = _state_file(district_id)
    tmp_path = path + '.tmp'
    with open(tmp_path, 'w') as f:
        json.dump(state, f, indent=2)
    os.replace(tmp_path, path)  # Atomic on POSIX


def is_phase_done(state, phase):
    """Check if a phase is already completed."""
    return state.get(phase, False)


def mark_phase_done(state, district_id, phase):
    """Mark a phase as completed (thread-safe, per-district file)."""
    with _state_lock:
        state[phase] = True
        state[f'{phase}_at'] = datetime.now().isoformat()
        save_state(district_id, state)


def clear_state(district_id):
    """Clear pipeline state for a specific district."""
    path = _state_file(district_id)
    if os.path.exists(path):
        os.remove(path)


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
    parser.add_argument('--prediction-delay', type=int, default=0,
                        help='Seconds to wait before starting predictions (NOAA rate stagger)')
    parser.add_argument('--resume', action='store_true',
                        help='Resume from last checkpoint — skip completed phases')
    parser.add_argument('--clean', action='store_true',
                        help='Clear saved state for this district before running')

    args = parser.parse_args()

    if not args.chart and not args.bounds:
        parser.error('Either --chart or --bounds is required')

    if args.chart and args.bounds:
        parser.error('Specify either --chart or --bounds, not both')

    # Handle --clean
    if args.clean:
        clear_state(args.name)
        logger.info(f'Cleared saved state for {args.name}')

    # Load resume state (per-district file)
    state = load_state(args.name) if args.resume else {}

    logger.info(f'========================================')
    logger.info(f'Creating test district: {args.name}')
    logger.info(f'Source: {args.source}')
    if args.chart:
        logger.info(f'Coverage chart: {args.chart}')
    else:
        logger.info(f'Bounds: {args.bounds}')
    logger.info(f'Dry run: {args.dry_run}')
    if args.resume:
        done_phases = [k for k, v in state.items() if v is True]
        if done_phases:
            logger.info(f'Resuming — completed: {", ".join(sorted(done_phases))}')
    logger.info(f'========================================')

    # Phase 1: Resolve bounds
    if args.chart:
        bounds = resolve_bounds_from_chart(args.source, args.chart)
    else:
        bounds = resolve_bounds_from_json(args.bounds)

    chart_ids = []
    firestore_ok = True

    if not args.skip_setup:
        if is_phase_done(state, 'setup'):
            logger.info('Setup phases 2-5: Already complete (resuming), skipping')
        else:
            # Phase 2: Discover charts (must be first — need chart_ids for Phase 3)
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

            # Phases 3+4+5 in parallel (all independent after chart discovery)
            logger.info(f'\nRunning setup phases 3-5 in parallel...')
            with ThreadPoolExecutor(max_workers=3) as pool:
                enc_copy_future = pool.submit(copy_enc_data, args.source, args.name, chart_ids)
                gnis_future = pool.submit(copy_gnis_data, args.source, args.name)
                firestore_future = pool.submit(create_firestore_doc, args.source, args.name, bounds)

                enc_copy_ok = enc_copy_future.result()  # Phase 3
                gnis_future.result()      # Phase 4
                firestore_ok = firestore_future.result()  # Phase 5

            if not enc_copy_ok:
                logger.error('ENC data copy had errors -- aborting pipeline to prevent incomplete data')
                sys.exit(1)
            if not firestore_ok:
                logger.error('Firestore doc creation failed -- aborting pipeline to prevent incomplete data')
                sys.exit(1)

            mark_phase_done(state, args.name, 'setup')
    else:
        logger.info('Skipping phases 1-5 (--skip-setup)')

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

    # Phases 6+7+8+8b: All generators + marine zones in parallel
    enc_ok = is_phase_done(state, 'enc')
    basemap_ok = is_phase_done(state, 'basemap')
    satellite_ok = is_phase_done(state, 'satellite')
    ocean_ok = is_phase_done(state, 'ocean')
    terrain_ok = is_phase_done(state, 'terrain')
    predictions_ok = is_phase_done(state, 'predictions')
    marine_zones_ok = is_phase_done(state, 'marine_zones')

    # Determine which generators to run
    imagery_generators = {
        'basemap': basemap_ok,
        'satellite': satellite_ok,
        'ocean': ocean_ok,
        'terrain': terrain_ok,
    }
    imagery_to_run = [g for g, done in imagery_generators.items() if not done]

    generators_to_run = []
    if not enc_ok:
        generators_to_run.append('enc')
    if imagery_to_run:
        generators_to_run.append('imagery')
    if not predictions_ok:
        generators_to_run.append('predictions')
    if not marine_zones_ok:
        generators_to_run.append('marine_zones')

    if generators_to_run:
        # Only need service URLs/auth for cloud generators (not marine zones)
        if any(g != 'marine_zones' for g in generators_to_run):
            _populate_service_url_cache()
            get_auth_token()

        done_generators = [g for g, ok in imagery_generators.items() if ok]
        if args.resume and (done_generators or enc_ok or predictions_ok or marine_zones_ok):
            skip_list = []
            if enc_ok:
                skip_list.append('enc')
            skip_list.extend(done_generators)
            if predictions_ok:
                skip_list.append('predictions')
            if marine_zones_ok:
                skip_list.append('marine_zones')
            logger.info(f'\nResuming — already done: {", ".join(skip_list)}')
        else:
            logger.info(f'\nRunning generators in parallel...')

        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {}
            if not enc_ok:
                futures['enc'] = pool.submit(trigger_enc_conversion, args.name, timeout=args.timeout)
            if imagery_to_run:
                futures['imagery'] = pool.submit(
                    trigger_imagery_generators, args.name, bounds, timeout=args.timeout)
            if not predictions_ok:
                if firestore_ok:
                    futures['predictions'] = pool.submit(
                        trigger_predictions, args.name, timeout=args.timeout,
                        prediction_delay=args.prediction_delay)
                else:
                    logger.error('Skipping predictions — Firestore doc creation failed')
            if not marine_zones_ok:
                futures['marine_zones'] = pool.submit(discover_marine_zones, args.name)

            # Collect ENC result
            if 'enc' in futures:
                try:
                    enc_ok = futures['enc'].result()
                except Exception as e:
                    logger.error(f'  ENC generator exception: {e}')
                    enc_ok = False
                if enc_ok:
                    mark_phase_done(state, args.name, 'enc')

            # Collect per-generator imagery results
            if 'imagery' in futures:
                try:
                    imagery_results = futures['imagery'].result()
                except Exception as e:
                    logger.error(f'  Imagery generator exception: {e}')
                    imagery_results = {g: False for g in imagery_to_run}

                # Mark each generator individually
                for gen_name, ok in imagery_results.items():
                    if ok:
                        mark_phase_done(state, args.name, gen_name)
                    if gen_name == 'basemap':
                        basemap_ok = ok
                    elif gen_name == 'satellite':
                        satellite_ok = ok
                    elif gen_name == 'ocean':
                        ocean_ok = ok
                    elif gen_name == 'terrain':
                        terrain_ok = ok

            # Collect predictions result
            if 'predictions' in futures:
                try:
                    predictions_ok = futures['predictions'].result()
                except Exception as e:
                    logger.error(f'  Predictions generator exception: {e}')
                    predictions_ok = False
                if predictions_ok:
                    mark_phase_done(state, args.name, 'predictions')

            # Collect marine zones result
            if 'marine_zones' in futures:
                try:
                    marine_zones_ok = futures['marine_zones'].result()
                except Exception as e:
                    logger.error(f'  Marine zones exception: {e}')
                    marine_zones_ok = False
                if marine_zones_ok:
                    mark_phase_done(state, args.name, 'marine_zones')
    else:
        logger.info('\nAll generators already complete (resuming)')

    # Phase 9: Metadata — generate even with partial success
    # Metadata service already handles missing packs gracefully (checks if files exist)
    imagery_ok = basemap_ok and satellite_ok and ocean_ok and terrain_ok
    all_ok = enc_ok and imagery_ok and predictions_ok and marine_zones_ok

    if not is_phase_done(state, 'metadata'):
        if enc_ok:
            # Generate metadata whenever ENC is done — metadata service handles missing packs
            metadata_ok = generate_metadata(args.name)
            if metadata_ok:
                mark_phase_done(state, args.name, 'metadata')
            else:
                logger.warning('Metadata not marked complete — will retry on resume')
        else:
            logger.error('Metadata skipped — ENC conversion required')
    else:
        logger.info('Metadata: Already generated (resuming)')

    if not all_ok:
        failed_parts = []
        if not enc_ok: failed_parts.append('ENC')
        if not basemap_ok: failed_parts.append('basemap')
        if not satellite_ok: failed_parts.append('satellite')
        if not ocean_ok: failed_parts.append('ocean')
        if not terrain_ok: failed_parts.append('terrain')
        if not predictions_ok: failed_parts.append('predictions')
        if not marine_zones_ok: failed_parts.append('marine_zones')
        logger.warning(f'Incomplete generators: {", ".join(failed_parts)}')

    # Phase 10: Output app config
    logger.info(f'\n=== TEST DISTRICT CREATION {"COMPLETE" if all_ok else "INCOMPLETE"} ===')
    logger.info(f'District: {args.name}')
    logger.info(f'Charts: {len(chart_ids)}')
    logger.info(f'Bounds: {bounds}')
    logger.info(f'ENC: {"OK" if enc_ok else "FAILED"}')
    logger.info(f'Basemap: {"OK" if basemap_ok else "FAILED"}')
    logger.info(f'Satellite: {"OK" if satellite_ok else "FAILED"}')
    logger.info(f'Ocean: {"OK" if ocean_ok else "FAILED"}')
    logger.info(f'Terrain: {"OK" if terrain_ok else "FAILED"}')
    logger.info(f'Predictions: {"OK" if predictions_ok else "FAILED"}')
    logger.info(f'Marine Zones: {"OK" if marine_zones_ok else "FAILED"}')
    output_app_config(args.source, args.name, bounds)

    if not all_ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
