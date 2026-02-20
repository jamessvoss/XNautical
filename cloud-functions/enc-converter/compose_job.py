#!/usr/bin/env python3
"""
Cloud Run Job for composing a unified MBTiles from per-chart GeoJSON.

Downloads all per-chart compressed GeoJSON from temp storage, deduplicates
features across scales, assigns per-feature zoom ranges, runs a single
tippecanoe pass to produce one unified MBTiles per district.

Environment Variables:
    DISTRICT_ID: District identifier (e.g., "13")
    DISTRICT_LABEL: Optional override for the district label (e.g., "017cgd_test")
    BUCKET_NAME: Firebase Storage bucket name
    JOB_TYPE: Must be "compose" (used by orchestrator to identify this job)

Usage:
    python compose_job.py
"""

import math
import os
import sys
import json
import hashlib
import logging
import tempfile
import shutil
import subprocess
import threading
import time
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from datetime import datetime, timezone

import sqlite3

from google.cloud import storage, firestore

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

# App-side filename prefixes per district (must match app's DISTRICT_PREFIXES)
DISTRICT_PREFIXES = {
    '01cgd': 'd01', '05cgd': 'd05', '07cgd': 'd07', '08cgd': 'd08',
    '09cgd': 'd09', '11cgd': 'd11', '13cgd': 'd13', '14cgd': 'd14',
    '17cgd': 'd17',
}

# Zoom ranges per scale number (matching convert.py get_tippecanoe_settings)
SCALE_ZOOM_RANGES = {
    1: (0, 8),
    2: (0, 10),
    3: (4, 13),
    4: (6, 15),
    5: (8, 15),
    6: (6, 15),
}

# Category 1: Fixed physical objects — deduplicate, keep highest _scaleNum
# All codes are verified against actual binary OBJL values in S-57 .000 files
# (cross-referenced GDAL layer names with TypeScript parser output on 50+ charts)
DEDUP_POINT_OBJLS = {
    75,   # LIGHTS
    17, 14, 18, 19, 16,  # BOY* (BOYLAT, BOYCAR, BOYSAW, BOYSPP, BOYISD)
    7, 9, 5, 6, 8,       # BCN* (BCNLAT, BCNSPP, BCNCAR, BCNISD, BCNSAW)
    74,   # LNDMRK
    159,  # WRECKS
    153,  # UWTROC
    86,   # OBSTRN
    90,   # PILPNT
    58,   # FOGSIG
    111,  # RSCSTA
    39,   # DAYMAR
    65,   # HULKES
    95,   # PONTON
    84,   # MORFAC
}

DEDUP_LINE_OBJLS = {
    11,   # BRIDGE
    21,   # CBLOHD
    22,   # CBLSUB
    94,   # PIPSOL
    122,  # SLCONS
    26,   # CAUSWY
}

# Category 2: Regulatory/navigation zones — deduplicate, keep highest _scaleNum
DEDUP_ZONE_OBJLS = {
    112,  # RESARE
    27,   # CTNARE
    83,   # MIPARE
    4,    # ACHARE
    3,    # ACHBRT
    82,   # MARCUL
    20,   # CBLARE
    92,   # PIPARE
    51,   # FAIRWY
    109,  # RECTRC
    145,  # TSELNE
    148,  # TSSLPT
    85,   # NAVLNE
    46,   # DRGARE
}

# Category 3: Hydrographic/geographic features — deduplicate, keep highest _scaleNum
# These features exist on multiple overlapping charts and cause visual doubling
# (overlapping contour lines, duplicate soundings, doubled coastlines)
DEDUP_HYDRO_OBJLS = {
    43,   # DEPCNT — depth contours
    42,   # DEPARE — depth areas
    129,  # SOUNDG — soundings
    30,   # COALNE — coastline
    71,   # LNDARE — land areas
}

# All OBJL codes that should be deduplicated
ALL_DEDUP_OBJLS = DEDUP_POINT_OBJLS | DEDUP_LINE_OBJLS | DEDUP_ZONE_OBJLS | DEDUP_HYDRO_OBJLS

# M_COVR (302) features are NOT deduplicated — each chart has its own coverage polygon.
# They pass through to tiles as-is (the TypeScript parser includes them, unlike GDAL).
M_COVR_OBJL = 302


def compute_zoom_ownership(scales: set) -> dict:
    """For each zoom 0-15, highest scale whose native range covers it wins.
    Returns {scale_num: (minzoom, maxzoom)} with non-overlapping ranges."""
    zoom_to_owner = {}
    for z in range(0, 16):
        best = None
        for sn in scales:
            lo, hi = SCALE_ZOOM_RANGES.get(sn, (0, 15))
            if lo <= z <= hi and (best is None or sn > best):
                best = sn
        if best is not None:
            zoom_to_owner[z] = best

    ownership = {}
    for z in sorted(zoom_to_owner):
        sn = zoom_to_owner[z]
        if sn not in ownership:
            ownership[sn] = (z, z)
        else:
            ownership[sn] = (ownership[sn][0], z)
    return ownership


def get_district_prefix(district_label: str) -> str:
    """Get the app-side filename prefix for a district."""
    return DISTRICT_PREFIXES.get(district_label, district_label.replace('cgd', ''))


