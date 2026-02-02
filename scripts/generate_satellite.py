#!/usr/bin/env python3
"""
Generate Satellite MBTiles for Alaska

Downloads satellite imagery tiles from ESRI World Imagery and packages them
into an MBTiles file for offline use in XNautical.

Usage:
    # Per-zoom coastal buffer files (recommended)
    python scripts/generate_satellite.py --coastal-buffer --single-zoom 9 -o charts/satellite/satellite_z9.mbtiles
    python scripts/generate_satellite.py --coastal-buffer --single-zoom 10 -o charts/satellite/satellite_z10.mbtiles
    
    # World/Pacific/Alaska base layers
    python scripts/generate_satellite.py --world --max-zoom 5 -o charts/satellite/satellite_z0-5.mbtiles
    python scripts/generate_satellite.py --north-pacific -o charts/satellite/satellite_z6-7.mbtiles
    python scripts/generate_satellite.py --alaska-only --single-zoom 8 -o charts/satellite/satellite_z8.mbtiles

    # Legacy modes
    python scripts/generate_satellite.py                    # Default z8-12, full coverage
    python scripts/generate_satellite.py --max-zoom 14      # Higher detail (larger file)
    python scripts/generate_satellite.py --resume           # Resume interrupted download
    python scripts/generate_satellite.py --poi-only --max-zoom 14  # Only POI areas at high zoom

Data Source: ESRI World Imagery (free with attribution)
Attribution: "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
"""

import asyncio
import aiohttp
import sqlite3
import math
import time
import argparse
import json
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Tuple, Optional, Set, Dict, Any
from datetime import timedelta

try:
    from rich.console import Console
    from rich.live import Live
    from rich.table import Table
    from rich.panel import Panel
    from rich.layout import Layout
    from rich.text import Text
    from rich import box
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False
    print("Note: Install 'rich' for beautiful progress display: pip install rich")

try:
    from shapely.geometry import shape, box as shapely_box
    from shapely.ops import unary_union
    SHAPELY_AVAILABLE = True
except ImportError:
    SHAPELY_AVAILABLE = False
    print("Note: Install 'shapely' for coastal buffer support: pip install shapely")

# Configuration
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
OUTPUT_DIR = PROJECT_ROOT / "charts" / "Satellite"
OUTPUT_FILE = "satellite_alaska.mbtiles"
POI_FILE = PROJECT_ROOT / "charts" / "regional_packs" / "alaska_poi.json"
COASTLINE_FILE = PROJECT_ROOT / "data" / "coastline" / "alaska_coast_combined.geojson"

# ESRI World Imagery tile server
TILE_URL_TEMPLATE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

# Nautical mile to degrees (approximate at 60°N latitude)
NM_TO_DEG_LAT = 1 / 60  # 1 nm ≈ 1 arcminute
NM_TO_DEG_LON_60N = 1 / 30  # At 60°N, longitude degrees are ~half as wide

# World bounds for low-zoom global coverage
WORLD = {
    'name': 'World',
    'west': -180.0,
    'east': 180.0,
    'south': -85.0,  # Web Mercator limits
    'north': 85.0,
}

# North Pacific bounds (for z6-7)
NORTH_PACIFIC_WEST = {
    'name': 'North Pacific West',
    'west': 150.0,
    'east': 180.0,
    'south': 40.0,
    'north': 75.0,
}

NORTH_PACIFIC_EAST = {
    'name': 'North Pacific East',
    'west': -180.0,
    'east': -120.0,
    'south': 40.0,
    'north': 75.0,
}

# Alaska bounds (including Aleutians which cross antimeridian)
# We'll handle this as two separate regions
ALASKA_MAIN = {
    'name': 'Alaska Main',
    'west': -180.0,
    'east': -129.0,
    'south': 51.0,
    'north': 72.0,
}

ALASKA_ALEUTIANS_EAST = {
    'name': 'Aleutians (East of 180)',
    'west': 172.0,  # Western Aleutians that wrap around
    'east': 180.0,
    'south': 51.0,
    'north': 55.0,
}

# Download settings
DEFAULT_MIN_ZOOM = 8
DEFAULT_MAX_ZOOM = 12
MAX_CONCURRENT = 8  # Be respectful to ESRI servers
CHUNK_SIZE = 1024 * 32
REQUEST_DELAY = 0.05  # Small delay between requests

console = Console() if RICH_AVAILABLE else None


