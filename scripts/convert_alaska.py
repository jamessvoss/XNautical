#!/usr/bin/env python3
"""
Convert S-57 ENC cells to MBTiles with hybrid output strategy.

Phase 1: Generate per-chart MBTiles (individual files in mirrored hierarchy)
Phase 2: Combine into regional packs using tile-join

Output Structure:
  converted/
  ├── per_chart/
  │   ├── US1AK90M/
  │   │   └── US1AK90M.mbtiles
  │   ├── US3AK12M/
  │   │   └── US3AK12M.mbtiles
  │   └── ...
  ├── regional/
  │   ├── alaska_full.mbtiles
  │   ├── alaska_overview.mbtiles
  │   ├── alaska_coastal.mbtiles
  │   └── alaska_detail.mbtiles
  └── temp/

Usage:
  python convert_alaska.py                    # Convert all charts (5 parallel workers)
  python convert_alaska.py --chart US5AK5SI   # Convert single chart (for updates)
  python convert_alaska.py --regional-only    # Rebuild regional packs from existing per-chart files
  python convert_alaska.py --parallel 8       # Use 8 parallel workers

Requirements:
  pip install rich
"""

import subprocess
import json
import math
import argparse
import sys
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
import time
import threading
from collections import defaultdict

# Add cloud-functions/enc-converter to path for canonical convert.py
_SCRIPT_DIR = Path(__file__).parent
_CONVERTER_DIR = _SCRIPT_DIR.parent / 'cloud-functions' / 'enc-converter'
sys.path.insert(0, str(_CONVERTER_DIR))

from convert import convert_chart as _convert_chart_canonical

# Try to import rich, provide fallback message if not installed
try:
    from rich.console import Console
    from rich.live import Live
    from rich.table import Table
    from rich.panel import Panel
    from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn, TimeRemainingColumn, SpinnerColumn
    from rich.layout import Layout
    from rich.text import Text
    from rich import box
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False

# =============================================================================
# Configuration
# =============================================================================

# Safety-critical feature categories
HAZARD_LAYERS = {'UWTROC', 'WRECKS', 'OBSTRN', 'CTNARE', 'WATTUR', 'ROCK'}
NAVIGATION_AIDS = {
    'LIGHTS', 'BOYLAT', 'BCNLAT', 'BCNSPP', 'BOYSAW', 'BOYSPP',
    'BCNCAR', 'BOYCAR', 'FOGSIG', 'RTPBCN', 'PILPNT', 'DAYMAR'
}

# OBJL code to layer name mapping (S-57 standard)
# OBJL code to layer name mapping (IHO S-57 Edition 3.1)
OBJL_TO_LAYER = {
    3: 'ACHBRT', 4: 'ACHARE',
    5: 'BCNCAR', 6: 'BCNISD', 7: 'BCNLAT', 8: 'BCNSAW', 9: 'BCNSPP',
    11: 'BRIDGE', 12: 'BUISGL',
    14: 'BOYCAR', 15: 'BOYINB', 16: 'BOYISD', 17: 'BOYLAT', 18: 'BOYSAW', 19: 'BOYSPP',
    20: 'CBLARE', 21: 'CBLOHD', 22: 'CBLSUB',
    27: 'CTNARE', 30: 'COALNE',
    39: 'DAYMAR', 42: 'DEPARE', 43: 'DEPCNT', 46: 'DRGARE',
    51: 'FAIRWY', 58: 'FOGSIG',
    71: 'LNDARE', 74: 'LNDMRK', 75: 'LIGHTS',
    82: 'MARCUL', 83: 'MIPARE', 84: 'MORFAC', 86: 'OBSTRN',
    92: 'PIPARE', 94: 'PIPSOL',
    112: 'RESARE', 121: 'SBDARE', 129: 'SOUNDG',
    153: 'UWTROC', 156: 'WATTUR', 159: 'WRECKS',
}

# Zoom ranges by scale band
# Extended 4 zooms earlier for detail charts to support user-configurable detail level
SCALE_ZOOM_RANGES = {
    'US1': (0, 8),    # Overview - unchanged
    'US2': (0, 10),   # General - unchanged
    'US3': (4, 13),   # Coastal - was 8, now 4 (4 zooms earlier)
    'US4': (6, 16),   # Approach - was 10, now 6 (4 zooms earlier)
    'US5': (8, 18),   # Harbor - was 12, now 8 (4 zooms earlier)
    'US6': (6, 18),   # Berthing - was 14, now 6 (8 zooms earlier for early harbor detail)
}

# Paths
ENC_ROOT = Path('/Users/jvoss/Documents/XNautical/charts/All_Alaska_ENC_ROOT')
OUTPUT_DIR = Path('/Users/jvoss/Documents/XNautical/charts/converted')


# =============================================================================
# SCAMIN Handling
# =============================================================================

def scamin_to_zoom(scamin: int) -> int:
    """Convert S-57 SCAMIN to Mapbox zoom level."""
    if scamin is None or scamin <= 0:
        return 0
    zoom = 28 - math.log2(scamin)
    return max(0, min(22, int(zoom)))


def get_minzoom(layer: str, scamin: int) -> int:
    """Calculate minzoom with safety buffer for hazards."""
    if layer in NAVIGATION_AIDS:
        return 0
    if not scamin:
        return 0
    base_zoom = scamin_to_zoom(scamin)
    if layer in HAZARD_LAYERS:
        return max(0, base_zoom - 1)
    return base_zoom


# =============================================================================
# Metadata Extraction
# =============================================================================