def compute_md5(file_path: Path) -> str:
    """Compute MD5 checksum of a file."""
    hash_md5 = hashlib.md5()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def dedup_key(feature: dict) -> str:
    """Generate a deduplication key for a feature.

    Points: "{OBJL}:{OBJNAM}:{round(lon,4)}:{round(lat,4)}" or without OBJNAM
    Lines/Polygons: "{OBJL}:{OBJNAM}:{hash(sorted_rounded_coords)}" or without OBJNAM
    """
    props = feature.get('properties', {})
    objl = props.get('OBJL', 0)
    objnam = props.get('OBJNAM')
    geom = feature.get('geometry', {})
    geom_type = geom.get('type', '')

    if geom_type == 'Point':
        coords = geom.get('coordinates', [0, 0])
        lon = round(coords[0], 4)
        lat = round(coords[1], 4)
        if objnam:
            return f"{objl}:{objnam}:{lon}:{lat}"
        return f"{objl}:{lon}:{lat}"

    else:
        # Lines, Polygons, MultiLineString, MultiPolygon
        coords = geom.get('coordinates', [])
        # Flatten and round all coordinate pairs for hashing
        flat = _flatten_coords(coords)
        rounded = tuple((round(c[0], 4), round(c[1], 4)) for c in flat)
        coord_hash = hashlib.md5(str(sorted(rounded)).encode()).hexdigest()[:12]
        if objnam:
            return f"{objl}:{objnam}:{coord_hash}"
        return f"{objl}:{coord_hash}"


def _flatten_coords(coords):
    """Recursively flatten nested coordinate arrays into list of (lon, lat) tuples."""
    if not coords:
        return []
    if isinstance(coords[0], (int, float)):
        # Single coordinate pair
        return [(coords[0], coords[1])]
    if isinstance(coords[0], list) and coords[0] and isinstance(coords[0][0], (int, float)):
        # List of coordinate pairs
        return [(c[0], c[1]) for c in coords]
    # Nested (polygon rings, multi-geometries)
    result = []
    for item in coords:
        result.extend(_flatten_coords(item))
    return result



def tippecanoe_worker():
    """Standalone tippecanoe worker for fan-out execution.

    Reads DISTRICT_LABEL, BUCKET_NAME, SCALE_NUM, ZOOM_MIN, ZOOM_MAX from env vars.
    Downloads the full scale GeoJSON from Cloud Storage, runs tippecanoe on
    the specified zoom band only, and uploads the resulting .mbtiles back.

    Zoom-band partitioning: each worker processes the SAME input GeoJSON but
    generates tiles for a different zoom range (-Z/-z). No tile overlap between
    workers, no output bloat. tile-join merges the disjoint zoom bands.
    """
    district_label = os.environ.get('DISTRICT_LABEL', '')
    bucket_name = os.environ.get('BUCKET_NAME', 'xnautical-8a296.firebasestorage.app')
    scale_num = int(os.environ.get('SCALE_NUM', '0'))
    zoom_min = os.environ.get('ZOOM_MIN', '')
    zoom_max = os.environ.get('ZOOM_MAX', '')

    if not district_label or scale_num not in SCALE_ZOOM_RANGES:
        logger.error(f'Invalid env: DISTRICT_LABEL={district_label}, SCALE_NUM={scale_num}')
        sys.exit(1)

    native_lo, native_hi = SCALE_ZOOM_RANGES[scale_num]

    # Use ZOOM_MIN/ZOOM_MAX if provided, otherwise use native range
    z_lo = int(zoom_min) if zoom_min else native_lo
    z_hi = int(zoom_max) if zoom_max else native_hi

    # Output suffix encodes the zoom band (empty if full native range)
    if z_lo == native_lo and z_hi == native_hi:
        zoom_suffix = ''
    else:
        zoom_suffix = f'_z{z_lo}-{z_hi}'

    input_stem = f'scale_{scale_num}'
    output_stem = f'scale_{scale_num}{zoom_suffix}'

    logger.info(f'=== Tippecanoe worker: {output_stem} (US{scale_num} z{z_lo}-{z_hi}) '
                f'for {district_label} ===')

    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)

    work_dir = tempfile.mkdtemp(prefix=f'tippecanoe_{output_stem}_')
    geojson_path = os.path.join(work_dir, f'{input_stem}.geojson')
    mbtiles_path = os.path.join(work_dir, f'{output_stem}.mbtiles')

    try:
        # Download the full scale GeoJSON (same file for all zoom-band workers)
        blob_path = f'{district_label}/charts/temp/compose/{input_stem}.geojson'
        logger.info(f'Downloading {blob_path}...')
        blob = bucket.blob(blob_path)
        blob.download_to_filename(geojson_path)
        sz = os.path.getsize(geojson_path) / 1024 / 1024
        logger.info(f'Downloaded {sz:.1f} MB')

        # Run tippecanoe — use all available CPU cores (no TIPPECANOE_MAX_THREADS limit)
        cmd = [
            'tippecanoe', '-o', mbtiles_path,
            '-Z', str(z_lo), '-z', str(z_hi),
            '-P',
            '--no-feature-limit',
            '--no-tile-size-limit',
            '--no-line-simplification',
            '--no-tiny-polygon-reduction',
            '-r1',
            '--force',
            geojson_path,
        ]

        logger.info(f'Running: {" ".join(cmd)}')
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)

        # Stream stderr to stdout for Cloud Logging
        stderr_lines = []
        log_tag = f'US{scale_num}{zoom_suffix}'
        for line in proc.stderr:
            line = line.rstrip('\n')
            stderr_lines.append(line)
            sys.stdout.write(f'  [{log_tag}] {line}\n')
            sys.stdout.flush()

        proc.wait()

        if proc.returncode != 0:
            logger.error(f'tippecanoe failed (exit {proc.returncode}): '
                        f'{" ".join(stderr_lines[-5:])}')
            sys.exit(1)

        # Check for skipped tiles
        skipped = [l for l in stderr_lines if 'Skipping this tile' in l]
        if skipped:
            logger.error(f'tippecanoe DROPPED {len(skipped)} TILES!')
            for line in skipped[:10]:
                logger.error(f'  {line.strip()}')
            sys.exit(1)

        mb = os.path.getsize(mbtiles_path) / 1024 / 1024
        logger.info(f'Tippecanoe complete: {mb:.1f} MB')

        # Upload .mbtiles to Cloud Storage
        upload_path = f'{district_label}/charts/temp/compose/{output_stem}.mbtiles'
        logger.info(f'Uploading {upload_path}...')
        upload_blob = bucket.blob(upload_path)
        upload_blob.upload_from_filename(mbtiles_path, timeout=600)
        logger.info(f'Upload complete: {mb:.1f} MB -> {upload_path}')

        sys.exit(0)

    except Exception as e:
        logger.error(f'Tippecanoe worker failed: {e}', exc_info=True)
        sys.exit(1)

    finally:
        if os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)


