#!/usr/bin/env python3
"""
One-time script to create the 017cgd-test district for contour clipping iteration.

Steps:
  1. Download US1GLBDC's M_COVR polygon from 17cgd/chart-geojson/
  2. Find all charts in 17cgd whose M_COVR intersects US1GLBDC's coverage
  3. Copy enc-source and chart-geojson for matching charts to 017cgd-test/
  4. Create _manifest.json listing all chart IDs
  5. Copy basemaps/ocean/satellite/terrain tile packs
  6. Create Firestore document for the test district

Usage:
    # Step 1: Discover charts (dry run — no copies)
    python3 setup_test_district.py discover

    # Step 2: Copy everything to create the test district
    python3 setup_test_district.py copy

    # Step 3: Create Firestore document
    python3 setup_test_district.py firestore
"""

import json
import os
import sys
import time
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

from osgeo import ogr
from google.cloud import storage, firestore

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

BUCKET_NAME = 'xnautical-8a296.firebasestorage.app'
SOURCE_DISTRICT = '17cgd'
TEST_DISTRICT = '017cgd-test'
US1_CHART = 'US1GLBDC'
US2_CHART = 'US2PACZS'
M_COVR_OBJL = 302


def get_mcovr_polygon(geojson_data):
    """Extract the union of all M_COVR (OBJL=302) polygons from a GeoJSON FeatureCollection."""
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


def discover_charts():
    """Find US1GLBDC + US2PACZS + all charts intersecting US2PACZS's coverage."""
    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)

    # Step 1: Download US2PACZS's GeoJSON and extract its M_COVR as the intersection boundary
    logger.info(f'Downloading {US2_CHART} GeoJSON for intersection boundary...')
    us2_blob = bucket.blob(f'{SOURCE_DISTRICT}/chart-geojson/{US2_CHART}/{US2_CHART}.geojson')
    us2_data = json.loads(us2_blob.download_as_text())
    us2_coverage = get_mcovr_polygon(us2_data)
    if us2_coverage is None:
        logger.error(f'No M_COVR polygon found in {US2_CHART}')
        sys.exit(1)

    area = us2_coverage.GetArea()
    env = us2_coverage.GetEnvelope()  # (minX, maxX, minY, maxY)
    logger.info(f'{US2_CHART} M_COVR: {area:.2f} deg², '
                f'envelope: ({env[0]:.2f}, {env[2]:.2f}) to ({env[1]:.2f}, {env[3]:.2f})')

    # Always include US1GLBDC and US2PACZS
    forced_charts = {US1_CHART, US2_CHART}

    # Step 2: List all chart-geojson directories in 17cgd
    logger.info(f'Listing charts in {SOURCE_DISTRICT}/chart-geojson/...')
    prefix = f'{SOURCE_DISTRICT}/chart-geojson/'
    blobs = list(bucket.list_blobs(prefix=prefix))

    # Group by chart ID — find .geojson files
    chart_blobs = {}
    for b in blobs:
        rel = b.name[len(prefix):]
        parts = rel.split('/')
        if len(parts) == 2 and parts[1].endswith('.geojson'):
            chart_id = parts[0]
            chart_blobs[chart_id] = b

    logger.info(f'Found {len(chart_blobs)} charts in {SOURCE_DISTRICT}')

    # Step 3: Check intersection against US2PACZS boundary for remaining charts
    # Download and check in parallel (8 workers)
    def check_chart(chart_id_blob):
        chart_id, blob = chart_id_blob
        if chart_id in forced_charts:
            # Always include — just get scale number
            try:
                data = json.loads(blob.download_as_text())
                scale_num = None
                for f in data.get('features', []):
                    sn = f.get('properties', {}).get('_scaleNum')
                    if sn:
                        scale_num = sn
                        break
                return chart_id, scale_num, 'match'
            except Exception as e:
                return chart_id, None, f'error: {e}'
        try:
            data = json.loads(blob.download_as_text())
            mcovr = get_mcovr_polygon(data)
            if mcovr is None:
                return chart_id, None, 'no_mcovr'
            if us2_coverage.Intersects(mcovr):
                scale_num = None
                for f in data.get('features', []):
                    sn = f.get('properties', {}).get('_scaleNum')
                    if sn:
                        scale_num = sn
                        break
                return chart_id, scale_num, 'match'
            return chart_id, None, 'no_intersect'
        except Exception as e:
            return chart_id, None, f'error: {e}'

    logger.info(f'Checking chart intersections against {US2_CHART} boundary...')
    logger.info(f'  (forced inclusions: {", ".join(sorted(forced_charts))})')
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
                            f'{len(results["match"])} matches so far')

    # Sort matches by scale number then chart ID
    results['match'].sort(key=lambda x: (x[1] or 0, x[0]))

    logger.info(f'\n=== Discovery Results ===')
    logger.info(f'Total charts checked: {len(chart_blobs)}')
    logger.info(f'Matching (intersect {US2_CHART}): {len(results["match"])}')
    logger.info(f'No intersection: {results["no_intersect"]}')
    logger.info(f'No M_COVR: {results["no_mcovr"]}')
    logger.info(f'Errors: {results["error"]}')

    # Print matches grouped by scale
    by_scale = defaultdict(list)
    for chart_id, scale_num in results['match']:
        by_scale[scale_num or 0].append(chart_id)

    logger.info(f'\nMatching charts by scale:')
    for sn in sorted(by_scale.keys()):
        charts = by_scale[sn]
        label = f'US{sn}' if sn else 'Unknown'
        logger.info(f'  {label}: {len(charts)} charts')
        for cid in sorted(charts):
            logger.info(f'    {cid}')

    # Save results to file for use by copy step
    chart_ids = [cid for cid, _ in results['match']]
    output = {
        'us1_chart': US1_CHART,
        'us2_chart': US2_CHART,
        'boundary_envelope': {
            'west': env[0], 'east': env[1],
            'south': env[2], 'north': env[3],
        },
        'chart_ids': chart_ids,
        'by_scale': {str(sn): sorted(ids) for sn, ids in by_scale.items()},
        'total': len(chart_ids),
    }
    output_path = os.path.join(os.path.dirname(__file__), 'test_district_charts.json')
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)
    logger.info(f'\nSaved {len(chart_ids)} chart IDs to {output_path}')

    return chart_ids, output['boundary_envelope']