def extract_compilation_scale(s57_path: str) -> int:
    """Extract DSPM_CSCL (compilation scale) from DSID layer."""
    result = subprocess.run(
        ['ogrinfo', s57_path, 'DSID'],
        capture_output=True, text=True
    )
    for line in result.stdout.split('\n'):
        if 'DSPM_CSCL' in line and '=' in line:
            try:
                return int(line.split('=')[1].strip())
            except (ValueError, IndexError):
                pass
    return 0


# =============================================================================
# Single Chart Conversion
# =============================================================================

def convert_single_chart(s57_path: str, output_base: Path, quiet: bool = True) -> dict:
    """
    Convert a single S-57 chart to MBTiles by calling convert.py as a subprocess.
    
    Args:
        s57_path: Path to .000 file
        output_base: Base output directory
        quiet: If True, capture output (for batch mode dashboard).
               If False, show output in real time (for single chart mode).
    
    Returns a dict for dashboard compatibility.
    """
    chart_id = Path(s57_path).stem
    scale_band = chart_id[:3]
    
    result = {
        'chart_id': chart_id,
        'scale_band': scale_band,
        'success': False,
        'features': 0,
        'size_mb': 0,
        'error': None,
        'elapsed': 0,
        'log': ''
    }
    
    start = time.time()
    
    try:
        # Output directory for per-chart files
        chart_output_dir = output_base / 'per_chart' / chart_id
        chart_output_dir.mkdir(parents=True, exist_ok=True)
        
        # Path to canonical converter script
        converter_script = _CONVERTER_DIR / 'convert.py'
        
        cmd = [
            sys.executable,
            str(converter_script),
            s57_path,
            str(chart_output_dir)
        ]
        
        if quiet:
            # Batch mode: capture all output for dashboard
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=str(_CONVERTER_DIR)
            )
            result['log'] = proc.stdout + proc.stderr
            returncode = proc.returncode
        else:
            # Single chart mode: show output in real time
            proc = subprocess.run(
                cmd,
                cwd=str(_CONVERTER_DIR)
            )
            returncode = proc.returncode
        
        # Check for output file
        expected_mbtiles = chart_output_dir / f"{chart_id}.mbtiles"
        
        if returncode == 0 and expected_mbtiles.exists():
            result['size_mb'] = expected_mbtiles.stat().st_size / 1024 / 1024
            result['success'] = True
        else:
            # Try to find mbtiles file even if return code was non-zero
            mbtiles_files = list(chart_output_dir.glob('*.mbtiles'))
            if mbtiles_files:
                result['size_mb'] = mbtiles_files[0].stat().st_size / 1024 / 1024
                result['success'] = True
            else:
                error_msg = 'MBTiles file not created'
                if quiet and result.get('log'):
                    # Extract error from captured output
                    error_msg = result['log'].strip().split('\n')[-1][:200]
                result['error'] = error_msg
        
    except Exception as e:
        result['error'] = str(e)
    
    result['elapsed'] = time.time() - start
    return result


# =============================================================================
# Regional Pack Building
# =============================================================================

def check_for_skipped_tiles(stderr: str, context: str = "") -> None:
    """Check tile-join output for skipped tiles and FAIL LOUDLY if any are found."""
    skipped_lines = [line for line in stderr.split('\n') if 'Skipping this tile' in line]
    if skipped_lines:
        print("\n" + "=" * 70, file=sys.stderr)
        print("ERROR: tile-join DROPPED TILES due to size limits!", file=sys.stderr)
        print("=" * 70, file=sys.stderr)
        print(f"Context: {context}", file=sys.stderr)
        print(f"Skipped {len(skipped_lines)} tile(s):", file=sys.stderr)
        for line in skipped_lines[:10]:  # Show first 10
            print(f"  {line.strip()}", file=sys.stderr)
        if len(skipped_lines) > 10:
            print(f"  ... and {len(skipped_lines) - 10} more", file=sys.stderr)
        print("=" * 70, file=sys.stderr)
        print("This should NEVER happen! The --no-tile-size-limit flag should be set.", file=sys.stderr)
        print("=" * 70 + "\n", file=sys.stderr)
        raise RuntimeError(f"tile-join dropped {len(skipped_lines)} tiles! Fix the tile-join command.")