@dataclass
class DownloadStats:
    """Track download progress"""
    total_tiles: int = 0
    completed: int = 0
    failed: int = 0
    skipped: int = 0
    total_bytes: int = 0
    start_time: float = field(default_factory=time.time)
    active_downloads: dict = field(default_factory=dict)
    failed_tiles: list = field(default_factory=list)
    current_zoom: int = 0
    
    @property
    def elapsed(self) -> timedelta:
        return timedelta(seconds=time.time() - self.start_time)
    
    @property
    def tiles_per_second(self) -> float:
        elapsed = time.time() - self.start_time
        return self.completed / elapsed if elapsed > 0 else 0
    
    @property
    def eta(self) -> Optional[timedelta]:
        if self.completed == 0:
            return None
        remaining = self.total_tiles - self.completed - self.failed - self.skipped
        if self.tiles_per_second > 0:
            return timedelta(seconds=remaining / self.tiles_per_second)
        return None


def format_bytes(size: int) -> str:
    """Format bytes to human readable string"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def lon_to_tile_x(lon: float, zoom: int) -> int:
    """Convert longitude to tile X coordinate"""
    return int((lon + 180.0) / 360.0 * (1 << zoom))


def lat_to_tile_y(lat: float, zoom: int) -> int:
    """Convert latitude to tile Y coordinate (XYZ scheme, NOT TMS)"""
    lat_rad = math.radians(lat)
    n = 1 << zoom
    return int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)


def tile_y_to_tms(y: int, zoom: int) -> int:
    """Convert XYZ Y coordinate to TMS Y coordinate"""
    return (1 << zoom) - 1 - y


def tile_to_bounds(z: int, x: int, y: int) -> Tuple[float, float, float, float]:
    """Convert tile coordinates to lat/lon bounds (west, south, east, north)"""
    n = 1 << z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return (west, south, east, north)


def get_tiles_for_bounds(bounds: dict, min_zoom: int, max_zoom: int) -> List[Tuple[int, int, int]]:
    """Get list of (z, x, y) tiles covering the bounds"""
    tiles = []
    
    for z in range(min_zoom, max_zoom + 1):
        x_min = lon_to_tile_x(bounds['west'], z)
        x_max = lon_to_tile_x(bounds['east'], z)
        y_min = lat_to_tile_y(bounds['north'], z)  # Note: north gives smaller y
        y_max = lat_to_tile_y(bounds['south'], z)
        
        for x in range(x_min, x_max + 1):
            for y in range(y_min, y_max + 1):
                tiles.append((z, x, y))
    
    return tiles


def load_poi_file() -> Optional[Dict[str, Any]]:
    """Load the Alaska POI file"""
    if not POI_FILE.exists():
        print(f"Warning: POI file not found at {POI_FILE}")
        return None
    
    with open(POI_FILE, 'r') as f:
        return json.load(f)


def load_coastline(coastline_path: Path = None) -> Optional[Dict[str, Any]]:
    """Load the coastline GeoJSON file"""
    path = coastline_path or COASTLINE_FILE
    if not path.exists():
        print(f"Warning: Coastline file not found at {path}")
        return None
    
    with open(path, 'r') as f:
        return json.load(f)


def nm_to_degrees(nm: float, lat: float) -> Tuple[float, float]:
    """Convert nautical miles to degrees at a given latitude"""
    # 1 nm = 1 arcminute of latitude
    lat_deg = nm / 60
    # Longitude degrees vary with latitude
    lon_deg = nm / (60 * math.cos(math.radians(lat)))
    return lat_deg, lon_deg


def get_poi_bounds(poi: Dict[str, Any], default_radius: float, radius_override: Optional[float] = None) -> dict:
    """Get bounding box around a POI"""
    lat = poi['lat']
    lon = poi['lon']
    radius = radius_override or poi.get('radius_nm', default_radius)
    
    lat_deg, lon_deg = nm_to_degrees(radius, lat)
    
    return {
        'west': lon - lon_deg,
        'east': lon + lon_deg,
        'south': lat - lat_deg,
        'north': lat + lat_deg,
    }


def get_tiles_for_pois(poi_data: Dict[str, Any], min_zoom: int, max_zoom: int, radius_override: Optional[float] = None) -> Set[Tuple[int, int, int]]:
    """Get all tiles needed to cover POI areas"""
    tiles = set()
    default_radii = poi_data.get('default_radius_nm', {})
    
    # Process cities
    for city_type in ['major', 'minor']:
        cities = poi_data.get('cities', {}).get(city_type, [])
        default_radius = default_radii.get(f'city_{city_type}', 5)
        for city in cities:
            bounds = get_poi_bounds(city, default_radius, radius_override)
            tiles.update(get_tiles_for_bounds(bounds, min_zoom, max_zoom))
    
    # Process harbors
    default_radius = default_radii.get('harbor', 3)
    for harbor in poi_data.get('harbors', []):
        bounds = get_poi_bounds(harbor, default_radius, radius_override)
        tiles.update(get_tiles_for_bounds(bounds, min_zoom, max_zoom))
    
    # Process bays and inlets
    default_radius = default_radii.get('bay', 8)
    for bay in poi_data.get('bays_inlets', []):
        bounds = get_poi_bounds(bay, default_radius, radius_override)
        tiles.update(get_tiles_for_bounds(bounds, min_zoom, max_zoom))
    
    # Process river mouths
    default_radius = default_radii.get('river_mouth', 5)
    for river in poi_data.get('rivers_mouths', []):
        bounds = get_poi_bounds(river, default_radius, radius_override)
        tiles.update(get_tiles_for_bounds(bounds, min_zoom, max_zoom))
    
    # Process passes and narrows
    default_radius = default_radii.get('pass', 3)
    for pass_entry in poi_data.get('passes_narrows', []):
        bounds = get_poi_bounds(pass_entry, default_radius, radius_override)
        tiles.update(get_tiles_for_bounds(bounds, min_zoom, max_zoom))
    
    # Process anchorages
    default_radius = default_radii.get('anchorage', 2)
    for anchorage in poi_data.get('anchorages', []):
        bounds = get_poi_bounds(anchorage, default_radius, radius_override)
        tiles.update(get_tiles_for_bounds(bounds, min_zoom, max_zoom))
    
    return tiles


def get_tiles_for_coastline_buffer(coastline_data: Dict[str, Any], zoom: int, buffer_nm: float = 10) -> Set[Tuple[int, int, int]]:
    """
    Get tiles covering the buffered coastline at a specific zoom level.
    
    Buffer is +/- buffer_nm from coastline:
    - buffer_nm inland (covers coastal terrain, rivers, bays)
    - buffer_nm seaward (covers nearshore waters)
    Total coverage width: 2 * buffer_nm
    
    Args:
        coastline_data: GeoJSON FeatureCollection of coastline
        zoom: Zoom level to generate tiles for
        buffer_nm: Buffer distance in nautical miles (applied both sides)
    
    Returns:
        Set of (z, x, y) tile coordinates
    """
    if not SHAPELY_AVAILABLE:
        print("Error: Shapely is required for coastal buffer. Install with: pip install shapely")
        return set()
    
    # Convert nm to degrees (approximate at 60N latitude)
    # 1 degree latitude = 60nm, so buffer_nm / 60 degrees
    # This is approximate - at higher latitudes it's slightly more
    buffer_deg = buffer_nm / 60.0
    
    print(f"  Buffering coastline by {buffer_nm}nm ({buffer_deg:.4f}°)...")
    
    # Collect all coastline geometries
    geometries = []
    for feature in coastline_data['features']:
        try:
            geom = shape(feature['geometry'])
            if geom.is_valid:
                geometries.append(geom)
        except Exception as e:
            continue
    
    if not geometries:
        print("  Warning: No valid geometries found in coastline")
        return set()
    
    print(f"  Processing {len(geometries)} coastline segments...")
    
    # Union all geometries and buffer
    try:
        combined = unary_union(geometries)
        buffered = combined.buffer(buffer_deg)
    except Exception as e:
        print(f"  Error buffering coastline: {e}")
        return set()
    
    # Get the bounding box of the buffered area
    minx, miny, maxx, maxy = buffered.bounds
    
    # Calculate tile range
    x_min = lon_to_tile_x(minx, zoom)
    x_max = lon_to_tile_x(maxx, zoom)
    y_min = lat_to_tile_y(maxy, zoom)  # Note: north (max lat) gives smaller y
    y_max = lat_to_tile_y(miny, zoom)
    
    print(f"  Tile range: x={x_min}-{x_max}, y={y_min}-{y_max}")
    print(f"  Checking {(x_max - x_min + 1) * (y_max - y_min + 1)} potential tiles...")
    
    # Check each tile for intersection with buffered coastline
    tiles = set()
    checked = 0
    for x in range(x_min, x_max + 1):
        for y in range(y_min, y_max + 1):
            # Get tile bounds
            west, south, east, north = tile_to_bounds(zoom, x, y)
            tile_box = shapely_box(west, south, east, north)
            
            # Check if tile intersects buffered coastline
            if buffered.intersects(tile_box):
                tiles.add((zoom, x, y))
            
            checked += 1
            if checked % 10000 == 0:
                print(f"    Checked {checked} tiles, found {len(tiles)} so far...")
    
    print(f"  Found {len(tiles)} tiles intersecting coastal buffer")
    return tiles


def estimate_tile_count(min_zoom: int, max_zoom: int) -> int:
    """Estimate total tiles for Alaska"""
    total = 0
    for region in [ALASKA_MAIN, ALASKA_ALEUTIANS_EAST]:
        total += len(get_tiles_for_bounds(region, min_zoom, max_zoom))
    return total


def init_mbtiles(db_path: Path, min_zoom: int, max_zoom: int, name: str = "Alaska Satellite") -> sqlite3.Connection:
    """Initialize MBTiles database with proper schema"""
    # Create parent directory if needed
    db_path.parent.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    # Create tables
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS metadata (
            name TEXT PRIMARY KEY,
            value TEXT
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tiles (
            zoom_level INTEGER,
            tile_column INTEGER,
            tile_row INTEGER,
            tile_data BLOB,
            PRIMARY KEY (zoom_level, tile_column, tile_row)
        )
    ''')
    
    # Create index for faster lookups
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS tiles_idx ON tiles (zoom_level, tile_column, tile_row)
    ''')
    
    # Set metadata
    metadata = {
        'name': name,
        'type': 'baselayer',
        'version': '1.0',
        'description': 'ESRI World Imagery satellite tiles',
        'format': 'jpg',  # ESRI serves JPEG
        'bounds': '-180,51,-129,72',
        'center': '-152,62,9',
        'minzoom': str(min_zoom),
        'maxzoom': str(max_zoom),
        'attribution': 'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    }
    
    for name_key, value in metadata.items():
        cursor.execute(
            'INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)',
            (name_key, value)
        )
    
    conn.commit()
    return conn


def get_existing_tiles(conn: sqlite3.Connection) -> Set[Tuple[int, int, int]]:
    """Get set of tiles already in database (for resume support)"""
    cursor = conn.cursor()
    cursor.execute('SELECT zoom_level, tile_column, tile_row FROM tiles')
    # Convert TMS y back to XYZ y for comparison
    existing = set()
    for z, x, tms_y in cursor.fetchall():
        xyz_y = tile_y_to_tms(tms_y, z)  # TMS to XYZ conversion
        existing.add((z, x, xyz_y))
    return existing


def create_display(stats: DownloadStats) -> Layout:
    """Create Rich display layout"""
    layout = Layout()
    
    # Progress calculation
    progress_pct = (stats.completed + stats.skipped) / stats.total_tiles * 100 if stats.total_tiles > 0 else 0
    bar_width = 40
    filled = int(bar_width * progress_pct / 100)
    bar = "█" * filled + "░" * (bar_width - filled)
    
    eta_str = str(stats.eta).split('.')[0] if stats.eta else "calculating..."
    elapsed_str = str(stats.elapsed).split('.')[0]
    
    content = Text()
    content.append("Progress: ", style="bold")
    content.append(f"[{bar}] ", style="cyan")
    content.append(f"{progress_pct:.1f}%\n\n", style="bold green")
    
    content.append(f"  🗺️  Total Tiles:     {stats.total_tiles:,}\n", style="white")
    content.append(f"  ✅ Downloaded:      {stats.completed:,}\n", style="green")
    content.append(f"  ⏭️  Skipped:         {stats.skipped:,}\n", style="yellow")
    content.append(f"  ❌ Failed:          {stats.failed:,}\n", style="red")
    content.append(f"  📥 Data:            {format_bytes(stats.total_bytes)}\n", style="cyan")
    content.append(f"  🔍 Current Zoom:    z{stats.current_zoom}\n", style="magenta")
    content.append(f"  ⚡ Speed:           {stats.tiles_per_second:.1f} tiles/sec\n", style="magenta")
    content.append(f"  ⏱️  Elapsed:         {elapsed_str}\n", style="white")
    content.append(f"  🏁 ETA:             {eta_str}", style="white")
    
    panel = Panel(
        content,
        title="[bold blue]🛰️  Satellite Tile Download[/bold blue]",
        subtitle=f"[dim]{MAX_CONCURRENT} concurrent downloads[/dim]",
        box=box.ROUNDED,
        border_style="blue",
    )
    
    layout.split_column(
        Layout(panel, name="header"),
    )
    
    return layout


async def download_tile(
    session: aiohttp.ClientSession,
    conn: sqlite3.Connection,
    z: int, x: int, y: int,
    stats: DownloadStats,
    semaphore: asyncio.Semaphore,
    db_lock: asyncio.Lock,
) -> bool:
    """Download a single tile and store in MBTiles"""
    async with semaphore:
        url = TILE_URL_TEMPLATE.format(z=z, y=y, x=x)
        
        try:
            # Small delay to be respectful
            await asyncio.sleep(REQUEST_DELAY)
            
            async with session.get(url) as response:
                if response.status == 200:
                    tile_data = await response.read()
                    stats.total_bytes += len(tile_data)
                    
                    # Convert Y to TMS for storage
                    tms_y = tile_y_to_tms(y, z)
                    
                    # Store in database
                    async with db_lock:
                        cursor = conn.cursor()
                        cursor.execute(
                            'INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
                            (z, x, tms_y, tile_data)
                        )
                        conn.commit()
                    
                    stats.completed += 1
                    return True
                else:
                    stats.failed += 1
                    stats.failed_tiles.append((z, x, y, f"HTTP {response.status}"))
                    return False
                    
        except asyncio.CancelledError:
            raise
        except Exception as e:
            stats.failed += 1
            stats.failed_tiles.append((z, x, y, str(e)))
            return False


async def download_zoom_level(
    session: aiohttp.ClientSession,
    conn: sqlite3.Connection,
    tiles: List[Tuple[int, int, int]],
    existing_tiles: Set[Tuple[int, int, int]],
    stats: DownloadStats,
    live: Optional[Live],
) -> None:
    """Download all tiles for a zoom level"""
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    db_lock = asyncio.Lock()
    
    # Filter out existing tiles
    tiles_to_download = [t for t in tiles if t not in existing_tiles]
    stats.skipped += len(tiles) - len(tiles_to_download)
    
    if not tiles_to_download:
        return
    
    # Create download tasks
    tasks = []
    for z, x, y in tiles_to_download:
        task = asyncio.create_task(
            download_tile(session, conn, z, x, y, stats, semaphore, db_lock)
        )
        tasks.append(task)
    
    # Wait for all tasks
    await asyncio.gather(*tasks, return_exceptions=True)


async def main(min_zoom: int, max_zoom: int, resume: bool, all_tiles: List[Tuple[int, int, int]], output_path: Path, db_name: str):
    """Main download orchestrator"""
    # Sort by zoom level for orderly processing
    all_tiles = sorted(all_tiles, key=lambda t: (t[0], t[1], t[2]))
    
    # Initialize database
    conn = init_mbtiles(output_path, min_zoom, max_zoom, db_name)
    
    # Get existing tiles for resume support
    existing_tiles = get_existing_tiles(conn) if resume else set()
    
    # Initialize stats
    stats = DownloadStats(total_tiles=len(all_tiles))
    
    # Print startup info
    estimated_size = len(all_tiles) * 25000  # ~25KB avg per tile
    
    if RICH_AVAILABLE:
        console.clear()
        console.print(Panel(
            f"[bold]Satellite Tile Download[/bold]\n\n"
            f"  🔍 Zoom levels:  z{min_zoom} - z{max_zoom}\n"
            f"  🗺️  Total tiles:  {len(all_tiles):,}\n"
            f"  📦 Est. size:    {format_bytes(estimated_size)}\n"
            f"  📂 Output:       {output_path}\n"
            f"  🔄 Resume:       {'Yes' if resume else 'No'} ({len(existing_tiles):,} existing tiles)",
            title="[bold blue]Configuration[/bold blue]",
            border_style="blue",
        ))
        await asyncio.sleep(2)
    else:
        print(f"\nSatellite Tile Download")
        print(f"  Zoom levels: z{min_zoom} - z{max_zoom}")
        print(f"  Total tiles: {len(all_tiles):,}")
        print(f"  Estimated size: {format_bytes(estimated_size)}")
        print(f"  Output: {output_path}")
        print(f"  Existing tiles: {len(existing_tiles):,}")
        print()
    
    # Configure HTTP client
    timeout = aiohttp.ClientTimeout(total=60, connect=10)
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT * 2, limit_per_host=MAX_CONCURRENT)
    headers = {
        'User-Agent': 'XNautical/1.0 (Offline Nautical Charts)',
        'Referer': 'https://xnautical.app',
    }
    
    async with aiohttp.ClientSession(timeout=timeout, connector=connector, headers=headers) as session:
        if RICH_AVAILABLE:
            with Live(create_display(stats), console=console, refresh_per_second=4) as live:
                # Process by zoom level
                for z in range(min_zoom, max_zoom + 1):
                    stats.current_zoom = z
                    zoom_tiles = [t for t in all_tiles if t[0] == z]
                    await download_zoom_level(session, conn, zoom_tiles, existing_tiles, stats, live)
                    live.update(create_display(stats))
                    
                    # Commit after each zoom level
                    conn.commit()
        else:
            # Simple progress without Rich
            for z in range(min_zoom, max_zoom + 1):
                stats.current_zoom = z
                zoom_tiles = [t for t in all_tiles if t[0] == z]
                print(f"Downloading z{z}: {len(zoom_tiles)} tiles...")
                await download_zoom_level(session, conn, zoom_tiles, existing_tiles, stats, None)
                conn.commit()
                print(f"  Completed: {stats.completed}, Failed: {stats.failed}")
    
    # Close database
    conn.close()
    
    # Final size
    final_size = output_path.stat().st_size
    elapsed_str = str(stats.elapsed).split('.')[0]
    
    if RICH_AVAILABLE:
        if stats.failed == 0:
            console.print(Panel(
                f"[bold green]✅ Download Complete![/bold green]\n\n"
                f"  📥 Tiles downloaded: {stats.completed:,}\n"
                f"  ⏭️  Tiles skipped:    {stats.skipped:,}\n"
                f"  📦 File size:        {format_bytes(final_size)}\n"
                f"  ⏱️  Time elapsed:     {elapsed_str}\n\n"
                f"  📂 Output: {output_path}",
                title="[bold green]Success[/bold green]",
                border_style="green",
            ))
        else:
            console.print(Panel(
                f"[bold yellow]⚠️ Download Complete with Errors[/bold yellow]\n\n"
                f"  📥 Tiles downloaded: {stats.completed:,}\n"
                f"  ⏭️  Tiles skipped:    {stats.skipped:,}\n"
                f"  ❌ Tiles failed:     {stats.failed:,}\n"
                f"  📦 File size:        {format_bytes(final_size)}\n"
                f"  ⏱️  Time elapsed:     {elapsed_str}\n\n"
                f"  📂 Output: {output_path}\n\n"
                f"  💡 Run with --resume to retry failed tiles",
                title="[bold yellow]Complete with Errors[/bold yellow]",
                border_style="yellow",
            ))
    else:
        print(f"\nDownload complete!")
        print(f"  Downloaded: {stats.completed:,} tiles")
        print(f"  Skipped: {stats.skipped:,} tiles")
        print(f"  Failed: {stats.failed:,} tiles")
        print(f"  File size: {format_bytes(final_size)}")
        print(f"  Output: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Download satellite tiles and package into MBTiles",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Coastal buffer per-zoom files (recommended for Alaska z9-14)
    python scripts/generate_satellite.py --coastal-buffer --single-zoom 9 -o charts/satellite/satellite_z9.mbtiles
    python scripts/generate_satellite.py --coastal-buffer --single-zoom 10 -o charts/satellite/satellite_z10.mbtiles
    python scripts/generate_satellite.py --coastal-buffer --single-zoom 11 -o charts/satellite/satellite_z11.mbtiles
    python scripts/generate_satellite.py --coastal-buffer --single-zoom 12 -o charts/satellite/satellite_z12.mbtiles
    python scripts/generate_satellite.py --coastal-buffer --single-zoom 13 -o charts/satellite/satellite_z13.mbtiles
    python scripts/generate_satellite.py --coastal-buffer --single-zoom 14 -o charts/satellite/satellite_z14.mbtiles
    
    # Base layer files
    python scripts/generate_satellite.py --world --max-zoom 5 -o charts/satellite/satellite_z0-5.mbtiles
    python scripts/generate_satellite.py --north-pacific -o charts/satellite/satellite_z6-7.mbtiles
    python scripts/generate_satellite.py --alaska-only --single-zoom 8 -o charts/satellite/satellite_z8.mbtiles
    
    # Legacy full-coverage modes
    python scripts/generate_satellite.py                         # Default z8-12, full Alaska
    python scripts/generate_satellite.py --max-zoom 14           # Higher detail (large!)
    python scripts/generate_satellite.py --resume                # Resume download
    python scripts/generate_satellite.py --poi-only --max-zoom 14  # Only POI areas
        """
    )
    
    # Output options
    parser.add_argument(
        '-o', '--output', type=str, default=None,
        help='Output MBTiles file path (default: charts/Satellite/satellite_alaska.mbtiles)'
    )
    
    # Zoom options
    parser.add_argument(
        '--min-zoom', type=int, default=DEFAULT_MIN_ZOOM,
        help=f'Minimum zoom level (default: {DEFAULT_MIN_ZOOM})'
    )
    parser.add_argument(
        '--max-zoom', type=int, default=DEFAULT_MAX_ZOOM,
        help=f'Maximum zoom level (default: {DEFAULT_MAX_ZOOM})'
    )
    parser.add_argument(
        '--single-zoom', type=int, default=None,
        help='Generate only this zoom level (overrides min/max-zoom)'
    )
    
    # Coverage mode options
    parser.add_argument(
        '--coastal-buffer', action='store_true',
        help='Use coastal buffer mode: tiles within buffer-nm of coastline'
    )
    parser.add_argument(
        '--buffer-nm', type=float, default=10,
        help='Buffer distance in nautical miles, +/- from coastline (default: 10, giving 20nm total width)'
    )
    parser.add_argument(
        '--coastline', type=str, default=None,
        help=f'Path to coastline GeoJSON (default: {COASTLINE_FILE})'
    )
    parser.add_argument(
        '--world', action='store_true',
        help='Generate world coverage (use with --max-zoom to limit)'
    )
    parser.add_argument(
        '--north-pacific', action='store_true',
        help='Generate North Pacific coverage at z6-7'
    )
    parser.add_argument(
        '--alaska-only', action='store_true',
        help='Generate full Alaska coverage (all of Alaska bounds)'
    )
    
    # POI options (legacy)
    parser.add_argument(
        '--poi-only', action='store_true',
        help='Only download tiles around POIs (cities, harbors, bays, etc.)'
    )
    parser.add_argument(
        '--poi-zoom', type=int, default=None,
        help='Zoom level at which to start using POI filtering (full coverage below this)'
    )
    parser.add_argument(
        '--poi-radius', type=float, default=None,
        help='Override all POI radii with this value (nautical miles)'
    )
    
    # Other options
    parser.add_argument(
        '--resume', action='store_true',
        help='Resume interrupted download (skip existing tiles)'
    )
    
    args = parser.parse_args()
    
    # Handle single-zoom option
    if args.single_zoom is not None:
        args.min_zoom = args.single_zoom
        args.max_zoom = args.single_zoom
    
    # Determine output path
    if args.output:
        output_path = Path(args.output)
    else:
        output_path = OUTPUT_DIR / OUTPUT_FILE
    
    # Create output directory
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Load data files as needed
    poi_data = None
    coastline_data = None
    
    if args.poi_only or args.poi_zoom:
        poi_data = load_poi_file()
        if poi_data is None:
            print("Error: POI filtering requested but POI file not found")
            print(f"Expected at: {POI_FILE}")
            exit(1)
    
    if args.coastal_buffer:
        coastline_path = Path(args.coastline) if args.coastline else COASTLINE_FILE
        coastline_data = load_coastline(coastline_path)
        if coastline_data is None:
            print("Error: Coastal buffer requested but coastline file not found")
            print(f"Expected at: {coastline_path}")
            print("Download with: ogr2ogr -f GeoJSON -clipsrc -180 50 -128 73 alaska_coastline.geojson ne_10m_coastline.shp")
            exit(1)
        if not SHAPELY_AVAILABLE:
            print("Error: Coastal buffer requires shapely. Install with: pip install shapely")
            exit(1)
    
    # Calculate tiles based on mode
    all_tiles_set = set()
    mode_parts = []
    db_name = "Satellite"
    
    if args.world:
        # World coverage
        world_tiles = get_tiles_for_bounds(WORLD, args.min_zoom, args.max_zoom)
        all_tiles_set.update(world_tiles)
        mode_parts.append(f"World z{args.min_zoom}-{args.max_zoom}")
        db_name = f"World Satellite z{args.min_zoom}-{args.max_zoom}"
    
    elif args.north_pacific:
        # North Pacific coverage (z6-7 by default)
        min_z = args.min_zoom if args.single_zoom else 6
        max_z = args.max_zoom if args.single_zoom else 7
        for region in [NORTH_PACIFIC_WEST, NORTH_PACIFIC_EAST]:
            tiles = get_tiles_for_bounds(region, min_z, max_z)
            all_tiles_set.update(tiles)
        mode_parts.append(f"North Pacific z{min_z}-{max_z}")
        db_name = f"North Pacific Satellite z{min_z}-{max_z}"
    
    elif args.coastal_buffer:
        # Coastal buffer mode
        print(f"\nCalculating coastal buffer tiles for z{args.min_zoom}-{args.max_zoom}...")
        print(f"Buffer: +/- {args.buffer_nm}nm from coastline ({args.buffer_nm * 2}nm total width)")
        
        for z in range(args.min_zoom, args.max_zoom + 1):
            print(f"\nProcessing z{z}...")
            zoom_tiles = get_tiles_for_coastline_buffer(coastline_data, z, args.buffer_nm)
            all_tiles_set.update(zoom_tiles)
        
        mode_parts.append(f"Coastal buffer z{args.min_zoom}-{args.max_zoom} (+/-{args.buffer_nm}nm)")
        db_name = f"Alaska Coastal z{args.min_zoom}" if args.single_zoom else f"Alaska Coastal z{args.min_zoom}-{args.max_zoom}"
    
    elif args.alaska_only:
        # Full Alaska coverage
        for region in [ALASKA_MAIN, ALASKA_ALEUTIANS_EAST]:
            tiles = get_tiles_for_bounds(region, args.min_zoom, args.max_zoom)
            all_tiles_set.update(tiles)
        mode_parts.append(f"Alaska full z{args.min_zoom}-{args.max_zoom}")
        db_name = f"Alaska Satellite z{args.min_zoom}" if args.single_zoom else f"Alaska Satellite z{args.min_zoom}-{args.max_zoom}"
    
    elif args.poi_only:
        # Only POI tiles at all zoom levels
        poi_tiles = get_tiles_for_pois(poi_data, args.min_zoom, args.max_zoom, args.poi_radius)
        all_tiles_set.update(poi_tiles)
        mode_parts.append(f"POI-only z{args.min_zoom}-{args.max_zoom}")
        db_name = f"Alaska POI Satellite z{args.min_zoom}-{args.max_zoom}"
    
    elif args.poi_zoom:
        # Full coverage below poi_zoom, POI-only at and above
        for region in [ALASKA_MAIN, ALASKA_ALEUTIANS_EAST]:
            full_tiles = get_tiles_for_bounds(region, args.min_zoom, args.poi_zoom - 1)
            all_tiles_set.update(full_tiles)
        poi_tiles = get_tiles_for_pois(poi_data, args.poi_zoom, args.max_zoom, args.poi_radius)
        all_tiles_set.update(poi_tiles)
        mode_parts.append(f"Alaska full z{args.min_zoom}-{args.poi_zoom-1}, POI z{args.poi_zoom}-{args.max_zoom}")
        db_name = f"Alaska Satellite z{args.min_zoom}-{args.max_zoom}"
    
    else:
        # Default: Full Alaska coverage
        for region in [ALASKA_MAIN, ALASKA_ALEUTIANS_EAST]:
            full_tiles = get_tiles_for_bounds(region, args.min_zoom, args.max_zoom)
            all_tiles_set.update(full_tiles)
        mode_parts.append(f"Alaska full z{args.min_zoom}-{args.max_zoom}")
        db_name = f"Alaska Satellite z{args.min_zoom}-{args.max_zoom}"
    
    all_tiles = list(all_tiles_set)
    mode_desc = " + ".join(mode_parts)
    
    # Determine actual min/max zoom from tiles
    if all_tiles:
        actual_min_zoom = min(t[0] for t in all_tiles)
        actual_max_zoom = max(t[0] for t in all_tiles)
    else:
        actual_min_zoom = args.min_zoom
        actual_max_zoom = args.max_zoom
    
    # Print tile count estimate
    print(f"\nMode: {mode_desc}")
    print(f"Zoom range: z{actual_min_zoom}-{actual_max_zoom}")
    print(f"Total tiles: {len(all_tiles):,}")
    print(f"Estimated size: {format_bytes(len(all_tiles) * 25000)}")
    print(f"Output: {output_path}")
    
    # Breakdown by zoom
    print("\nBreakdown by zoom:")
    for z in range(actual_min_zoom, actual_max_zoom + 1):
        count = len([t for t in all_tiles if t[0] == z])
        if count > 0:
            size_str = format_bytes(count * 25000)
            print(f"  z{z}: {count:>8,} tiles ({size_str})")
    print()
    
    if len(all_tiles) == 0:
        print("No tiles to download!")
        exit(0)
    
    try:
        asyncio.run(main(actual_min_zoom, actual_max_zoom, args.resume, all_tiles, output_path, db_name))
    except KeyboardInterrupt:
        print("\n\nDownload cancelled. Run with --resume to continue.")
