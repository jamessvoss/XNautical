#!/usr/bin/env python3
"""
Rename storage files to use normalized district prefixes.

Changes:
  1. Alaska charts/satellite/ocean/terrain: alaska_* -> d17_*
  2. All districts' basemaps: basemap_{geo}.mbtiles -> {prefix}_basemap.mbtiles

Zip files are downloaded, re-zipped with the new internal filename, and re-uploaded.
Raw (non-zip) files are copied with gsutil.

Requires: gsutil (authenticated via gcloud auth login)

Usage:
    python rename-storage-files.py [--dry-run]
"""

import os
import sys
import subprocess
import tempfile
import zipfile
import argparse

BUCKET = 'gs://xnautical-8a296.firebasestorage.app'

# Old -> new basemap filenames (inside the zip)
BASEMAP_RENAMES = {
    '01cgd': ('basemap_ne', 'd01_basemap'),
    '05cgd': ('basemap_ma', 'd05_basemap'),
    '07cgd': ('basemap_se', 'd07_basemap'),
    '08cgd': ('basemap_gc', 'd08_basemap'),
    '09cgd': ('basemap_gl', 'd09_basemap'),
    '11cgd': ('basemap_sw', 'd11_basemap'),
    '13cgd': ('basemap_pnw', 'd13_basemap'),
    '14cgd': ('basemap_hi', 'd14_basemap'),
    '17cgd': ('basemap_alaska', 'd17_basemap'),
}


def gsutil_ls(prefix):
    """List blobs under a prefix."""
    result = subprocess.run(
        ['gsutil', 'ls', f'{BUCKET}/{prefix}'],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.strip().split('\n') if line.strip()]


def gsutil_cp(src, dst, dry_run):
    """Copy a blob."""
    print(f'  COPY: {src} -> {dst}')
    if dry_run:
        return True
    result = subprocess.run(['gsutil', 'cp', src, dst], capture_output=True, text=True)
    if result.returncode != 0:
        print(f'  ERROR: {result.stderr.strip()}')
        return False
    return True


def gsutil_rm(path, dry_run):
    """Delete a blob."""
    print(f'  DELETE: {path}')
    if dry_run:
        return
    subprocess.run(['gsutil', 'rm', path], capture_output=True, text=True)


def rezip_and_upload(old_gs_path, new_gs_path, new_internal, dry_run):
    """Download a zip, re-zip with new internal filename, upload to new path."""
    old_short = old_gs_path.replace(BUCKET + '/', '')
    new_short = new_gs_path.replace(BUCKET + '/', '')
    print(f'  REZIP: {old_short}')
    print(f'      -> {new_short}')
    print(f'         internal name: {new_internal}')

    if dry_run:
        return True

    with tempfile.TemporaryDirectory() as tmpdir:
        # Download
        old_zip_path = os.path.join(tmpdir, 'old.zip')
        result = subprocess.run(
            ['gsutil', 'cp', old_gs_path, old_zip_path],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f'  SKIP (download failed): {result.stderr.strip()}')
            return False

        # Extract the mbtiles from the old zip
        mbtiles_path = os.path.join(tmpdir, 'data.mbtiles')
        with zipfile.ZipFile(old_zip_path, 'r') as zf:
            names = zf.namelist()
            if not names:
                print(f'  ERROR: empty zip')
                return False
            print(f'         old internal: {names[0]}')
            with zf.open(names[0]) as src, open(mbtiles_path, 'wb') as dst:
                dst.write(src.read())

        # Re-zip with new internal filename
        new_zip_path = os.path.join(tmpdir, 'new.zip')
        with zipfile.ZipFile(new_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.write(mbtiles_path, new_internal)

        old_size = os.path.getsize(old_zip_path) / 1024 / 1024
        new_size = os.path.getsize(new_zip_path) / 1024 / 1024
        print(f'         size: {old_size:.1f} MB -> {new_size:.1f} MB')

        # Upload to new path
        result = subprocess.run(
            ['gsutil', 'cp', new_zip_path, new_gs_path],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f'  ERROR uploading: {result.stderr.strip()}')
            return False

    return True


def rename_alaska_prefix(subfolder, dry_run):
    """Rename alaska_* files to d17_* in a given subfolder under 17cgd/."""
    prefix = f'17cgd/{subfolder}/'
    blobs = gsutil_ls(prefix)

    for gs_path in blobs:
        filename = gs_path.split('/')[-1]
        if not filename.startswith('alaska_'):
            continue

        new_filename = filename.replace('alaska_', 'd17_', 1)
        new_gs_path = f'{BUCKET}/{prefix}{new_filename}'

        if filename.endswith('.zip'):
            new_internal = new_filename.replace('.zip', '')
            if rezip_and_upload(gs_path, new_gs_path, new_internal, dry_run):
                gsutil_rm(gs_path, dry_run)
        else:
            # Raw mbtiles (e.g., alaska_charts.mbtiles)
            if gsutil_cp(gs_path, new_gs_path, dry_run):
                gsutil_rm(gs_path, dry_run)


def main():
    parser = argparse.ArgumentParser(description='Rename storage files to normalized prefixes')
    parser.add_argument('--dry-run', action='store_true', help='Print what would be done without making changes')
    args = parser.parse_args()

    dry_run = args.dry_run
    if dry_run:
        print('=== DRY RUN MODE ===\n')

    # ── 1-4. Alaska prefix: alaska_ -> d17_ ──
    for subfolder in ['charts', 'satellite', 'ocean', 'terrain']:
        print(f'\n=== Alaska {subfolder} prefix rename (alaska_ -> d17_) ===')
        rename_alaska_prefix(subfolder, dry_run)

    # ── 5. All districts: basemap rename ──
    print('\n=== Basemap rename (all districts) ===')
    for district_id, (old_base, new_base) in BASEMAP_RENAMES.items():
        print(f'\n--- {district_id}: {old_base} -> {new_base} ---')

        old_gs = f'{BUCKET}/{district_id}/basemaps/{old_base}.mbtiles.zip'
        new_gs = f'{BUCKET}/{district_id}/basemaps/{new_base}.mbtiles.zip'
        new_internal = f'{new_base}.mbtiles'

        if rezip_and_upload(old_gs, new_gs, new_internal, dry_run):
            gsutil_rm(old_gs, dry_run)

    print('\n=== Done ===')
    if dry_run:
        print('(No changes made — run without --dry-run to execute)')


if __name__ == '__main__':
    main()