def main():
    """Main entry point for compose job."""
    start_time = datetime.now(timezone.utc)

    # Read environment variables
    district_id = os.environ.get('DISTRICT_ID', '').zfill(2)
    bucket_name = os.environ.get('BUCKET_NAME', 'xnautical-8a296.firebasestorage.app')

    if not district_id or district_id == '00':
        logger.error('DISTRICT_ID environment variable not set')
        sys.exit(1)

    district_label = os.environ.get('DISTRICT_LABEL') or f'{district_id}cgd'
    district_prefix = get_district_prefix(district_label)

    logger.info(f'=== Starting compose job for {district_label} (prefix: {district_prefix}) ===')
    logger.info(f'Bucket: {bucket_name}')

    # Initialize clients
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    db = firestore.Client()

    # Create working directory
    work_dir = tempfile.mkdtemp(prefix=f'enc_compose_{district_label}_')
    geojson_dir = os.path.join(work_dir, 'geojson')
    output_dir = os.path.join(work_dir, 'output')
    os.makedirs(geojson_dir)
    os.makedirs(output_dir)

    try:
        # ─── Download all per-chart GeoJSON from cache ───
        logger.info('Downloading per-chart GeoJSON from chart-geojson cache...')
        download_start = datetime.now(timezone.utc)

        cache_prefix = f'{district_label}/chart-geojson/'

        # Read manifest to filter valid chart IDs (prevents stale cache inclusion)
        valid_chart_ids = None
        manifest_blob = bucket.blob(f'{cache_prefix}_manifest.json')
        try:
            if manifest_blob.exists():
                manifest_data = json.loads(manifest_blob.download_as_text())
                valid_chart_ids = set(manifest_data.get('chartIds', []))
                logger.info(f'  Manifest: {len(valid_chart_ids)} valid chart IDs')
            else:
                logger.warning('  No _manifest.json found, processing all cached GeoJSON')
        except Exception as e:
            logger.warning(f'  Failed to read _manifest.json: {e}, processing all cached GeoJSON')

        blobs = list(bucket.list_blobs(prefix=cache_prefix))

        # Filter for .geojson and .sector-lights.json files, apply manifest filtering
        geojson_blobs = []
        sector_lights_blobs = []
        for b in blobs:
            # Extract chart ID from path: {district}/chart-geojson/{chartId}/{filename}
            parts = b.name[len(cache_prefix):].split('/')
            if len(parts) < 2:
                continue
            chart_id = parts[0]
            if valid_chart_ids is not None and chart_id not in valid_chart_ids:
                continue
            if b.name.endswith('.geojson'):
                geojson_blobs.append((b, f'{chart_id}.geojson'))
            elif b.name.endswith('.sector-lights.json'):
                sector_lights_blobs.append((b, f'{chart_id}.sector-lights.json'))

        logger.info(f'Found {len(geojson_blobs)} GeoJSON files in chart-geojson cache')

        if not geojson_blobs:
            logger.error('No GeoJSON files found in chart-geojson cache')
            sys.exit(1)

        # Download in parallel
        def _download_blob(args):
            blob, filename = args
            local_path = os.path.join(geojson_dir, filename)
            blob.download_to_filename(local_path)
            return local_path

        download_workers = min(16, len(geojson_blobs))
        local_paths = []
        with ThreadPoolExecutor(max_workers=download_workers) as pool:
            local_paths = list(pool.map(_download_blob, geojson_blobs))

        download_duration = (datetime.now(timezone.utc) - download_start).total_seconds()
        total_size = sum(os.path.getsize(p) for p in local_paths) / 1024 / 1024
        logger.info(f'Downloaded {len(geojson_blobs)} files ({total_size:.1f} MB) '
                   f'in {download_duration:.1f}s')

        # ─── Download and aggregate sector-lights sidecar files ───
        all_sector_lights = []
        if sector_lights_blobs:
            logger.info(f'Downloading {len(sector_lights_blobs)} sector-lights sidecar files...')
            sector_dir = os.path.join(work_dir, 'sector-lights')
            os.makedirs(sector_dir, exist_ok=True)

            def _download_sector_blob(args):
                blob, filename = args
                local_path = os.path.join(sector_dir, filename)
                blob.download_to_filename(local_path)
                return local_path

            sl_workers = min(16, len(sector_lights_blobs))
            sl_paths = []
            with ThreadPoolExecutor(max_workers=sl_workers) as pool:
                sl_paths = list(pool.map(_download_sector_blob, sector_lights_blobs))

            # Aggregate all per-chart sector lights into a single list
            for sl_path in sl_paths:
                try:
                    with open(sl_path, 'r') as f:
                        lights = json.load(f)
                    if isinstance(lights, list):
                        all_sector_lights.extend(lights)
                except Exception as e:
                    logger.warning(f'Failed to load sector-lights: {sl_path}: {e}')

            logger.info(f'Aggregated {len(all_sector_lights)} sector lights from '
                       f'{len(sector_lights_blobs)} charts')

        # ─── Load all charts in parallel ───
        logger.info('Loading charts in parallel...')
        load_start = datetime.now(timezone.utc)

        sorted_paths = sorted(local_paths)
        num_charts = len(sorted_paths)

        def _load_chart(path):
            chart_id = Path(path).name.replace('.geojson', '')
            with open(path, 'r', encoding='utf-8') as f:
                collection = json.load(f)
            return chart_id, collection.get('features', [])

        with ThreadPoolExecutor(max_workers=8) as pool:
            chart_data = list(pool.map(_load_chart, sorted_paths))

        total_features_input = sum(len(feats) for _, feats in chart_data)
        features_per_chart = {cid: len(feats) for cid, feats in chart_data}
        load_duration = (datetime.now(timezone.utc) - load_start).total_seconds()
        logger.info(f'Loaded {num_charts} charts, {total_features_input:,d} features '
                   f'in {load_duration:.1f}s')

        # ─── Build dedup index (from cached data) ───
        logger.info('Building dedup index...')
        dedup_start = datetime.now(timezone.utc)

        dedup_index = {}
        key_scales = defaultdict(set)

        for chart_id, features in chart_data:
            for idx, feature in enumerate(features):
                props = feature.get('properties', {})
                objl = props.get('OBJL', 0)
                scale_num = props.get('_scaleNum', 0)

                if objl in ALL_DEDUP_OBJLS:
                    key = dedup_key(feature)
                    key_scales[key].add(scale_num)

                    existing = dedup_index.get(key)
                    if existing is None or existing[2] < scale_num:
                        dedup_index[key] = (chart_id, idx, scale_num)

        dedup_duration = (datetime.now(timezone.utc) - dedup_start).total_seconds()
        logger.info(f'Dedup index: {len(dedup_index):,d} unique keys in {dedup_duration:.1f}s')

        # ─── Write per-scale GeoJSON (from cached data, no re-read) ───
        logger.info('Writing per-scale deduplicated GeoJSON...')
        write_start = datetime.now(timezone.utc)

        total_features_output = 0
        duplicates_removed = 0
        dedup_by_category = {'physicalObjects': 0, 'regulatoryZones': 0, 'hydrographicFeatures': 0}
        scale_feature_counts = defaultdict(int)

        # Per-scale newline-delimited GeoJSON files. Features may be written
        # to multiple files with non-overlapping zoom slices (priority-
        # partitioned) so each scale's tippecanoe runs only its native range.
        # tile-join merges the per-scale MBTiles correctly — it concatenates
        # vector tile data at overlapping z/x/y.
        scale_geojson = {}   # sn -> file handle
        scale_paths = {}     # sn -> file path
        scale_counts = {}    # sn -> feature writes (may exceed unique features)
        for sn in SCALE_ZOOM_RANGES:
            path = os.path.join(output_dir, f'scale_{sn}.geojson')
            scale_paths[sn] = path
            scale_geojson[sn] = open(path, 'w')
            scale_counts[sn] = 0

        # Cache for zoom ownership computations (frozenset of scales → ownership dict)
        ownership_cache = {}

        for chart_idx, (chart_id, features) in enumerate(chart_data):
            for idx, feature in enumerate(features):
                props = feature.get('properties', {})
                objl = props.get('OBJL', 0)
                scale_num = props.get('_scaleNum', 0)

                # Check deduplication
                if objl in ALL_DEDUP_OBJLS:
                    key = dedup_key(feature)
                    winner = dedup_index.get(key)
                    if winner and (winner[0] != chart_id or winner[1] != idx):
                        duplicates_removed += 1
                        if objl in DEDUP_POINT_OBJLS | DEDUP_LINE_OBJLS:
                            dedup_by_category['physicalObjects'] += 1
                        elif objl in DEDUP_HYDRO_OBJLS:
                            dedup_by_category['hydrographicFeatures'] += 1
                        else:
                            dedup_by_category['regulatoryZones'] += 1
                        continue

                # Skip features with null/missing geometry (e.g. C_ASSO associations)
                geom = feature.get('geometry')
                if not geom or geom.get('type') is None:
                    continue

                # Fix layer name if present (allow 'charts' and 'arcs')
                existing_tippecanoe = feature.get('tippecanoe')
                if existing_tippecanoe:
                    layer = existing_tippecanoe.get('layer')
                    if layer and layer not in ('charts', 'arcs'):
                        existing_tippecanoe['layer'] = 'charts'

                native_lo, native_hi = SCALE_ZOOM_RANGES.get(scale_num, (0, 15))

                # Determine if feature needs priority-partitioned zoom slicing.
                # Two cases trigger partitioning:
                # 1. Dedup winner existing in multiple scales (zoom union)
                # 2. Pre-existing tippecanoe extending beyond native range (nav aids)
                partition_scales = None

                if objl in ALL_DEDUP_OBJLS and not existing_tippecanoe:
                    key = dedup_key(feature)
                    all_scales = key_scales.get(key, {scale_num})
                    if len(all_scales) > 1:
                        partition_scales = all_scales

                if existing_tippecanoe and partition_scales is None:
                    feat_minz = existing_tippecanoe.get('minzoom', native_lo)
                    feat_maxz = existing_tippecanoe.get('maxzoom', native_hi)
                    if feat_minz < native_lo or feat_maxz > native_hi:
                        # Pre-existing tippecanoe extends beyond native range —
                        # find all scales whose native range overlaps the desired range
                        all_scales = set()
                        for sn_candidate, (lo, hi) in SCALE_ZOOM_RANGES.items():
                            if lo <= feat_maxz and hi >= feat_minz:
                                all_scales.add(sn_candidate)
                        if len(all_scales) > 1:
                            partition_scales = all_scales

                if partition_scales is not None and len(partition_scales) > 1:
                    # Compute zoom ownership (cached by scale set)
                    cache_key = frozenset(partition_scales)
                    if cache_key not in ownership_cache:
                        ownership_cache[cache_key] = compute_zoom_ownership(partition_scales)
                    ownership = ownership_cache[cache_key]

                    # Determine desired full zoom range
                    if existing_tippecanoe:
                        desired_minz = existing_tippecanoe.get('minzoom', native_lo)
                        desired_maxz = existing_tippecanoe.get('maxzoom', native_hi)
                    else:
                        # Dedup case: union of all scales' native ranges
                        desired_minz = min(SCALE_ZOOM_RANGES.get(s, (0, 15))[0] for s in partition_scales)
                        desired_maxz = max(SCALE_ZOOM_RANGES.get(s, (0, 15))[1] for s in partition_scales)

                    # Write a copy to each owning scale's file with its zoom slice
                    for sn, (oz_min, oz_max) in ownership.items():
                        clamped_min = max(oz_min, desired_minz)
                        clamped_max = min(oz_max, desired_maxz)
                        if clamped_min > clamped_max:
                            continue
                        if sn not in scale_geojson:
                            continue

                        feature_copy = dict(feature)
                        orig_layer = (existing_tippecanoe or {}).get('layer', 'charts')
                        feature_copy['tippecanoe'] = {
                            'minzoom': clamped_min,
                            'maxzoom': clamped_max,
                            'layer': orig_layer,
                        }
                        json.dump(feature_copy, scale_geojson[sn], separators=(',', ':'))
                        scale_geojson[sn].write('\n')
                        scale_counts[sn] += 1

                    scale_feature_counts[scale_num] += 1
                    total_features_output += 1
                else:
                    # Single-scale feature: write to native scale with native zoom range
                    if not existing_tippecanoe:
                        feature['tippecanoe'] = {
                            'minzoom': native_lo,
                            'maxzoom': native_hi,
                            'layer': 'charts',
                        }
                    elif 'layer' not in existing_tippecanoe:
                        existing_tippecanoe['layer'] = 'charts'

                    sn = scale_num if scale_num in scale_geojson else 1
                    json.dump(feature, scale_geojson[sn], separators=(',', ':'))
                    scale_geojson[sn].write('\n')
                    scale_counts[sn] += 1
                    scale_feature_counts[scale_num] += 1
                    total_features_output += 1

            if (chart_idx + 1) % 100 == 0 or chart_idx + 1 == num_charts:
                elapsed = (datetime.now(timezone.utc) - write_start).total_seconds()
                logger.info(f'  Write: {chart_idx + 1}/{num_charts} charts, '
                           f'{total_features_output:,d} written, '
                           f'{duplicates_removed:,d} dupes removed ({elapsed:.0f}s)')
                sys.stdout.flush()

        for f in scale_geojson.values():
            f.close()

        # Free cached chart data before tippecanoe
        del chart_data

        write_duration = (datetime.now(timezone.utc) - write_start).total_seconds()
        for sn in sorted(scale_counts):
            if scale_counts[sn] > 0:
                native_lo, native_hi = SCALE_ZOOM_RANGES[sn]
                sz = os.path.getsize(scale_paths[sn]) / 1024 / 1024
                logger.info(f'  US{sn}: {scale_counts[sn]:,d} features, '
                           f'{sz:.1f} MB, z{native_lo}-{native_hi}')
        logger.info(f'GeoJSON write complete: {total_features_output:,d} features '
                   f'({duplicates_removed:,d} duplicates removed) in {write_duration:.1f}s')

        # ─── Tippecanoe: zoom-band fan-out to parallel Cloud Run Job executions ───
        # Each scale's GeoJSON is uploaded once. For high-zoom scales (maxzoom > 14),
        # multiple workers each handle a different zoom band (-Z/-z). This avoids the
        # output bloat of feature-partitioning (where each partition redundantly
        # generates tiles across the full zoom pyramid). tile-join merges the
        # disjoint zoom bands into the final unified.mbtiles.
        #
        # Zoom band strategy:
        #   - Scales with maxzoom <= 14: single worker (fast, small output)
        #   - Scales with maxzoom > 14: one worker for z_lo..14, then one per zoom 15..maxzoom
        #     z15 is the max zoom level — gets its own worker for parallelism.

        active_scales = [sn for sn in sorted(scale_counts) if scale_counts[sn] > 0]

        # Build worker tasks: [(scale_num, zoom_lo, zoom_hi), ...]
        worker_tasks = []
        for sn in active_scales:
            native_lo, native_hi = SCALE_ZOOM_RANGES[sn]

            if native_hi <= 14:
                # Low-zoom scale: single worker handles the full range
                worker_tasks.append((sn, native_lo, native_hi))
            else:
                # High-zoom scale: split into zoom bands
                # Band 1: native_lo .. 14 (grouped low zooms, relatively fast)
                if native_lo <= 14:
                    worker_tasks.append((sn, native_lo, 14))
                # Individual bands for each high zoom level (15)
                for z in range(max(15, native_lo), native_hi + 1):
                    worker_tasks.append((sn, z, z))

        logger.info(f'Fan-out: {len(worker_tasks)} tippecanoe workers to launch')
        for sn in active_scales:
            native_lo, native_hi = SCALE_ZOOM_RANGES[sn]
            bands = [(zlo, zhi) for s, zlo, zhi in worker_tasks if s == sn]
            band_strs = [f'z{zlo}-{zhi}' if zlo != zhi else f'z{zlo}' for zlo, zhi in bands]
            logger.info(f'  US{sn}: {scale_counts[sn]:,d} features, '
                       f'{len(bands)} worker{"s" if len(bands) > 1 else ""}: {", ".join(band_strs)}')
        tippecanoe_start = datetime.now(timezone.utc)

        compose_prefix = f'{district_label}/charts/temp/compose/'

        # (a) Clean stale compose artifacts from Cloud Storage
        logger.info('Cleaning stale compose artifacts from Cloud Storage...')
        stale_blobs = list(bucket.list_blobs(prefix=compose_prefix))
        for b in stale_blobs:
            try:
                b.delete()
            except Exception:
                pass
        if stale_blobs:
            logger.info(f'  Deleted {len(stale_blobs)} stale artifacts')

        # (b) Upload one GeoJSON per scale to Cloud Storage (all zoom-band workers
        #     for the same scale download the same file)
        logger.info(f'Uploading {len(active_scales)} GeoJSON files to Cloud Storage...')
        upload_geojson_start = datetime.now(timezone.utc)

        def _upload_geojson(sn):
            blob_path = f'{compose_prefix}scale_{sn}.geojson'
            blob = bucket.blob(blob_path)
            blob.upload_from_filename(scale_paths[sn], timeout=600)
            sz = os.path.getsize(scale_paths[sn]) / 1024 / 1024
            logger.info(f'  Uploaded scale_{sn}.geojson: {sz:.1f} MB')
            os.remove(scale_paths[sn])

        with ThreadPoolExecutor(max_workers=min(16, len(active_scales))) as pool:
            list(pool.map(_upload_geojson, active_scales))

        upload_geojson_duration = (datetime.now(timezone.utc) - upload_geojson_start).total_seconds()
        logger.info(f'GeoJSON upload complete in {upload_geojson_duration:.1f}s')

        # (c) Launch Cloud Run Job executions (one per zoom band)
        from google.cloud import run_v2
        from google.protobuf import duration_pb2

        project_id = os.environ.get('GCP_PROJECT', 'xnautical-8a296')
        gcp_region = 'us-central1'
        job_name = 'enc-converter-merge'
        job_path = f'projects/{project_id}/locations/{gcp_region}/jobs/{job_name}'
        jobs_client = run_v2.JobsClient()

        logger.info(f'Launching {len(worker_tasks)} tippecanoe worker jobs...')
        for sn, z_lo, z_hi in worker_tasks:
            native_lo, native_hi = SCALE_ZOOM_RANGES[sn]

            # Generous timeout: z18 alone can take 40+ min, lower zooms are fast
            timeout_duration = duration_pb2.Duration()
            timeout_duration.seconds = 7200  # 2 hours

            run_request = run_v2.RunJobRequest(
                name=job_path,
                overrides=run_v2.RunJobRequest.Overrides(
                    container_overrides=[
                        run_v2.RunJobRequest.Overrides.ContainerOverride(
                            env=[
                                run_v2.EnvVar(name='JOB_TYPE', value='tippecanoe'),
                                run_v2.EnvVar(name='SCALE_NUM', value=str(sn)),
                                run_v2.EnvVar(name='DISTRICT_LABEL', value=district_label),
                                run_v2.EnvVar(name='BUCKET_NAME', value=bucket_name),
                                run_v2.EnvVar(name='ZOOM_MIN', value=str(z_lo)),
                                run_v2.EnvVar(name='ZOOM_MAX', value=str(z_hi)),
                            ],
                        )
                    ],
                    task_count=1,
                    timeout=timeout_duration,
                ),
            )

            try:
                jobs_client.run_job(request=run_request)
                zoom_label = f'z{z_lo}-{z_hi}' if z_lo != z_hi else f'z{z_lo}'
                logger.info(f'  Launched US{sn} {zoom_label}')
            except Exception as e:
                logger.error(f'  Failed to launch US{sn} z{z_lo}-{z_hi}: {e}')
                sys.exit(1)

        # (d) Poll, download, and incrementally tile-join as workers complete.
        #     We can't download all mbtiles at once — total output can be 40+ GB
        #     which exceeds the 32 Gi tmpfs. Instead, we download each file as it
        #     completes, tile-join it into a running merged.mbtiles, then delete
        #     the input. At most 2 large files exist on disk at any time.
        expected_blobs = {}
        for sn, z_lo, z_hi in worker_tasks:
            native_lo, native_hi = SCALE_ZOOM_RANGES[sn]
            if z_lo == native_lo and z_hi == native_hi:
                mbtiles_name = f'scale_{sn}.mbtiles'
            else:
                mbtiles_name = f'scale_{sn}_z{z_lo}-{z_hi}.mbtiles'
            expected_blobs[mbtiles_name] = f'{compose_prefix}{mbtiles_name}'

        logger.info(f'Polling for {len(expected_blobs)} .mbtiles files (incremental tile-join)...')
        poll_interval = 15  # seconds
        log_interval = 60  # log progress every 60s
        max_wait = 5400  # 90 minutes
        elapsed = 0
        last_log = 0
        detected = set()    # blobs detected in storage
        merged = set()      # blobs downloaded and merged
        merged_path = os.path.join(output_dir, 'merged.mbtiles')
        merge_count = 0

        while len(merged) < len(expected_blobs) and elapsed < max_wait:
            time.sleep(poll_interval)
            elapsed += poll_interval

            # Detect newly completed workers
            for key, blob_path in expected_blobs.items():
                if key in detected:
                    continue
                blob = bucket.blob(blob_path)
                if blob.exists():
                    blob.reload()
                    mb = (blob.size or 0) / 1024 / 1024
                    logger.info(f'  {key} ready: {mb:.1f} MB ({elapsed}s)')
                    detected.add(key)

            # Download and merge any detected-but-not-yet-merged files one at a time
            for key in sorted(detected - merged):
                blob_path = expected_blobs[key]
                local_path = os.path.join(output_dir, key)

                # Download
                logger.info(f'  Downloading {key}...')
                bucket.blob(blob_path).download_to_filename(local_path)
                sz = os.path.getsize(local_path) / 1024 / 1024
                logger.info(f'  Downloaded {key}: {sz:.1f} MB')

                # Incremental tile-join
                merge_count += 1
                if not os.path.exists(merged_path):
                    # First file — just rename it as the merged base
                    os.rename(local_path, merged_path)
                    logger.info(f'  Merge {merge_count}/{len(expected_blobs)}: '
                               f'{key} -> base ({sz:.1f} MB)')
                else:
                    # tile-join merged + new -> temp, then swap
                    temp_path = os.path.join(output_dir, 'merged_tmp.mbtiles')
                    join_cmd = [
                        'tile-join',
                        '-o', temp_path,
                        '--force',
                        '--no-tile-size-limit',
                        merged_path,
                        local_path,
                    ]
                    logger.info(f'  Merge {merge_count}/{len(expected_blobs)}: '
                               f'tile-join {key} into merged...')
                    join_proc = subprocess.Popen(
                        join_cmd, stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE, text=True)
                    _, join_stderr = join_proc.communicate()
                    if join_proc.returncode != 0:
                        logger.error(f'tile-join failed: {join_stderr}')
                        sys.exit(1)

                    # Delete inputs, swap temp to merged
                    os.remove(local_path)
                    os.remove(merged_path)
                    os.rename(temp_path, merged_path)
                    merged_sz = os.path.getsize(merged_path) / 1024 / 1024
                    logger.info(f'  Merged: {merged_sz:.1f} MB total')

                merged.add(key)

            if elapsed - last_log >= log_interval:
                remaining = len(expected_blobs) - len(detected)
                logger.info(f'  Progress: {len(merged)}/{len(expected_blobs)} merged, '
                           f'{len(detected) - len(merged)} pending merge, '
                           f'{remaining} workers still running ({elapsed}s)')
                last_log = elapsed

        if len(merged) < len(expected_blobs):
            missing = sorted(k for k in expected_blobs if k not in detected)
            logger.error(f'Timeout after {max_wait}s waiting for {len(missing)} workers: '
                        f'{", ".join(missing[:10])}')
            sys.exit(1)

        logger.info(f'All {len(expected_blobs)} tippecanoe workers merged in {elapsed}s')

        output_mbtiles = merged_path
        tippecanoe_duration = (datetime.now(timezone.utc) - tippecanoe_start).total_seconds()
        mbtiles_size = os.path.getsize(output_mbtiles) / 1024 / 1024
        logger.info(f'Unified MBTiles complete: {mbtiles_size:.1f} MB in {tippecanoe_duration:.1f}s')

        # ─── Upload unified MBTiles (raw + zip in parallel) ───
        logger.info('Uploading unified MBTiles...')
        upload_start = datetime.now(timezone.utc)

        raw_storage_path = f'{district_label}/charts/{district_prefix}_charts.mbtiles'
        zip_path = os.path.join(output_dir, f'{district_prefix}_charts.mbtiles.zip')
        zip_storage_path = f'{district_label}/charts/{district_prefix}_charts.mbtiles.zip'

        def _upload_raw():
            blob = bucket.blob(raw_storage_path)
            blob.upload_from_filename(output_mbtiles, timeout=600)
            logger.info(f'  Uploaded raw: {mbtiles_size:.1f} MB -> {raw_storage_path}')

        def _upload_zip():
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                zf.write(output_mbtiles, f'{district_prefix}_charts.mbtiles')
            zip_blob = bucket.blob(zip_storage_path)
            zip_blob.upload_from_filename(zip_path, timeout=600)
            sz = os.path.getsize(zip_path) / 1024 / 1024
            logger.info(f'  Uploaded zip: {sz:.1f} MB -> {zip_storage_path}')

        with ThreadPoolExecutor(max_workers=2) as pool:
            raw_future = pool.submit(_upload_raw)
            zip_future = pool.submit(_upload_zip)
            raw_future.result()
            zip_future.result()

        zip_size = os.path.getsize(zip_path) / 1024 / 1024
        upload_duration = (datetime.now(timezone.utc) - upload_start).total_seconds()

        # ─── Upload unified sector-lights.json ───
        sector_lights_count = 0
        if all_sector_lights:
            sl_output_path = os.path.join(output_dir, 'sector-lights.json')
            with open(sl_output_path, 'w') as f:
                json.dump(all_sector_lights, f)
            sl_storage_path = f'{district_label}/charts/sector-lights.json'
            sl_blob = bucket.blob(sl_storage_path)
            sl_blob.upload_from_filename(sl_output_path, timeout=120)
            sector_lights_count = len(all_sector_lights)
            sl_size_kb = os.path.getsize(sl_output_path) / 1024
            logger.info(f'Uploaded sector-lights.json: {sector_lights_count} lights '
                       f'({sl_size_kb:.1f} KB) -> {sl_storage_path}')

        # Read bounds from MBTiles metadata
        bounds = None
        try:
            conn = sqlite3.connect(output_mbtiles)
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM metadata WHERE name='bounds'")
            row = cursor.fetchone()
            if row:
                b = [float(x) for x in row[0].split(',')]
                bounds = {'west': b[0], 'south': b[1], 'east': b[2], 'north': b[3]}
            conn.close()
            logger.info(f'  Bounds: {bounds}')
        except Exception as e:
            logger.warning(f'Could not read MBTiles bounds: {e}')

        # Compute checksum
        md5_checksum = compute_md5(Path(output_mbtiles))

        total_duration = (datetime.now(timezone.utc) - start_time).total_seconds()

        # ─── Write results to Firestore ───
        dedup_stats = {
            'totalFeaturesInput': total_features_input,
            'totalFeaturesOutput': total_features_output,
            'duplicatesRemoved': duplicates_removed,
            'byCategory': dedup_by_category,
        }

        chart_data = {
            'composedAt': firestore.SERVER_TIMESTAMP,
            'totalCharts': len(features_per_chart),
            'totalSizeMB': round(mbtiles_size, 2),
            'zipSizeMB': round(zip_size, 2),
            'unifiedStoragePath': raw_storage_path,
            'zipStoragePath': zip_storage_path,
            'md5Checksum': md5_checksum,
            'minZoom': 0,
            'maxZoom': 15,
            'dedupStats': dedup_stats,
            'durationSeconds': round(total_duration, 1),
        }
        if bounds:
            chart_data['bounds'] = bounds
        if sector_lights_count > 0:
            chart_data['sectorLightsCount'] = sector_lights_count
            chart_data['sectorLightsPath'] = f'{district_label}/charts/sector-lights.json'

        doc_ref = db.collection('districts').document(district_label)
        doc_ref.set({'chartData': chart_data}, merge=True)

        logger.info(f'=== Compose job complete: {len(features_per_chart)} charts, '
                   f'{total_features_output} features ({duplicates_removed} deduped), '
                   f'{mbtiles_size:.1f} MB, {total_duration:.1f}s ===')
        logger.info(f'  Phases: download={download_duration:.0f}s, '
                   f'load={load_duration:.0f}s, dedup={dedup_duration:.0f}s, '
                   f'write={write_duration:.0f}s, tippecanoe={tippecanoe_duration:.0f}s, '
                   f'upload={upload_duration:.0f}s')

        # ─── Trigger metadata regeneration ───
        # Regenerate download-metadata.json so the app sees the correct file sizes
        metadata_url = os.environ.get('METADATA_GENERATOR_URL', '')
        if metadata_url:
            logger.info('Triggering metadata regeneration...')
            try:
                import requests as req_lib
                resp = req_lib.post(
                    f'{metadata_url.rstrip("/")}/generateMetadata',
                    json={'districtId': district_label},
                    timeout=120,
                    headers={'Content-Type': 'application/json'},
                )
                if resp.status_code == 200:
                    meta_result = resp.json()
                    logger.info(f'  Metadata regenerated: {meta_result.get("totalSizeGB", "?")} GB, '
                               f'{meta_result.get("packCount", "?")} packs')
                else:
                    logger.warning(f'  Metadata regeneration failed: HTTP {resp.status_code} - {resp.text[:200]}')
            except Exception as e:
                logger.warning(f'  Metadata regeneration failed: {e}')
        else:
            logger.info('METADATA_GENERATOR_URL not set, skipping metadata regeneration')

        # Output JSON result for job logs
        result_output = {
            'status': 'success',
            'district': district_label,
            'totalCharts': len(features_per_chart),
            'totalFeaturesInput': total_features_input,
            'totalFeaturesOutput': total_features_output,
            'duplicatesRemoved': duplicates_removed,
            'sizeMB': round(mbtiles_size, 2),
            'durationSeconds': round(total_duration, 1),
            'completedAt': datetime.now(timezone.utc).isoformat(),
        }
        print(json.dumps(result_output, indent=2))

        # Clean up temp storage (tippecanoe fan-out artifacts)
        logger.info('Cleaning up temp storage...')
        temp_prefix = f'{district_label}/charts/temp/'
        temp_blobs = list(bucket.list_blobs(prefix=temp_prefix))
        deleted_count = 0
        for temp_blob in temp_blobs:
            try:
                temp_blob.delete()
                deleted_count += 1
            except Exception:
                pass  # Already deleted or doesn't exist
        logger.info(f'  Deleted {deleted_count}/{len(temp_blobs)} temp files')

        # Delete _manifest.json (transient, only needed for this compose run)
        # Do NOT delete chart-geojson/*.geojson — that's the persistent cache
        try:
            manifest_blob = bucket.blob(f'{district_label}/chart-geojson/_manifest.json')
            manifest_blob.delete()
            logger.info('  Deleted _manifest.json')
        except Exception:
            pass

        sys.exit(0)

    except Exception as e:
        logger.error(f'Error in compose job: {e}', exc_info=True)
        sys.exit(1)

    finally:
        # Clean up working directory
        if os.path.exists(work_dir):
            logger.info(f'Cleaning up working directory: {work_dir}')
            shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == '__main__':
    main()