def merge_mbtiles_batch(input_files: list, output_path: Path, name: str, description: str,
                        progress_callback=None) -> tuple:
    """Merge a batch of MBTiles files, handling large batches by chunking."""
    if not input_files:
        return (0, 0, 'No input files')
    
    # If small batch, merge directly
    if len(input_files) <= 100:
        if progress_callback:
            progress_callback(f"Merging {len(input_files)} files...", 0, 1)
        
        cmd = [
            'tile-join',
            '-o', str(output_path),
            '--force',
            '--no-tile-size-limit',  # CRITICAL: Never drop tiles due to size!
            '-n', name,
            '-N', description,
        ] + [str(f) for f in sorted(input_files)]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # FAIL LOUDLY if any tiles were skipped
        check_for_skipped_tiles(result.stderr, f"merge_mbtiles_batch({name})")
        
        if progress_callback:
            progress_callback("Done", 1, 1)
        
        if result.returncode != 0:
            return (len(input_files), 0, result.stderr[:100])
        elif output_path.exists():
            size_mb = output_path.stat().st_size / 1024 / 1024
            return (len(input_files), size_mb, None)
        else:
            return (len(input_files), 0, 'File not created')
    
    # Large batch: chunk into groups of 100, merge each, then merge results
    temp_dir = output_path.parent / 'temp_merge'
    temp_dir.mkdir(parents=True, exist_ok=True)
    
    chunk_size = 100
    temp_files = []
    
    sorted_files = sorted(input_files)
    total_chunks = (len(sorted_files) + chunk_size - 1) // chunk_size
    
    for i in range(0, len(sorted_files), chunk_size):
        chunk = sorted_files[i:i + chunk_size]
        chunk_num = i // chunk_size
        temp_output = temp_dir / f'{name}_chunk_{chunk_num}.mbtiles'
        
        if progress_callback:
            progress_callback(f"Batch {chunk_num + 1}/{total_chunks} ({len(chunk)} files)", 
                            chunk_num, total_chunks + 1)
        else:
            # Plain text progress
            print(f"    Batch {chunk_num + 1}/{total_chunks} ({len(chunk)} files)...", flush=True)
        
        cmd = [
            'tile-join',
            '-o', str(temp_output),
            '--force',
            '--no-tile-size-limit',  # CRITICAL: Never drop tiles due to size!
        ] + [str(f) for f in chunk]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # FAIL LOUDLY if any tiles were skipped
        check_for_skipped_tiles(result.stderr, f"chunk {chunk_num} merge")
        
        if result.returncode != 0:
            # Clean up temp files
            for tf in temp_files:
                tf.unlink(missing_ok=True)
            return (len(input_files), 0, f'Chunk {chunk_num} failed: {result.stderr[:80]}')
        
        temp_files.append(temp_output)
    
    # Merge all temp files into final output
    if progress_callback:
        progress_callback(f"Final merge ({len(temp_files)} batches)", total_chunks, total_chunks + 1)
    else:
        print(f"    Final merge ({len(temp_files)} batches)...", flush=True)
    
    cmd = [
        'tile-join',
        '-o', str(output_path),
        '--force',
        '--no-tile-size-limit',  # CRITICAL: Never drop tiles due to size!
        '-n', name,
        '-N', description,
    ] + [str(f) for f in temp_files]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    # FAIL LOUDLY if any tiles were skipped
    check_for_skipped_tiles(result.stderr, f"final merge for {name}")
    
    # Clean up temp files
    for tf in temp_files:
        tf.unlink(missing_ok=True)
    try:
        temp_dir.rmdir()
    except:
        pass
    
    if progress_callback:
        progress_callback("Done", total_chunks + 1, total_chunks + 1)
    
    if result.returncode != 0:
        return (len(input_files), 0, result.stderr[:100])
    elif output_path.exists():
        size_mb = output_path.stat().st_size / 1024 / 1024
        return (len(input_files), size_mb, None)
    else:
        return (len(input_files), 0, 'File not created')


class RegionalPackDashboard:
    """Live dashboard for regional pack building."""
    
    def __init__(self):
        self.console = Console()
        self.start_time = time.time()
        self.current_pack = ""
        self.current_status = ""
        self.current_progress = 0
        self.current_total = 1
        self.results = []
        self.lock = threading.Lock()
    
    def update(self, pack_name: str, status: str, progress: int, total: int):
        with self.lock:
            self.current_pack = pack_name
            self.current_status = status
            self.current_progress = progress
            self.current_total = total
    
    def add_result(self, pack_name: str, num_charts: int, size_mb: float, error: str):
        with self.lock:
            self.results.append((pack_name, num_charts, size_mb, error))
    
    def build_display(self) -> Table:
        elapsed = time.time() - self.start_time
        elapsed_str = f"{int(elapsed // 60):02d}:{int(elapsed % 60):02d}"
        
        # Header
        header = Panel(
            Text.assemble(
                ("Building Regional Packs\n", "bold cyan"),
                (f"Elapsed: {elapsed_str}", "dim")
            ),
            box=box.DOUBLE_EDGE,
            padding=(0, 2)
        )
        
        # Current operation
        with self.lock:
            pack = self.current_pack
            status = self.current_status
            prog = self.current_progress
            total = self.current_total
            results = list(self.results)
        
        pct = (prog / total * 100) if total > 0 else 0
        bar_width = 40
        filled = int(bar_width * pct / 100)
        bar = "━" * filled + "╸" + "─" * (bar_width - filled - 1) if filled < bar_width else "━" * bar_width
        
        current_panel = Panel(
            Text.assemble(
                (f"{pack}\n", "bold green"),
                (f"{status}\n", "yellow"),
                (bar, "blue"),
                (f"  {pct:.0f}%", "cyan")
            ),
            box=box.ROUNDED,
            title="Current",
            title_align="left"
        )
        
        # Results table
        results_table = Table(box=box.ROUNDED, title="Completed", title_justify="left")
        results_table.add_column("Pack", style="bold", width=20)
        results_table.add_column("Charts", justify="right", width=10)
        results_table.add_column("Size", justify="right", width=12)
        results_table.add_column("Status", width=20)
        
        for pack_name, num_charts, size_mb, error in results:
            if error:
                results_table.add_row(
                    pack_name, 
                    str(num_charts), 
                    "-", 
                    Text("FAILED", style="red")
                )
            else:
                results_table.add_row(
                    pack_name, 
                    str(num_charts), 
                    f"{size_mb:.1f} MB",
                    Text("OK", style="green")
                )
        
        # Add pending rows
        all_packs = ['alaska_US1', 'alaska_US2', 'alaska_US3', 'alaska_US4', 'alaska_US5', 'alaska_US6']
        done_packs = [r[0] for r in results]
        for p in all_packs:
            if p not in done_packs and p != pack:
                results_table.add_row(p, "-", "-", Text("pending", style="dim"))
        
        # Combine
        main_table = Table.grid(padding=0)
        main_table.add_column()
        main_table.add_row(header)
        main_table.add_row("")
        main_table.add_row(current_panel)
        main_table.add_row("")
        main_table.add_row(results_table)
        
        return main_table


