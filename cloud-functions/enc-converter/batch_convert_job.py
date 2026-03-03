#!/usr/bin/env python3
"""
Cloud Run Job task for batch S-57 → GeoJSON conversion.

Each task in the job processes one batch from a shared manifest in Cloud Storage.
The manifest is a JSON array of batch objects, each with batchId and chartIds.
CLOUD_RUN_TASK_INDEX selects which batch this task handles.

Environment Variables:
    DISTRICT_ID:           District identifier (e.g., "05")
    DISTRICT_LABEL:        Storage path prefix (e.g., "05cgd", "17cgd-Juneau")
    BUCKET_NAME:           Firebase Storage bucket name
    BATCH_MANIFEST_PATH:   Storage path to the batch manifest JSON
    CLOUD_RUN_TASK_INDEX:  Index of this task within the job (set by Cloud Run)
"""

import os
import sys
import json
import time
import logging
import subprocess
import tempfile
import shutil
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed

from google.cloud import storage

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

# Number of parallel conversion workers (match vCPU count)
NUM_WORKERS = int(os.environ.get('NUM_WORKERS', '4'))


# ============================================================================
# S-57 conversion functions (duplicated from server.py to avoid Flask import)
# ============================================================================

def _node_convert_s57_to_geojson(s57_path: str, output_dir: str) -> tuple:
    """Convert S-57 to GeoJSON using the TypeScript S-57 parser.

    Calls the compiled Node.js script which reads the .000 binary directly
    (no GDAL dependency), producing GeoJSON with IHO standard OBJL codes,
    OBJL_NAME strings, M_COVR coverage polygons, and all post-processing.

    Returns:
        (geojson_path, has_safety_areas, sector_lights_path) tuple
    """
    result = subprocess.run(
        ['node', '/app/dist/convert_s57.js', s57_path, output_dir],
        capture_output=True, text=True, check=True,
        timeout=120,
    )
    data = json.loads(result.stdout.strip())
    return (data['geojson_path'], data['has_safety_areas'],
            data.get('sector_lights_path'))


def _convert_to_geojson(args: tuple) -> dict:
    """Convert a single chart to GeoJSON only (no tippecanoe). Subprocess worker.

    Args:
        args: (s57_path_str, output_dir_str)

    Returns:
        dict with chart_id, success, size_mb, error, duration, geojson_path
    """
    s57_path_str, output_dir_str = args
    chart_id = Path(s57_path_str).stem
    start = time.time()

    result = {
        'chart_id': chart_id,
        'scale': chart_id[:3] if len(chart_id) >= 3 else 'unknown',
        'success': False,
        'size_mb': 0,
        'error': None,
        'duration': 0,
    }

    try:
        geojson_path, _has_safety, sector_lights_path = _node_convert_s57_to_geojson(s57_path_str, output_dir_str)

        geojson_file = Path(geojson_path)
        if geojson_file.exists():
            result['success'] = True
            result['size_mb'] = geojson_file.stat().st_size / 1024 / 1024
            result['geojson_path'] = str(geojson_file)
            if sector_lights_path:
                result['sector_lights_path'] = sector_lights_path
        else:
            result['error'] = 'GeoJSON not created'
    except Exception as e:
        result['error'] = str(e)[:300]

    result['duration'] = time.time() - start
    return result


# ============================================================================
# Main entry point
# ============================================================================

