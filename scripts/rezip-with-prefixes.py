#!/usr/bin/env python3
"""
Re-zip all MBTiles zip files in Firebase Storage with district-prefixed internal filenames.

The app expects zip files to contain prefixed filenames like:
  - d07_US1.mbtiles (not US1.mbtiles)
  - d07_ocean.mbtiles (not ocean.mbtiles)
  - d17_satellite_z0-5.mbtiles (not satellite_z0-5.mbtiles)
  - d07_basemap.mbtiles (not basemaps.mbtiles)

This script downloads each zip, re-packages it with the correct internal name, and re-uploads.
Uses parallel processing for speed.

Usage:
    python scripts/rezip-with-prefixes.py [--dry-run] [--district 07cgd] [--workers 8]
"""

import os
import sys
import zipfile
import tempfile
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed

from google.cloud import storage

BUCKET_NAME = 'xnautical-8a296.firebasestorage.app'

DISTRICTS = ['01cgd', '05cgd', '07cgd', '08cgd', '09cgd', '11cgd', '13cgd', '14cgd', '17cgd']

# Must match app's DISTRICT_PREFIXES
DISTRICT_PREFIXES = {
    '01cgd': 'd01', '05cgd': 'd05', '07cgd': 'd07', '08cgd': 'd08',
    '09cgd': 'd09', '11cgd': 'd11', '13cgd': 'd13', '14cgd': 'd14',
    '17cgd': 'd17',
}

# Must match app's BASEMAP_FILENAMES
BASEMAP_FILENAMES = {
    '01cgd': 'd01_basemap', '05cgd': 'd05_basemap', '07cgd': 'd07_basemap',
    '08cgd': 'd08_basemap', '09cgd': 'd09_basemap', '11cgd': 'd11_basemap',
    '13cgd': 'd13_basemap', '14cgd': 'd14_basemap', '17cgd': 'd17_basemap',
}

CHART_SCALES = ['US1', 'US2', 'US3', 'US4', 'US5', 'US6']

SATELLITE_PACKS = [
    'satellite_z0-5', 'satellite_z6-7', 'satellite_z8', 'satellite_z9',
    'satellite_z10', 'satellite_z11', 'satellite_z12', 'satellite_z13', 'satellite_z14',
]


def rezip_file(bucket, storage_path: str, old_internal: str, new_internal: str, dry_run: bool) -> str:
    """Download a zip, re-package with new internal filename, and re-upload.
    Returns a status string for logging."""
    blob = bucket.blob(storage_path)
    if not blob.exists():
        return f'  SKIP (not found): {storage_path}'

    if dry_run:
        return f'  DRY RUN: {storage_path}: {old_internal} -> {new_internal}'

    with tempfile.TemporaryDirectory() as tmpdir:
        # Download
        zip_path = os.path.join(tmpdir, 'original.zip')
        blob.download_to_filename(zip_path)
        size_mb = os.path.getsize(zip_path) / 1024 / 1024

        # Check current internal name
        with zipfile.ZipFile(zip_path, 'r') as zf:
            names = zf.namelist()
            if new_internal in names:
                return f'  ALREADY OK: {storage_path} (contains {new_internal})'
            if old_internal not in names:
                if len(names) == 1:
                    old_internal = names[0]
                else:
                    return f'  SKIP: {storage_path} has multiple files: {names}'

        # Extract the file
        extracted_path = os.path.join(tmpdir, old_internal)
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extract(old_internal, tmpdir)

        # Re-zip with new name
        new_zip_path = os.path.join(tmpdir, 'repacked.zip')
        with zipfile.ZipFile(new_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.write(extracted_path, new_internal)

        # Upload
        blob.upload_from_filename(new_zip_path, timeout=1200)
        new_size_mb = os.path.getsize(new_zip_path) / 1024 / 1024
        return f'  OK: {storage_path}: {old_internal} -> {new_internal} ({size_mb:.1f} -> {new_size_mb:.1f} MB)'


def build_work_items(districts):
    """Build list of (storage_path, old_internal, new_internal) tuples."""
    items = []
    for district in districts:
        prefix = DISTRICT_PREFIXES[district]

        # Charts
        for scale in CHART_SCALES:
            items.append((
                f'{district}/charts/{scale}.mbtiles.zip',
                f'{scale}.mbtiles',
                f'{prefix}_{scale}.mbtiles',
            ))

        # Ocean
        items.append((
            f'{district}/ocean/ocean.mbtiles.zip',
            'ocean.mbtiles',
            f'{prefix}_ocean.mbtiles',
        ))

        # Terrain
        items.append((
            f'{district}/terrain/terrain.mbtiles.zip',
            'terrain.mbtiles',
            f'{prefix}_terrain.mbtiles',
        ))

        # Satellite
        for sat_pack in SATELLITE_PACKS:
            items.append((
                f'{district}/satellite/{sat_pack}.mbtiles.zip',
                f'{sat_pack}.mbtiles',
                f'{prefix}_{sat_pack}.mbtiles',
            ))

        # Basemap
        basemap_name = BASEMAP_FILENAMES.get(district, 'basemap')
        items.append((
            f'{district}/basemaps/basemaps.mbtiles.zip',
            'basemaps.mbtiles',
            f'{basemap_name}.mbtiles',
        ))

    return items


def main():
    parser = argparse.ArgumentParser(description='Re-zip MBTiles with district prefixes')
    parser.add_argument('--dry-run', action='store_true', help='Just print what would be done')
    parser.add_argument('--district', type=str, help='Process only this district (e.g., 07cgd)')
    parser.add_argument('--workers', type=int, default=8, help='Number of parallel workers (default: 8)')
    args = parser.parse_args()

    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)

    districts = [args.district] if args.district else DISTRICTS
    for d in districts:
        if d not in DISTRICT_PREFIXES:
            print(f'Unknown district: {d}')
            sys.exit(1)

    items = build_work_items(districts)
    print(f'Processing {len(items)} zip files with {args.workers} parallel workers...\n')

    completed = 0
    total = len(items)

    def process_item(item):
        storage_path, old_internal, new_internal = item
        return rezip_file(bucket, storage_path, old_internal, new_internal, args.dry_run)

    errors = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process_item, item): item for item in items}
        for future in as_completed(futures):
            completed += 1
            item = futures[future]
            try:
                result = future.result()
                print(f'[{completed}/{total}] {result}')
            except Exception as e:
                err_msg = f'  ERROR: {item[0]}: {e}'
                errors.append(err_msg)
                print(f'[{completed}/{total}] {err_msg}')

    print(f'\nDone. Processed {total} items.')
    if errors:
        print(f'\n{len(errors)} errors:')
        for err in errors:
            print(err)


if __name__ == '__main__':
    main()
