"""
Shared tile generation utilities for XNautical imagery generators.

Provides tile math, geometry loading, async downloading with streaming
MBTiles writes, zip packaging, skip-existing checks, and failure thresholds.
"""

import os
import json
import math
import time
import sqlite3
import logging
import asyncio
import tempfile
import zipfile
import shutil
import threading
import random
from pathlib import Path

import aiohttp
import shapefile
from shapely.geometry import shape, box as shapely_box
from shapely.ops import unary_union
from shapely.prepared import prep

logger = logging.getLogger(__name__)


def _run_async(coro):
    """Run async code from sync context, reusing event loop when possible."""
    try:
        loop = asyncio.get_running_loop()
        # Already in async context - shouldn't happen in our sync gunicorn workers
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(asyncio.run, coro).result()
    except RuntimeError:
        # No running loop - normal case for sync workers
        return asyncio.run(coro)


# Natural Earth land data (bundled in Docker image)
LAND_SHAPEFILE = Path('/app/data/ne_10m_land/ne_10m_land.shp')

# Below this zoom, download full bounding box (tile counts trivially small)
COASTAL_BUFFER_MIN_ZOOM = 6


# ============================================================================
# Tile math
# ============================================================================

def lon_to_tile_x(lon, zoom):
    n = 1 << zoom
    x = int((lon + 180.0) / 360.0 * n)
    return min(x, n - 1)


def lat_to_tile_y(lat, zoom):
    lat_rad = math.radians(lat)
    n = 1 << zoom
    return int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)


def tile_y_to_tms(y, zoom):
    return (1 << zoom) - 1 - y


def tile_to_bounds(z, x, y):
    """Convert XYZ tile coordinates to (west, south, east, north)."""
    n = 1 << z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return (west, south, east, north)


def get_tiles_for_bounds(bounds, zoom):
    """Get set of (z, x, y) XYZ tiles covering the bounds at a single zoom."""
    tiles = set()
    x_min = lon_to_tile_x(bounds['west'], zoom)
    x_max = lon_to_tile_x(bounds['east'], zoom)
    y_min = lat_to_tile_y(bounds['north'], zoom)
    y_max = lat_to_tile_y(bounds['south'], zoom)
    for x in range(x_min, x_max + 1):
        for y in range(y_min, y_max + 1):
            tiles.add((zoom, x, y))
    return tiles


def format_bytes(size):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


# ============================================================================
# Coastal geometry loading
# ============================================================================

_land_cache = {}
_land_cache_lock = threading.Lock()
_LAND_CACHE_MAX = 50