def build_single_scale_pack(args: tuple) -> tuple:
    """Build a single scale pack - designed for parallel execution.
    
    Args:
        args: (pack_name, patterns, description, per_chart_dir, regional_dir)
    
    Returns:
        (pack_name, num_charts, size_mb, error)
    """
    pack_name, patterns, description, per_chart_dir, regional_dir = args
    
    # Find input files
    input_files = []
    for pattern in patterns:
        matching_dirs = list(Path(per_chart_dir).glob(pattern))
        for chart_dir in matching_dirs:
            mbtiles_files = list(chart_dir.glob('*.mbtiles'))
            input_files.extend(mbtiles_files)
    
    if not input_files:
        return (pack_name, 0, 0, 'No input files found')
    
    output_path = Path(regional_dir) / f'{pack_name}.mbtiles'
    
    # Build pack (no progress callback in parallel mode)
    num_charts, size_mb, error = merge_mbtiles_batch(
        input_files, output_path, pack_name, description, progress_callback=None
    )
    
    return (pack_name, num_charts, size_mb, error)


def build_regional_packs(output_base: Path, console=None, use_rich=True):
    """Build per-scale regional packs from per-chart MBTiles using tile-join.
    
    Creates separate packs for each scale band (US1-US6) with NO merging between scales.
    All 6 packs are built IN PARALLEL for maximum speed.
    """
    per_chart_dir = output_base / 'per_chart'
    regional_dir = output_base / 'regional'
    regional_dir.mkdir(parents=True, exist_ok=True)
    
    # Per-scale packs - NO merging between scales
    regional_configs = [
        ('alaska_US1', ['US1*'], 'US1 Overview charts - continental view'),
        ('alaska_US2', ['US2*'], 'US2 General charts - regional planning'),
        ('alaska_US3', ['US3*'], 'US3 Coastal charts - coastal navigation'),
        ('alaska_US4', ['US4*'], 'US4 Approach charts - channel approaches'),
        ('alaska_US5', ['US5*'], 'US5 Harbor charts - harbor navigation'),
        ('alaska_US6', ['US6*'], 'US6 Berthing charts - docking detail'),
    ]
    
    # Prepare args for parallel execution
    pack_args = [
        (pack_name, patterns, description, str(per_chart_dir), str(regional_dir))
        for pack_name, patterns, description in regional_configs
    ]
    
    results = []
    start_time = time.time()
    
    if use_rich and RICH_AVAILABLE:
        console = Console()
        console.print("\n[bold cyan]Building 6 scale packs in PARALLEL...[/bold cyan]\n")
        
        # Show what we're building
        for pack_name, patterns, description in regional_configs:
            console.print(f"  • {pack_name}: {patterns[0]}")
        console.print()
        
        # Run all 6 in parallel
        with ProcessPoolExecutor(max_workers=6) as executor:
            futures = {executor.submit(build_single_scale_pack, args): args[0] 
                      for args in pack_args}
            
            for future in as_completed(futures):
                pack_name = futures[future]
                result = future.result()
                results.append(result)
                
                _, num_charts, size_mb, error = result
                if error:
                    console.print(f"  [red]✗[/red] {pack_name}: FAILED - {error}")
                else:
                    console.print(f"  [green]✓[/green] {pack_name}: {num_charts} charts, {size_mb:.1f} MB")
        
        elapsed = time.time() - start_time
        console.print(f"\n[bold]Parallel build completed in {elapsed:.1f}s[/bold]")
    
    else:
        # Plain text parallel
        print(f"\nBuilding 6 scale packs in PARALLEL...")
        
        with ProcessPoolExecutor(max_workers=6) as executor:
            futures = {executor.submit(build_single_scale_pack, args): args[0] 
                      for args in pack_args}
            
            for future in as_completed(futures):
                pack_name = futures[future]
                result = future.result()
                results.append(result)
                
                _, num_charts, size_mb, error = result
                if error:
                    print(f"  ✗ {pack_name}: FAILED - {error}")
                else:
                    print(f"  ✓ {pack_name}: {num_charts} charts, {size_mb:.1f} MB")
        
        elapsed = time.time() - start_time
        print(f"\nParallel build completed in {elapsed:.1f}s")
    
    # Generate manifest for per-scale packs
    generate_scale_manifest(regional_dir, results)
    
    return results


