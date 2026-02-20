#!/usr/bin/env python3
"""
Rename zip files in Firebase Storage so the blob name matches the internal filename.

Before: 07cgd/charts/US1.mbtiles.zip  (contains d07_US1.mbtiles)
After:  07cgd/charts/d07_US1.mbtiles.zip  (contains d07_US1.mbtiles)

GCS doesn't support rename, so this copies to the new name then deletes the old blob.
Uses parallel processing for speed.

Usage:
    python scripts/rename-storage-zips.py [--dry-run] [--district 07cgd] [--workers 12]
"""

import os
import sys
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed

from google.cloud import storage

BUCKET_NAME = 'xnautical-8a296.firebasestorage.app'

DISTRICTS = ['01cgd', '05cgd', '07cgd', '08cgd', '09cgd', '11cgd', '13cgd', '14cgd', '17cgd']

DISTRICT_PREFIXES = {
    '01cgd': 'd01', '05cgd': 'd05', '07cgd': 'd07', '08cgd': 'd08',
    '09cgd': 'd09', '11cgd': 'd11', '13cgd': 'd13', '14cgd': 'd14',
    '17cgd': 'd17',
}

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


def rename_blob(bucket, old_path: str, new_path: str, dry_run: bool) -> str:
    """Copy blob from old_path to new_path, then delete old. Returns status string."""
    if old_path == new_path:
        return f'  SAME: {old_path} (no rename needed)'

    new_blob = bucket.blob(new_path)
    if new_blob.exists():
        # New name already exists, just need to clean up old if it still exists
        old_blob = bucket.blob(old_path)
        if old_blob.exists():
            if dry_run:
                return f'  DRY RUN DELETE OLD: {old_path} (new already exists at {new_path})'
            old_blob.delete()
            return f'  CLEANUP: deleted old {old_path} (new already at {new_path})'
        return f'  ALREADY OK: {new_path}'

    old_blob = bucket.blob(old_path)
    if not old_blob.exists():
        return f'  SKIP (not found): {old_path}'

    if dry_run:
        return f'  DRY RUN: {old_path} -> {new_path}'

    # Copy to new name
    bucket.copy_blob(old_blob, bucket, new_path)
    # Delete old
    old_blob.delete()
    return f'  RENAMED: {old_path} -> {new_path}'


def build_work_items(districts):
    """Build list of (old_path, new_path) tuples."""
    items = []
    for district in districts:
        prefix = DISTRICT_PREFIXES[district]

        # Charts
        for scale in CHART_SCALES:
            items.append((
                f'{district}/charts/{scale}.mbtiles.zip',
                f'{district}/charts/{prefix}_{scale}.mbtiles.zip',
            ))

        # Ocean
        items.append((
            f'{district}/ocean/ocean.mbtiles.zip',
            f'{district}/ocean/{prefix}_ocean.mbtiles.zip',
        ))

        # Terrain
        items.append((
            f'{district}/terrain/terrain.mbtiles.zip',
            f'{district}/terrain/{prefix}_terrain.mbtiles.zip',
        ))

        # Satellite
        for sat_pack in SATELLITE_PACKS:
            items.append((
                f'{district}/satellite/{sat_pack}.mbtiles.zip',
                f'{district}/satellite/{prefix}_{sat_pack}.mbtiles.zip',
            ))

        # Basemap
        basemap_name = BASEMAP_FILENAMES.get(district, 'basemap')
        items.append((
            f'{district}/basemaps/basemap.mbtiles.zip',
            f'{district}/basemaps/{basemap_name}.mbtiles.zip',
        ))

    return items


def main():
    parser = argparse.ArgumentParser(description='Rename Storage zip files to match internal names')
    parser.add_argument('--dry-run', action='store_true', help='Just print what would be done')
    parser.add_argument('--district', type=str, help='Process only this district (e.g., 07cgd)')
    parser.add_argument('--workers', type=int, default=12, help='Number of parallel workers (default: 12)')
    args = parser.parse_args()

    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)

    districts = [args.district] if args.district else DISTRICTS
    for d in districts:
        if d not in DISTRICT_PREFIXES:
            print(f'Unknown district: {d}')
            sys.exit(1)

    items = build_work_items(districts)
    print(f'Renaming {len(items)} zip files with {args.workers} parallel workers...\n')

    completed = 0
    total = len(items)
    errors = []

    def process_item(item):
        old_path, new_path = item
        return rename_blob(bucket, old_path, new_path, args.dry_run)

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