def load_geometry_for_region(region_bounds_list, buffer_nm, mode='coastal'):
    """
    Load Natural Earth land polygons, clip to region bounds, and create
    a coastal zone or ocean zone geometry.

    Args:
        region_bounds_list: List of bounds dicts [{'west','south','east','north'}]
        buffer_nm: Buffer distance in nautical miles
        mode: 'coastal' = coastline buffer (basemap/terrain/satellite)
              'ocean' = water + buffer onto land (ocean)

    Returns prepared Shapely geometry, or None if no land found.
    """
    cache_key = f'{json.dumps(region_bounds_list, sort_keys=True)}_{buffer_nm}_{mode}'
    with _land_cache_lock:
        if cache_key in _land_cache:
            return _land_cache[cache_key]

    # Compute outside lock to avoid blocking other threads during expensive I/O
    start = time.time()

    # Create clip region expanded by buffer
    clip_buffer_deg = buffer_nm / 60.0 + 1.0
    clip_boxes = []
    for b in region_bounds_list:
        clip_boxes.append(shapely_box(
            b['west'] - clip_buffer_deg,
            b['south'] - clip_buffer_deg,
            b['east'] + clip_buffer_deg,
            b['north'] + clip_buffer_deg,
        ))
    clip_region = unary_union(clip_boxes)

    # Load shapefile and collect intersecting polygons
    reader = shapefile.Reader(str(LAND_SHAPEFILE))
    land_geometries = []
    geom_error_count = 0
    for shape_rec in reader.iterShapeRecords():
        try:
            geom = shape(shape_rec.shape.__geo_interface__)
            if not geom.is_valid:
                geom = geom.buffer(0)
            if clip_region.intersects(geom):
                clipped = geom.intersection(clip_region)
                if not clipped.is_empty:
                    land_geometries.append(clipped)
        except Exception as e:
            geom_error_count += 1
            if geom_error_count <= 3:
                logger.warning(f'Skipping invalid geometry in land shapefile: {e}')
            continue

    if geom_error_count > 0:
        logger.warning(f'  Skipped {geom_error_count} invalid geometries in land shapefile')
    if geom_error_count > 100:
        logger.error(f'  Excessive geometry errors ({geom_error_count}) -- land data may be corrupt')

    if not land_geometries:
        if mode == 'ocean':
            # No land = entire region is water
            logger.info(f'  No land features found — entire region is water')
            result = prep(clip_region)
        else:
            logger.warning(f'  No land features found')
            result = None
    else:
        logger.info(f'  Found {len(land_geometries)} land features')
        land = unary_union(land_geometries)

        buffer_deg = buffer_nm / 60.0

        if mode == 'ocean':
            # Ocean zone: water (clip - land) + buffer onto land
            water = clip_region.difference(land)
            zone = water.buffer(buffer_deg)
        else:
            # Coastal zone: coastline (boundary of land) + buffer
            coastline = land.boundary
            zone = coastline.buffer(buffer_deg)

        result = prep(zone)
        load_time = time.time() - start
        logger.info(f'  {mode.title()} zone prepared in {load_time:.1f}s '
                    f'(buffer: {buffer_nm}nm = {buffer_deg:.4f}{"°" if mode == "coastal" else "° onto land"})')

    # Double-checked locking: re-check cache in case another thread computed it
    with _land_cache_lock:
        if cache_key in _land_cache:
            return _land_cache[cache_key]
        if len(_land_cache) >= _LAND_CACHE_MAX:
            _land_cache.pop(next(iter(_land_cache)))
        _land_cache[cache_key] = result
    return result


def get_coastal_tiles_for_bounds(bounds, zoom, prepared_zone):
    """Get tiles covering a bounding box, filtered by the prepared zone geometry."""
    tiles = set()
    x_min = lon_to_tile_x(bounds['west'], zoom)
    x_max = lon_to_tile_x(bounds['east'], zoom)
    y_min = lat_to_tile_y(bounds['north'], zoom)
    y_max = lat_to_tile_y(bounds['south'], zoom)

    checked = 0
    for x in range(x_min, x_max + 1):
        for y in range(y_min, y_max + 1):
            west, south, east, north = tile_to_bounds(zoom, x, y)
            tile_box = shapely_box(west, south, east, north)
            if prepared_zone.intersects(tile_box):
                tiles.add((zoom, x, y))
            checked += 1
    return tiles, checked


def get_all_tiles_for_region(region_bounds_list, min_zoom, max_zoom,
                             buffer_nm=25, geometry_mode='coastal'):
    """
    Get all tiles needed for a region across zoom levels.

    For zoom < COASTAL_BUFFER_MIN_ZOOM: full bounding box
    For zoom >= COASTAL_BUFFER_MIN_ZOOM: filtered by geometry zone
    """
    zone = load_geometry_for_region(region_bounds_list, buffer_nm, geometry_mode)
    all_tiles = set()

    for z in range(min_zoom, max_zoom + 1):
        if z < COASTAL_BUFFER_MIN_ZOOM or zone is None:
            for bounds in region_bounds_list:
                all_tiles.update(get_tiles_for_bounds(bounds, z))
            zoom_count = sum(1 for t in all_tiles if t[0] == z)
            logger.info(f'  z{z}: {zoom_count:,} tiles (full bbox)')
        else:
            zoom_tiles = set()
            total_checked = 0
            for bounds in region_bounds_list:
                filtered, checked = get_coastal_tiles_for_bounds(bounds, z, zone)
                zoom_tiles.update(filtered)
                total_checked += checked
            all_tiles.update(zoom_tiles)
            pct = len(zoom_tiles) / total_checked * 100 if total_checked > 0 else 0
            logger.info(f'  z{z}: {len(zoom_tiles):,} / {total_checked:,} tiles '
                        f'({pct:.1f}% of bbox, {geometry_mode} zone)')
    return all_tiles


# ============================================================================
# MBTiles management
# ============================================================================

