#!/usr/bin/env python3
"""
ENC Converter Cloud Run Service

Converts S-57 ENC source files (already in Firebase Storage) into MBTiles vector
tiles and merges them into per-scale packs using tile-join.

Endpoints:
  POST /convert     - Convert all source files for a USCG Coast Guard District
  GET  /status      - Get current conversion status for a district
  GET  /             - Health check

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
import tempfile
import subprocess
import threading
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed

from flask import Flask, request, jsonify
from google.cloud import storage, firestore

# Import the proven single-chart converter
from convert import convert_chart

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
    'US4': {'minZoom': 6, 'maxZoom': 16, 'displayFrom': 12, 'displayTo': 15},
    'US5': {'minZoom': 8, 'maxZoom': 18, 'displayFrom': 14, 'displayTo': 17},
    'US6': {'minZoom': 6, 'maxZoom': 18, 'displayFrom': 16, 'displayTo': 22},
}

# Number of parallel conversion workers (match vCPU count)
NUM_WORKERS = int(os.environ.get('NUM_WORKERS', '4'))


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
# tile-join merge logic (ported from convert_alaska.py)
# ============================================================================

def check_for_skipped_tiles(stderr: str, context: str = "") -> None:
    """Check tile-join output for skipped tiles and FAIL LOUDLY if any are found.

    This is a safety-critical check. If tile-join drops any tiles, it means
    navigation features are missing from the output, which is unacceptable.
    """
    skipped_lines = [line for line in stderr.split('\n') if 'Skipping this tile' in line]
    if skipped_lines:
        logger.error(f"tile-join DROPPED {len(skipped_lines)} TILES! Context: {context}")
        for line in skipped_lines[:10]:
            logger.error(f"  {line.strip()}")
        raise RuntimeError(
            f"tile-join dropped {len(skipped_lines)} tiles in {context}! "
            f"The --no-tile-size-limit flag should be set."
        )


def merge_mbtiles_batch(input_files: list, output_path: Path, name: str,
                        description: str) -> tuple:
    """Merge a batch of MBTiles files using tile-join.

    For batches >100 files, uses chunked merging (groups of 100, then
    a final merge of the chunks).

    Returns: (num_input_files, size_mb, error_string_or_None)
    """
    if not input_files:
        return (0, 0, 'No input files')

    # Small batch: merge directly
    if len(input_files) <= 100:
        logger.info(f'  Merging {len(input_files)} files into {name}...')
        cmd = [
            'tile-join',
            '-o', str(output_path),
            '--force',
            '--no-tile-size-limit',
            '-n', name,
            '-N', description,
        ] + [str(f) for f in sorted(input_files)]

        result = subprocess.run(cmd, capture_output=True, text=True)
        check_for_skipped_tiles(result.stderr, f"merge {name}")

        if result.returncode != 0:
            return (len(input_files), 0, result.stderr[:200])
        elif output_path.exists():
            size_mb = output_path.stat().st_size / 1024 / 1024
            return (len(input_files), size_mb, None)
        else:
            return (len(input_files), 0, 'File not created')

    # Large batch: chunk into groups of 100, merge each, then merge results
    temp_dir = output_path.parent / 'temp_merge'
    temp_dir.mkdir(parents=True, exist_ok=True)

    chunk_size = 100
    temp_files = []
    sorted_files = sorted(input_files)
    total_chunks = (len(sorted_files) + chunk_size - 1) // chunk_size

    for i in range(0, len(sorted_files), chunk_size):
        chunk = sorted_files[i:i + chunk_size]
        chunk_num = i // chunk_size
        temp_output = temp_dir / f'{name}_chunk_{chunk_num}.mbtiles'

        logger.info(f'  Batch {chunk_num + 1}/{total_chunks} ({len(chunk)} files)...')

        cmd = [
            'tile-join',
            '-o', str(temp_output),
            '--force',
            '--no-tile-size-limit',
        ] + [str(f) for f in chunk]

        result = subprocess.run(cmd, capture_output=True, text=True)
        check_for_skipped_tiles(result.stderr, f"chunk {chunk_num} of {name}")

        if result.returncode != 0:
            for tf in temp_files:
                tf.unlink(missing_ok=True)
            return (len(input_files), 0, f'Chunk {chunk_num} failed: {result.stderr[:100]}')

        temp_files.append(temp_output)

    # Final merge of all chunks
    logger.info(f'  Final merge ({len(temp_files)} batches)...')

    cmd = [
        'tile-join',
        '-o', str(output_path),
        '--force',
        '--no-tile-size-limit',
        '-n', name,
        '-N', description,
    ] + [str(f) for f in temp_files]

    result = subprocess.run(cmd, capture_output=True, text=True)
    check_for_skipped_tiles(result.stderr, f"final merge for {name}")

    # Clean up temp files
    for tf in temp_files:
        tf.unlink(missing_ok=True)
    try:
        temp_dir.rmdir()
    except Exception:
        pass

    if result.returncode != 0:
        return (len(input_files), 0, result.stderr[:200])
    elif output_path.exists():
        size_mb = output_path.stat().st_size / 1024 / 1024
        return (len(input_files), size_mb, None)
    else:
        return (len(input_files), 0, 'File not created')


# ============================================================================
# Manifest generation (ported from convert_alaska.py)
# ============================================================================

def generate_manifest(scale_results: dict, district_label: str) -> dict:
    """Generate manifest dict from scale pack results.

    Args:
        scale_results: {scale: {'path': Path, 'chartCount': int, 'sizeMB': float}}
        district_label: e.g. '11cgd'

    Returns:
        manifest dict
    """
    packs = []

    for scale in SCALE_PREFIXES:
        info = scale_results.get(scale)
        if not info or info.get('error'):
            continue

        pack_path = info['path']
        if not pack_path or not pack_path.exists():
            continue

        # Read bounds and zoom from mbtiles metadata
        try:
            conn = sqlite3.connect(str(pack_path))
            cursor = conn.cursor()
            metadata = {}
            cursor.execute("SELECT name, value FROM metadata")
            for name, value in cursor.fetchall():
                metadata[name] = value
            conn.close()

            bounds_str = metadata.get('bounds', '-180,-90,180,90')
            bounds = [float(x) for x in bounds_str.split(',')]
            min_zoom = int(metadata.get('minzoom', SCALE_DISPLAY_ZOOMS[scale]['minZoom']))
            max_zoom = int(metadata.get('maxzoom', SCALE_DISPLAY_ZOOMS[scale]['maxZoom']))
        except Exception as e:
            logger.warning(f'Could not read metadata from {scale}: {e}')
            bounds = [-180, -90, 180, 90]
            min_zoom = SCALE_DISPLAY_ZOOMS[scale]['minZoom']
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
    }

    try:
        output_path = convert_chart(s57_path_str, output_dir_str)
        mbtiles = Path(output_path)
        if mbtiles.exists():
            result['success'] = True
            result['size_mb'] = mbtiles.stat().st_size / 1024 / 1024
            result['output_path'] = str(mbtiles)
        else:
            result['error'] = 'MBTiles file not created'
    except Exception as e:
        result['error'] = str(e)[:300]

    result['duration'] = time.time() - start
    return result


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

        logger.info('Merging per-chart MBTiles into scale packs...')
        merge_start = time.time()

        scale_results = {}  # scale -> {path, chartCount, sizeMB, error}

        for scale in SCALE_PREFIXES:
            # Find all per-chart MBTiles for this scale
            input_files = []
            per_chart_path = Path(per_chart_dir)
            for chart_dir in per_chart_path.iterdir():
                if chart_dir.is_dir() and chart_dir.name.startswith(scale):
                    mbtiles_files = list(chart_dir.glob('*.mbtiles'))
                    input_files.extend(mbtiles_files)

            if not input_files:
                logger.info(f'  {scale}: no charts found, skipping')
                continue

            output_path = Path(scale_pack_dir) / f'{scale}.mbtiles'
            description = f'{scale} scale charts for {district_label}'

            logger.info(f'  {scale}: merging {len(input_files)} charts...')

            num_charts, size_mb, error = merge_mbtiles_batch(
                input_files, output_path, f'{district_label}_{scale}', description
            )

            if error:
                logger.error(f'  {scale}: FAILED - {error}')
                scale_results[scale] = {
                    'path': None,
                    'chartCount': num_charts,
                    'sizeMB': 0,
                    'error': error,
                }
            else:
                logger.info(f'  {scale}: {num_charts} charts, {size_mb:.1f} MB')
                scale_results[scale] = {
                    'path': output_path,
                    'chartCount': num_charts,
                    'sizeMB': size_mb,
                    'error': None,
                }

            # Delete per-chart MBTiles for this scale to free disk
            for chart_dir in per_chart_path.iterdir():
                if chart_dir.is_dir() and chart_dir.name.startswith(scale):
                    shutil.rmtree(chart_dir, ignore_errors=True)

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

        doc_ref = db.collection('districts').document(district_label)
        doc_ref.set({
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
        }, merge=True)

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
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
