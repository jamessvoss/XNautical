#!/usr/bin/env python3
"""
ENC Converter Cloud Run Service

Converts S-57 ENC source files (already in Firebase Storage) into MBTiles vector
tiles and merges them into per-scale packs using tile-join.

Endpoints:
  POST /convert                     - Convert all source files for a district (monolithic)
  POST /convert-batch               - Convert a batch of charts (5-10 charts)
  POST /convert-district-parallel   - Parallel conversion coordinator (recommended)
  GET  /status                      - Get current conversion status for a district
  GET  /                            - Health check

Parallel Architecture:
  The /convert-district-parallel endpoint splits district conversion into batches
  and processes them across 50-80 Cloud Run instances in parallel, reducing
  conversion time from 40+ minutes to 10-15 minutes.

This is the cloud adaptation of the proven local pipeline:
  - convert.py      (single-chart S-57 → MBTiles via ogr2ogr + tippecanoe)
  - convert_alaska.py (parallel conversion + tile-join merging into scale packs)
"""

import os
import sys
import time
import json
import shutil
import sqlite3
import logging
import subprocess
import tempfile
import zipfile
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed

from flask import Flask, request, jsonify
from google.cloud import storage, firestore

# Import tippecanoe conversion (S-57→GeoJSON now handled by TypeScript parser)
from convert import convert_geojson_to_mbtiles
# Import shared merge utilities
from merge_utils import compute_md5, check_for_skipped_tiles, merge_mbtiles as merge_mbtiles_batch

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# Valid USCG Coast Guard Districts
VALID_DISTRICTS = {'01', '05', '07', '08', '09', '11', '13', '14', '17'}

# Firebase Storage bucket
BUCKET_NAME = os.environ.get('STORAGE_BUCKET', 'xnautical-8a296.firebasestorage.app')

# Scale prefixes
SCALE_PREFIXES = ['US1', 'US2', 'US3', 'US4', 'US5', 'US6']

# Zoom ranges by scale (for manifest - display ranges)
SCALE_DISPLAY_ZOOMS = {
    'US1': {'minZoom': 0, 'maxZoom': 8, 'displayFrom': 0, 'displayTo': 9},
    'US2': {'minZoom': 0, 'maxZoom': 10, 'displayFrom': 8, 'displayTo': 11},
    'US3': {'minZoom': 4, 'maxZoom': 13, 'displayFrom': 10, 'displayTo': 13},
    'US4': {'minZoom': 6, 'maxZoom': 15, 'displayFrom': 12, 'displayTo': 15},
    'US5': {'minZoom': 8, 'maxZoom': 15, 'displayFrom': 14, 'displayTo': 15},
    'US6': {'minZoom': 6, 'maxZoom': 15, 'displayFrom': 14, 'displayTo': 15},
}

# Number of parallel conversion workers (match vCPU count)
NUM_WORKERS = int(os.environ.get('NUM_WORKERS', '4'))

# App-side filename prefixes per district (must match app's DISTRICT_PREFIXES)
DISTRICT_PREFIXES = {
    '01cgd': 'd01', '05cgd': 'd05', '07cgd': 'd07', '08cgd': 'd08',
    '09cgd': 'd09', '11cgd': 'd11', '13cgd': 'd13', '14cgd': 'd14',
    '17cgd': 'd17',
}

def get_district_prefix(district_label: str) -> str:
    """Get the app-side filename prefix for a district."""
    return DISTRICT_PREFIXES.get(district_label, district_label.replace('cgd', ''))


# ============================================================================
# Firestore progress tracking
# ============================================================================

def update_status(db, district_label: str, status: dict):
    """Write conversion status to Firestore for progress monitoring."""
    try:
        doc_ref = db.collection('districts').document(district_label)
        doc_ref.set({'conversionStatus': status}, merge=True)
    except Exception as e:
        logger.warning(f'Failed to update status in Firestore: {e}')


# ============================================================================
# Helper functions for parallel batch processing
# ============================================================================

def create_batches(chart_ids: list, batch_size: int = 10) -> list:
    """Split chart IDs into batches for parallel processing.
    
    Args:
        chart_ids: List of chart IDs to process
        batch_size: Number of charts per batch
        
    Returns:
        List of batch dictionaries with batchId and chartIds
    """
    batches = []
    for i in range(0, len(chart_ids), batch_size):
        batches.append({
            'batchId': f'batch_{i // batch_size + 1:03d}',
            'chartIds': chart_ids[i:i + batch_size]
        })
    return batches


def group_charts_by_scale(chart_ids: list) -> dict:
    """Group chart IDs by their scale prefix (US1, US2, etc.)."""
    charts_by_scale = defaultdict(list)
    for chart_id in chart_ids:
        scale = chart_id[:3] if len(chart_id) >= 3 else 'unknown'
        if scale in SCALE_PREFIXES:
            charts_by_scale[scale].append(chart_id)
    return dict(charts_by_scale)


def track_scale_completion(charts_by_scale: dict, completed_charts: set) -> dict:
    """Track which scales have all charts completed and are ready to merge."""
    scale_status = {}
    for scale in SCALE_PREFIXES:
        chart_ids = charts_by_scale.get(scale, [])
        if not chart_ids:
            continue
        completed = [c for c in chart_ids if c in completed_charts]
        scale_status[scale] = {
            'total': len(chart_ids),
            'complete': len(completed),
            'ready_to_merge': len(completed) == len(chart_ids)
        }
    return scale_status


# ============================================================================
# Manifest generation (ported from convert_alaska.py)
# ============================================================================

