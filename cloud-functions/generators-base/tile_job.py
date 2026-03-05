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
import sqlite3
import logging
import tempfile
from pathlib import Path

from google.cloud import storage, firestore

from config import BUCKET_NAME, REGION_BOUNDS, get_district_prefix, get_basemap_filename
from tile_utils import (
    get_all_tiles_for_region, download_and_store_tiles,
    zip_and_upload_pack, combine_and_zip, check_pack_exists,
    update_generator_status, TileDownloadError, init_mbtiles,
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
            # For sub-packs reused from a previous partial run, write a result
            # so finalize's metadata aggregation includes their size.
            if pack.get('parentPack'):
                blob = bucket.blob(storage_path)
                blob.reload()
                _write_result(bucket, region_id, storage_folder, pack_id, {
                    'packId': pack_id, 'status': 'success',
                    'filename': filename, 'storagePath': storage_path,
                    'sizeMB': round((blob.size or 0) / 1024 / 1024, 1),
                    'sizeBytes': blob.size or 0,
                    'tileCount': 0, 'failedTiles': 0,
                    'minZoom': min_zoom, 'maxZoom': max_zoom,
                    'parentPack': pack['parentPack'],
                    'reused': True,
                })
        else:
            # Calculate tiles (sub-packs carry their own bounds slice)
            bounds = pack.get('bounds', manifest['bounds'])
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

                if not pack.get('parentPack'):
                    # Normal pack: zip and upload
                    if layer_name == 'basemap':
                        zip_internal = f'{get_basemap_filename(region_id)}_{pack_id}.mbtiles'
                    else:
                        zip_internal = f'{get_district_prefix(region_id)}_{layer_name}_{pack_id}.mbtiles'
                    zip_and_upload_pack(bucket, region_id, storage_folder,
                                        db_path, zip_internal, work_dir)
                # Sub-packs: raw mbtiles already uploaded; finalize will merge+zip

                # Write per-pack result
                result_data = {
                    'packId': pack_id, 'status': 'success',
                    'filename': filename, 'storagePath': storage_path,
                    'sizeMB': round(size_mb, 1), 'sizeBytes': file_size,
                    'tileCount': stats['completed'], 'failedTiles': stats['failed'],
                    'minZoom': min_zoom, 'maxZoom': max_zoom,
                }
                if pack.get('parentPack'):
                    result_data['parentPack'] = pack['parentPack']
                _write_result(bucket, region_id, storage_folder, pack_id, result_data)

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


def _merge_sub_packs(bucket, region_id, storage_folder, layer_name, manifest):
    """Merge longitude-sliced sub-packs back into canonical per-zoom MBTiles.

    For each parentPack group, downloads sub-pack MBTiles one at a time,
    streams tiles into a canonical MBTiles, then uploads the canonical
    raw + zip and deletes the sub-pack files from storage.

    Returns dict of {parentPack: [missing_pack_ids, ...]} for any sub-packs
    that were not found in storage (indicates partial failure).
    """
    # Identify sub-packs from manifest
    parent_groups = {}  # parentPack -> [pack, ...]
    for pack in manifest['packs']:
        parent = pack.get('parentPack')
        if parent:
            parent_groups.setdefault(parent, []).append(pack)

    if not parent_groups:
        return {}

    logger.info(f'  Merging {len(parent_groups)} split pack group(s)...')
    missing_slices = {}  # parentPack -> [missing packId, ...]

    for parent_id, sub_packs in parent_groups.items():
        merge_dir = tempfile.mkdtemp(prefix=f'merge_{layer_name}_{region_id}_{parent_id}_')
        try:
            # Determine zoom range from sub-packs (all share same zoom)
            min_z = sub_packs[0]['minZoom']
            max_z = sub_packs[0]['maxZoom']
            canonical_filename = f'{layer_name}_{parent_id}.mbtiles'
            canonical_path = Path(merge_dir) / canonical_filename

            # Init canonical MBTiles with the full region bounds
            region_bounds = manifest['bounds']
            conn = init_mbtiles(
                canonical_path, min_z, max_z,
                f'{region_id} {layer_name.title()} ({parent_id})',
                region_bounds,
            )
            conn.close()

            # Copy tiles from each sub-pack one at a time
            pack_missing = []
            for sp in sorted(sub_packs, key=lambda p: p['packId']):
                sp_filename = f'{layer_name}_{sp["packId"]}.mbtiles'
                sp_storage_path = f'{region_id}/{storage_folder}/{sp_filename}'
                sp_local = Path(merge_dir) / sp_filename

                logger.info(f'    Downloading sub-pack {sp["packId"]}...')
                blob = bucket.blob(sp_storage_path)
                if not blob.exists():
                    logger.warning(f'    Sub-pack not found: {sp_storage_path}')
                    pack_missing.append(sp['packId'])
                    continue
                blob.download_to_filename(str(sp_local))

                # Stream tiles into canonical
                src_conn = sqlite3.connect(str(sp_local))
                dst_conn = sqlite3.connect(str(canonical_path))
                dst_conn.execute('PRAGMA journal_mode=WAL')
                dst_conn.execute('BEGIN TRANSACTION')
                cursor = src_conn.execute(
                    'SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles')
                while True:
                    batch = cursor.fetchmany(1000)
                    if not batch:
                        break
                    dst_conn.executemany(
                        'INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)', batch)
                dst_conn.execute('COMMIT')
                dst_conn.close()
                src_conn.close()

                # Delete local sub-pack immediately to control disk usage
                sp_local.unlink()

            if pack_missing:
                missing_slices[parent_id] = pack_missing
                logger.error(f'    {parent_id}: {len(pack_missing)}/{len(sub_packs)} '
                             f'sub-packs missing — canonical will have gaps')

            # Compact the canonical MBTiles (reclaims WAL journal space)
            vac_conn = sqlite3.connect(str(canonical_path))
            vac_conn.execute('PRAGMA journal_mode=DELETE')
            vac_conn.execute('VACUUM')
            vac_conn.close()

            canonical_size_mb = canonical_path.stat().st_size / 1024 / 1024
            logger.info(f'    Canonical {canonical_filename}: {canonical_size_mb:.1f} MB')
            if canonical_size_mb > 10_000:
                logger.warning(f'    Large canonical ({canonical_size_mb:.0f} MB) — '
                               f'ensure Cloud Run Job has sufficient disk/memory')

            # Upload canonical raw mbtiles
            canonical_storage = f'{region_id}/{storage_folder}/{canonical_filename}'
            logger.info(f'    Uploading merged {canonical_filename}...')
            bucket.blob(canonical_storage).upload_from_filename(
                str(canonical_path), timeout=1200)

            # Zip and upload canonical
            if layer_name == 'basemap':
                zip_internal = f'{get_basemap_filename(region_id)}_{parent_id}.mbtiles'
            else:
                zip_internal = f'{get_district_prefix(region_id)}_{layer_name}_{parent_id}.mbtiles'
            zip_and_upload_pack(bucket, region_id, storage_folder,
                                canonical_path, zip_internal, merge_dir)

            # Delete sub-pack raw files from storage
            for sp in sub_packs:
                sp_filename = f'{layer_name}_{sp["packId"]}.mbtiles'
                sp_path = f'{region_id}/{storage_folder}/{sp_filename}'
                try:
                    bucket.blob(sp_path).delete()
                except Exception:
                    pass

            logger.info(f'    Merged {len(sub_packs) - len(pack_missing)}/{len(sub_packs)} '
                        f'sub-packs into {canonical_filename}')

        finally:
            if os.path.exists(merge_dir):
                shutil.rmtree(merge_dir, ignore_errors=True)

    return missing_slices


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

    # Merge any longitude-sliced sub-packs before combining
    missing_slices = {}
    try:
        missing_slices = _merge_sub_packs(bucket, region_id, storage_folder, layer_name, manifest)
    except Exception as e:
        logger.error(f'Sub-pack merge failed: {e}', exc_info=True)

    # Read all per-pack results
    prefix = f'{region_id}/{storage_folder}/_job_results/'
    result_blobs = list(bucket.list_blobs(prefix=prefix))
    pack_results = {}
    sub_pack_results = {}  # parentPack -> [result, ...]
    failed_packs = []
    for blob in result_blobs:
        try:
            result = json.loads(blob.download_as_text())
            if result.get('status') == 'success':
                pack_id = result['packId']
                parent = result.get('parentPack')
                if parent:
                    sub_pack_results.setdefault(parent, []).append(result)
                else:
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
            elif result.get('status') == 'error':
                failed_packs.append(result.get('packId', 'unknown'))
        except Exception as e:
            logger.warning(f'  Failed to read result {blob.name}: {e}')

    # Aggregate sub-pack results into canonical entries
    for parent_id, results in sub_pack_results.items():
        canonical_filename = f'{layer_name}_{parent_id}.mbtiles'
        canonical_storage_path = f'{region_id}/{storage_folder}/{canonical_filename}'
        total_tiles = sum(r['tileCount'] for r in results)
        total_failed = sum(r['failedTiles'] for r in results)

        # Use actual merged file size from storage (accounts for dedup/overhead)
        canonical_blob = bucket.blob(canonical_storage_path)
        if canonical_blob.exists():
            canonical_blob.reload()
            actual_bytes = canonical_blob.size or 0
        else:
            # Fallback to sum if canonical wasn't uploaded (merge failed)
            actual_bytes = sum(r['sizeBytes'] for r in results)

        pack_results[parent_id] = {
            'filename': canonical_filename,
            'storagePath': canonical_storage_path,
            'sizeMB': round(actual_bytes / 1024 / 1024, 1),
            'sizeBytes': actual_bytes,
            'tileCount': total_tiles,
            'failedTiles': total_failed,
            'minZoom': results[0]['minZoom'],
            'maxZoom': results[0]['maxZoom'],
        }

    # Combine per-zoom packs into single zip (best-effort)
    try:
        if layer_name == 'basemap':
            get_zip_name = lambda rid: f'{get_basemap_filename(rid)}.mbtiles'
        else:
            get_zip_name = lambda rid: f'{get_district_prefix(rid)}_{layer_name}.mbtiles'

        region = REGION_BOUNDS.get(region_id, {})
        region_name = region.get('name', region_id)
        region_bounds = region.get('bounds', bounds)
        combine_and_zip(bucket, region_id, layer_name, storage_folder,
                        region_bounds, db, status_field, get_zip_name)
    except Exception as e:
        logger.warning(f'  Combined zip failed (per-zoom zips available): {e}')

    # Determine final state
    has_failures = bool(missing_slices) or bool(failed_packs)
    if has_failures:
        state = 'partial'
        parts = []
        if missing_slices:
            total_missing = sum(len(v) for v in missing_slices.values())
            parts.append(f'{total_missing} missing slices')
        if failed_packs:
            parts.append(f'{len(failed_packs)} failed packs')
        failure_detail = ', '.join(parts)
        message = f'{layer_name.title()} generation partial for {region_name} ({failure_detail})'
        logger.warning(f'  Finalization with failures: {failure_detail}')
    else:
        state = 'complete'
        message = f'{layer_name.title()} generation complete for {region_name}'

    # Write final Firestore status
    doc_ref = db.collection('districts').document(region_id)

    status_data = {
        'state': state,
        'message': message,
        'completedAt': firestore.SERVER_TIMESTAMP,
    }
    if missing_slices:
        status_data['missingSlices'] = missing_slices

    doc_ref.set({
        data_field: {
            'lastGenerated': firestore.SERVER_TIMESTAMP,
            'region': region_name,
            'bufferNm': buffer_nm,
            'packs': pack_results,
        },
        status_field: status_data,
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