def copy_charts():
    """Copy enc-source and chart-geojson for matching charts to 017cgd-test."""
    # Load chart list from discovery step
    charts_path = os.path.join(os.path.dirname(__file__), 'test_district_charts.json')
    if not os.path.exists(charts_path):
        logger.error(f'Run "discover" first — {charts_path} not found')
        sys.exit(1)

    with open(charts_path, 'r') as f:
        data = json.load(f)

    chart_ids = data['chart_ids']
    logger.info(f'Copying {len(chart_ids)} charts from {SOURCE_DISTRICT} to {TEST_DISTRICT}')

    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)

    # Copy enc-source and chart-geojson for each chart
    copied = 0
    errors = 0

    for i, chart_id in enumerate(chart_ids):
        for subdir in ['enc-source', 'chart-geojson']:
            src_prefix = f'{SOURCE_DISTRICT}/{subdir}/{chart_id}/'
            dst_prefix = f'{TEST_DISTRICT}/{subdir}/{chart_id}/'

            blobs = list(bucket.list_blobs(prefix=src_prefix))
            for blob in blobs:
                rel = blob.name[len(src_prefix):]
                dst_name = f'{dst_prefix}{rel}'
                try:
                    bucket.copy_blob(blob, bucket, dst_name)
                    copied += 1
                except Exception as e:
                    logger.error(f'  Failed to copy {blob.name} -> {dst_name}: {e}')
                    errors += 1

        if (i + 1) % 20 == 0 or i + 1 == len(chart_ids):
            logger.info(f'  Progress: {i + 1}/{len(chart_ids)} charts, '
                        f'{copied} files copied, {errors} errors')

    # Create _manifest.json
    manifest = {'chartIds': chart_ids}
    manifest_blob = bucket.blob(f'{TEST_DISTRICT}/chart-geojson/_manifest.json')
    manifest_blob.upload_from_string(json.dumps(manifest, indent=2),
                                     content_type='application/json')
    logger.info(f'Created _manifest.json with {len(chart_ids)} chart IDs')

    logger.info(f'\n=== Copy Complete ===')
    logger.info(f'Charts: {len(chart_ids)}')
    logger.info(f'Files copied: {copied}')
    logger.info(f'Errors: {errors}')


