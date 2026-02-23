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

from osgeo import ogr
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
# These define the TILE GENERATION range (tippecanoe -Z/-z) per scale.
# Individual feature visibility within this range is controlled by per-feature
# tippecanoe.minzoom derived from S-57 SCAMIN values.
SCALE_ZOOM_RANGES = {
    1: (0, 8),
    2: (0, 10),
    3: (4, 13),
    4: (6, 15),
    5: (6, 15),
    6: (6, 15),
}

# SCAMIN offset for converting S-57 SCAMIN to tippecanoe minzoom.
# 2 = generates tiles 2 zooms earlier than chartDetail=medium threshold,
# providing headroom for chartDetail=ultra (offset=2) to actually work.
SCAMIN_HEADROOM = 2

# S-57 Group 1 "skin of earth" features + depth contours — SCAMIN must NOT
# restrict their visibility. Group 1 features define the fundamental land/water
# boundary; DEPCNT is included because depth contours are safety-critical and
# should be visible whenever the scale band's tiles exist (matching how
# commercial chart plotters always show contours for situational awareness).
# These always use the scale band's native zoom range, never SCAMIN-derived minzoom.
SKIN_OF_EARTH_OBJLS = {30, 42, 43, 69, 71}  # COALNE, DEPARE, DEPCNT, LAKARE, LNDARE


def scamin_to_minzoom(scamin_val, native_lo: int) -> int:
    """Convert S-57 SCAMIN to a tippecanoe minzoom level.

    Uses the same formula as the app: zoom = 28 - log2(SCAMIN) - offset.
    Falls back to native_lo if SCAMIN is missing or invalid.
    """
    if not scamin_val:
        return native_lo
    try:
        scamin = float(scamin_val)
        if scamin <= 0:
            return native_lo
        z = 28 - SCAMIN_HEADROOM - math.log2(scamin)
        return max(native_lo, round(z))
    except (ValueError, TypeError):
        return native_lo

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
    30,   # COALNE — coastline
    71,   # LNDARE — land areas
    129,  # SOUNDG — depth soundings (cross-scale dedup, uses 5-decimal precision)
}

# All OBJL codes that should be deduplicated
ALL_DEDUP_OBJLS = DEDUP_POINT_OBJLS | DEDUP_LINE_OBJLS | DEDUP_ZONE_OBJLS | DEDUP_HYDRO_OBJLS

# All Point geometry features are extracted to a standalone points.mbtiles file.
# Only Point geometry instances are extracted — Line/Polygon instances of the same
# OBJL (e.g. MORFAC, HULKES, PONTON) stay in per-scale tiles.
# MBTiles (memory-mapped SQLite) replaces the old nav-aids.json GeoJSON sidecar
# which caused OOM on mobile when parsed into JS objects.

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


# ── Pipeline validation gates ────────────────────────────────────────────────

def validate_geojson_downloads(local_paths, logger):
    """Validate downloaded GeoJSON files are non-empty and structurally complete."""
    valid = []
    problems = []
    for p in local_paths:
        chart_id = Path(p).name.replace('.geojson', '')
        size = os.path.getsize(p)
        if size == 0:
            problems.append({'chartId': chart_id, 'reason': 'empty (0 bytes)'})
            continue
        with open(p, 'rb') as f:
            first = f.read(1)
            f.seek(-1, 2)
            last = f.read(1)
            if last == b'\n':
                f.seek(-2, 2)
                last = f.read(1)
        if first != b'{' or last != b'}':
            problems.append({'chartId': chart_id,
                           'reason': f'bookend check failed ({first!r}...{last!r})'})
            continue
        valid.append(p)
    return valid, problems


def validate_mbtiles(path, context, logger):
    """Validate .mbtiles is a valid SQLite database with tiles. Returns error or None."""
    size = os.path.getsize(path)
    if size == 0:
        return f'{context}: file is 0 bytes'
    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {r[0] for r in cur.fetchall()}
        if 'tiles' not in tables:
            conn.close()
            return f'{context}: missing tiles table (found: {tables})'
        if 'metadata' not in tables:
            conn.close()
            return f'{context}: missing metadata table'
        cur.execute("SELECT COUNT(*) FROM tiles")
        tile_count = cur.fetchone()[0]
        conn.close()
        if tile_count == 0:
            return f'{context}: tiles table is empty'
        logger.info(f'  Validated {context}: {size / 1024 / 1024:.1f} MB, {tile_count:,d} tiles')
        return None
    except sqlite3.DatabaseError as e:
        return f'{context}: corrupt SQLite: {e}'


def validate_merged_mbtiles(path, expected_charts, logger):
    """Extended validation for the final merged .mbtiles."""
    error = validate_mbtiles(path, 'merged output', logger)
    if error:
        return error
    size_mb = os.path.getsize(path) / 1024 / 1024
    if size_mb < 1.0:
        return f'merged output suspiciously small: {size_mb:.2f} MB for {expected_charts} charts'
    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        cur.execute("SELECT MIN(zoom_level), MAX(zoom_level), COUNT(DISTINCT zoom_level) FROM tiles")
        z_min, z_max, z_count = cur.fetchone()
        conn.close()
        logger.info(f'  Merged: {size_mb:.1f} MB, zoom {z_min}-{z_max} ({z_count} levels)')
        return None
    except sqlite3.DatabaseError as e:
        return f'merged output zoom check failed: {e}'


def validate_upload(bucket, storage_path, expected_size, label, logger):
    """Verify uploaded blob exists with expected size. Returns error or None."""
    blob = bucket.blob(storage_path)
    if not blob.exists():
        return f'{label}: blob missing at {storage_path}'
    blob.reload()
    actual = blob.size or 0
    if actual == 0:
        return f'{label}: blob is 0 bytes at {storage_path}'
    if actual != expected_size:
        return (f'{label}: size mismatch at {storage_path}: '
                f'expected {expected_size:,d}, got {actual:,d}')
    logger.info(f'  Verified {label}: {actual / 1024 / 1024:.1f} MB at {storage_path}')
    return None


# ── End validation gates ─────────────────────────────────────────────────────

def dedup_key(feature: dict) -> str:
    """Generate a deduplication key for a feature.

    Precision strategy — dedup needs to be coarser than storage (7 decimals)
    to catch the same feature appearing across chart scales with slightly
    different coordinates (different surveys/generalization shift by meters).

    Named features (OBJNAM): OBJL + name already identifies the feature,
      so coordinates use 4 decimals (~11m at equator, ~5.5m at 60°N) to
      catch cross-scale duplicates even when coords differ by several meters.
    Unnamed points: 5 decimals (~1.1m at equator, ~0.55m at 60°N) balances
      catching duplicates vs preserving distinct nearby features.
    Soundings (OBJL 129): 5 decimals (~1.1m) matches survey resolution.
    Lines/Polygons: 5 decimals for coordinate hashing.
    """
    props = feature.get('properties', {})
    objl = props.get('OBJL', 0)
    objnam = props.get('OBJNAM')
    geom = feature.get('geometry') or {}
    geom_type = geom.get('type', '')

    if geom_type == 'Point':
        coords = geom.get('coordinates', [0, 0])
        # LIGHTS: include sector bearings + colour to preserve multi-sector lights
        # at the same coordinate (S-57 encodes each sector as a separate feature)
        if objl == 75:
            sectr1 = props.get('SECTR1', '')
            sectr2 = props.get('SECTR2', '')
            colour = props.get('COLOUR', '')
            lon = round(coords[0], 5)
            lat = round(coords[1], 5)
            return f"{objl}:{lon}:{lat}:{sectr1}:{sectr2}:{colour}"
        if objnam:
            # Named features: name + OBJL is strong identity, use looser coords
            lon = round(coords[0], 4)
            lat = round(coords[1], 4)
            return f"{objl}:{objnam}:{lon}:{lat}"
        else:
            # Unnamed points (including soundings): tighter precision
            lon = round(coords[0], 5)
            lat = round(coords[1], 5)
            return f"{objl}:{lon}:{lat}"

    else:
        # Lines, Polygons, MultiLineString, MultiPolygon
        coords = geom.get('coordinates', [])
        flat = _flatten_coords(coords)
        rounded = tuple((round(c[0], 5), round(c[1], 5)) for c in flat)
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