def init_mbtiles(db_path, min_zoom, max_zoom, name, region_bounds,
                 description='Tile data', format_='png', attribution=''):
    """Initialize an MBTiles database. Returns the sqlite3 connection."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    cursor.execute('CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT)')
    cursor.execute('''CREATE TABLE IF NOT EXISTS tiles (
        zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER,
        tile_data BLOB, PRIMARY KEY (zoom_level, tile_column, tile_row))''')
    cursor.execute('CREATE INDEX IF NOT EXISTS tiles_idx ON tiles (zoom_level, tile_column, tile_row)')

    west = min(b['west'] for b in region_bounds)
    south = min(b['south'] for b in region_bounds)
    east = max(b['east'] for b in region_bounds)
    north = max(b['north'] for b in region_bounds)
    if west > east:
        # Antimeridian crossing
        center_lon = (west + east + 360) / 2
        if center_lon > 180:
            center_lon -= 360
    else:
        center_lon = (west + east) / 2
    center_lat = (south + north) / 2

    meta = {
        'name': name,
        'type': 'baselayer',
        'version': '1.0',
        'description': description,
        'format': format_,
        'bounds': f'{west},{south},{east},{north}',
        'center': f'{center_lon},{center_lat},{min_zoom}',
        'minzoom': str(min_zoom),
        'maxzoom': str(max_zoom),
        'attribution': attribution,
    }
    for key, value in meta.items():
        cursor.execute('INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)', (key, value))
    conn.commit()
    return conn


# ============================================================================
# Async tile downloader with streaming writes
# ============================================================================

class TileDownloadError(Exception):
    """Raised when tile download failure threshold is exceeded."""
    pass


async def _download_tile(session, z, x, y, tile_url, semaphore, stats,
                         request_delay=0.05, skip_statuses=None):
    """Download a single tile. Returns (z, x, y, data) or None."""
    async with semaphore:
        url = tile_url.format(z=z, y=y, x=x)
        retries = 2
        for attempt in range(retries + 1):
            try:
                if request_delay > 0:
                    await asyncio.sleep(request_delay)
                async with session.get(url) as response:
                    if response.status == 200:
                        data = await response.read()
                        stats['completed'] += 1
                        stats['bytes'] += len(data)
                        return (z, x, y, data)
                    elif response.status == 429:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    elif response.status in (500, 502, 503):
                        if attempt < retries:
                            await asyncio.sleep(2 ** attempt + random.uniform(0, 1))
                            continue
                        stats['failed'] += 1
                        return None
                    elif skip_statuses and response.status in skip_statuses:
                        stats['completed'] += 1
                        return None
                    else:
                        logger.debug(f'Unexpected HTTP {response.status} for tile z{z}/{x}/{y}')
                        stats['failed'] += 1
                        return None
            except Exception:
                if attempt < retries:
                    await asyncio.sleep(1)
                    continue
                stats['failed'] += 1
                return None


async def _download_tiles_streaming(tiles, tile_url, db_conn, stats, *,
                                    max_concurrent=30, request_delay=0.05,
                                    request_timeout=30, headers=None,
                                    skip_statuses=None, tile_processor=None,
                                    failure_threshold=0.5):
    """
    Download tiles and stream directly into MBTiles database.

    Processes tiles in batches — only one batch (~5000 tiles) is in memory
    at a time, avoiding OOM on large regions.

    Args:
        tile_processor: Optional callable(data) -> data, e.g., gzip compression
        failure_threshold: Abort if failed/total exceeds this ratio (0.5 = 50%)
    """
    semaphore = asyncio.Semaphore(max_concurrent)
    timeout = aiohttp.ClientTimeout(total=request_timeout, connect=10)
    connector = aiohttp.TCPConnector(limit=max_concurrent * 2)

    if headers is None:
        headers = {
            'User-Agent': 'XNautical/1.0 (Offline Nautical Charts)',
            'Referer': 'https://xnautical.app',
        }

    cursor = db_conn.cursor()
    tile_list = list(tiles)
    batch_size = 5000

    async with aiohttp.ClientSession(timeout=timeout, connector=connector, headers=headers) as session:
        for i in range(0, len(tile_list), batch_size):
            batch = tile_list[i:i + batch_size]
            tasks = [
                _download_tile(session, z, x, y, tile_url, semaphore, stats,
                               request_delay, skip_statuses)
                for z, x, y in batch
            ]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)

            # Stream batch results directly into MBTiles
            try:
                cursor.execute('BEGIN TRANSACTION')
                for r in batch_results:
                    if r and not isinstance(r, Exception):
                        z, x, y, data = r
                        if tile_processor:
                            data = tile_processor(data)
                        tms_y = tile_y_to_tms(y, z)
                        cursor.execute(
                            'INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
                            (z, x, tms_y, data))
                cursor.execute('COMMIT')
            except Exception:
                cursor.execute('ROLLBACK')
                raise

            logger.info(f'  Batch {i // batch_size + 1}: '
                        f'{stats["completed"]}/{stats["total"]} downloaded, '
                        f'{stats["failed"]} failed, {format_bytes(stats["bytes"])}')

            # Check failure threshold
            processed = stats['completed'] + stats['failed']
            if processed > 100 and stats['failed'] / processed > failure_threshold:
                raise TileDownloadError(
                    f'Failure threshold exceeded: {stats["failed"]}/{stats["total"]} '
                    f'({stats["failed"] / stats["total"] * 100:.0f}% > {failure_threshold * 100:.0f}%)')


def download_and_store_tiles(tiles, db_path, min_zoom, max_zoom, name,
                             region_bounds, *, tile_url, max_concurrent=30,
                             request_delay=0.05, request_timeout=30,
                             headers=None, description='Tile data',
                             format_='png', attribution='',
                             skip_statuses=None, tile_processor=None,
                             failure_threshold=0.5):
    """
    Download tiles and stream into MBTiles. Returns (file_size, stats).

    Streams tiles to disk in batches instead of buffering all in memory.
    Aborts if failure rate exceeds failure_threshold.
    """
    conn = init_mbtiles(db_path, min_zoom, max_zoom, name, region_bounds,
                        description, format_, attribution)

    stats = {'total': len(tiles), 'completed': 0, 'failed': 0, 'bytes': 0}
    logger.info(f'Downloading {len(tiles):,} tiles for {name}...')

    try:
        _run_async(
            _download_tiles_streaming(
                tiles, tile_url, conn, stats,
                max_concurrent=max_concurrent,
                request_delay=request_delay,
                request_timeout=request_timeout,
                headers=headers,
                skip_statuses=skip_statuses,
                tile_processor=tile_processor,
                failure_threshold=failure_threshold,
            )
        )
    finally:
        conn.close()

    file_size = db_path.stat().st_size if db_path.exists() else 0
    return file_size, stats


# ============================================================================
# Storage helpers
# ============================================================================

def check_pack_exists(bucket, storage_path):
    """Check if a pack already exists in Storage (for skip-existing)."""
    blob = bucket.blob(storage_path)
    if not blob.exists():
        return False
    blob.reload()
    if blob.size is None or blob.size == 0:
        logger.warning(f'  Pack exists but is empty (0 bytes), will regenerate: {storage_path}')
        return False
    return True


def zip_and_upload_pack(bucket, region_id, storage_folder, db_path,
                        zip_internal_name, work_dir=None):
    """Zip an MBTiles file and upload both raw and zipped versions."""
    zip_filename = zip_internal_name + '.zip'
    zip_dir = work_dir or str(db_path.parent)
    zip_path = Path(zip_dir) / zip_filename

    with zipfile.ZipFile(str(zip_path), 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(str(db_path), zip_internal_name)

    zip_size_mb = zip_path.stat().st_size / 1024 / 1024
    zip_storage_path = f'{region_id}/{storage_folder}/{zip_filename}'
    logger.info(f'  Uploading zip to {zip_storage_path} ({zip_size_mb:.1f} MB)...')

    zip_blob = bucket.blob(zip_storage_path)
    zip_blob.upload_from_filename(str(zip_path), timeout=600)

    zip_path.unlink(missing_ok=True)
    return zip_storage_path


def update_generator_status(db, region_id, status_field, status):
    """Write generation status to Firestore."""
    try:
        doc_ref = db.collection('districts').document(region_id)
        doc_ref.set({status_field: status}, merge=True)
    except Exception as e:
        logger.warning(f'Failed to update Firestore status: {e}')


def _rmtree_onerror(func, path, exc_info):
    logger.warning(f'Failed to clean up temp file {path}: {exc_info[1]}')


def combine_and_zip(bucket, region_id, layer_name, storage_folder,
                    region_bounds, db, status_field, get_zip_internal_name,
                    min_zoom=0, max_zoom=14):
    """
    Download per-zoom MBTiles from storage, combine into a single MBTiles,
    zip it, and upload. Processes one file at a time to keep memory low.

    Args:
        get_zip_internal_name: callable(region_id) -> str, e.g. 'd01_ocean.mbtiles'
        status_field: Firestore status field for progress updates
    """
    prefix = f'{region_id}/{storage_folder}/'
    blobs = list(bucket.list_blobs(prefix=prefix))
    # Only include per-zoom .mbtiles files, not combined or zip files
    mbtiles_blobs = [b for b in blobs
                     if b.name.endswith('.mbtiles')
                     and '_z' in os.path.basename(b.name)]

    if not mbtiles_blobs:
        logger.warning(f'  No {layer_name} per-zoom MBTiles found at {prefix}, skipping combine')
        return

    logger.info(f'  Found {len(mbtiles_blobs)} per-zoom MBTiles files to combine')

    pkg_dir = tempfile.mkdtemp(prefix=f'pkg_{layer_name}_{region_id}_')

    try:
        combined_path = Path(pkg_dir) / f'{layer_name}.mbtiles'
        init_mbtiles(combined_path, min_zoom, max_zoom, f'{region_id} {layer_name.title()}', region_bounds)

        logger.info(f'Combining {len(mbtiles_blobs)} {layer_name} packs from storage...')
        update_generator_status(db, region_id, status_field, {
            'state': 'packaging',
            'message': f'Combining {len(mbtiles_blobs)} {layer_name} packs...',
        })

        for blob in sorted(mbtiles_blobs, key=lambda b: b.name):
            local_path = Path(pkg_dir) / ('src_' + os.path.basename(blob.name))
            logger.info(f'  Downloading {blob.name} ({blob.size / 1024 / 1024:.1f} MB)...')
            blob.download_to_filename(str(local_path))

            src_conn = sqlite3.connect(str(local_path))
            combined_conn = sqlite3.connect(str(combined_path))
            combined_conn.execute('PRAGMA journal_mode=WAL')
            combined_conn.execute('BEGIN TRANSACTION')
            cursor = src_conn.execute('SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles')
            while True:
                batch = cursor.fetchmany(1000)
                if not batch:
                    break
                combined_conn.executemany('INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)', batch)
            combined_conn.execute('COMMIT')
            combined_conn.close()
            src_conn.close()
            local_path.unlink()

        # Verify combined database integrity
        check_conn = sqlite3.connect(str(combined_path))
        result = check_conn.execute('PRAGMA integrity_check').fetchone()
        check_conn.close()
        if result[0] != 'ok':
            raise RuntimeError(f'Combined MBTiles failed integrity check: {result[0]}')

        combined_size = combined_path.stat().st_size / 1024 / 1024
        logger.info(f'  Combined: {combined_size:.1f} MB, zipping...')
        update_generator_status(db, region_id, status_field, {
            'state': 'packaging',
            'message': f'Zipping combined {layer_name} ({combined_size:.0f} MB)...',
        })

        zip_internal_name = get_zip_internal_name(region_id)
        zip_path = Path(pkg_dir) / f'{layer_name}.mbtiles.zip'
        with zipfile.ZipFile(str(zip_path), 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(str(combined_path), zip_internal_name)

        combined_path.unlink()

        zip_size = zip_path.stat().st_size / 1024 / 1024
        logger.info(f'  Compressed: {combined_size:.1f} MB -> {zip_size:.1f} MB (internal: {zip_internal_name})')

        zip_storage_path = f'{region_id}/{storage_folder}/{zip_internal_name}.zip'
        logger.info(f'  Uploading to {zip_storage_path}...')
        update_generator_status(db, region_id, status_field, {
            'state': 'uploading',
            'message': f'Uploading combined {layer_name} zip ({zip_size:.0f} MB)...',
        })

        blob = bucket.blob(zip_storage_path)
        blob.upload_from_filename(str(zip_path), timeout=1200)
        logger.info(f'  Combined {layer_name} zip uploaded.')

    finally:
        shutil.rmtree(pkg_dir, onerror=_rmtree_onerror)