def copy_tile_packs():
    """Copy basemaps/ocean/satellite/terrain from 17cgd to 017cgd-test.

    Uses gcloud storage cp for bulk copies (much faster than Python API for large dirs).
    """
    import subprocess

    packs = ['basemaps', 'ocean', 'satellite', 'terrain']

    for pack in packs:
        src = f'gs://{BUCKET_NAME}/{SOURCE_DISTRICT}/{pack}'
        dst = f'gs://{BUCKET_NAME}/{TEST_DISTRICT}/{pack}'
        logger.info(f'Copying {pack}: {src} -> {dst}')

        cmd = ['gcloud', 'storage', 'cp', '-r', src, dst]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            logger.error(f'  Failed: {proc.stderr[:500]}')
        else:
            logger.info(f'  Done: {pack}')


def create_firestore_doc():
    """Create the Firestore document for 017cgd-test."""
    charts_path = os.path.join(os.path.dirname(__file__), 'test_district_charts.json')
    if not os.path.exists(charts_path):
        logger.error(f'Run "discover" first — {charts_path} not found')
        sys.exit(1)

    with open(charts_path, 'r') as f:
        data = json.load(f)

    envelope = data.get('boundary_envelope') or data.get('us1_envelope')

    db = firestore.Client()
    doc_ref = db.collection('districts').document(TEST_DISTRICT)
    doc_ref.set({
        'conversionStatus': {'state': 'ready'},
        'regionBoundary': {
            'west': envelope['west'],
            'east': envelope['east'],
            'south': envelope['south'],
            'north': envelope['north'],
        },
        'chartData': {},  # Will be populated by compose job
    })

    logger.info(f'Created Firestore document: districts/{TEST_DISTRICT}')
    logger.info(f'  Region boundary: {envelope}')


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]

    if command == 'discover':
        discover_charts()
    elif command == 'copy':
        copy_charts()
    elif command == 'copy-tiles':
        copy_tile_packs()
    elif command == 'firestore':
        create_firestore_doc()
    elif command == 'all':
        logger.info('=== Running full setup ===')
        chart_ids, envelope = discover_charts()
        copy_charts()
        copy_tile_packs()
        create_firestore_doc()
        logger.info('\n=== Full setup complete ===')
        logger.info(f'Test district: {TEST_DISTRICT}')
        logger.info(f'Charts: {len(chart_ids)}')
        logger.info(f'\nTo run compose:')
        logger.info(f'  curl -X POST https://enc-converter-653355603694.us-central1.run.app/convert-district-parallel \\')
        logger.info(f'    -H "Content-Type: application/json" \\')
        logger.info(f'    -H "Authorization: Bearer $(gcloud auth print-identity-token)" \\')
        logger.info(f'    -d \'{{"districtId": "17", "districtLabel": "{TEST_DISTRICT}"}}\'')
    else:
        print(f'Unknown command: {command}')
        print('Valid commands: discover, copy, copy-tiles, firestore, all')
        sys.exit(1)


if __name__ == '__main__':
    main()