# OBJLs whose geometries should be clipped against higher-scale M_COVR coverage
# during compose (cascading: each scale clipped only against the next scale up).
# Where a higher-scale chart provides M_COVR coverage, it is the authoritative
# source for ALL features in that area. Lower-scale features must be removed to
# prevent cross-scale duplicates (e.g. same rock at different positions, same
# contour at different depths, same area with different boundaries).
# This is the S-57 intended use of M_COVR — it defines chart authority boundaries.
#

def build_coverage_index(local_paths):
    """Stream all chart GeoJSON and collect M_COVR (OBJL=302) polygons per scale.

    Returns {scale_num: OGR Geometry} where each geometry is the union of all
    M_COVR polygons for that scale.
    """
    coverage_by_scale = defaultdict(list)

    for path in local_paths:
        with open(path, 'r', encoding='utf-8') as f:
            collection = json.load(f)
        for feature in collection.get('features', []):
            props = feature.get('properties', {})
            if props.get('OBJL') != M_COVR_OBJL:
                continue
            # Only CATCOV=1 ("coverage available") defines chart authority.
            # CATCOV=2 is the chart's outer bounding box — not actual coverage.
            if str(props.get('CATCOV', '1')) != '1':
                continue
            geom = feature.get('geometry')
            if not geom or geom.get('type') is None:
                continue
            scale_num = props.get('_scaleNum', 0)
            if scale_num == 0:
                continue
            ogr_geom = ogr.CreateGeometryFromJson(json.dumps(geom))
            if ogr_geom and not ogr_geom.IsEmpty():
                coverage_by_scale[scale_num].append(ogr_geom)

    # Union all polygons per scale (with validity checks)
    coverage_union = {}
    for sn, geoms in coverage_by_scale.items():
        union = geoms[0].Clone()
        if not union.IsValid():
            union = union.MakeValid()
        for g in geoms[1:]:
            if not g.IsValid():
                g = g.MakeValid()
            union = union.Union(g)
        if not union.IsValid():
            union = union.MakeValid()
        coverage_union[sn] = union

    return coverage_union


def build_higher_scale_coverage(coverage_union):
    """For each scale N, get M_COVR from the next scale up (N+1) only.

    Cascading per-scale-pair clipping: each scale is only clipped against the
    immediately next higher scale, not the union of all higher scales. This
    prevents zoom gaps — e.g. US3 clipped by US4 (whose tiles overlap at z6),
    US4 clipped by US5 (whose tiles overlap at z6), rather than US3 clipped
    by a union of US4+US5+US6 which could remove contours at zooms where only
    the distant higher scale exists but hasn't started generating tiles yet.

    Returns {scale_num: OGR Geometry} only for scales that have a next-higher
    scale with coverage.
    """
    sorted_scales = sorted(coverage_union.keys())
    higher_coverage = {}

    for i, sn in enumerate(sorted_scales):
        # Find the next scale up that has coverage
        next_higher = [s for s in sorted_scales if s > sn]
        if not next_higher:
            continue
        higher_sn = next_higher[0]
        higher_coverage[sn] = (coverage_union[higher_sn].Clone(), higher_sn)

    return higher_coverage