def generate_manifest(scale_results: dict, district_label: str) -> dict:
    """Generate manifest dict from scale pack results.

    Args:
        scale_results: {scale: {'path': Path or None, 'chartCount': int, 'sizeMB': float,
                        'bounds': dict or None, 'minZoom': int or None, 'maxZoom': int or None}}
        district_label: e.g. '11cgd'

    Bounds/zoom can come from either:
      - A local MBTiles file (monolithic path: info['path'] exists)
      - Pre-computed values (parallel path: info['bounds'], info['minZoom'], info['maxZoom'])

    Returns:
        manifest dict
    """
    packs = []

    for scale in SCALE_PREFIXES:
        info = scale_results.get(scale)
        if not info or info.get('error'):
            continue

        bounds = None
        min_zoom = None
        max_zoom = None

        # Try pre-computed bounds first (from Firestore / merge job)
        if info.get('bounds'):
            b = info['bounds']
            bounds = [b['west'], b['south'], b['east'], b['north']]
            min_zoom = info.get('minZoom')
            max_zoom = info.get('maxZoom')

        # Fall back to reading from local MBTiles file (monolithic path)
        if bounds is None:
            pack_path = info.get('path')
            if pack_path and hasattr(pack_path, 'exists') and pack_path.exists():
                try:
                    conn = sqlite3.connect(str(pack_path))
                    cursor = conn.cursor()
                    metadata = {}
                    cursor.execute("SELECT name, value FROM metadata")
                    for name, value in cursor.fetchall():
                        metadata[name] = value
                    conn.close()

                    bounds_str = metadata.get('bounds')
                    if bounds_str:
                        bounds = [float(x) for x in bounds_str.split(',')]
                    min_zoom = int(metadata.get('minzoom', SCALE_DISPLAY_ZOOMS[scale]['minZoom']))
                    max_zoom = int(metadata.get('maxzoom', SCALE_DISPLAY_ZOOMS[scale]['maxZoom']))
                except Exception as e:
                    logger.warning(f'Could not read metadata from {scale}: {e}')

        # Final defaults
        if bounds is None:
            bounds = [-180, -90, 180, 90]
        if min_zoom is None:
            min_zoom = SCALE_DISPLAY_ZOOMS[scale]['minZoom']
        if max_zoom is None:
            max_zoom = SCALE_DISPLAY_ZOOMS[scale]['maxZoom']

        packs.append({
            'id': f'{district_label}_{scale}',
            'filename': f'{scale}.mbtiles',
            'name': f'{district_label} {scale} Charts',
            'description': f'{scale} scale charts for {district_label}',
            'scale': scale,
            'bounds': {
                'west': bounds[0],
                'south': bounds[1],
                'east': bounds[2],
                'north': bounds[3],
            },
            'minZoom': min_zoom,
            'maxZoom': max_zoom,
            'fileSize': int(info['sizeMB'] * 1024 * 1024),
            'chartCount': info['chartCount'],
        })

    manifest = {
        'version': '2.0',
        'architecture': 'per-scale',
        'district': district_label,
        'description': f'Per-scale chart packs for {district_label}.',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'packs': packs,
        'scaleZoomMapping': SCALE_DISPLAY_ZOOMS,
    }

    return manifest


def _compute_region_boundary(packs: list) -> dict | None:
    """Compute the union bounding box across all manifest packs.

    Args:
        packs: List of manifest pack dicts, each with a 'bounds' dict
               containing west, south, east, north.

    Returns:
        Dict with west, south, east, north or None if no valid bounds.
    """
    west, south, east, north = 180, 90, -180, -90
    found = False
    for pack in packs:
        b = pack.get('bounds')
        if not b:
            continue
        # Skip default/fallback bounds
        if b.get('west') == -180 and b.get('east') == 180:
            continue
        found = True
        west = min(west, b['west'])
        south = min(south, b['south'])
        east = max(east, b['east'])
        north = max(north, b['north'])
    if not found:
        return None
    return {'west': west, 'south': south, 'east': east, 'north': north}


# ============================================================================
# TypeScript S-57 parser bridge
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


# ============================================================================
# Single-chart conversion wrapper (for ProcessPoolExecutor)
# ============================================================================

