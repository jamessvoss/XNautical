#!/usr/bin/env python3
"""
Shared Cloud Run Job entry point for all 4 imagery generators.

Each job task processes one zoom pack from a manifest uploaded by the
generator's /generate endpoint. Tasks run in parallel with no HTTP
timeout constraint.

Environment variables (set by job launcher):
  MANIFEST_PATH  — Storage path to manifest JSON
  BUCKET_NAME    — Storage bucket (default from config.py)
  CLOUD_RUN_TASK_INDEX — 0-based task index (set by Cloud Run Jobs)
"""

import os
import sys
import json
import gzip
import time
import shutil
import logging
import tempfile
from pathlib import Path

from google.cloud import storage, firestore

from config import BUCKET_NAME, REGION_BOUNDS, get_district_prefix, get_basemap_filename
from tile_utils import (
    get_all_tiles_for_region, download_and_store_tiles,
    zip_and_upload_pack, combine_and_zip, check_pack_exists,
    update_generator_status, TileDownloadError,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# Generator-specific tile processors, keyed by manifest string.
# Only basemap uses gzip_pbf; others pass null (no processing).
TILE_PROCESSORS = {
    'gzip_pbf': lambda data: gzip.compress(data) if data[:2] != b'\x1f\x8b' else data,
}


def main():
    task_index = int(os.environ.get('CLOUD_RUN_TASK_INDEX', '0'))
    manifest_path = os.environ.get('MANIFEST_PATH', '')
    bucket_name = os.environ.get('BUCKET_NAME', BUCKET_NAME)

    if not manifest_path:
        logger.error('MANIFEST_PATH not set')
        sys.exit(1)

    logger.info(f'=== tile_job task {task_index} starting ===')
    logger.info(f'  manifest: {manifest_path}')

    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    db = firestore.Client()

    # Download manifest
    manifest_blob = bucket.blob(manifest_path)
    manifest = json.loads(manifest_blob.download_as_text())

    region_id = manifest['regionId']
    config = manifest['config']
    packs = manifest['packs']

    if task_index >= len(packs):
        logger.info(f'  Task {task_index} >= {len(packs)} packs, nothing to do')
        sys.exit(0)

    pack = packs[task_index]
    pack_id = pack['packId']
    min_zoom = pack['minZoom']
    max_zoom = pack['maxZoom']

    layer_name = config['layerName']
    storage_folder = config['storageFolder']
    status_field = config['statusField']
    data_field = config['dataField']

    logger.info(f'  Task {task_index}: {layer_name} {pack_id} (z{min_zoom}-z{max_zoom}) for {region_id}')

    work_dir = tempfile.mkdtemp(prefix=f'{layer_name}_{region_id}_{pack_id}_')

    try:
        # Check if pack already exists (belt-and-suspenders; server.py already filtered)
        filename = f'{layer_name}_{pack_id}.mbtiles'
        storage_path = f'{region_id}/{storage_folder}/{filename}'
        if check_pack_exists(bucket, storage_path):
            logger.info(f'  {pack_id} already exists, skipping download')
        else:
            # Calculate tiles
            bounds = manifest['bounds']
            buffer_nm = manifest.get('bufferNm', 25)
            geometry_mode = config.get('geometryMode', 'coastal')

            all_tiles = get_all_tiles_for_region(
                bounds, min_zoom, max_zoom,
                buffer_nm=buffer_nm, geometry_mode=geometry_mode)

            if not all_tiles:
                logger.warning(f'  No tiles for {pack_id}, skipping')
            else:
                logger.info(f'  {len(all_tiles):,} tiles after filter')

                db_path = Path(work_dir) / filename
                tile_url = config['tileUrl']
                max_concurrent = config.get('maxConcurrent', 30)
                request_delay = config.get('requestDelay', 0)
                description = config.get('description', '')
                tile_format = config.get('format', 'png')
                attribution = config.get('attribution', '')
                skip_statuses = config.get('skipStatuses', [])
                headers = config.get('headers')
                tile_processor_key = config.get('tileProcessor')
                tile_processor = TILE_PROCESSORS.get(tile_processor_key) if tile_processor_key else None

                mbtiles_name = f'{region_id} {layer_name.title()} ({pack_id})'

                try:
                    file_size, stats = download_and_store_tiles(
                        all_tiles, db_path, min_zoom, max_zoom,
                        mbtiles_name, bounds,
                        tile_url=tile_url,
                        max_concurrent=max_concurrent,
                        request_delay=request_delay,
                        headers=headers,
                        description=description,
                        format_=tile_format,
                        attribution=attribution,
                        skip_statuses=skip_statuses,
                        tile_processor=tile_processor,
                    )
                except TileDownloadError as e:
                    logger.error(f'  {pack_id} aborted: {e}')
                    _write_result(bucket, region_id, storage_folder, pack_id, {
                        'packId': pack_id, 'status': 'error', 'error': str(e),
                    })
                    _increment_completed(db, region_id, config, manifest)
                    return

                size_mb = file_size / 1024 / 1024
                logger.info(f'  {pack_id}: {stats["completed"]}/{stats["total"]} tiles, '
                            f'{size_mb:.1f} MB, {stats["failed"]} failed')

                # Upload raw MBTiles
                bucket.blob(storage_path).upload_from_filename(str(db_path), timeout=600)

                # Zip and upload
                if layer_name == 'basemap':
                    zip_internal = f'{get_basemap_filename(region_id)}_{pack_id}.mbtiles'
                else:
                    zip_internal = f'{get_district_prefix(region_id)}_{layer_name}_{pack_id}.mbtiles'
                zip_and_upload_pack(bucket, region_id, storage_folder,
                                    db_path, zip_internal, work_dir)

                # Write per-pack result
                _write_result(bucket, region_id, storage_folder, pack_id, {
                    'packId': pack_id, 'status': 'success',
                    'filename': filename, 'storagePath': storage_path,
                    'sizeMB': round(size_mb, 1), 'sizeBytes': file_size,
                    'tileCount': stats['completed'], 'failedTiles': stats['failed'],
                    'minZoom': min_zoom, 'maxZoom': max_zoom,
                })

                db_path.unlink(missing_ok=True)

        # Increment completed counter; finalize if last
        _increment_completed(db, region_id, config, manifest)

    except Exception as e:
        logger.error(f'Task {task_index} failed: {e}', exc_info=True)
        _write_result(bucket, region_id, storage_folder, pack_id, {
            'packId': pack_id, 'status': 'error', 'error': str(e)[:500],
        })
        try:
            _increment_completed(db, region_id, config, manifest)
        except Exception:
            pass
        raise
    finally:
        if os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)

    logger.info(f'=== tile_job task {task_index} complete ===')


