#!/usr/bin/env python3
"""
Cloud Run Job for merging per-chart MBTiles into scale packs.

Environment Variables:
    DISTRICT_ID: District identifier (e.g., "13")
    SCALE: Scale prefix (e.g., "US5")
    BUCKET_NAME: Firebase Storage bucket name
    
Usage:
    python merge_job.py
"""

import os
import sys
import json
import logging
import tempfile
import shutil
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from datetime import datetime, timezone

from google.cloud import storage, firestore
from merge_utils import compute_md5, check_for_skipped_tiles, merge_mbtiles

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

# Constants
SCALE_PREFIXES = ['US1', 'US2', 'US3', 'US4', 'US5', 'US6']


def main():
    """Main entry point for merge job."""
    start_time = datetime.now(timezone.utc)
    
    # Read environment variables
    district_id = os.environ.get('DISTRICT_ID', '').zfill(2)
    scale = os.environ.get('SCALE', '')
    bucket_name = os.environ.get('BUCKET_NAME', 'xnautical-8a296.firebasestorage.app')
    
    if not district_id or district_id == '00':
        logger.error('DISTRICT_ID environment variable not set')
        sys.exit(1)
    
    if scale not in SCALE_PREFIXES:
        logger.error(f'Invalid SCALE: {scale}. Must be one of {SCALE_PREFIXES}')
        sys.exit(1)
    
    district_label = f'{district_id}cgd'
    
    logger.info(f'=== Starting merge job for {district_label} scale {scale} ===')
    logger.info(f'Bucket: {bucket_name}')
    
    # Initialize clients
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    db = firestore.Client()
    
    # Create working directory
    work_dir = tempfile.mkdtemp(prefix=f'enc_merge_{scale}_')
    per_chart_dir = os.path.join(work_dir, 'per_chart')
    output_dir = os.path.join(work_dir, 'output')
    os.makedirs(per_chart_dir)
    os.makedirs(output_dir)
    
    try:
        # Download per-chart MBTiles from temp storage
        logger.info(f'Downloading per-chart MBTiles from temp storage...')
        download_start = datetime.now(timezone.utc)
        
        temp_prefix = f'{district_label}/charts/temp/'
        blobs = list(bucket.list_blobs(prefix=temp_prefix))
        
        # Filter blobs matching this scale
        scale_blobs = []
        for blob in blobs:
            filename = blob.name.split('/')[-1]
            chart_id = filename.replace('.mbtiles', '')
            if chart_id.startswith(scale):
                scale_blobs.append((blob, filename))
        
        logger.info(f'Found {len(scale_blobs)} {scale} charts in temp storage')
        
        if not scale_blobs:
            logger.error(f'No per-chart MBTiles found for scale {scale}')
            sys.exit(1)
        
        # Download all matching charts in parallel
        def _download_blob(args):
            blob, filename = args
            local_path = os.path.join(per_chart_dir, filename)
            blob.download_to_filename(local_path)
            return local_path

        download_workers = min(16, len(scale_blobs))
        with ThreadPoolExecutor(max_workers=download_workers) as pool:
            list(pool.map(_download_blob, scale_blobs))

        download_duration = (datetime.now(timezone.utc) - download_start).total_seconds()
        logger.info(f'Downloaded {len(scale_blobs)} files in {download_duration:.1f}s '
                   f'({download_workers} parallel workers)')
        
        # Merge charts
        logger.info(f'Merging {len(scale_blobs)} charts with tile-join...')
        merge_start = datetime.now(timezone.utc)
        
        input_files = list(Path(per_chart_dir).glob('*.mbtiles'))
        output_path = Path(output_dir) / f'{scale}.mbtiles'
        description = f'{scale} scale charts for {district_label}'
        
        num_charts, size_mb, error = merge_mbtiles(
            input_files, output_path, f'{district_label}_{scale}', description
        )
        
        merge_duration = (datetime.now(timezone.utc) - merge_start).total_seconds()
        
        if error:
            logger.error(f'Merge failed: {error}')
            sys.exit(1)
        
        logger.info(f'Merged {num_charts} charts, {size_mb:.1f} MB in {merge_duration:.1f}s')
        
        # Upload merged scale pack
        storage_path = f'{district_label}/charts/{scale}.mbtiles'
        logger.info(f'Uploading {scale}: {size_mb:.1f} MB -> {storage_path}')
        
        upload_start = datetime.now(timezone.utc)
        blob = bucket.blob(storage_path)
        blob.upload_from_filename(str(output_path), timeout=600)
        upload_duration = (datetime.now(timezone.utc) - upload_start).total_seconds()
        
        # Compute checksum
        md5_checksum = compute_md5(output_path)

        # Read bounds and zoom metadata from the merged MBTiles
        bounds = None
        min_zoom = None
        max_zoom = None
        try:
            conn = sqlite3.connect(str(output_path))
            cursor = conn.cursor()
            metadata = {}
            cursor.execute("SELECT name, value FROM metadata")
            for name, value in cursor.fetchall():
                metadata[name] = value
            conn.close()

            bounds_str = metadata.get('bounds')
            if bounds_str:
                b = [float(x) for x in bounds_str.split(',')]
                bounds = {'west': b[0], 'south': b[1], 'east': b[2], 'north': b[3]}
            min_zoom = int(metadata.get('minzoom', 0))
            max_zoom = int(metadata.get('maxzoom', 0))
            logger.info(f'Metadata: bounds={bounds_str}, zoom={min_zoom}-{max_zoom}')
        except Exception as e:
            logger.warning(f'Could not read MBTiles metadata: {e}')

        total_duration = (datetime.now(timezone.utc) - start_time).total_seconds()

        # Write result to Firestore
        result = {
            'status': 'success',
            'scale': scale,
            'district': district_label,
            'chartCount': num_charts,
            'sizeMB': round(size_mb, 2),
            'storagePath': storage_path,
            'md5Checksum': md5_checksum,
            'durationSeconds': round(total_duration, 1),
            'phases': {
                'downloadSeconds': round(download_duration, 1),
                'mergeSeconds': round(merge_duration, 1),
                'uploadSeconds': round(upload_duration, 1),
            },
        }

        # Update Firestore with merge result (including bounds for manifest generation)
        scale_data = {
            'chartCount': num_charts,
            'sizeMB': round(size_mb, 2),
            'storagePath': storage_path,
            'md5Checksum': md5_checksum,
            'mergedAt': firestore.SERVER_TIMESTAMP,
        }
        if bounds:
            scale_data['bounds'] = bounds
        if min_zoom is not None:
            scale_data['minZoom'] = min_zoom
        if max_zoom is not None:
            scale_data['maxZoom'] = max_zoom

        doc_ref = db.collection('districts').document(district_label)
        doc_ref.set({
            'chartData': {
                'scales': {
                    scale: scale_data
                }
            }
        }, merge=True)
        
        logger.info(f'=== Merge job complete: {num_charts} charts, {size_mb:.1f} MB, {total_duration:.1f}s ===')
        
        # Output JSON result for job logs (without Firestore sentinels)
        result_for_output = result.copy()
        result_for_output['completedAt'] = datetime.now(timezone.utc).isoformat()
        print(json.dumps(result_for_output, indent=2))
        
        sys.exit(0)
        
    except Exception as e:
        logger.error(f'Error in merge job: {e}', exc_info=True)
        sys.exit(1)
        
    finally:
        # Clean up temp directory
        if os.path.exists(work_dir):
            logger.info(f'Cleaning up temp directory: {work_dir}')
            shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == '__main__':
    main()