def generate_scale_manifest(regional_dir: Path, pack_results: list):
    """Generate manifest.json for per-scale regional packs."""
    import sqlite3
    
    # Zoom ranges by scale (natural ranges for display)
    SCALE_DISPLAY_ZOOMS = {
        'US1': (0, 8),
        'US2': (0, 10),
        'US3': (8, 12),
        'US4': (10, 14),
        'US5': (12, 18),
        'US6': (14, 18),
    }
    
    packs = []
    
    for pack_name, num_charts, size_mb, error in pack_results:
        if error or size_mb <= 0:
            continue
        
        mbtiles_path = regional_dir / f'{pack_name}.mbtiles'
        if not mbtiles_path.exists():
            continue
        
        # Extract scale from pack name (e.g., 'alaska_US3' -> 'US3')
        scale = pack_name.replace('alaska_', '')
        
        # Get bounds and zoom from mbtiles metadata
        try:
            conn = sqlite3.connect(str(mbtiles_path))
            cursor = conn.cursor()
            
            metadata = {}
            cursor.execute("SELECT name, value FROM metadata")
            for name, value in cursor.fetchall():
                metadata[name] = value
            
            conn.close()
            
            # Parse bounds
            bounds_str = metadata.get('bounds', '-180,-90,180,90')
            bounds = [float(x) for x in bounds_str.split(',')]
            
            # Get zoom range from metadata or use defaults
            min_zoom = int(metadata.get('minzoom', SCALE_DISPLAY_ZOOMS.get(scale, (0, 18))[0]))
            max_zoom = int(metadata.get('maxzoom', SCALE_DISPLAY_ZOOMS.get(scale, (0, 18))[1]))
            
        except Exception as e:
            print(f"Warning: Could not read metadata from {pack_name}: {e}")
            bounds = [-180, -90, 180, 90]
            zoom_range = SCALE_DISPLAY_ZOOMS.get(scale, (0, 18))
            min_zoom, max_zoom = zoom_range
        
        pack_info = {
            'id': pack_name,
            'filename': f'{pack_name}.mbtiles',
            'name': f'Alaska {scale} Charts',
            'description': f'{scale} scale charts for Alaska',
            'scale': scale,
            'bounds': {
                'west': bounds[0],
                'south': bounds[1],
                'east': bounds[2],
                'north': bounds[3],
            },
            'minZoom': min_zoom,
            'maxZoom': max_zoom,
            'fileSize': int(size_mb * 1024 * 1024),
            'chartCount': num_charts,
        }
        packs.append(pack_info)
    
    # Sort by scale
    scale_order = {'US1': 1, 'US2': 2, 'US3': 3, 'US4': 4, 'US5': 5, 'US6': 6}
    packs.sort(key=lambda p: scale_order.get(p.get('scale', ''), 99))
    
    manifest = {
        'version': '2.0',
        'architecture': 'per-scale',
        'description': 'Per-scale regional packs for Alaska. Server merges tiles at runtime based on zoom.',
        'packs': packs,
        'scaleZoomMapping': {
            'US1': {'minZoom': 0, 'maxZoom': 8, 'displayFrom': 0, 'displayTo': 9},
            'US2': {'minZoom': 0, 'maxZoom': 10, 'displayFrom': 8, 'displayTo': 11},
            'US3': {'minZoom': 4, 'maxZoom': 13, 'displayFrom': 10, 'displayTo': 13},
            'US4': {'minZoom': 6, 'maxZoom': 16, 'displayFrom': 12, 'displayTo': 15},
            'US5': {'minZoom': 8, 'maxZoom': 18, 'displayFrom': 14, 'displayTo': 17},
            'US6': {'minZoom': 6, 'maxZoom': 18, 'displayFrom': 16, 'displayTo': 22},
        },
    }
    
    manifest_path = regional_dir / 'manifest.json'
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    
    print(f"Generated manifest: {manifest_path}")


# =============================================================================
# Rich Dashboard
# =============================================================================