def main():
    """Cloud Run Job task entry point for batch conversion."""
    start_time = time.time()

    # Read environment variables
    district_id = os.environ.get('DISTRICT_ID', '').zfill(2)
    district_label = os.environ.get('DISTRICT_LABEL') or f'{district_id}cgd'
    bucket_name = os.environ.get('BUCKET_NAME', 'xnautical-8a296.firebasestorage.app')
    manifest_path = os.environ.get('BATCH_MANIFEST_PATH', '')
    task_index = int(os.environ.get('CLOUD_RUN_TASK_INDEX', '0'))

    if not district_id or district_id == '00':
        logger.error('DISTRICT_ID environment variable not set')
        sys.exit(1)

    if not manifest_path:
        logger.error('BATCH_MANIFEST_PATH environment variable not set')
        sys.exit(1)

    logger.info(f'=== Batch convert task {task_index} for {district_label} ===')
    logger.info(f'Bucket: {bucket_name}, manifest: {manifest_path}')

    # Initialize storage client
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)

    # Download batch manifest
    logger.info('Downloading batch manifest...')
    manifest_blob = bucket.blob(manifest_path)
    manifest_json = manifest_blob.download_as_text()
    manifest = json.loads(manifest_json)

    # Select this task's batch
    if task_index >= len(manifest):
        logger.info(f'Task index {task_index} >= manifest length {len(manifest)}, no work for this task')
        sys.exit(0)

    batch = manifest[task_index]
    batch_id = batch['batchId']
    chart_ids = batch['chartIds']

    logger.info(f'Processing {batch_id}: {len(chart_ids)} charts')

    # Create temp working directory
    work_dir = tempfile.mkdtemp(prefix=f'enc_batch_{batch_id}_')
    source_dir = os.path.join(work_dir, 'source')
    output_dir = os.path.join(work_dir, 'output')
    os.makedirs(source_dir)
    os.makedirs(output_dir)

    try:
        # Download S-57 source files in parallel
        logger.info(f'Downloading {len(chart_ids)} charts from {district_label}/enc-source/...')
        download_start = time.time()
        prefix = f'{district_label}/enc-source/'

        chart_s57_files = {}

        def download_chart(chart_id):
            """Download all files for a single chart. Returns (chart_id, s57_path or None)."""
            chart_prefix = f'{prefix}{chart_id}/'
            blobs = list(bucket.list_blobs(prefix=chart_prefix))

            chart_dir = os.path.join(source_dir, chart_id)
            os.makedirs(chart_dir, exist_ok=True)

            s57_path = None
            for blob in blobs:
                filename = blob.name.split('/')[-1]
                local_path = os.path.join(chart_dir, filename)
                blob.download_to_filename(local_path)

                if filename.lower().endswith('.000'):
                    s57_path = local_path
            return (chart_id, s57_path)

        with ThreadPoolExecutor(max_workers=len(chart_ids)) as dl_pool:
            for chart_id, s57_path in dl_pool.map(download_chart, chart_ids):
                if s57_path:
                    chart_s57_files[chart_id] = s57_path

        download_duration = time.time() - download_start
        logger.info(f'Downloaded {len(chart_s57_files)} charts in {download_duration:.1f}s')

        if not chart_s57_files:
            logger.error(f'No S-57 source files found for {batch_id}')
            sys.exit(1)

        # Convert S-57 → GeoJSON
        logger.info(f'Converting {len(chart_s57_files)} charts to GeoJSON with {NUM_WORKERS} workers...')
        convert_start = time.time()

        work_items = []
        for chart_id, s57_path in chart_s57_files.items():
            chart_output = os.path.join(output_dir, chart_id)
            os.makedirs(chart_output, exist_ok=True)
            work_items.append((s57_path, chart_output))

        results = []
        with ProcessPoolExecutor(max_workers=NUM_WORKERS) as executor:
            futures = {executor.submit(_convert_to_geojson, item): item for item in work_items}
            for future in as_completed(futures):
                results.append(future.result())

        convert_duration = time.time() - convert_start
        successful = [r for r in results if r['success']]
        failed = [r for r in results if not r['success']]

        logger.info(f'Conversion complete: {len(successful)}/{len(results)} succeeded in {convert_duration:.1f}s')

        # Upload GeoJSON to persistent cache
        logger.info(f'Uploading {len(successful)} GeoJSON files...')
        upload_start = time.time()

        upload_details = []

        def _upload_chart_geojson(result):
            """Upload a single chart GeoJSON and sector-lights sidecar."""
            geojson_path = result.get('geojson_path')
            if not geojson_path:
                return None
            geojson_file = Path(geojson_path)
            if not geojson_file.exists():
                return None
            chart_id = result['chart_id']
            storage_path = f'{district_label}/chart-geojson/{chart_id}/{chart_id}.geojson'
            blob = bucket.blob(storage_path)
            blob.upload_from_filename(str(geojson_file), timeout=300)
            # Upload sector-lights sidecar if it exists
            sector_lights_path = result.get('sector_lights_path')
            if sector_lights_path:
                sl_file = Path(sector_lights_path)
                if sl_file.exists():
                    sl_storage_path = f'{district_label}/chart-geojson/{chart_id}/{chart_id}.sector-lights.json'
                    sl_blob = bucket.blob(sl_storage_path)
                    sl_blob.upload_from_filename(str(sl_file), timeout=120)
            return {
                'chartId': chart_id,
                'storagePath': storage_path,
                'sizeMB': result['size_mb'],
            }

        with ThreadPoolExecutor(max_workers=len(successful)) as upload_pool:
            for detail in upload_pool.map(_upload_chart_geojson, successful):
                if detail:
                    upload_details.append(detail)

        upload_duration = time.time() - upload_start
        logger.info(f'Upload complete in {upload_duration:.1f}s')

        # Write per-task result to Storage
        total_duration = time.time() - start_time
        task_result = {
            'status': 'success',
            'batchId': batch_id,
            'taskIndex': task_index,
            'district': district_label,
            'totalCharts': len(chart_ids),
            'successfulCharts': len(successful),
            'failedCharts': len(failed),
            'durationSeconds': round(total_duration, 1),
            'phases': {
                'downloadSeconds': round(download_duration, 1),
                'convertSeconds': round(convert_duration, 1),
                'uploadSeconds': round(upload_duration, 1),
            },
            'perChartResults': [
                {
                    'chartId': r['chart_id'],
                    'success': r['success'],
                    'sizeMB': round(r['size_mb'], 2),
                    'durationSeconds': round(r['duration'], 1),
                    'error': r.get('error'),
                }
                for r in results
            ],
            'completedAt': datetime.now(timezone.utc).isoformat(),
        }

        result_path = f'{district_label}/chart-geojson/_batch_results/{batch_id}.json'
        bucket.blob(result_path).upload_from_string(
            json.dumps(task_result, indent=2), content_type='application/json')

        logger.info(f'=== Task {task_index} ({batch_id}) complete: '
                    f'{len(successful)}/{len(results)} charts in {total_duration:.1f}s ===')

        if failed:
            for r in failed:
                logger.warning(f"  FAILED: {r['chart_id']} - {r.get('error', 'unknown')}")

        # Exit 0 on success (even with partial failures — results are recorded)
        sys.exit(0)

    except Exception as e:
        logger.error(f'Error in batch convert task {task_index}: {e}', exc_info=True)
        sys.exit(1)

    finally:
        # Clean up temp directory
        if os.path.exists(work_dir):
            logger.info(f'Cleaning up temp directory: {work_dir}')
            shutil.rmtree(work_dir, ignore_errors=True)