class TreeMerger:
    """Merges .mbtiles files using a binary tree strategy with bounded concurrency.

    Instead of serially merging each file into a growing accumulator (O(N^2) total
    bytes processed), this pairs up the two smallest files and merges them concurrently.
    Tree depth is O(log N), and intermediate merges use --no-tile-compression to skip
    PBF gzip, saving ~40% CPU per merge. A final pass re-compresses the output.

    Peak /tmp usage: at most (max_concurrent * 2 inputs + max_concurrent outputs)
    files exist simultaneously, bounded to ~6GB for typical workloads.
    """

    def __init__(self, output_dir, max_concurrent=2):
        self.output_dir = output_dir
        self.max_concurrent = max_concurrent
        self.ready = []          # list of (size_bytes, path)
        self.merge_counter = 0
        self.lock = threading.Lock()
        self.merge_pool = ThreadPoolExecutor(max_workers=max_concurrent)
        self.active_merges = 0
        self.error = None
        self.total_added = 0
        self.total_expected = 0

    def add(self, path):
        """Add a downloaded .mbtiles file to the merge pool."""
        sz = os.path.getsize(path)
        with self.lock:
            self.ready.append((sz, path))
            self.total_added += 1
            logger.info(f'  TreeMerger: added {Path(path).name} ({sz / 1024 / 1024:.1f} MB), '
                       f'{len(self.ready)} ready, {self.active_merges} merging')
        self._try_merge_pairs()

    def _try_merge_pairs(self):
        """Greedily merge the two smallest files while capacity allows."""
        while True:
            with self.lock:
                if self.error:
                    return
                if len(self.ready) < 2 or self.active_merges >= self.max_concurrent:
                    return
                # Pick two smallest by size
                self.ready.sort()
                sz_a, path_a = self.ready.pop(0)
                sz_b, path_b = self.ready.pop(0)
                self.active_merges += 1

            logger.info(f'  TreeMerger: merging {Path(path_a).name} ({sz_a / 1024 / 1024:.1f} MB) + '
                       f'{Path(path_b).name} ({sz_b / 1024 / 1024:.1f} MB)')
            self.merge_pool.submit(self._do_merge, path_a, path_b)

    def _do_merge(self, path_a, path_b):
        """Run tile-join on two files, add result back to ready pool."""
        try:
            with self.lock:
                self.merge_counter += 1
                counter = self.merge_counter
            out_path = os.path.join(self.output_dir, f'tree_merge_{counter}.mbtiles')

            cmd = [
                'tile-join',
                '-o', out_path,
                '--force',
                '--no-tile-size-limit',
                '--no-tile-compression',
                path_a,
                path_b,
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                with self.lock:
                    self.error = f'tile-join failed: {proc.stderr[:500]}'
                    self.active_merges -= 1
                logger.error(f'  TreeMerger: {self.error}')
                return

            # Clean up inputs
            os.remove(path_a)
            os.remove(path_b)

            sz = os.path.getsize(out_path)
            with self.lock:
                self.ready.append((sz, out_path))
                self.active_merges -= 1

            logger.info(f'  TreeMerger: merge #{counter} → {sz / 1024 / 1024:.1f} MB '
                       f'({len(self.ready)} ready, {self.active_merges} merging)')

            # Try to kick off more merges
            self._try_merge_pairs()

        except Exception as e:
            with self.lock:
                self.error = str(e)
                self.active_merges -= 1
            logger.error(f'  TreeMerger: exception: {e}')

    def finish(self) -> str:
        """Block until one file remains, then run final merge with compression.

        Returns path to the final compressed .mbtiles file.
        """
        # Wait for all in-flight merges and keep triggering new ones
        while True:
            with self.lock:
                if self.error:
                    self.merge_pool.shutdown(wait=False)
                    raise RuntimeError(self.error)
                if len(self.ready) == 1 and self.active_merges == 0:
                    break
                if len(self.ready) == 0 and self.active_merges == 0:
                    raise RuntimeError('TreeMerger: no files to merge')
            # Try to kick off merges if possible
            self._try_merge_pairs()
            time.sleep(2)

        self.merge_pool.shutdown(wait=True)

        uncompressed_path = self.ready[0][1]
        final_path = os.path.join(self.output_dir, 'merged.mbtiles')

        if self.merge_counter == 0:
            # Only one file was added — no merges happened, tiles are already
            # compressed (came directly from tippecanoe worker). Just rename.
            os.rename(uncompressed_path, final_path)
            sz = os.path.getsize(final_path) / 1024 / 1024
            logger.info(f'  TreeMerger: single file, no merge needed ({sz:.1f} MB)')
        else:
            # Intermediate merges used --no-tile-compression.
            # Run a final tile-join WITH compression for the output.
            logger.info(f'  TreeMerger: final compression pass...')
            cmd = [
                'tile-join',
                '-o', final_path,
                '--force',
                '--no-tile-size-limit',
                uncompressed_path,
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                raise RuntimeError(f'Final tile-join failed: {proc.stderr[:500]}')
            os.remove(uncompressed_path)
            sz = os.path.getsize(final_path) / 1024 / 1024
            logger.info(f'  TreeMerger: final output {sz:.1f} MB')

        return final_path


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

        # Gate 3A: Validate tippecanoe output before upload
        error = validate_mbtiles(mbtiles_path, f'US{scale_num} z{z_lo}-{z_hi}', logger)
        if error:
            logger.error(f'Gate 3 FAILED: {error}')
            sys.exit(1)

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


class FeatureTracer:
    """Traces specific features through every compose pipeline decision.

    Activated by TRACE_FEATURES env var. Accepts a JSON list of matchers, e.g.:
      [{"OBJNAM": "Portland Head Light"}, {"OBJL": 75, "LNAM": "US123456"}]
    or a simple comma-separated OBJNAM list:
      "Portland Head Light,Boston Light"

    Logs every decision point: found in source, dedup result, M_COVR clip
    result, minzoom assignment, final scale file written.
    """

    def __init__(self):
        self.matchers = []
        self.log_lines = []
        raw = os.environ.get('TRACE_FEATURES', '')
        if not raw:
            return
        try:
            self.matchers = json.loads(raw)
        except json.JSONDecodeError:
            # Treat as comma-separated OBJNAM list
            self.matchers = [{'OBJNAM': name.strip()} for name in raw.split(',') if name.strip()]
        if self.matchers:
            logger.info(f'TRACE: Tracking {len(self.matchers)} feature matcher(s): {self.matchers}')

    @property
    def active(self):
        return bool(self.matchers)

    def matches(self, feature: dict) -> str | None:
        """Check if feature matches any tracer. Returns matcher description or None."""
        props = feature.get('properties', {})
        for m in self.matchers:
            if all(props.get(k) == v for k, v in m.items()):
                return str(m)
        return None

    def log(self, matcher: str, stage: str, detail: str, feature: dict = None):
        """Log a trace event."""
        coords = ''
        if feature:
            geom = feature.get('geometry') or {}
            if geom.get('type') == 'Point':
                c = geom.get('coordinates', [])
                if len(c) >= 2:
                    coords = f' @ ({c[1]:.7f}, {c[0]:.7f})'
        msg = f'TRACE [{matcher}] {stage}: {detail}{coords}'
        logger.info(msg)
        self.log_lines.append(msg)

    def summary(self):
        """Log all trace events as a summary block."""
        if not self.log_lines:
            return
        logger.info('=== FEATURE TRACE SUMMARY ===')
        for line in self.log_lines:
            logger.info(f'  {line}')
        logger.info(f'=== END TRACE ({len(self.log_lines)} events) ===')


def main():
    """Main entry point for compose job."""
    start_time = datetime.now(timezone.utc)

    # Read environment variables
    district_id = os.environ.get('DISTRICT_ID', '').zfill(2)
    bucket_name = os.environ.get('BUCKET_NAME', 'xnautical-8a296.firebasestorage.app')

    district_label = os.environ.get('DISTRICT_LABEL') or ''
    if not district_label:
        if not district_id or district_id == '00':
            logger.error('DISTRICT_ID environment variable not set')
            sys.exit(1)
        district_label = f'{district_id}cgd'
    district_prefix = get_district_prefix(district_label)

    logger.info(f'=== Starting compose job for {district_label} (prefix: {district_prefix}) ===')
    logger.info(f'Bucket: {bucket_name}')

    # Feature tracing (activated by TRACE_FEATURES env var)
    tracer = FeatureTracer()

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

        # Filter for .geojson files, apply manifest filtering
        geojson_blobs = []
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

        # Gate 2: Validate downloaded GeoJSON files
        logger.info('Gate 2: Validating downloaded GeoJSON files...')
        local_paths, download_problems = validate_geojson_downloads(local_paths, logger)
        if download_problems:
            for p in download_problems:
                logger.warning(f"  Download problem: {p['chartId']} - {p['reason']}")
        if not local_paths:
            logger.error('Gate 2 FAILED: No valid GeoJSON files after download')
            sys.exit(1)
        logger.info(f'Gate 2 passed: {len(local_paths)} files validated')

        # ─── Pass 1: Build dedup index (streaming, one chart at a time) ───
        # Instead of loading all charts into memory (~2.2GB for large districts),
        # we stream through files twice: once to build the dedup index, once to write.
        logger.info('Pass 1: Building dedup index (streaming)...')
        dedup_start = datetime.now(timezone.utc)

        sorted_paths = sorted(local_paths)
        num_charts = len(sorted_paths)

        dedup_index = {}       # key -> (chart_id, feat_idx, scale_num)
        key_scales = defaultdict(set)
        point_best_scamin = {}  # key -> best (most permissive / largest) SCAMIN for all Point features
        dedup_best_scamin = {}  # key -> best (most permissive / largest) SCAMIN across all dedup copies
        # Track tightest (smallest non-zero) SCAMIN per (scale, OBJL) for
        # visibility-aware M_COVR clipping — used to determine when the
        # higher scale's replacement feature actually becomes visible.
        scale_objl_tightest_scamin = {}
        scale_objl_exists = set()  # (scale_num, objl) pairs that exist in the data
        total_features_input = 0
        features_per_chart = {}

        for path in sorted_paths:
            chart_id = Path(path).name.replace('.geojson', '')
            with open(path, 'r', encoding='utf-8') as f:
                collection = json.load(f)
            features = collection.get('features', [])
            features_per_chart[chart_id] = len(features)
            total_features_input += len(features)

            for feat_idx, feature in enumerate(features):
                props = feature.get('properties', {})
                objl = props.get('OBJL', 0)
                scale_num = props.get('_scaleNum', 0)

                # Trace: log feature found in source
                if tracer.active:
                    tmatch = tracer.matches(feature)
                    if tmatch:
                        tracer.log(tmatch, 'FOUND', f'chart={chart_id} idx={feat_idx} OBJL={objl} US{scale_num} SCAMIN={props.get("SCAMIN")}', feature)

                # Track best SCAMIN for ALL Point features (for points.mbtiles extraction)
                geom = feature.get('geometry') or {}
                geom_type = geom.get('type', '')
                if geom_type == 'Point':
                    key = dedup_key(feature)
                    try:
                        scamin_val = float(props.get('SCAMIN', 0) or 0)
                    except (ValueError, TypeError):
                        scamin_val = 0
                    prev = point_best_scamin.get(key, 0)
                    if scamin_val > prev:
                        point_best_scamin[key] = scamin_val

                # Track tightest SCAMIN per (scale, OBJL) for non-point features
                if geom_type != 'Point' and scale_num > 0:
                    skey = (scale_num, objl)
                    scale_objl_exists.add(skey)
                    try:
                        scamin_val = float(props.get('SCAMIN', 0) or 0)
                    except (ValueError, TypeError):
                        scamin_val = 0
                    if scamin_val > 0:
                        prev = scale_objl_tightest_scamin.get(skey)
                        if prev is None or scamin_val < prev:
                            scale_objl_tightest_scamin[skey] = scamin_val

                if objl in ALL_DEDUP_OBJLS:
                    key = dedup_key(feature)
                    key_scales[key].add(scale_num)
                    # Track most permissive (largest) SCAMIN across all copies
                    try:
                        scamin_val = float(props.get('SCAMIN', 0) or 0)
                    except (ValueError, TypeError):
                        scamin_val = 0
                    if scamin_val > dedup_best_scamin.get(key, 0):
                        dedup_best_scamin[key] = scamin_val
                    existing = dedup_index.get(key)
                    if existing is None or existing[2] < scale_num:
                        if tracer.active:
                            tmatch = tracer.matches(feature)
                            if tmatch:
                                if existing:
                                    tracer.log(tmatch, 'DEDUP-REPLACE', f'replaces chart={existing[0]} idx={existing[1]} US{existing[2]} (higher scale wins)', feature)
                                else:
                                    tracer.log(tmatch, 'DEDUP-NEW', f'key={key}', feature)
                        dedup_index[key] = (chart_id, feat_idx, scale_num)

        dedup_duration = (datetime.now(timezone.utc) - dedup_start).total_seconds()
        logger.info(f'Pass 1 complete: {len(dedup_index):,d} unique dedup keys from '
                   f'{num_charts} charts, {total_features_input:,d} features '
                   f'in {dedup_duration:.1f}s')

        # ─── Build M_COVR coverage index for contour clipping ───
        logger.info('Building M_COVR coverage index for contour clipping...')
        coverage_start = datetime.now(timezone.utc)
        coverage_union = build_coverage_index(sorted_paths)
        higher_coverage = build_higher_scale_coverage(coverage_union)
        coverage_duration = (datetime.now(timezone.utc) - coverage_start).total_seconds()
        logger.info(f'M_COVR coverage: {len(coverage_union)} scales indexed, '
                   f'{len(higher_coverage)} scales have higher-scale clip masks '
                   f'({coverage_duration:.1f}s)')
        # Precompute per-scale list of higher scales for point coverage suppression
        _coverage_higher_scales = {}
        for sn in sorted(coverage_union.keys()):
            _coverage_higher_scales[sn] = sorted(s for s in coverage_union if s > sn)
            area_deg2 = coverage_union[sn].GetArea()
            has_clip = sn in higher_coverage
            logger.info(f'  US{sn}: {area_deg2:.2f} deg² coverage'
                       f'{", has clip mask" if has_clip else ""}')

        # ─── Pass 2: Write per-scale GeoJSON (streaming, one chart at a time) ───
        # Re-read each chart from disk and write deduplicated features with buffering.
        # Peak memory: one chart (~10-50MB) + dedup index + write buffers (~50MB).
        logger.info('Pass 2: Writing per-scale deduplicated GeoJSON...')
        write_start = datetime.now(timezone.utc)

        total_features_output = 0
        duplicates_removed = 0
        dedup_by_category = {'physicalObjects': 0, 'regulatoryZones': 0, 'hydrographicFeatures': 0}
        contours_clipped = 0   # fully removed by M_COVR clipping
        contours_trimmed = 0   # partially clipped by M_COVR
        points_extracted = []    # All Point features for points.mbtiles
        sector_lights_index = [] # Sector light index for points.mbtiles metadata
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

        # Buffered writes: accumulate JSON strings and flush in batches
        WRITE_BUFFER_SIZE = 2000
        write_buffers = {sn: [] for sn in SCALE_ZOOM_RANGES}

        def flush_buffer(sn):
            if write_buffers[sn]:
                scale_geojson[sn].write(''.join(write_buffers[sn]))
                write_buffers[sn] = []

        def buffer_feature(sn, feature_str):
            write_buffers[sn].append(feature_str)
            if len(write_buffers[sn]) >= WRITE_BUFFER_SIZE:
                flush_buffer(sn)

        for chart_idx, path in enumerate(sorted_paths):
            chart_id = Path(path).name.replace('.geojson', '')
            with open(path, 'r', encoding='utf-8') as f:
                collection = json.load(f)
            features = collection.get('features', [])

            for idx, feature in enumerate(features):
                props = feature.get('properties', {})
                objl = props.get('OBJL', 0)
                scale_num = props.get('_scaleNum', 0)

                # Check deduplication
                if objl in ALL_DEDUP_OBJLS:
                    key = dedup_key(feature)
                    winner = dedup_index.get(key)
                    if winner and (winner[0] != chart_id or winner[1] != idx):
                        if tracer.active:
                            tmatch = tracer.matches(feature)
                            if tmatch:
                                tracer.log(tmatch, 'DEDUP-SKIP', f'chart={chart_id} lost to winner chart={winner[0]} US{winner[2]} key={key}', feature)
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

                # ── Point extraction: divert ALL Point features to points.mbtiles ──
                # Every Point geometry goes to points.mbtiles (separate VectorSource).
                # No dedup — all scale copies are emitted with their own _scaleNum.
                # The app uses coverage metadata + _scaleNum to decide which copy
                # to display at each zoom/location (ECDIS usage band rules).
                # Line/Polygon instances of the same OBJL stay in per-scale tiles.
                geom_type = geom.get('type', '')
                if geom_type == 'Point':
                    key = dedup_key(feature)
                    best_scamin = point_best_scamin.get(key, 0)
                    # Strip metadata properties not needed for rendering
                    # (keep _scaleNum for app-side usage band filtering)
                    stripped = {k: v for k, v in props.items()
                                if k not in ('RCID', 'PRIM', 'GRUP', 'SORDAT', 'SORIND',
                                             'CHART_ID', 'OBJL_NAME')}
                    point_feature = {
                        'type': 'Feature',
                        'geometry': geom,
                        'properties': stripped,
                    }
                    if best_scamin > 0:
                        point_feature['properties']['SCAMIN'] = best_scamin
                    # Set tippecanoe minzoom from SCAMIN
                    scamin_minz = scamin_to_minzoom(best_scamin if best_scamin > 0 else None, 0)
                    # ECDIS usage band suppression: if a higher-scale M_COVR
                    # covers this point, cap maxzoom so it yields when the
                    # higher-scale data takes over.
                    native_max = SCALE_ZOOM_RANGES.get(scale_num, (0, 15))[1]
                    point_maxz = native_max
                    if coverage_union and scale_num in _coverage_higher_scales:
                        coords = geom.get('coordinates', [])
                        if len(coords) >= 2:
                            pt_ogr = ogr.Geometry(ogr.wkbPoint)
                            pt_ogr.AddPoint_2D(coords[0], coords[1])
                            for higher_sn in _coverage_higher_scales[scale_num]:
                                if coverage_union[higher_sn].Contains(pt_ogr):
                                    higher_floor = SCALE_ZOOM_RANGES.get(higher_sn, (0, 15))[0]
                                    point_maxz = higher_floor - 1
                                    break
                    # Skip if coverage suppression leaves no visible zoom range
                    if point_maxz < 0 or point_maxz < scamin_minz:
                        continue
                    point_feature['tippecanoe'] = {
                        'minzoom': scamin_minz,
                        'maxzoom': point_maxz,
                        'layer': 'points',
                    }
                    points_extracted.append(point_feature)
                    # Collect sector lights for metadata index
                    if objl == 75:  # LIGHTS
                        sectr1 = stripped.get('SECTR1')
                        sectr2 = stripped.get('SECTR2')
                        if sectr1 is not None and sectr2 is not None:
                            coords = geom.get('coordinates', [])
                            sector_lights_index.append({
                                'lon': round(coords[0], 6),
                                'lat': round(coords[1], 6),
                                'sectr1': float(sectr1),
                                'sectr2': float(sectr2),
                                'colour': int(stripped.get('COLOUR', 1)),
                                'scamin': float(best_scamin) if best_scamin > 0 else 0,
                                'scaleNum': scale_num,
                                'maxZoom': point_maxz,
                                'valnmr': float(stripped['VALNMR']) if stripped.get('VALNMR') is not None else None,
                            })
                    if tracer.active:
                        tmatch = tracer.matches(feature)
                        if tmatch:
                            tracer.log(tmatch, 'POINT-EXTRACT', f'→ points.mbtiles SCAMIN={best_scamin} minzoom={scamin_minz} maxzoom={point_maxz} _scaleNum={scale_num} (chart={chart_id})', feature)
                    total_features_output += 1
                    scale_feature_counts[scale_num] += 1
                    continue

                # M_COVR authority clipping: remove/trim lower-scale features
                # where higher-scale charts provide coverage.
                #
                # Two types of gap protection:
                # 1. Tile-level gap: higher scale tiles don't exist yet at low zooms
                #    (e.g. US4 floor z6, US5 floor z6 — no gap here).
                # 2. SCAMIN gap: higher scale tiles exist but the replacement feature
                #    isn't visible yet due to a tighter SCAMIN. We emit a "filler"
                #    copy of the clipped geometry that stays visible until the
                #    higher scale's feature turns on.
                if scale_num in higher_coverage:
                    try:
                        ogr_line = ogr.CreateGeometryFromJson(json.dumps(geom))
                        if ogr_line and not ogr_line.IsEmpty():
                            clip_mask, higher_sn = higher_coverage[scale_num]
                            higher_lo = SCALE_ZOOM_RANGES.get(higher_sn, (0, 15))[0]
                            my_lo = SCALE_ZOOM_RANGES.get(scale_num, (0, 15))[0]
                            gap_maxz = higher_lo - 1  # last zoom before higher scale starts

                            # Compute SCAMIN filler range: keep clipped geometry
                            # visible until the higher scale's version of this
                            # feature type actually turns on.
                            my_scamin_minz = my_lo if objl in SKIN_OF_EARTH_OBJLS else scamin_to_minzoom(props.get('SCAMIN'), my_lo)
                            higher_objl_key = (higher_sn, objl)
                            higher_tightest = scale_objl_tightest_scamin.get(higher_objl_key)
                            if higher_tightest is not None:
                                # Higher scale has this OBJL with SCAMIN — filler
                                # until the tightest SCAMIN kicks in
                                higher_feat_minz = scamin_to_minzoom(higher_tightest, higher_lo)
                            elif higher_objl_key in scale_objl_exists:
                                # Higher scale has this OBJL but no SCAMIN —
                                # visible at the scale floor, no filler needed
                                higher_feat_minz = higher_lo
                            else:
                                # Higher scale has NO features of this type —
                                # filler covers our full range (effectively no clip)
                                higher_feat_minz = SCALE_ZOOM_RANGES.get(scale_num, (0, 15))[1] + 1
                            scamin_filler_minz = max(my_scamin_minz, higher_lo)
                            scamin_filler_maxz = higher_feat_minz - 1

                            if clip_mask.Contains(ogr_line):
                                if tracer.active:
                                    tmatch = tracer.matches(feature)
                                    if tmatch:
                                        tracer.log(tmatch, 'MCOVR-CLIPPED', f'entirely within higher-scale coverage, removed (chart={chart_id} US{scale_num})', feature)
                                # Write unclipped copy for tile-level gap zooms
                                if gap_maxz >= my_scamin_minz and scale_num in scale_geojson:
                                    gap_feature = dict(feature)
                                    gap_feature['tippecanoe'] = {
                                        'minzoom': my_scamin_minz,
                                        'maxzoom': gap_maxz,
                                        'layer': 'charts',
                                    }
                                    line = json.dumps(gap_feature, separators=(',', ':')) + '\n'
                                    buffer_feature(scale_num, line)
                                    scale_counts[scale_num] += 1
                                # Write SCAMIN filler: keeps feature visible until
                                # the higher scale's replacement feature turns on
                                if scamin_filler_maxz >= scamin_filler_minz and scale_num in scale_geojson:
                                    filler_feature = dict(feature)
                                    filler_feature['tippecanoe'] = {
                                        'minzoom': scamin_filler_minz,
                                        'maxzoom': scamin_filler_maxz,
                                        'layer': 'charts',
                                    }
                                    line = json.dumps(filler_feature, separators=(',', ':')) + '\n'
                                    buffer_feature(scale_num, line)
                                    scale_counts[scale_num] += 1
                                contours_clipped += 1
                                continue
                            if clip_mask.Intersects(ogr_line):
                                clipped = ogr_line.Difference(clip_mask)
                                if clipped and not clipped.IsEmpty():
                                    if not clipped.IsValid():
                                        clipped = clipped.MakeValid()
                                    clipped_json = json.loads(clipped.ExportToJson())
                                    if tracer.active:
                                        tmatch = tracer.matches(feature)
                                        if tmatch:
                                            tracer.log(tmatch, 'MCOVR-TRIMMED', f'partially clipped by higher-scale coverage (chart={chart_id} US{scale_num})', feature)
                                    # Write unclipped copy for tile-level gap zooms
                                    if gap_maxz >= my_scamin_minz and scale_num in scale_geojson:
                                        gap_feature = dict(feature)
                                        gap_feature['tippecanoe'] = {
                                            'minzoom': my_scamin_minz,
                                            'maxzoom': gap_maxz,
                                            'layer': 'charts',
                                        }
                                        line = json.dumps(gap_feature, separators=(',', ':')) + '\n'
                                        buffer_feature(scale_num, line)
                                        scale_counts[scale_num] += 1
                                    # Write SCAMIN filler for the clipped-away inside portion only
                                    if scamin_filler_maxz >= scamin_filler_minz and scale_num in scale_geojson:
                                        inside_geom = ogr_line.Intersection(clip_mask)
                                        if inside_geom and not inside_geom.IsEmpty():
                                            if not inside_geom.IsValid():
                                                inside_geom = inside_geom.MakeValid()
                                            filler_feature = dict(feature)
                                            filler_feature['geometry'] = json.loads(inside_geom.ExportToJson())
                                            filler_feature['tippecanoe'] = {
                                                'minzoom': scamin_filler_minz,
                                                'maxzoom': scamin_filler_maxz,
                                                'layer': 'charts',
                                            }
                                            line = json.dumps(filler_feature, separators=(',', ':')) + '\n'
                                            buffer_feature(scale_num, line)
                                            scale_counts[scale_num] += 1
                                    feature['geometry'] = clipped_json
                                    geom = clipped_json
                                    contours_trimmed += 1
                                else:
                                    if tracer.active:
                                        tmatch = tracer.matches(feature)
                                        if tmatch:
                                            tracer.log(tmatch, 'MCOVR-CLIPPED', f'Difference produced empty geometry, removed (chart={chart_id} US{scale_num})', feature)
                                    # Write unclipped copy for tile-level gap zooms
                                    if gap_maxz >= my_scamin_minz and scale_num in scale_geojson:
                                        gap_feature = dict(feature)
                                        gap_feature['tippecanoe'] = {
                                            'minzoom': my_scamin_minz,
                                            'maxzoom': gap_maxz,
                                            'layer': 'charts',
                                        }
                                        line = json.dumps(gap_feature, separators=(',', ':')) + '\n'
                                        buffer_feature(scale_num, line)
                                        scale_counts[scale_num] += 1
                                    # Write SCAMIN filler
                                    if scamin_filler_maxz >= scamin_filler_minz and scale_num in scale_geojson:
                                        filler_feature = dict(feature)
                                        filler_feature['tippecanoe'] = {
                                            'minzoom': scamin_filler_minz,
                                            'maxzoom': scamin_filler_maxz,
                                            'layer': 'charts',
                                        }
                                        line = json.dumps(filler_feature, separators=(',', ':')) + '\n'
                                        buffer_feature(scale_num, line)
                                        scale_counts[scale_num] += 1
                                    contours_clipped += 1
                                    continue
                    except Exception as e:
                        logger.warning(f'M_COVR clip error for OBJL {objl} in {chart_id}: {e}')

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

                    # Apply SCAMIN-derived minzoom — ensures partitioned
                    # copies don't appear at zooms below their SCAMIN threshold.
                    # Use best (most permissive) SCAMIN across all dedup copies so
                    # the winner inherits the widest visibility from any scale's version.
                    # Skip for group 1 (skin of earth) features which must always be visible.
                    if objl not in SKIN_OF_EARTH_OBJLS:
                        best_scamin = dedup_best_scamin.get(key, 0)
                        scamin_for_minz = best_scamin if best_scamin > 0 else props.get('SCAMIN')
                        scamin_minz = scamin_to_minzoom(scamin_for_minz, desired_minz)
                        desired_minz = max(desired_minz, scamin_minz)

                    # Write a copy to each owning scale's file with its zoom slice
                    wrote_any = False
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
                        line = json.dumps(feature_copy, separators=(',', ':')) + '\n'
                        buffer_feature(sn, line)
                        scale_counts[sn] += 1
                        wrote_any = True
                        if tracer.active:
                            tmatch = tracer.matches(feature)
                            if tmatch:
                                tracer.log(tmatch, 'WRITE-PARTITIONED', f'→ US{sn} z{clamped_min}-{clamped_max} (chart={chart_id})', feature)

                    if tracer.active and not wrote_any:
                        tmatch = tracer.matches(feature)
                        if tmatch:
                            tracer.log(tmatch, 'WRITE-SKIPPED', f'partitioned but no valid zoom slice (desired z{desired_minz}-{desired_maxz}, chart={chart_id})', feature)

                    scale_feature_counts[scale_num] += 1
                    total_features_output += 1
                else:
                    # Single-scale feature: write to native scale file.
                    # minzoom derived from feature's SCAMIN (per-chart compilation
                    # scale), maxzoom from the scale band's native range.
                    # Group 1 (skin of earth) features skip SCAMIN — always use native range.
                    scamin_minz = native_lo if objl in SKIN_OF_EARTH_OBJLS else scamin_to_minzoom(props.get('SCAMIN'), native_lo)

                    if not existing_tippecanoe:
                        feature['tippecanoe'] = {
                            'minzoom': scamin_minz,
                            'maxzoom': native_hi,
                            'layer': 'charts',
                        }
                    else:
                        if 'layer' not in existing_tippecanoe:
                            existing_tippecanoe['layer'] = 'charts'
                        # Preserve pre-existing minzoom (e.g. nav aids forced to z0)
                        # but use SCAMIN-derived zoom for features that only have 'layer'
                        if 'minzoom' not in existing_tippecanoe:
                            existing_tippecanoe['minzoom'] = scamin_minz
                        if 'maxzoom' not in existing_tippecanoe:
                            existing_tippecanoe['maxzoom'] = native_hi

                    sn = scale_num if scale_num in scale_geojson else 1
                    final_minz = feature.get('tippecanoe', {}).get('minzoom', scamin_minz)
                    final_maxz = feature.get('tippecanoe', {}).get('maxzoom', native_hi)
                    if tracer.active:
                        tmatch = tracer.matches(feature)
                        if tmatch:
                            skin = 'SKIN_OF_EARTH' if objl in SKIN_OF_EARTH_OBJLS else f'SCAMIN={props.get("SCAMIN")}'
                            tracer.log(tmatch, 'WRITE-SINGLE', f'→ US{sn} z{final_minz}-{final_maxz} ({skin}, chart={chart_id})', feature)
                    line = json.dumps(feature, separators=(',', ':')) + '\n'
                    buffer_feature(sn, line)
                    scale_counts[sn] += 1
                    scale_feature_counts[scale_num] += 1
                    total_features_output += 1

            if (chart_idx + 1) % 100 == 0 or chart_idx + 1 == num_charts:
                elapsed = (datetime.now(timezone.utc) - write_start).total_seconds()
                logger.info(f'  Write: {chart_idx + 1}/{num_charts} charts, '
                           f'{total_features_output:,d} written, '
                           f'{duplicates_removed:,d} dupes removed ({elapsed:.0f}s)')
                sys.stdout.flush()

        # Flush remaining buffers and close files
        for sn in SCALE_ZOOM_RANGES:
            flush_buffer(sn)
        for f in scale_geojson.values():
            f.close()

        write_duration = (datetime.now(timezone.utc) - write_start).total_seconds()
        for sn in sorted(scale_counts):
            if scale_counts[sn] > 0:
                native_lo, native_hi = SCALE_ZOOM_RANGES[sn]
                sz = os.path.getsize(scale_paths[sn]) / 1024 / 1024
                logger.info(f'  US{sn}: {scale_counts[sn]:,d} features, '
                           f'{sz:.1f} MB, z{native_lo}-{native_hi}')
        logger.info(f'GeoJSON write complete: {total_features_output:,d} features '
                   f'({duplicates_removed:,d} duplicates removed) in {write_duration:.1f}s')
        if contours_clipped or contours_trimmed:
            logger.info(f'Contour clipping: {contours_clipped} fully removed, '
                       f'{contours_trimmed} partially trimmed')
        logger.info(f'Points extracted: {len(points_extracted):,d} Point features for points.mbtiles')

        # ─── Write points GeoJSON and run tippecanoe → points.mbtiles ───
        # Nav aids (all non-sounding points): -r1 keeps every feature at every zoom.
        # Soundings (OBJL 129): --drop-densest-as-needed auto-thins at low zoom,
        # reaching full density at max zoom (standard ECDIS behavior).
        points_count = len(points_extracted)
        points_storage_path = ''
        if points_extracted:
            navaid_geojson_path = os.path.join(output_dir, 'navaid.geojson')
            soundings_geojson_path = os.path.join(output_dir, 'soundings.geojson')
            navaid_mbtiles_path = os.path.join(output_dir, 'navaid.mbtiles')
            soundings_mbtiles_path = os.path.join(output_dir, 'soundings.mbtiles')
            points_mbtiles_path = os.path.join(output_dir, 'points.mbtiles')

            # Separate soundings from nav aids and write two GeoJSON files
            navaid_count = 0
            sounding_count = 0
            with open(navaid_geojson_path, 'w') as f_nav, \
                 open(soundings_geojson_path, 'w') as f_snd:
                for pf in points_extracted:
                    if pf['properties'].get('OBJL') == 129:
                        f_snd.write(json.dumps(pf, separators=(',', ':')) + '\n')
                        sounding_count += 1
                    else:
                        f_nav.write(json.dumps(pf, separators=(',', ':')) + '\n')
                        navaid_count += 1

            navaid_mb = os.path.getsize(navaid_geojson_path) / 1024 / 1024
            sounding_mb = os.path.getsize(soundings_geojson_path) / 1024 / 1024
            logger.info(f'Wrote navaid.geojson: {navaid_count:,d} features ({navaid_mb:.1f} MB)')
            logger.info(f'Wrote soundings.geojson: {sounding_count:,d} features ({sounding_mb:.1f} MB)')

            # Free the in-memory list before tippecanoe
            del points_extracted

            # Run tippecanoe for nav aids: -r1 keeps every feature
            if navaid_count > 0:
                tippecanoe_navaid_cmd = [
                    'tippecanoe', '-o', navaid_mbtiles_path,
                    '-Z', '0', '-z', '15',
                    '-r1',
                    '--no-feature-limit',
                    '--no-tile-size-limit',
                    '--no-line-simplification',
                    '-l', 'points',
                    '--force',
                    navaid_geojson_path,
                ]
                logger.info(f'Running tippecanoe for navaid.mbtiles: {" ".join(tippecanoe_navaid_cmd)}')
                proc = subprocess.run(tippecanoe_navaid_cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    logger.error(f'tippecanoe (navaid) failed: {proc.stderr[:500]}')
                    sys.exit(1)
                skipped = [l for l in proc.stderr.splitlines() if 'Skipping this tile' in l]
                if skipped:
                    logger.error(f'tippecanoe (navaid) DROPPED {len(skipped)} TILES!')
                    sys.exit(1)
                logger.info(f'navaid.mbtiles: {os.path.getsize(navaid_mbtiles_path) / 1024 / 1024:.1f} MB')

            # Run tippecanoe for soundings: --drop-densest-as-needed for auto-thinning
            if sounding_count > 0:
                tippecanoe_sounding_cmd = [
                    'tippecanoe', '-o', soundings_mbtiles_path,
                    '-Z', '0', '-z', '15',
                    '--drop-densest-as-needed',
                    '-M', '2000',
                    '--no-line-simplification',
                    '-l', 'points',
                    '--force',
                    soundings_geojson_path,
                ]
                logger.info(f'Running tippecanoe for soundings.mbtiles: {" ".join(tippecanoe_sounding_cmd)}')
                proc = subprocess.run(tippecanoe_sounding_cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    logger.error(f'tippecanoe (soundings) failed: {proc.stderr[:500]}')
                    sys.exit(1)
                logger.info(f'soundings.mbtiles: {os.path.getsize(soundings_mbtiles_path) / 1024 / 1024:.1f} MB')

            # Merge nav aids + soundings into points.mbtiles via tile-join
            tile_join_inputs = []
            if navaid_count > 0:
                tile_join_inputs.append(navaid_mbtiles_path)
            if sounding_count > 0:
                tile_join_inputs.append(soundings_mbtiles_path)

            if len(tile_join_inputs) == 1:
                # Only one type present — just rename
                os.rename(tile_join_inputs[0], points_mbtiles_path)
            else:
                tile_join_cmd = [
                    'tile-join', '-o', points_mbtiles_path, '--force',
                ] + tile_join_inputs
                logger.info(f'Running tile-join for points.mbtiles: {" ".join(tile_join_cmd)}')
                proc = subprocess.run(tile_join_cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    logger.error(f'tile-join (points) failed: {proc.stderr[:500]}')
                    sys.exit(1)

            points_mbtiles_mb = os.path.getsize(points_mbtiles_path) / 1024 / 1024
            logger.info(f'points.mbtiles: {points_mbtiles_mb:.1f} MB')

            # Validate points.mbtiles
            error = validate_mbtiles(points_mbtiles_path, 'points.mbtiles', logger)
            if error:
                logger.error(f'points.mbtiles validation FAILED: {error}')
                sys.exit(1)

            # Embed sector light index in points.mbtiles metadata
            if sector_lights_index:
                conn = sqlite3.connect(points_mbtiles_path)
                conn.execute(
                    "INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)",
                    ('sector_lights', json.dumps(sector_lights_index, separators=(',', ':')))
                )
                conn.commit()
                conn.close()
                logger.info(f'Embedded {len(sector_lights_index)} sector lights in points.mbtiles metadata')
            else:
                logger.info('No sector lights found — skipping metadata injection')
            del sector_lights_index

            # Embed M_COVR coverage boundaries in points.mbtiles metadata
            # App uses these for ECDIS usage band filtering — suppressing
            # lower-scale features in areas covered by higher-scale charts.
            if coverage_union:
                coverage_meta = {}
                for sn, geom in coverage_union.items():
                    simplified = geom.SimplifyPreserveTopology(0.001)  # ~100m tolerance
                    if simplified and not simplified.IsEmpty():
                        coverage_meta[str(sn)] = json.loads(simplified.ExportToJson())
                if coverage_meta:
                    conn = sqlite3.connect(points_mbtiles_path)
                    conn.execute(
                        "INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)",
                        ('coverage_boundaries', json.dumps(coverage_meta, separators=(',', ':')))
                    )
                    conn.commit()
                    conn.close()
                    logger.info(f'Embedded coverage boundaries for {len(coverage_meta)} scales in points.mbtiles metadata')

            # Upload points.mbtiles (raw + zip in parallel)
            points_storage_path = f'{district_label}/charts/points.mbtiles'
            points_zip_path = os.path.join(output_dir, 'points.mbtiles.zip')
            points_zip_storage_path = f'{district_label}/charts/points.mbtiles.zip'

            def _upload_points_raw():
                blob = bucket.blob(points_storage_path)
                blob.upload_from_filename(points_mbtiles_path, timeout=600)
                logger.info(f'  Uploaded points.mbtiles: {points_mbtiles_mb:.1f} MB -> {points_storage_path}')

            def _upload_points_zip():
                with zipfile.ZipFile(points_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                    zf.write(points_mbtiles_path, 'points.mbtiles')
                zip_blob = bucket.blob(points_zip_storage_path)
                zip_blob.upload_from_filename(points_zip_path, timeout=600)
                sz = os.path.getsize(points_zip_path) / 1024 / 1024
                logger.info(f'  Uploaded points.mbtiles.zip: {sz:.1f} MB -> {points_zip_storage_path}')

            with ThreadPoolExecutor(max_workers=2) as pool:
                pool.submit(_upload_points_raw)
                pool.submit(_upload_points_zip)

            # Free from tmpfs
            for p in [navaid_geojson_path, soundings_geojson_path,
                       navaid_mbtiles_path, soundings_mbtiles_path,
                       points_mbtiles_path, points_zip_path]:
                if os.path.exists(p):
                    os.remove(p)

            logger.info(f'Uploaded points.mbtiles: {points_count:,d} features')
        else:
            del points_extracted

        # Free per-chart GeoJSON from tmpfs — no longer needed after Pass 2
        geojson_freed = sum(os.path.getsize(p) for p in local_paths) / 1024 / 1024
        shutil.rmtree(geojson_dir, ignore_errors=True)
        logger.info(f'Freed {geojson_freed:.0f} MB of per-chart GeoJSON from tmpfs')

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

        # (d) Poll, download, and tree-merge as workers complete.
        #     We can't download all mbtiles at once — total output can be 40+ GB
        #     which exceeds the 32 Gi tmpfs. Files are downloaded as they appear
        #     and fed into a TreeMerger that pairs the two smallest files for
        #     concurrent tile-join, keeping peak /tmp bounded.
        expected_blobs = {}
        for sn, z_lo, z_hi in worker_tasks:
            native_lo, native_hi = SCALE_ZOOM_RANGES[sn]
            if z_lo == native_lo and z_hi == native_hi:
                mbtiles_name = f'scale_{sn}.mbtiles'
            else:
                mbtiles_name = f'scale_{sn}_z{z_lo}-{z_hi}.mbtiles'
            expected_blobs[mbtiles_name] = f'{compose_prefix}{mbtiles_name}'

        merge_dir = os.path.join(output_dir, 'merge_work')
        os.makedirs(merge_dir, exist_ok=True)
        merger = TreeMerger(merge_dir, max_concurrent=2)
        merger.total_expected = len(expected_blobs)

        logger.info(f'Polling for {len(expected_blobs)} .mbtiles files (tree merge)...')
        poll_interval = 15  # seconds
        log_interval = 60  # log progress every 60s
        max_wait = 5400  # 90 minutes
        elapsed = 0
        last_log = 0
        detected = set()    # blobs detected in storage
        downloaded = set()   # blobs downloaded and fed to merger

        while len(downloaded) < len(expected_blobs) and elapsed < max_wait:
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

            # Download detected files and feed to tree merger, but throttle to
            # avoid accumulating too many mbtiles on tmpfs (RAM-backed).
            # With max_concurrent=2 merges, at most 4 files are being merged
            # (2 pairs × 2 inputs). We allow up to 4 files in the ready queue
            # so the merger always has work, for a total of ~8 files on disk.
            MAX_QUEUED = 4  # max files in ready queue before pausing downloads
            for key in sorted(detected - downloaded):
                with merger.lock:
                    queued = len(merger.ready) + merger.active_merges * 2
                if queued >= MAX_QUEUED + merger.max_concurrent * 2:
                    break  # wait for merges to free up space

                blob_path = expected_blobs[key]
                local_path = os.path.join(merge_dir, key)

                logger.info(f'  Downloading {key}...')
                bucket.blob(blob_path).download_to_filename(local_path)
                sz = os.path.getsize(local_path) / 1024 / 1024
                logger.info(f'  Downloaded {key}: {sz:.1f} MB')

                # Gate 3B: Validate downloaded worker .mbtiles
                error = validate_mbtiles(local_path, key, logger)
                if error:
                    logger.error(f'Gate 3B FAILED: {error}')
                    sys.exit(1)

                merger.add(local_path)
                downloaded.add(key)

            if merger.error:
                logger.error(f'TreeMerger error: {merger.error}')
                sys.exit(1)

            if elapsed - last_log >= log_interval:
                remaining = len(expected_blobs) - len(detected)
                with merger.lock:
                    ready_count = len(merger.ready)
                    active = merger.active_merges
                logger.info(f'  Progress: {len(downloaded)}/{len(expected_blobs)} downloaded, '
                           f'{ready_count} ready for merge, {active} merging, '
                           f'{remaining} workers still running ({elapsed}s)')
                last_log = elapsed

        if len(downloaded) < len(expected_blobs):
            missing = sorted(k for k in expected_blobs if k not in detected)
            logger.error(f'Timeout after {max_wait}s waiting for {len(missing)} workers: '
                        f'{", ".join(missing[:10])}')
            sys.exit(1)

        logger.info(f'All {len(expected_blobs)} worker outputs downloaded in {elapsed}s, '
                   f'waiting for tree merge to complete...')

        # Wait for tree merge to finish (all pairs merged + final compression)
        output_mbtiles = merger.finish()
        tippecanoe_duration = (datetime.now(timezone.utc) - tippecanoe_start).total_seconds()
        mbtiles_size = os.path.getsize(output_mbtiles) / 1024 / 1024
        logger.info(f'Unified MBTiles complete: {mbtiles_size:.1f} MB in {tippecanoe_duration:.1f}s')

        # Gate 4: Validate merged MBTiles
        logger.info('Gate 4: Validating merged MBTiles...')
        error = validate_merged_mbtiles(output_mbtiles, len(features_per_chart), logger)
        if error:
            logger.error(f'Gate 4 FAILED: {error}')
            sys.exit(1)
        logger.info('Gate 4 passed')

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

        # Gate 5: Verify uploads landed correctly
        logger.info('Gate 5: Verifying uploads...')
        errors = list(filter(None, [
            validate_upload(bucket, raw_storage_path, os.path.getsize(output_mbtiles),
                            'raw mbtiles', logger),
            validate_upload(bucket, zip_storage_path, os.path.getsize(zip_path),
                            'zip archive', logger),
        ]))
        if errors:
            for e in errors:
                logger.error(f'Gate 5 FAILED: {e}')
            sys.exit(1)
        logger.info('Gate 5 passed')

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
        if points_count > 0:
            chart_data['pointsCount'] = points_count
            chart_data['pointsPath'] = points_storage_path

        doc_ref = db.collection('districts').document(district_label)
        doc_ref.set({'chartData': chart_data}, merge=True)

        logger.info(f'=== Compose job complete: {len(features_per_chart)} charts, '
                   f'{total_features_output} features ({duplicates_removed} deduped), '
                   f'{mbtiles_size:.1f} MB, {total_duration:.1f}s ===')
        logger.info(f'  Phases: download={download_duration:.0f}s, '
                   f'dedup={dedup_duration:.0f}s, '
                   f'write={write_duration:.0f}s, tippecanoe={tippecanoe_duration:.0f}s, '
                   f'upload={upload_duration:.0f}s')

        # Print feature trace summary
        tracer.summary()

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