class ConversionDashboard:
    """
    Live dashboard for monitoring conversion progress.
    
    Uses Rich's Live display with a fixed layout that updates in place.
    No scrolling - the entire dashboard fits in the terminal.
    """
    
    def __init__(self, total_charts: int, num_workers: int, scale_totals: dict):
        self.console = Console()
        self.total_charts = total_charts
        self.num_workers = num_workers
        self.scale_totals = scale_totals  # {'US1': 5, 'US2': 14, ...}
        
        # Stats
        self.completed = 0
        self.success_count = 0
        self.fail_count = 0
        self.total_features = 0
        self.total_size_mb = 0
        self.start_time = time.time()
        
        # Per-scale stats
        self.scale_stats = {scale: {'done': 0, 'failed': 0, 'size': 0} 
                           for scale in scale_totals}
        
        # Active workers: worker_id -> {chart_id, start_time, status}
        self.active_workers = {}
        self.worker_lock = threading.Lock()
        
        # Recent completions for activity log (last 5)
        self.recent_completions = []
        
        # Log buffer for console-like output (last N lines)
        self.log_lines = []
        self.max_log_lines = 8
    
    def set_worker_active(self, worker_id: int, chart_id: str, log: bool = False):
        with self.worker_lock:
            self.active_workers[worker_id] = {
                'chart_id': chart_id,
                'start_time': time.time(),
                'status': 'converting'
            }
        # Optionally log starts (disabled by default to reduce noise)
        if log:
            self.add_log(f"→ Worker {worker_id} started {chart_id}")
    
    def set_worker_done(self, worker_id: int):
        with self.worker_lock:
            if worker_id in self.active_workers:
                del self.active_workers[worker_id]
    
    def record_result(self, result: dict):
        self.completed += 1
        scale = result['scale_band']
        
        if result['success']:
            self.success_count += 1
            self.total_features += result['features']
            self.total_size_mb += result['size_mb']
            self.scale_stats[scale]['done'] += 1
            self.scale_stats[scale]['size'] += result['size_mb']
        else:
            self.fail_count += 1
            self.scale_stats[scale]['done'] += 1
            self.scale_stats[scale]['failed'] += 1
        
        # Add to recent completions
        self.recent_completions.append({
            'chart_id': result['chart_id'],
            'success': result['success'],
            'size_mb': result.get('size_mb', 0),
            'elapsed': result.get('elapsed', 0),
            'error': result.get('error'),
        })
        # Keep last 5
        if len(self.recent_completions) > 5:
            self.recent_completions.pop(0)
        
        # Add log entry
        chart_id = result['chart_id']
        if result['success']:
            self.add_log(f"✓ {chart_id} completed ({result.get('size_mb', 0):.1f} MB, {result.get('elapsed', 0):.1f}s)")
        else:
            self.add_log(f"✗ {chart_id} FAILED: {result.get('error', 'unknown error')}")
    
    def add_log(self, message: str):
        """Add a line to the log buffer."""
        timestamp = time.strftime("%H:%M:%S")
        self.log_lines.append(f"[{timestamp}] {message}")
        # Keep only last N lines
        if len(self.log_lines) > self.max_log_lines:
            self.log_lines.pop(0)
    
    def build_display(self) -> Table:
        """Build the full dashboard display as a fixed-height grid."""
        elapsed = time.time() - self.start_time
        rate = self.completed / elapsed if elapsed > 0 else 0
        eta_seconds = (self.total_charts - self.completed) / rate if rate > 0 else 0
        
        # Main container - grid layout
        main = Table.grid(padding=0, expand=True)
        main.add_column()
        
        # === HEADER ===
        pct = (self.completed / self.total_charts * 100) if self.total_charts > 0 else 0
        elapsed_str = f"{int(elapsed // 60):02d}:{int(elapsed % 60):02d}"
        eta_str = f"{int(eta_seconds // 60):02d}:{int(eta_seconds % 60):02d}" if eta_seconds > 0 else "--:--"
        
        header = Table.grid(padding=0, expand=True)
        header.add_column(ratio=1)
        header.add_column(justify="right")
        header.add_row(
            Text("XNautical Chart Converter", style="bold cyan"),
            Text(f"Elapsed: {elapsed_str}  ETA: {eta_str}", style="dim")
        )
        main.add_row(Panel(header, box=box.HEAVY, style="cyan"))
        
        # === PROGRESS BAR ===
        bar_width = 60
        filled = int(bar_width * pct / 100)
        bar_char = "━"
        empty_char = "─"
        bar = f"[green]{bar_char * filled}[/green][dim]{empty_char * (bar_width - filled)}[/dim]"
        
        progress_text = Text()
        progress_text.append(f"\n  {bar}  ", style="")
        progress_text.append(f"{pct:5.1f}%", style="bold green" if pct > 50 else "bold yellow")
        progress_text.append(f"  ({self.completed:,}/{self.total_charts:,})", style="dim")
        progress_text.append(f"  {rate:.1f}/sec\n", style="cyan")
        main.add_row(progress_text)
        
        # === STATS ROW ===
        stats = Table.grid(padding=(0, 4), expand=True)
        stats.add_column()
        stats.add_column()
        stats.add_column()
        stats.add_column()
        stats.add_row(
            Text.assemble(("✓ ", "green"), (f"{self.success_count}", "bold green"), (" success", "dim")),
            Text.assemble(("✗ ", "red" if self.fail_count > 0 else "dim"), 
                         (f"{self.fail_count}", "bold red" if self.fail_count > 0 else "dim"), 
                         (" failed", "dim")),
            Text.assemble(("◷ ", "yellow"), (f"{self.total_charts - self.completed}", "bold yellow"), (" remaining", "dim")),
            Text.assemble(("💾 ", ""), (f"{self.total_size_mb:.1f} MB", "bold cyan")),
        )
        main.add_row(Panel(stats, box=box.ROUNDED, title="[bold]Summary[/bold]", title_align="left"))
        
        # === WORKERS TABLE ===
        workers_table = Table(box=box.SIMPLE, expand=True, show_header=True, header_style="bold")
        workers_table.add_column("#", width=3, justify="center")
        workers_table.add_column("Chart", width=14)
        workers_table.add_column("Status", width=12)
        workers_table.add_column("Time", width=8, justify="right")
        
        with self.worker_lock:
            workers_copy = dict(self.active_workers)
        
        for i in range(1, self.num_workers + 1):
            if i in workers_copy:
                w = workers_copy[i]
                worker_elapsed = time.time() - w['start_time']
                workers_table.add_row(
                    f"{i}",
                    Text(w['chart_id'], style="bold green"),
                    Text("● converting", style="yellow"),
                    f"{worker_elapsed:.1f}s"
                )
            else:
                workers_table.add_row(
                    Text(f"{i}", style="dim"),
                    Text("—", style="dim"),
                    Text("○ idle", style="dim"),
                    ""
                )
        
        main.add_row(Panel(workers_table, box=box.ROUNDED, title=f"[bold]Workers ({self.num_workers})[/bold]", title_align="left"))
        
        # === SCALE PROGRESS ===
        scale_table = Table(box=box.SIMPLE, expand=True, show_header=True, header_style="bold dim")
        scale_table.add_column("Scale", width=6)
        scale_table.add_column("Progress", width=30)
        scale_table.add_column("Done", width=10, justify="right")
        scale_table.add_column("Size", width=10, justify="right")
        
        for scale in sorted(self.scale_totals.keys()):
            total = self.scale_totals[scale]
            stats = self.scale_stats.get(scale, {'done': 0, 'failed': 0, 'size': 0})
            done = stats['done']
            size = stats['size']
            pct_scale = (done / total * 100) if total > 0 else 0
            
            # Mini progress bar
            bar_w = 20
            filled_w = int(bar_w * pct_scale / 100)
            mini_bar = "█" * filled_w + "░" * (bar_w - filled_w)
            
            if done == total:
                style = "green"
                status = "✓"
            elif done > 0:
                style = "blue"
                status = ""
            else:
                style = "dim"
                status = ""
            
            scale_table.add_row(
                Text(scale, style="bold"),
                Text(f"{mini_bar} {pct_scale:5.1f}%{status}", style=style),
                f"{done}/{total}",
                f"{size:.1f} MB"
            )
        
        main.add_row(Panel(scale_table, box=box.ROUNDED, title="[bold]Scale Bands[/bold]", title_align="left"))
        
        # === LOG CONSOLE ===
        log_text = Text()
        if self.log_lines:
            for i, line in enumerate(self.log_lines):
                if "✓" in line:
                    style = "green"
                elif "✗" in line or "FAILED" in line:
                    style = "red"
                else:
                    style = "dim"
                log_text.append(line + "\n", style=style)
        else:
            log_text.append("Waiting for completions...\n", style="dim")
        
        main.add_row(Panel(log_text, box=box.ROUNDED, title="[bold]Log[/bold]", title_align="left", height=self.max_log_lines + 2))
        
        return main


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Convert S-57 ENC to MBTiles (hybrid per-chart + regional)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('--chart', help='Convert single chart (e.g., US5AK5SI)')
    parser.add_argument('--regional-only', action='store_true',
                        help='Only rebuild regional packs from existing per-chart files')
    parser.add_argument('--scale-bands', type=str, default=None,
                        help='Comma-separated scale bands to convert (e.g., US3,US4,US5,US6)')
    parser.add_argument('--parallel', type=int, default=8,
                        help='Number of parallel workers (default: 8)')
    parser.add_argument('--enc-root', type=Path, default=ENC_ROOT,
                        help=f'Source ENC directory (default: {ENC_ROOT})')
    parser.add_argument('--output-dir', type=Path, default=OUTPUT_DIR,
                        help=f'Output directory (default: {OUTPUT_DIR})')
    parser.add_argument('--no-rich', action='store_true',
                        help='Disable rich output (use plain text)')
    args = parser.parse_args()
    
    enc_root = args.enc_root
    output_dir = args.output_dir
    output_dir.mkdir(exist_ok=True)
    
    use_rich = RICH_AVAILABLE and not args.no_rich
    console = Console() if use_rich else None
    
    # -------------------------------------------------------------------------
    # Regional-only mode
    # -------------------------------------------------------------------------
    if args.regional_only:
        if use_rich:
            results = build_regional_packs(output_dir, console, use_rich=True)
            
            # Show final summary
            console.print()
            table = Table(title="Regional Packs Complete", box=box.DOUBLE_EDGE)
            table.add_column("Pack", style="bold", width=20)
            table.add_column("Charts", justify="right", width=10)
            table.add_column("Size", justify="right", width=12)
            table.add_column("Status", width=10)
            
            total_size = 0
            for pack_name, num_charts, size_mb, error in results:
                if error:
                    table.add_row(pack_name, str(num_charts), "-", "[red]FAILED[/red]")
                else:
                    table.add_row(pack_name, str(num_charts), f"{size_mb:.1f} MB", "[green]OK[/green]")
                    total_size += size_mb
            
            console.print(table)
            console.print(f"\n[bold]Total size:[/bold] {total_size:.1f} MB ({total_size/1024:.2f} GB)")
            console.print(f"[bold]Output:[/bold] {output_dir}/regional/\n")
        else:
            print("Rebuilding regional packs...")
            results = build_regional_packs(output_dir, use_rich=False)
            for pack_name, num_charts, size_mb, error in results:
                if error:
                    print(f"  {pack_name}: FAILED - {error}")
                else:
                    print(f"  {pack_name}: {num_charts} charts, {size_mb:.1f} MB")
            print("\nDone!")
        return
    
    # -------------------------------------------------------------------------
    # Single chart mode
    # -------------------------------------------------------------------------
    if args.chart:
        chart_dir = enc_root / args.chart
        s57_files = list(chart_dir.glob('*.000'))
        
        if not s57_files:
            if use_rich:
                console.print(f"[red]Error: Chart {args.chart} not found[/red]")
            else:
                print(f"Error: Chart {args.chart} not found")
            sys.exit(1)
        
        # Single chart mode: show output in real time (quiet=False)
        if use_rich:
            console.print(f"\n[bold]Converting single chart:[/bold] {args.chart}\n")
        else:
            print(f"Converting single chart: {args.chart}\n")
        
        # Run with quiet=False to show real-time output
        result = convert_single_chart(str(s57_files[0]), output_dir, quiet=False)
        
        print()  # Blank line after converter output
        
        if result['success']:
            if use_rich:
                console.print(f"[green]✓[/green] Success: {result['size_mb']:.1f} MB in {result['elapsed']:.1f}s")
                console.print(f"  Output: {output_dir}/per_chart/{args.chart}/{args.chart}.mbtiles")
                console.print("\n[dim]To update regional packs:[/dim]")
                console.print(f"  python {sys.argv[0]} --regional-only\n")
            else:
                print(f"Success: {result['size_mb']:.1f} MB in {result['elapsed']:.1f}s")
                print(f"  Output: {output_dir}/per_chart/{args.chart}/{args.chart}.mbtiles")
        else:
            if use_rich:
                console.print(f"[red]✗[/red] Failed: {result['error']}")
            else:
                print(f"Failed: {result['error']}")
            sys.exit(1)
        return
    
    # -------------------------------------------------------------------------
    # Full conversion mode
    # -------------------------------------------------------------------------
    
    # Find all charts and count by scale
    cell_dirs = sorted([d for d in enc_root.iterdir() if d.is_dir()])
    s57_files = []
    scale_totals = defaultdict(int)
    
    # Parse scale bands filter if provided
    scale_bands_filter = None
    if args.scale_bands:
        scale_bands_filter = set(args.scale_bands.upper().split(','))
        print(f"Filtering to scale bands: {scale_bands_filter}")
    
    for cell_dir in cell_dirs:
        files = list(cell_dir.glob('*.000'))
        if files:
            scale_band = cell_dir.name[:3]
            # Apply scale band filter if specified
            if scale_bands_filter and scale_band not in scale_bands_filter:
                continue
            s57_files.append(str(files[0]))
            scale_totals[scale_band] += 1
    
    if not s57_files:
        if use_rich:
            console.print(f"[red]No charts found in {enc_root}[/red]")
        else:
            print(f"No charts found in {enc_root}")
        sys.exit(1)
    
    num_workers = args.parallel
    
    if use_rich:
        # Create dashboard
        dashboard = ConversionDashboard(
            total_charts=len(s57_files),
            num_workers=num_workers,
            scale_totals=dict(scale_totals)
        )
        
        # Clear screen and hide cursor for cleaner display
        console.clear()
        
        # Track active workers properly
        available_workers = list(range(1, num_workers + 1))
        worker_lock = threading.Lock()
        future_to_worker = {}
        
        def get_available_worker():
            """Get an available worker ID."""
            with worker_lock:
                if available_workers:
                    return available_workers.pop(0)
                return None
        
        def release_worker(worker_id):
            """Return a worker to the pool."""
            with worker_lock:
                if worker_id and worker_id not in available_workers:
                    available_workers.append(worker_id)
                    available_workers.sort()
        
        with Live(dashboard.build_display(), console=console, refresh_per_second=4, transient=False, vertical_overflow="visible") as live:
            with ProcessPoolExecutor(max_workers=num_workers) as executor:
                futures = {}
                pending_charts = list(s57_files)
                
                # Submit initial batch
                while pending_charts and len(futures) < num_workers:
                    s57_path = pending_charts.pop(0)
                    chart_id = Path(s57_path).stem
                    worker_id = get_available_worker()
                    
                    future = executor.submit(convert_single_chart, s57_path, output_dir)
                    futures[future] = s57_path
                    future_to_worker[future] = worker_id
                    
                    if worker_id:
                        dashboard.set_worker_active(worker_id, chart_id)
                    
                    live.update(dashboard.build_display())
                
                # Process as they complete
                while futures:
                    # Wait for any future to complete
                    done_futures = []
                    for future in list(futures.keys()):
                        if future.done():
                            done_futures.append(future)
                    
                    if not done_futures:
                        time.sleep(0.1)
                        live.update(dashboard.build_display())
                        continue
                    
                    for future in done_futures:
                        result = future.result()
                        dashboard.record_result(result)
                        
                        worker_id = future_to_worker.pop(future, None)
                        if worker_id:
                            dashboard.set_worker_done(worker_id)
                            release_worker(worker_id)
                        
                        del futures[future]
                        
                        # Submit next chart if available
                        if pending_charts:
                            s57_path = pending_charts.pop(0)
                            chart_id = Path(s57_path).stem
                            new_worker_id = get_available_worker()
                            
                            new_future = executor.submit(convert_single_chart, s57_path, output_dir)
                            futures[new_future] = s57_path
                            future_to_worker[new_future] = new_worker_id
                            
                            if new_worker_id:
                                dashboard.set_worker_active(new_worker_id, chart_id)
                        
                        live.update(dashboard.build_display())
        
        # Phase 2: Regional packs
        console.print("\n[bold cyan]Phase 2: Building regional packs...[/bold cyan]\n")
        
        pack_results = build_regional_packs(output_dir, console, use_rich=True)
        
        # Show regional pack results
        pack_table = Table(title="Regional Packs", box=box.ROUNDED)
        pack_table.add_column("Pack", style="bold")
        pack_table.add_column("Charts", justify="right")
        pack_table.add_column("Size", justify="right")
        pack_table.add_column("Status")
        
        for pack_name, num_charts, size_mb, error in pack_results:
            if error:
                pack_table.add_row(pack_name, str(num_charts), "-", f"[red]{error}[/red]")
            else:
                pack_table.add_row(pack_name, str(num_charts), f"{size_mb:.1f} MB", "[green]✓[/green]")
        
        console.print(pack_table)
        
        # Final summary
        console.print(Panel(
            f"[bold green]Conversion Complete![/bold green]\n\n"
            f"Per-chart files: {output_dir}/per_chart/*/\n"
            f"Regional packs:  {output_dir}/regional/\n\n"
            f"[dim]To update a single chart:[/dim]\n"
            f"  python {sys.argv[0]} --chart US5AK5SI\n"
            f"  python {sys.argv[0]} --regional-only",
            title="Done",
            box=box.DOUBLE_EDGE
        ))
    
    else:
        # Plain text fallback
        print("=" * 60)
        print("S-57 ENC to MBTiles Conversion")
        print("=" * 60)
        print(f"Source:  {enc_root}")
        print(f"Output:  {output_dir}")
        print(f"Workers: {num_workers}")
        print(f"Charts:  {len(s57_files)}")
        print()
        
        start_time = time.time()
        results = []
        
        with ProcessPoolExecutor(max_workers=num_workers) as executor:
            futures = {executor.submit(convert_single_chart, p, output_dir): p for p in s57_files}
            
            for i, future in enumerate(as_completed(futures), 1):
                result = future.result()
                results.append(result)
                pct = i / len(s57_files) * 100
                status = "OK" if result['success'] else "FAIL"
                print(f"[{i:4d}/{len(s57_files)}] ({pct:5.1f}%) {result['chart_id']}: {status}")
        
        elapsed = time.time() - start_time
        success = sum(1 for r in results if r['success'])
        total_mb = sum(r['size_mb'] for r in results if r['success'])
        
        print()
        print(f"Completed: {success}/{len(results)}, {total_mb:.1f} MB, {elapsed/60:.1f} min")
        print()
        print("Building regional packs...")
        build_regional_packs(output_dir, use_rich=False)
        print("\nDone!")


if __name__ == '__main__':
    main()