def _write_result(bucket, region_id, storage_folder, pack_id, result):
    """Write per-pack result JSON to Storage for finalization."""
    path = f'{region_id}/{storage_folder}/_job_results/{pack_id}.json'
    blob = bucket.blob(path)
    blob.upload_from_string(json.dumps(result), content_type='application/json')
    logger.info(f'  Wrote result to {path}')


@firestore.transactional
def _transactional_increment(transaction, doc_ref, status_field, total_packs):
    """Atomically increment completedPacks and return the new value."""
    snapshot = doc_ref.get(transaction=transaction)
    data = snapshot.to_dict() or {}
    status = data.get(status_field, {})
    current = status.get('completedPacks', 0)
    new_count = current + 1
    transaction.update(doc_ref, {
        f'{status_field}.completedPacks': new_count,
        f'{status_field}.message': f'Generated {new_count}/{total_packs} packs...',
    })
    return new_count


def _increment_completed(db, region_id, config, manifest):
    """Atomically increment completedPacks; finalize if this was the last task."""
    status_field = config['statusField']
    total_packs = len(manifest['packs'])

    doc_ref = db.collection('districts').document(region_id)
    transaction = db.transaction()
    new_count = _transactional_increment(transaction, doc_ref, status_field, total_packs)

    logger.info(f'  completedPacks: {new_count}/{total_packs}')

    if new_count >= total_packs:
        logger.info(f'  All packs complete — running finalization')
        _finalize(db, region_id, config, manifest)


def _finalize(db, region_id, config, manifest):
    """Called by the last task: combine packs, write final Firestore status."""
    layer_name = config['layerName']
    storage_folder = config['storageFolder']
    status_field = config['statusField']
    data_field = config['dataField']
    buffer_nm = manifest.get('bufferNm', 25)
    bounds = manifest['bounds']

    storage_client = storage.Client()
    bucket = storage_client.bucket(os.environ.get('BUCKET_NAME', BUCKET_NAME))

    # Read all per-pack results
    prefix = f'{region_id}/{storage_folder}/_job_results/'
    result_blobs = list(bucket.list_blobs(prefix=prefix))
    pack_results = {}
    for blob in result_blobs:
        try:
            result = json.loads(blob.download_as_text())
            if result.get('status') == 'success':
                pack_id = result['packId']
                pack_results[pack_id] = {
                    'filename': result['filename'],
                    'storagePath': result['storagePath'],
                    'sizeMB': result['sizeMB'],
                    'sizeBytes': result['sizeBytes'],
                    'tileCount': result['tileCount'],
                    'failedTiles': result['failedTiles'],
                    'minZoom': result['minZoom'],
                    'maxZoom': result['maxZoom'],
                }
        except Exception as e:
            logger.warning(f'  Failed to read result {blob.name}: {e}')

    # Combine per-zoom packs into single zip (best-effort)
    try:
        if layer_name == 'basemap':
            get_zip_name = lambda rid: f'{get_basemap_filename(rid)}.mbtiles'
        else:
            get_zip_name = lambda rid: f'{get_district_prefix(rid)}_{layer_name}.mbtiles'

        region = REGION_BOUNDS.get(region_id, {})
        region_bounds = region.get('bounds', bounds)
        combine_and_zip(bucket, region_id, layer_name, storage_folder,
                        region_bounds, db, status_field, get_zip_name)
    except Exception as e:
        logger.warning(f'  Combined zip failed (per-zoom zips available): {e}')

    # Write final Firestore status
    doc_ref = db.collection('districts').document(region_id)
    region = REGION_BOUNDS.get(region_id, {})
    region_name = region.get('name', region_id)

    doc_ref.set({
        data_field: {
            'lastGenerated': firestore.SERVER_TIMESTAMP,
            'region': region_name,
            'bufferNm': buffer_nm,
            'packs': pack_results,
        },
        status_field: {
            'state': 'complete',
            'message': f'{layer_name.title()} generation complete for {region_name}',
            'completedAt': firestore.SERVER_TIMESTAMP,
        },
    }, merge=True)

    logger.info(f'  Finalization complete for {layer_name} / {region_id}')

    # Clean up job artifacts
    try:
        manifest_path = os.environ.get('MANIFEST_PATH', '')
        if manifest_path:
            bucket.blob(manifest_path).delete()
        for blob in result_blobs:
            blob.delete()
        logger.info(f'  Cleaned up manifest and {len(result_blobs)} result files')
    except Exception as e:
        logger.warning(f'  Cleanup failed (non-critical): {e}')


if __name__ == '__main__':
    main()