def _convert_one(args: tuple) -> dict:
    """Convert a single chart. Designed to run in a subprocess worker.

    Args:
        args: (s57_path_str, output_dir_str)

    Returns:
        dict with chart_id, success, size_mb, error, duration
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
        'us1_bounds': None,
    }

    try:
        # S-57 → GeoJSON via TypeScript parser
        geojson_path, has_safety, sector_lights_path = _node_convert_s57_to_geojson(s57_path_str, output_dir_str)
        if sector_lights_path:
            result['sector_lights_path'] = sector_lights_path
        # GeoJSON → MBTiles via tippecanoe
        output_path = os.path.join(output_dir_str, f'{chart_id}.mbtiles')
        convert_geojson_to_mbtiles(geojson_path, output_path, chart_id, has_safety_areas=has_safety)
        mbtiles = Path(output_path)
        if mbtiles.exists():
            result['success'] = True
            result['size_mb'] = mbtiles.stat().st_size / 1024 / 1024
            result['output_path'] = str(mbtiles)

            # Extract bounds inline for US1 charts (eliminates separate Phase 2.5)
            if chart_id.startswith('US1'):
                try:
                    conn = sqlite3.connect(str(mbtiles))
                    cursor = conn.cursor()
                    cursor.execute("SELECT value FROM metadata WHERE name='bounds'")
                    row = cursor.fetchone()
                    conn.close()
                    if row:
                        b = [float(x) for x in row[0].split(',')]
                        result['us1_bounds'] = {
                            'name': chart_id,
                            'west': b[0], 'south': b[1],
                            'east': b[2], 'north': b[3],
                        }
                except Exception:
                    pass
        else:
            result['error'] = 'MBTiles file not created'
    except Exception as e:
        result['error'] = str(e)[:300]

    result['duration'] = time.time() - start
    return result


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


def _merge_scale(scale: str, per_chart_dir: str, scale_pack_dir: str,
                 district_label: str) -> tuple:
    """Merge all per-chart MBTiles for one scale. Thread-safe.

    Args:
        scale: Scale prefix (e.g. 'US1')
        per_chart_dir: Directory containing per-chart subdirectories
        scale_pack_dir: Output directory for merged scale pack
        district_label: e.g. '07cgd'

    Returns:
        (scale, result_dict_or_None)
    """
    input_files = []
    per_chart_path = Path(per_chart_dir)
    for chart_dir in per_chart_path.iterdir():
        if chart_dir.is_dir() and chart_dir.name.startswith(scale):
            input_files.extend(chart_dir.glob('*.mbtiles'))

    if not input_files:
        logger.info(f'  {scale}: no charts found, skipping')
        return (scale, None)

    output_path = Path(scale_pack_dir) / f'{scale}.mbtiles'
    description = f'{scale} scale charts for {district_label}'

    logger.info(f'  {scale}: merging {len(input_files)} charts...')

    num_charts, size_mb, error = merge_mbtiles_batch(
        input_files, output_path, f'{district_label}_{scale}', description
    )

    if error:
        logger.error(f'  {scale}: FAILED - {error}')
        return (scale, {
            'path': None,
            'chartCount': num_charts,
            'sizeMB': 0,
            'error': error,
        })

    logger.info(f'  {scale}: {num_charts} charts, {size_mb:.1f} MB')
    return (scale, {
        'path': output_path,
        'chartCount': num_charts,
        'sizeMB': size_mb,
        'error': None,
    })


# ============================================================================
# Main conversion endpoint
# ============================================================================

@app.route('/convert', methods=['POST'])
def convert_district():
    """
    Convert all S-57 source files for a USCG Coast Guard District into
    per-scale MBTiles packs.

    Request body: { "districtId": "11" }

    Pipeline:
      1. Download S-57 source files from Firebase Storage
      2. Convert each chart to per-chart MBTiles (parallel)
      3. Merge per-chart MBTiles into scale packs using tile-join
      4. Upload scale packs + manifest to Firebase Storage
      5. Update Firestore metadata
    """
    data = request.get_json(silent=True) or {}
    district_id = str(data.get('districtId', '')).zfill(2)

    if district_id not in VALID_DISTRICTS:
        return jsonify({
            'error': f'Invalid district ID: {district_id}',
            'valid': sorted(VALID_DISTRICTS),
        }), 400

    district_label = f'{district_id}cgd'
    start_time = time.time()

    logger.info(f'=== Starting conversion for district {district_label} ===')

    # Initialize clients
    storage_client = storage.Client()
    bucket = storage_client.bucket(BUCKET_NAME)
    db = firestore.Client()

    # Create temp working directory
    work_dir = tempfile.mkdtemp(prefix=f'enc_convert_{district_id}_')
    source_dir = os.path.join(work_dir, 'source')
    per_chart_dir = os.path.join(work_dir, 'per_chart')
    scale_pack_dir = os.path.join(work_dir, 'scale_packs')
    os.makedirs(source_dir)
    os.makedirs(per_chart_dir)
    os.makedirs(scale_pack_dir)

    try:
        # ------------------------------------------------------------------
        # Phase 0: Update status
        # ------------------------------------------------------------------
        update_status(db, district_label, {
            'state': 'downloading',
            'startedAt': firestore.SERVER_TIMESTAMP,
            'message': 'Downloading source files from storage...',
        })

        # ------------------------------------------------------------------
        # Phase 1: Download source files from Firebase Storage
        # ------------------------------------------------------------------
        logger.info(f'Downloading source files from {district_label}/enc-source/...')
        download_start = time.time()

        prefix = f'{district_label}/enc-source/'
        blobs = list(bucket.list_blobs(prefix=prefix))

        # Group by chart ID and download
        chart_s57_files = {}  # chart_id -> path to .000 file
        download_count = 0

        for blob in blobs:
            # Path: 11cgd/enc-source/US4CA1CM/US4CA1CM.000
            rel_path = blob.name[len(prefix):]
            parts = rel_path.split('/')
            if len(parts) < 2:
                continue

            chart_id = parts[0]
            filename = parts[1]

            # Create chart directory
            chart_dir = os.path.join(source_dir, chart_id)
            os.makedirs(chart_dir, exist_ok=True)

            # Download file
            local_path = os.path.join(chart_dir, filename)
            blob.download_to_filename(local_path)
            download_count += 1

            # Track the .000 file for conversion
            if filename.lower().endswith('.000'):
                chart_s57_files[chart_id] = local_path

            if download_count % 100 == 0:
                logger.info(f'  Downloaded {download_count} files...')

        download_duration = time.time() - download_start
        logger.info(f'Downloaded {download_count} files ({len(chart_s57_files)} charts) '
                     f'in {download_duration:.1f}s')

        if not chart_s57_files:
            update_status(db, district_label, {
                'state': 'error',
                'message': 'No S-57 source files found in storage',
            })
            return jsonify({
                'status': 'error',
                'error': 'No S-57 source files found in storage',
                'district': district_label,
            }), 404

        # Count by scale
        scale_counts = defaultdict(int)
        for chart_id in chart_s57_files:
            scale = chart_id[:3] if len(chart_id) >= 3 else 'unknown'
            scale_counts[scale] += 1

        logger.info(f'Charts by scale: {dict(scale_counts)}')

        # ------------------------------------------------------------------
        # Phase 2: Convert each chart to per-chart MBTiles
        # ------------------------------------------------------------------
        update_status(db, district_label, {
            'state': 'converting',
            'message': f'Converting {len(chart_s57_files)} charts...',
            'totalCharts': len(chart_s57_files),
            'completedCharts': 0,
            'failedCharts': 0,
        })

        logger.info(f'Converting {len(chart_s57_files)} charts with {NUM_WORKERS} workers...')
        convert_start = time.time()

        # Prepare work items: (s57_path, output_dir)
        # Output goes to per_chart/{chart_id}/ to keep them organized
        work_items = []
        for chart_id, s57_path in sorted(chart_s57_files.items()):
            chart_output = os.path.join(per_chart_dir, chart_id)
            os.makedirs(chart_output, exist_ok=True)
            work_items.append((s57_path, chart_output))

        # Convert in parallel
        results = []
        completed = 0
        failed = 0

        with ProcessPoolExecutor(max_workers=NUM_WORKERS) as executor:
            futures = {executor.submit(_convert_one, item): item for item in work_items}

            for future in as_completed(futures):
                result = future.result()
                results.append(result)

                if result['success']:
                    completed += 1
                else:
                    failed += 1
                    logger.warning(f"  FAILED: {result['chart_id']}: {result['error']}")

                # Update progress every 10 charts
                if (completed + failed) % 10 == 0:
                    logger.info(f'  Progress: {completed + failed}/{len(work_items)} '
                                f'({completed} OK, {failed} failed)')
                    update_status(db, district_label, {
                        'state': 'converting',
                        'message': f'Converting charts... ({completed + failed}/{len(work_items)})',
                        'completedCharts': completed,
                        'failedCharts': failed,
                    })

        convert_duration = time.time() - convert_start
        total_size_mb = sum(r['size_mb'] for r in results if r['success'])

        logger.info(f'Conversion complete: {completed}/{len(work_items)} succeeded, '
                     f'{failed} failed, {total_size_mb:.1f} MB total, '
                     f'{convert_duration:.1f}s')

        # Collect US1 chart bounds from conversion results (extracted inline
        # during Phase 2 by _convert_one, no separate pass needed)
        us1_bounds = [r['us1_bounds'] for r in results if r.get('us1_bounds')]
        logger.info(f'Extracted bounds for {len(us1_bounds)} US1 charts')

        # Delete source files to free disk space
        logger.info('Freeing disk: removing source files...')
        shutil.rmtree(source_dir, ignore_errors=True)

        # ------------------------------------------------------------------
        # Phase 3: Merge into scale packs using tile-join
        # ------------------------------------------------------------------
        update_status(db, district_label, {
            'state': 'merging',
            'message': 'Merging charts into scale packs...',
        })

        logger.info('Merging per-chart MBTiles into scale packs (all scales in parallel)...')
        merge_start = time.time()

        scale_results = {}  # scale -> {path, chartCount, sizeMB, error}

        with ThreadPoolExecutor(max_workers=len(SCALE_PREFIXES)) as merge_pool:
            futures = {
                merge_pool.submit(
                    _merge_scale, scale, per_chart_dir, scale_pack_dir, district_label
                ): scale
                for scale in SCALE_PREFIXES
            }
            for future in as_completed(futures):
                scale = futures[future]
                try:
                    result_scale, result_info = future.result()
                    if result_info:
                        scale_results[result_scale] = result_info
                except Exception as e:
                    logger.error(f'  {scale}: merge thread failed - {e}')
                    scale_results[scale] = {
                        'path': None, 'chartCount': 0, 'sizeMB': 0,
                        'error': str(e)[:200],
                    }

        # Clean up all per-chart dirs after all merges complete
        shutil.rmtree(per_chart_dir, ignore_errors=True)

        merge_duration = time.time() - merge_start
        logger.info(f'Merge complete in {merge_duration:.1f}s')

        # ------------------------------------------------------------------
        # Phase 4: Generate manifest
        # ------------------------------------------------------------------
        manifest = generate_manifest(scale_results, district_label)
        manifest_path = Path(scale_pack_dir) / 'manifest.json'
        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=2)

        logger.info(f'Generated manifest with {len(manifest["packs"])} packs')

        # ------------------------------------------------------------------
        # Phase 5: Upload scale packs + manifest to Firebase Storage
        # ------------------------------------------------------------------
        update_status(db, district_label, {
            'state': 'uploading',
            'message': 'Uploading scale packs to storage...',
        })

        logger.info('Uploading scale packs to Firebase Storage...')
        upload_start = time.time()
        upload_sizes = {}

        for scale, info in scale_results.items():
            if info.get('error') or not info.get('path'):
                continue

            pack_path = info['path']
            storage_path = f'{district_label}/charts/{scale}.mbtiles'

            logger.info(f'  Uploading {scale}: {info["sizeMB"]:.1f} MB -> {storage_path}')
            blob = bucket.blob(storage_path)
            blob.upload_from_filename(str(pack_path), timeout=600)
            upload_sizes[scale] = info['sizeMB']

            # Zip and upload for app download (prefixed for multi-region support)
            district_prefix = get_district_prefix(district_label)
            zip_path = Path(scale_pack_dir) / f'{scale}.mbtiles.zip'
            with zipfile.ZipFile(str(zip_path), 'w', zipfile.ZIP_DEFLATED) as zf:
                zf.write(str(pack_path), f'{district_prefix}_{scale}.mbtiles')
            zip_storage_path = f'{district_label}/charts/{district_prefix}_{scale}.mbtiles.zip'
            zip_blob = bucket.blob(zip_storage_path)
            zip_blob.upload_from_filename(str(zip_path), timeout=600)
            zip_size = zip_path.stat().st_size / 1024 / 1024
            logger.info(f'  Uploaded zip: {info["sizeMB"]:.1f} → {zip_size:.1f} MB -> {zip_storage_path}')

        # Upload manifest
        manifest_storage_path = f'{district_label}/charts/manifest.json'
        blob = bucket.blob(manifest_storage_path)
        blob.upload_from_filename(str(manifest_path))
        logger.info(f'  Uploaded manifest -> {manifest_storage_path}')

        upload_duration = time.time() - upload_start
        logger.info(f'Upload complete in {upload_duration:.1f}s')

        # ------------------------------------------------------------------
        # Phase 6: Update Firestore metadata
        # ------------------------------------------------------------------
        total_duration = time.time() - start_time

        # Build scale summary for Firestore
        scale_summary = {}
        for scale, info in scale_results.items():
            scale_summary[scale] = {
                'chartCount': info['chartCount'],
                'sizeMB': round(info['sizeMB'], 1),
                'sizeBytes': int(info['sizeMB'] * 1024 * 1024),
                'storagePath': f'{district_label}/charts/{scale}.mbtiles',
                'error': info.get('error'),
            }

        # Compute region boundary from manifest packs (union of all scale bounds)
        region_boundary = _compute_region_boundary(manifest.get('packs', []))

        doc_ref = db.collection('districts').document(district_label)
        firestore_data = {
            'chartData': {
                'lastConverted': firestore.SERVER_TIMESTAMP,
                'totalCharts': completed,
                'failedCharts': failed,
                'totalSizeMB': round(sum(i['sizeMB'] for i in scale_results.values()), 1),
                'scales': scale_summary,
                'manifestPath': manifest_storage_path,
                'conversionDurationSeconds': round(total_duration, 1),
            },
            'conversionStatus': {
                'state': 'complete',
                'message': f'Conversion complete: {completed} charts, '
                           f'{sum(i["sizeMB"] for i in scale_results.values()):.1f} MB',
                'completedAt': firestore.SERVER_TIMESTAMP,
                'completedCharts': completed,
                'failedCharts': failed,
            },
            'us1ChartBounds': us1_bounds,
        }
        if region_boundary:
            firestore_data['regionBoundary'] = region_boundary
        doc_ref.set(firestore_data, merge=True)

        # Build response
        summary = {
            'status': 'success',
            'district': district_label,
            'totalCharts': completed,
            'failedCharts': failed,
            'totalSizeMB': round(sum(i['sizeMB'] for i in scale_results.values()), 1),
            'durationSeconds': round(total_duration, 1),
            'phases': {
                'downloadSeconds': round(download_duration, 1),
                'convertSeconds': round(convert_duration, 1),
                'mergeSeconds': round(merge_duration, 1),
                'uploadSeconds': round(upload_duration, 1),
            },
            'scales': {},
            'failedChartIds': [r['chart_id'] for r in results if not r['success']],
        }

        for scale, info in scale_results.items():
            summary['scales'][scale] = {
                'chartCount': info['chartCount'],
                'sizeMB': round(info['sizeMB'], 1),
                'error': info.get('error'),
            }

        logger.info(f'=== Conversion complete for {district_label}: '
                     f'{completed} charts, {summary["totalSizeMB"]} MB, '
                     f'{total_duration:.1f}s ===')

        return jsonify(summary), 200

    except Exception as e:
        logger.error(f'Error converting district {district_label}: {e}', exc_info=True)
        update_status(db, district_label, {
            'state': 'error',
            'message': str(e)[:500],
            'failedAt': firestore.SERVER_TIMESTAMP,
        })
        return jsonify({
            'status': 'error',
            'error': str(e),
            'district': district_label,
        }), 500

    finally:
        # Clean up temp directory
        if os.path.exists(work_dir):
            logger.info(f'Cleaning up temp directory: {work_dir}')
            shutil.rmtree(work_dir, ignore_errors=True)


# ============================================================================
# Status endpoint
# ============================================================================

@app.route('/status', methods=['GET'])
def get_status():
    """Get current conversion status for a district.

    Query params: ?districtId=11
    """
    district_id = str(request.args.get('districtId', '')).zfill(2)

    if district_id not in VALID_DISTRICTS:
        return jsonify({
            'error': f'Invalid district ID: {district_id}',
            'valid': sorted(VALID_DISTRICTS),
        }), 400

    district_label = f'{district_id}cgd'

    try:
        db = firestore.Client()
        doc = db.collection('districts').document(district_label).get()

        if not doc.exists:
            return jsonify({
                'district': district_label,
                'conversionStatus': None,
                'chartData': None,
            })

        data = doc.to_dict()
        return jsonify({
            'district': district_label,
            'conversionStatus': data.get('conversionStatus'),
            'chartData': data.get('chartData'),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# Batch conversion endpoint (for parallel processing)
# ============================================================================

@app.route('/convert-batch', methods=['POST'])
def convert_batch():
    """
    Convert a specific batch of charts for a district.
    
    Request body: {
        "districtId": "05",
        "chartIds": ["US5NC2OP", "US5NC2OE", ...],
        "batchId": "batch_001"
    }
    
    This endpoint is called by the parallel coordinator to process
    small batches of charts (typically 5-10) in separate containers.
    
    Outputs per-chart GeoJSON to: {districtId}/chart-geojson/{chartId}/
    """
    data = request.get_json(silent=True) or {}
    district_id = str(data.get('districtId', '')).zfill(2)
    chart_ids = data.get('chartIds', [])
    batch_id = data.get('batchId', 'batch_unknown')

    # Allow districtLabel override for testing
    district_label = data.get('districtLabel')
    if not district_label:
        if district_id not in VALID_DISTRICTS:
            return jsonify({
                'error': f'Invalid district ID: {district_id}',
                'valid': sorted(VALID_DISTRICTS),
            }), 400
        district_label = f'{district_id}cgd'

    if not chart_ids:
        return jsonify({'error': 'No chartIds provided'}), 400
    start_time = time.time()
    
    logger.info(f'=== Starting batch conversion: {batch_id} for {district_label} ===')
    logger.info(f'  Charts to convert: {len(chart_ids)}')
    
    # Initialize clients
    storage_client = storage.Client()
    bucket = storage_client.bucket(BUCKET_NAME)
    
    # Create temp working directory
    work_dir = tempfile.mkdtemp(prefix=f'enc_batch_{batch_id}_')
    source_dir = os.path.join(work_dir, 'source')
    output_dir = os.path.join(work_dir, 'output')
    os.makedirs(source_dir)
    os.makedirs(output_dir)
    
    try:
        # Download only the requested charts from Storage (in parallel)
        logger.info(f'Downloading {len(chart_ids)} charts from {district_label}/enc-source/...')
        download_start = time.time()

        chart_s57_files = {}  # chart_id -> path to .000 file
        prefix = f'{district_label}/enc-source/'

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
            return jsonify({
                'status': 'error',
                'error': 'No S-57 source files found',
                'batchId': batch_id,
            }), 404
        
        # Convert each chart to GeoJSON (skip tippecanoe — compose job runs it later)
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

        # Upload compressed GeoJSON to temp storage
        logger.info(f'Uploading {len(successful)} GeoJSON files to temp storage...')
        upload_start = time.time()

        upload_details = []

        def _upload_chart_geojson(result):
            """Upload a single chart GeoJSON and sector-lights sidecar to temp storage."""
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
        
        # Build response
        total_duration = time.time() - start_time
        response = {
            'status': 'success',
            'batchId': batch_id,
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
                    'storagePath': next((u['storagePath'] for u in upload_details if u['chartId'] == r['chart_id']), None)
                }
                for r in results
            ],
            'failedChartIds': [r['chart_id'] for r in failed],
        }
        
        logger.info(f'=== Batch {batch_id} complete: {len(successful)}/{len(results)} charts ===')
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f'Error in batch {batch_id}: {e}', exc_info=True)
        return jsonify({
            'status': 'error',
            'error': str(e),
            'batchId': batch_id,
            'district': district_label,
        }), 500
        
    finally:
        # Clean up temp directory
        if os.path.exists(work_dir):
            logger.info(f'Cleaning up batch temp directory: {work_dir}')
            shutil.rmtree(work_dir, ignore_errors=True)


# ============================================================================
# Parallel conversion coordinator endpoint
# ============================================================================

@app.route('/convert-district-parallel', methods=['POST'])
def convert_district_parallel():
    """
    Coordinate parallel batch conversion for a district.
    
    Request body: {
        "districtId": "05",
        "batchSize": 10,      # optional, default 10
        "maxParallel": 80      # optional, default 80
    }
    
    This endpoint orchestrates the parallel conversion pipeline:
    1. Discover all charts in {districtId}/enc-source/
    2. Split into batches
    3. Fire parallel /convert-batch requests
    4. Track progress and start merging scales as they complete
    5. Generate comprehensive validation report
    """
    data = request.get_json(silent=True) or {}
    district_id = str(data.get('districtId', '')).zfill(2)
    batch_size = int(data.get('batchSize', 10))
    max_parallel = int(data.get('maxParallel', 80))

    # Allow districtLabel override for testing (e.g. "017cgd_test")
    district_label = data.get('districtLabel')
    if district_label:
        logger.info(f'Using custom districtLabel: {district_label}')
    else:
        if district_id not in VALID_DISTRICTS:
            return jsonify({
                'error': f'Invalid district ID: {district_id}',
                'valid': sorted(VALID_DISTRICTS),
            }), 400
        district_label = f'{district_id}cgd'
    start_time = time.time()
    
    logger.info(f'=== Starting PARALLEL conversion for {district_label} ===')
    logger.info(f'  Batch size: {batch_size}, Max parallel: {max_parallel}')
    
    # Initialize clients
    storage_client = storage.Client()
    bucket = storage_client.bucket(BUCKET_NAME)
    db = firestore.Client()
    
    # Create temp working directory for merge phase
    work_dir = tempfile.mkdtemp(prefix=f'enc_parallel_{district_id}_')
    per_chart_dir = os.path.join(work_dir, 'per_chart')
    scale_pack_dir = os.path.join(work_dir, 'scale_packs')
    os.makedirs(per_chart_dir)
    os.makedirs(scale_pack_dir)
    
    try:
        # Phase 1: Discovery - List all charts
        logger.info('Phase 1: Discovering charts...')
        update_status(db, district_label, {
            'state': 'discovering',
            'startedAt': firestore.SERVER_TIMESTAMP,
            'message': 'Discovering charts...',
        })
        
        discovery_start = time.time()
        prefix = f'{district_label}/enc-source/'
        blobs = list(bucket.list_blobs(prefix=prefix))
        
        # Group by chart ID
        chart_ids = set()
        source_file_count = 0
        for blob in blobs:
            rel_path = blob.name[len(prefix):]
            parts = rel_path.split('/')
            if len(parts) >= 2:
                chart_id = parts[0]
                if blob.name.lower().endswith('.000'):
                    chart_ids.add(chart_id)
                source_file_count += 1
        
        chart_ids = sorted(list(chart_ids))
        charts_by_scale = group_charts_by_scale(chart_ids)
        discovery_duration = time.time() - discovery_start
        
        logger.info(f'  Found {len(chart_ids)} charts ({source_file_count} files) in {discovery_duration:.1f}s')
        logger.info(f'  Charts by scale: {dict((k, len(v)) for k, v in charts_by_scale.items())}')

        if not chart_ids:
            return jsonify({
                'status': 'error',
                'error': 'No charts found in source',
                'district': district_label,
            }), 404

        # Check GeoJSON cache
        cache_prefix = f'{district_label}/chart-geojson/'
        cached_chart_ids = set()
        for blob in bucket.list_blobs(prefix=cache_prefix):
            if blob.name.endswith('.geojson'):
                parts = blob.name[len(cache_prefix):].split('/')
                if len(parts) >= 2:
                    cached_chart_ids.add(parts[0])

        charts_to_convert = sorted(set(chart_ids) - cached_chart_ids)
        charts_already_cached = sorted(set(chart_ids) & cached_chart_ids)
        logger.info(f'  {len(charts_already_cached)} cached, {len(charts_to_convert)} need conversion')

        # Phase 2: Create batches and fire parallel conversions (uncached only)
        if not charts_to_convert:
            logger.info('Phase 2: All charts cached, skipping conversion')
            completed_charts = set(chart_ids)
            batches = []
            batch_results = []
            conversion_duration = 0
            successful_batches = 0
        else:
            batches = create_batches(charts_to_convert, batch_size)
            logger.info(f'Phase 2: Converting {len(charts_to_convert)} charts in {len(batches)} batches '
                        f'({len(charts_already_cached)} cached, skipped)')

        if charts_to_convert:
            update_status(db, district_label, {
                'state': 'converting',
                'message': f'Converting {len(charts_to_convert)} charts in {len(batches)} batches '
                           f'({len(charts_already_cached)} cached)...',
                'totalCharts': len(chart_ids),
                'totalBatches': len(batches),
                'completedBatches': 0,
            })

            conversion_start = time.time()

            # Get service URL
            service_url = os.environ.get('SERVICE_URL', 'https://enc-converter-653355603694.us-central1.run.app')
            logger.info(f'  Using service URL: {service_url}')

            # Fire parallel batch conversions using ThreadPoolExecutor
            batch_results = []
            completed_charts = set()
            scales_merged = set()
            merge_results = {}

            MAX_RETRIES = 8
            RETRY_BASE_DELAY = 5  # seconds
            INITIAL_CONCURRENCY = 20  # ramp up gradually to avoid 429 thundering herd
            import random

            def execute_batch_sync(batch, url):
                """Execute a single batch with retry logic for 429 rate limits."""
                import requests as req_lib
                import google.auth
                import google.auth.transport.requests
                from google.oauth2 import id_token

                payload = {
                    'districtId': district_id,
                    'districtLabel': district_label,
                    'chartIds': batch['chartIds'],
                    'batchId': batch['batchId']
                }

                for attempt in range(MAX_RETRIES + 1):
                    try:
                        # Get fresh ID token each attempt (tokens expire)
                        auth_req = google.auth.transport.requests.Request()
                        token = id_token.fetch_id_token(auth_req, url)

                        headers = {
                            'Authorization': f'Bearer {token}',
                            'Content-Type': 'application/json'
                        }

                        response = req_lib.post(
                            f'{url}/convert-batch',
                            json=payload,
                            headers=headers,
                            timeout=600
                        )

                        logger.info(f"  Batch {batch['batchId']}: HTTP {response.status_code} (attempt {attempt + 1})")

                        # Handle retryable status codes (429 rate limit, 500/503 scaling errors)
                        if response.status_code in (429, 500, 502, 503):
                            if attempt < MAX_RETRIES:
                                delay = RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 3)
                                logger.warning(f"  Batch {batch['batchId']}: HTTP {response.status_code}, retrying in {delay:.0f}s (attempt {attempt + 1}/{MAX_RETRIES})")
                                time.sleep(delay)
                                continue
                            else:
                                logger.error(f"  Batch {batch['batchId']}: HTTP {response.status_code}, all {MAX_RETRIES} retries exhausted")
                                return {
                                    'status': 'error',
                                    'error': f'HTTP {response.status_code} after all retries',
                                    'batchId': batch['batchId']
                                }

                        response.raise_for_status()
                        return response.json()

                    except req_lib.exceptions.RequestException as e:
                        response_text = getattr(e.response, 'text', str(e)) if hasattr(e, 'response') else str(e)
                        status_code = getattr(e.response, 'status_code', None) if hasattr(e, 'response') else None

                        # Retry on 429, 500, 502, 503 (scaling/rate limit errors)
                        if status_code in (429, 500, 502, 503) and attempt < MAX_RETRIES:
                            delay = RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 3)
                            logger.warning(f"  Batch {batch['batchId']}: HTTP {status_code}, retrying in {delay:.0f}s (attempt {attempt + 1}/{MAX_RETRIES})")
                            time.sleep(delay)
                            continue

                        logger.error(f"  Batch {batch['batchId']} HTTP error (attempt {attempt + 1}): {response_text[:200]}")
                        return {
                            'status': 'error',
                            'error': f'HTTP error: {response_text[:500]}',
                            'batchId': batch['batchId']
                        }
                    except Exception as e:
                        logger.error(f"  Batch {batch['batchId']} error (attempt {attempt + 1}): {e}")
                        if attempt < MAX_RETRIES:
                            delay = RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 3)
                            time.sleep(delay)
                            continue
                        return {
                            'status': 'error',
                            'error': str(e),
                            'batchId': batch['batchId']
                        }

                return {'status': 'error', 'error': 'Unexpected retry loop exit', 'batchId': batch['batchId']}

            # Launch batches with controlled concurrency to avoid overwhelming Cloud Run
            # INITIAL_CONCURRENCY limits in-flight requests so Cloud Run can scale up
            # gradually instead of 429-ing a wall of simultaneous requests.
            effective_concurrency = min(INITIAL_CONCURRENCY, max_parallel, len(batches))
            logger.info(f'  Launching {len(batches)} batches ({effective_concurrency} concurrent, {MAX_RETRIES} retries with jittered exponential backoff)...')
            with ThreadPoolExecutor(max_workers=effective_concurrency) as executor:
                futures = {executor.submit(execute_batch_sync, batch, service_url): batch for batch in batches}

                for future in as_completed(futures):
                    result = future.result()
                    batch_results.append(result)

                    # Track completed charts
                    if result.get('status') == 'success':
                        for chart_result in result.get('perChartResults', []):
                            if chart_result.get('success'):
                                completed_charts.add(chart_result['chartId'])

                    # Update progress
                    logger.info(f"  Batch {result.get('batchId')} complete: "
                               f"{result.get('successfulCharts', 0)}/{result.get('totalCharts', 0)} charts "
                               f"[{len(batch_results)}/{len(batches)} batches done, {len(completed_charts)} charts total]")

                    update_status(db, district_label, {
                        'completedBatches': len(batch_results),
                        'completedCharts': len(completed_charts),
                    })

            conversion_duration = time.time() - conversion_start
            successful_batches = sum(1 for r in batch_results if r.get('status') == 'success')

            logger.info(f'Batch conversion complete: {successful_batches}/{len(batches)} batches, '
                       f'{len(completed_charts)}/{len(charts_to_convert)} charts in {conversion_duration:.1f}s')

        # Add cached charts to completed set
        completed_charts.update(charts_already_cached)
        logger.info(f'Total charts for compose: {len(completed_charts)} '
                   f'({len(completed_charts) - len(charts_already_cached)} converted + {len(charts_already_cached)} cached)')

        # Write chart manifest for compose job (prevents stale cache inclusion)
        manifest = {'chartIds': sorted(list(completed_charts))}
        bucket.blob(f'{district_label}/chart-geojson/_manifest.json').upload_from_string(
            json.dumps(manifest), content_type='application/json')
        logger.info(f'  Wrote _manifest.json with {len(completed_charts)} chart IDs')

        # Phase 3: Launch compose job (unified deduplication + tippecanoe)
        logger.info('Phase 3: Launching compose job for unified MBTiles...')
        update_status(db, district_label, {
            'state': 'composing',
            'message': 'Deduplicating features and building unified MBTiles...',
        })

        compose_start = time.time()
        all_charts_complete = len(completed_charts) == len(chart_ids)
        compose_result = {}

        if not all_charts_complete:
            logger.warning(f'  *** INCOMPLETE: {len(completed_charts)}/{len(chart_ids)} charts. '
                          f'Compose will proceed with available charts. ***')

        # Launch ONE Cloud Run Job for compose
        from google.cloud import run_v2
        from google.protobuf import duration_pb2

        jobs_client = run_v2.JobsClient()
        executions_client = run_v2.ExecutionsClient()

        job_name = 'enc-converter-merge'
        project_id = os.environ.get('GCP_PROJECT', 'xnautical-8a296')
        gcp_region = 'us-central1'
        job_path = f'projects/{project_id}/locations/{gcp_region}/jobs/{job_name}'

        logger.info(f'  Launching compose job with 32Gi memory, 8 vCPU')

        try:
            timeout_duration = duration_pb2.Duration()
            timeout_duration.seconds = 7200  # 2 hours for large districts

            run_request = run_v2.RunJobRequest(
                name=job_path,
                overrides=run_v2.RunJobRequest.Overrides(
                    container_overrides=[
                        run_v2.RunJobRequest.Overrides.ContainerOverride(
                            env=[
                                run_v2.EnvVar(name='DISTRICT_ID', value=district_id),
                                run_v2.EnvVar(name='DISTRICT_LABEL', value=district_label),
                                run_v2.EnvVar(name='BUCKET_NAME', value=BUCKET_NAME),
                                run_v2.EnvVar(name='JOB_TYPE', value='compose'),
                                run_v2.EnvVar(name='METADATA_GENERATOR_URL',
                                              value=os.environ.get('METADATA_GENERATOR_URL', '')),
                            ],
                        )
                    ],
                    task_count=1,
                    timeout=timeout_duration,
                ),
            )

            operation = jobs_client.run_job(request=run_request)
            logger.info(f'  Compose job launch initiated')
        except Exception as e:
            logger.error(f'  Compose job failed to start: {e}')
            compose_result = {'error': f'Job launch failed: {str(e)[:200]}'}

        # Poll Firestore for compose completion
        poll_interval = 10  # seconds
        max_wait = 3500  # just under Cloud Run service 3600s max timeout
        elapsed = 0
        launch_time = time.time()
        compose_done = bool(compose_result.get('error'))

        logger.info(f'  Polling Firestore for compose completion...')

        while not compose_done and elapsed < max_wait:
            time.sleep(poll_interval)
            elapsed += poll_interval

            try:
                doc_ref = db.collection('districts').document(district_label)
                doc_snap = doc_ref.get()

                if doc_snap.exists:
                    chart_data = doc_snap.to_dict().get('chartData', {})
                    composed_at = chart_data.get('composedAt')

                    if composed_at:
                        try:
                            composed_epoch = composed_at.timestamp() if hasattr(composed_at, 'timestamp') else composed_at
                        except Exception:
                            composed_epoch = 0

                        if composed_epoch >= launch_time - 30:
                            compose_result = {
                                'totalCharts': chart_data.get('totalCharts', 0),
                                'sizeMB': chart_data.get('totalSizeMB', 0),
                                'storagePath': chart_data.get('unifiedStoragePath'),
                                'bounds': chart_data.get('bounds'),
                                'dedupStats': chart_data.get('dedupStats'),
                                'error': None,
                            }
                            compose_duration_s = composed_epoch - launch_time
                            logger.info(f'  Compose complete - '
                                       f'{compose_result.get("totalCharts")} charts, '
                                       f'{compose_result.get("sizeMB", 0):.1f} MB in {compose_duration_s:.0f}s')
                            compose_done = True
            except Exception as e:
                logger.warning(f'  Error polling Firestore: {e}')

            if not compose_done and elapsed % 60 < poll_interval:
                # Check if job execution terminally failed
                try:
                    list_request = run_v2.ListExecutionsRequest(parent=job_path)
                    executions_list = list(executions_client.list_executions(request=list_request))

                    compose_executions = []
                    for execution in executions_list:
                        try:
                            for container in (execution.template.containers or []):
                                for env_var in (container.env or []):
                                    if env_var.name == 'JOB_TYPE' and env_var.value == 'compose':
                                        compose_executions.append(execution)
                        except Exception:
                            pass

                    if compose_executions:
                        all_done = all(e.completion_time for e in compose_executions)
                        any_succeeded = any(e.succeeded_count and e.succeeded_count > 0 for e in compose_executions)
                        if all_done and not any_succeeded:
                            compose_result = {'error': f'All {len(compose_executions)} compose execution(s) failed'}
                            logger.error(f'  Compose: {compose_result["error"]}')
                            compose_done = True
                except Exception as e:
                    logger.warning(f'  Error checking execution status: {e}')

            if not compose_done and elapsed % 30 < poll_interval:
                logger.info(f'  Still waiting on compose job ({elapsed}s elapsed)')

        if not compose_done:
            compose_result = {'error': f'Compose job timeout after {max_wait}s'}
            logger.error(f'  Compose job timed out after {max_wait}s')

        compose_duration = time.time() - compose_start
        logger.info(f'Compose phase complete in {compose_duration:.1f}s')

        # Phase 4: Generate report
        total_duration = time.time() - start_time
        output_size_mb = compose_result.get('sizeMB', 0)

        report = {
            'district': district_label,
            'status': 'success' if not compose_result.get('error') else 'error',
            'architecture': 'unified',
            'startTime': datetime.fromtimestamp(start_time, timezone.utc).isoformat(),
            'endTime': datetime.fromtimestamp(time.time(), timezone.utc).isoformat(),
            'durationSeconds': round(total_duration, 1),

            'phases': {
                'discovery': {
                    'durationSeconds': round(discovery_duration, 1),
                    'chartsFound': len(chart_ids),
                    'sourceFilesFound': source_file_count,
                    'chartsByScale': dict((k, len(v)) for k, v in charts_by_scale.items()),
                },
                'batchConversion': {
                    'durationSeconds': round(conversion_duration, 1),
                    'totalBatches': len(batches),
                    'successfulBatches': successful_batches,
                    'failedBatches': len(batches) - successful_batches,
                    'chartsCached': len(charts_already_cached),
                    'chartsConverted': len(charts_to_convert),
                    'batchDetails': batch_results,
                },
                'compose': {
                    'durationSeconds': round(compose_duration, 1),
                    'outputSizeMB': output_size_mb,
                    'dedupStats': compose_result.get('dedupStats'),
                    'error': compose_result.get('error'),
                },
            },

            'validation': {
                'allChartsProcessed': len(completed_charts) == len(chart_ids),
                'chartVerification': {
                    'expected': len(chart_ids),
                    'successful': len(completed_charts),
                    'failed': len(chart_ids) - len(completed_charts),
                    'missingCharts': sorted(list(set(chart_ids) - completed_charts)),
                },
            },

            'summary': {
                'totalCharts': len(chart_ids),
                'successfulCharts': len(completed_charts),
                'failedCharts': len(chart_ids) - len(completed_charts),
                'totalOutputSizeMB': round(output_size_mb, 1),
                'parallelSpeedup': f'{(len(chart_ids) * 2.5 / 60) / max(total_duration / 60, 0.01):.1f}x',
            },

            'errors': [compose_result['error']] if compose_result.get('error') else [],
            'warnings': [],
        }

        # Upload report to Storage
        report_path = f'{district_label}/charts/conversion-report.json'
        blob = bucket.blob(report_path)
        blob.upload_from_string(json.dumps(report, indent=2), content_type='application/json')

        # Update Firestore with final results (compose job writes its own chartData;
        # we add the conversion report and status here)
        doc_ref = db.collection('districts').document(district_label)
        firestore_data = {
            'conversionStatus': {
                'state': 'complete' if not compose_result.get('error') else 'error',
                'message': f'Unified conversion complete: {len(completed_charts)} charts, {output_size_mb:.1f} MB'
                           if not compose_result.get('error') else compose_result['error'],
                'completedAt': firestore.SERVER_TIMESTAMP,
            },
            'conversionReport': report,
        }
        doc_ref.set(firestore_data, merge=True)

        # NOTE: Do NOT clean up temp storage here — the compose job handles its own
        # cleanup after tile-join. If the orchestrator times out before the compose
        # job finishes, cleaning temp would delete .mbtiles files that workers
        # uploaded and that the compose job still needs to download.

        logger.info(f'=== PARALLEL conversion complete for {district_label}: '
                   f'{len(completed_charts)} charts, {output_size_mb:.1f} MB, '
                   f'{total_duration:.1f}s ===')
        
        return jsonify(report), 200
        
    except Exception as e:
        logger.error(f'Error in parallel conversion for {district_label}: {e}', exc_info=True)
        update_status(db, district_label, {
            'state': 'error',
            'message': str(e)[:500],
            'failedAt': firestore.SERVER_TIMESTAMP,
        })
        return jsonify({
            'status': 'error',
            'error': str(e),
            'district': district_label,
        }), 500
        
    finally:
        # Clean up temp directory
        if os.path.exists(work_dir):
            logger.info(f'Cleaning up temp directory: {work_dir}')
            shutil.rmtree(work_dir, ignore_errors=True)


# ============================================================================
# Health check
# ============================================================================

@app.route('/', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'service': 'enc-converter',
        'status': 'healthy',
        'validDistricts': sorted(VALID_DISTRICTS),
        'workers': NUM_WORKERS,
        'endpoints': ['/convert', '/convert-batch', '/convert-district-parallel', '/status'],
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
