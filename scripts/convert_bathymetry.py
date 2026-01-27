#!/usr/bin/env python3
"""
Convert CUDEM GeoTIFF bathymetry files to MBTiles for use in XNautical app.

This script:
1. Reads raw CUDEM GeoTIFF files (Float32 depth values)
2. Applies a depth-based color ramp using GDAL (memory-efficient)
3. Converts to MBTiles with appropriate zoom levels

Usage:
    python convert_bathymetry.py input.tif --output output.mbtiles
    python convert_bathymetry.py *.tif --output-dir ./mbtiles/
    python convert_bathymetry.py --merge tile1.tif tile2.tif --output merged.mbtiles
"""

import argparse
import os
import sys
import tempfile
import time
from pathlib import Path

try:
    from osgeo import gdal
except ImportError:
    print("Error: This script requires GDAL")
    print("Install with: pip install gdal")
    sys.exit(1)

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich import box
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False

# Initialize console
console = Console() if RICH_AVAILABLE else None

# Configure GDAL for better performance
gdal.UseExceptions()
gdal.SetConfigOption('GDAL_CACHEMAX', '2048')  # 2GB cache
gdal.SetConfigOption('GDAL_NUM_THREADS', 'ALL_CPUS')

# Color ramp for bathymetry (depth in meters -> RGB)
# Format for gdaldem color-relief: value R G B
COLOR_RAMP_TEXT = """-500 2 10 40
-300 5 20 60
-200 8 24 68
-150 12 50 100
-100 16 78 139
-75 24 116 205
-50 65 105 225
-30 100 149 237
-20 135 206 235
-10 176 224 230
-5 200 238 255
0 220 248 255
nv 0 0 0 0
"""


def log(message: str, style: str = None):
    """Print a log message with optional styling."""
    if RICH_AVAILABLE and console:
        if style:
            console.print(message, style=style)
        else:
            console.print(message)
    else:
        # Strip rich markup for plain output
        import re
        plain = re.sub(r'\[.*?\]', '', message)
        print(plain)


def log_step(step: str, detail: str = ""):
    """Print a step indicator."""
    if detail:
        log(f"[bold cyan]>>> {step}[/bold cyan] {detail}")
    else:
        log(f"[bold cyan]>>> {step}[/bold cyan]")


def log_info(message: str):
    """Print an info message."""
    log(f"    [dim]{message}[/dim]")


def log_success(message: str):
    """Print a success message."""
    log(f"    [green]✓[/green] {message}")


def log_warning(message: str):
    """Print a warning message."""
    log(f"    [yellow]⚠[/yellow] {message}")


def log_error(message: str):
    """Print an error message."""
    log(f"    [red]✗[/red] {message}")


def format_bytes(size: int) -> str:
    """Format bytes to human readable string."""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} PB"


def format_duration(seconds: float) -> str:
    """Format seconds to human readable duration."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        return f"{int(seconds // 60)}m {int(seconds % 60)}s"
    else:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        return f"{hours}h {minutes}m"


def analyze_raster(input_path: str) -> dict:
    """Analyze a raster and return statistics."""
    log_step("Analyzing raster", str(input_path))
    
    start = time.time()
    ds = gdal.Open(input_path)
    if ds is None:
        raise ValueError(f"Could not open {input_path}")
    
    width = ds.RasterXSize
    height = ds.RasterYSize
    gt = ds.GetGeoTransform()
    
    # Calculate bounds
    min_x = gt[0]
    max_x = gt[0] + width * gt[1]
    max_y = gt[3]
    min_y = gt[3] + height * gt[5]
    
    # Get band info
    band = ds.GetRasterBand(1)
    nodata = band.GetNoDataValue()
    dtype = gdal.GetDataTypeName(band.DataType)
    
    # Get statistics (computed efficiently by GDAL)
    log_info("Computing statistics (this may take a moment)...")
    stats = band.GetStatistics(True, True)  # approx=True, force=True
    min_val, max_val, mean_val, std_val = stats
    
    elapsed = time.time() - start
    
    log_info(f"Dimensions: {width:,} x {height:,} pixels ({width * height:,} total)")
    log_info(f"Data type: {dtype}, NoData: {nodata}")
    log_info(f"Bounds: ({min_x:.4f}, {min_y:.4f}) to ({max_x:.4f}, {max_y:.4f})")
    log_info(f"Value range: {min_val:.1f} to {max_val:.1f} (mean: {mean_val:.1f})")
    log_success(f"Analysis completed in {format_duration(elapsed)}")
    
    ds = None
    
    return {
        "width": width,
        "height": height,
        "bounds": (min_x, min_y, max_x, max_y),
        "nodata": nodata,
        "min_val": min_val,
        "max_val": max_val,
        "mean_val": mean_val,
    }


def apply_color_relief(input_path: str, output_path: str) -> str:
    """Apply color relief to bathymetry data using gdaldem (memory-efficient)."""
    log_step("Applying color relief", "(streaming, memory-efficient)")
    start = time.time()
    
    # Create temporary color ramp file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        f.write(COLOR_RAMP_TEXT)
        color_file = f.name
    
    log_info(f"Color ramp file: {color_file}")
    log_info(f"Output: {output_path}")
    log_info("Running gdaldem color-relief (processes tile-by-tile, low memory)...")
    
    try:
        # Use gdaldem color-relief which processes data in chunks
        # This is MUCH more memory efficient than loading into numpy
        options = gdal.DEMProcessingOptions(
            colorFilename=color_file,
            addAlpha=True,
            creationOptions=['COMPRESS=LZW', 'TILED=YES', 'BIGTIFF=YES'],
            callback=gdal.TermProgress_nocb
        )
        
        result = gdal.DEMProcessing(
            output_path,
            input_path,
            'color-relief',
            options=options
        )
        
        if result is None:
            raise ValueError("gdaldem color-relief failed")
        
        result = None  # Close dataset
        
        elapsed = time.time() - start
        output_size = os.path.getsize(output_path)
        log_success(f"Color relief applied in {format_duration(elapsed)}")
        log_info(f"Output size: {format_bytes(output_size)}")
        
        return output_path
        
    finally:
        os.unlink(color_file)


def convert_to_mbtiles(input_path: str, output_path: str, 
                       min_zoom: int = 8, max_zoom: int = 16) -> str:
    """Convert colored GeoTIFF to MBTiles."""
    log_step("Converting to MBTiles", f"zoom {min_zoom}-{max_zoom}")
    overall_start = time.time()
    
    input_size = os.path.getsize(input_path)
    log_info(f"Input file: {format_bytes(input_size)}")
    log_info(f"Output: {output_path}")
    log_info(f"Zoom levels: {min_zoom} to {max_zoom}")
    
    # Use gdal_translate to create MBTiles
    log_info("Running GDAL Translate to MBTiles...")
    log_info("(Processes tile-by-tile, memory efficient)")
    
    translate_start = time.time()
    
    translate_options = gdal.TranslateOptions(
        format='MBTiles',
        creationOptions=[
            'TILE_FORMAT=PNG',
            f'MINZOOM={min_zoom}',
            f'MAXZOOM={max_zoom}',
            'WRITE_BOUNDS=YES',
        ],
        callback=gdal.TermProgress_nocb
    )
    
    result = gdal.Translate(output_path, input_path, options=translate_options)
    if result is None:
        raise ValueError("Failed to convert to MBTiles")
    result = None
    
    translate_elapsed = time.time() - translate_start
    log_success(f"MBTiles created in {format_duration(translate_elapsed)}")
    
    # Build overviews
    log_info("Building overview levels...")
    overview_start = time.time()
    
    ds = gdal.Open(output_path, gdal.GA_Update)
    if ds:
        ds.BuildOverviews('AVERAGE', [2, 4, 8, 16, 32], callback=gdal.TermProgress_nocb)
        ds = None
    
    overview_elapsed = time.time() - overview_start
    log_success(f"Overviews built in {format_duration(overview_elapsed)}")
    
    # Final stats
    final_size = os.path.getsize(output_path)
    overall_elapsed = time.time() - overall_start
    
    log_success(f"MBTiles conversion complete!")
    log_info(f"Final size: {format_bytes(final_size)}")
    log_info(f"Total time: {format_duration(overall_elapsed)}")
    
    return output_path


def merge_tiles(input_paths: list, output_path: str,
                min_zoom: int = 8, max_zoom: int = 16) -> str:
    """Merge multiple TIFF files into a single MBTiles."""
    overall_start = time.time()
    
    if RICH_AVAILABLE:
        console.print(Panel(
            f"[bold]Input files:[/bold] {len(input_paths)} GeoTIFFs\n"
            f"[bold]Output:[/bold] {output_path}\n"
            f"[bold]Zoom levels:[/bold] {min_zoom} - {max_zoom}",
            title="[bold blue]Merging Bathymetry Tiles[/bold blue]",
            border_style="blue"
        ))
    else:
        print(f"\nMerging {len(input_paths)} tiles to {output_path}")
    
    # Show input file summary
    log_step("Input Files Summary")
    total_input_size = 0
    
    if RICH_AVAILABLE:
        table = Table(title="Input Files", box=box.SIMPLE)
        table.add_column("#", style="dim", width=4)
        table.add_column("Filename", style="cyan")
        table.add_column("Size", justify="right", style="green")
        
        for i, path in enumerate(input_paths[:10], 1):
            size = os.path.getsize(path)
            total_input_size += size
            table.add_row(str(i), Path(path).name, format_bytes(size))
        
        if len(input_paths) > 10:
            for path in input_paths[10:]:
                total_input_size += os.path.getsize(path)
            table.add_row("...", f"({len(input_paths) - 10} more files)", "...")
        
        console.print(table)
    else:
        for i, path in enumerate(input_paths[:5], 1):
            size = os.path.getsize(path)
            total_input_size += size
            print(f"  {i}. {Path(path).name} ({format_bytes(size)})")
        if len(input_paths) > 5:
            for path in input_paths[5:]:
                total_input_size += os.path.getsize(path)
            print(f"  ... and {len(input_paths) - 5} more files")
    
    log_info(f"Total input size: {format_bytes(total_input_size)}")
    
    # Create temp directory for intermediate files
    temp_dir = tempfile.mkdtemp(prefix='cudem_convert_')
    log_info(f"Temp directory: {temp_dir}")
    
    vrt_path = os.path.join(temp_dir, 'merged.vrt')
    colored_path = os.path.join(temp_dir, 'colored.tif')
    
    try:
        # Build VRT (virtual mosaic - no data copying)
        log_step("Building Virtual Raster (VRT)")
        log_info("This creates a virtual mosaic reference (fast, no data copying)...")
        vrt_start = time.time()
        
        vrt_options = gdal.BuildVRTOptions(resampleAlg='bilinear')
        vrt = gdal.BuildVRT(vrt_path, input_paths, options=vrt_options)
        vrt = None
        
        vrt_elapsed = time.time() - vrt_start
        vrt_size = os.path.getsize(vrt_path)
        log_success(f"VRT created ({format_bytes(vrt_size)}) in {format_duration(vrt_elapsed)}")
        
        # Analyze VRT
        log("")
        stats = analyze_raster(vrt_path)
        
        # Memory estimate warning
        pixels = stats['width'] * stats['height']
        estimated_rgba_memory = pixels * 4  # 4 bytes per RGBA pixel
        log("")
        log_info(f"[yellow]Note:[/yellow] Full raster would be {format_bytes(estimated_rgba_memory)} in memory")
        log_info("Using streaming processing to avoid memory issues...")
        
        # Apply color relief (memory-efficient, streams data)
        log("")
        apply_color_relief(vrt_path, colored_path)
        
        # Convert to MBTiles
        log("")
        convert_to_mbtiles(colored_path, output_path, min_zoom, max_zoom)
        
        # Final summary
        overall_elapsed = time.time() - overall_start
        output_size = os.path.getsize(output_path)
        
        log("")
        if RICH_AVAILABLE:
            console.print(Panel(
                f"[bold green]Merge Complete![/bold green]\n\n"
                f"[bold]Output file:[/bold] {output_path}\n"
                f"[bold]Output size:[/bold] {format_bytes(output_size)}\n"
                f"[bold]Compression:[/bold] {total_input_size / output_size:.1f}x smaller than input\n"
                f"[bold]Total time:[/bold] {format_duration(overall_elapsed)}\n\n"
                f"[dim]Input: {len(input_paths)} files, {format_bytes(total_input_size)}[/dim]",
                title="[bold green]Success[/bold green]",
                border_style="green"
            ))
        else:
            print(f"\n{'='*60}")
            print(f"Merge Complete!")
            print(f"  Output: {output_path}")
            print(f"  Size: {format_bytes(output_size)}")
            print(f"  Time: {format_duration(overall_elapsed)}")
            print(f"{'='*60}")
        
        return output_path
        
    finally:
        # Cleanup temp files
        log_step("Cleaning up temporary files")
        import shutil
        for f in [vrt_path, colored_path]:
            if os.path.exists(f):
                size = os.path.getsize(f)
                log_info(f"Removing {Path(f).name} ({format_bytes(size)})")
        shutil.rmtree(temp_dir, ignore_errors=True)
        log_success("Cleanup complete")


def process_file(input_path: str, output_dir: str, output_name: str = None,
                 min_zoom: int = 8, max_zoom: int = 16) -> str:
    """Process a single TIFF file to MBTiles."""
    input_path = Path(input_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    if output_name:
        base_name = output_name
    else:
        base_name = f"BATHY_{input_path.stem}"
    
    output_mbtiles = output_dir / f"{base_name}.mbtiles"
    
    if RICH_AVAILABLE:
        console.print(Panel(
            f"[bold]Input:[/bold] {input_path}\n[bold]Output:[/bold] {output_mbtiles}",
            title="[bold blue]Processing Single File[/bold blue]",
            border_style="blue"
        ))
    else:
        print(f"\nProcessing: {input_path}")
        print(f"Output: {output_mbtiles}")
    
    # Create temp directory
    temp_dir = tempfile.mkdtemp(prefix='cudem_convert_')
    colored_path = os.path.join(temp_dir, 'colored.tif')
    
    try:
        # Analyze input
        analyze_raster(str(input_path))
        
        # Apply color relief
        log("")
        apply_color_relief(str(input_path), colored_path)
        
        # Convert to MBTiles
        log("")
        convert_to_mbtiles(colored_path, str(output_mbtiles), min_zoom, max_zoom)
        
        return str(output_mbtiles)
        
    finally:
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(
        description="Convert CUDEM bathymetry GeoTIFFs to MBTiles",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s input.tif --output output.mbtiles
  %(prog)s data/cudem/raw/*.tif --output-dir data/cudem/mbtiles/
  %(prog)s --merge tile1.tif tile2.tif --output merged.mbtiles
  %(prog)s --analyze input.tif
        """
    )
    
    parser.add_argument("inputs", nargs="*", help="Input GeoTIFF file(s)")
    parser.add_argument("--output", "-o", help="Output MBTiles file")
    parser.add_argument("--output-dir", "-d", default="./data/cudem/mbtiles",
                        help="Output directory (batch mode)")
    parser.add_argument("--merge", action="store_true",
                        help="Merge all inputs into single MBTiles")
    parser.add_argument("--analyze", action="store_true",
                        help="Only analyze input files, don't convert")
    parser.add_argument("--name", help="Output name (without extension)")
    parser.add_argument("--min-zoom", type=int, default=8,
                        help="Minimum zoom level (default: 8)")
    parser.add_argument("--max-zoom", type=int, default=16,
                        help="Maximum zoom level (default: 16)")
    
    args = parser.parse_args()
    
    # Show header
    if RICH_AVAILABLE:
        console.print(Panel(
            "[bold]CUDEM Bathymetry to MBTiles Converter[/bold]\n"
            "[dim]Memory-efficient streaming conversion[/dim]",
            border_style="blue"
        ))
    else:
        print("\n" + "="*60)
        print("CUDEM Bathymetry to MBTiles Converter")
        print("="*60 + "\n")
    
    if not args.inputs:
        parser.print_help()
        return 1
    
    # Validate inputs
    log_step("Validating input files")
    valid_inputs = []
    for inp in args.inputs:
        if not os.path.exists(inp):
            log_error(f"File not found: {inp}")
            return 1
        valid_inputs.append(inp)
    log_success(f"Found {len(valid_inputs)} valid input file(s)")
    
    # Analyze mode
    if args.analyze:
        log_step("Analyze Mode")
        for inp in valid_inputs:
            analyze_raster(inp)
            log("")
        return 0
    
    # Merge mode
    if args.merge:
        if not args.output:
            log_error("--output required with --merge")
            return 1
        merge_tiles(valid_inputs, args.output, args.min_zoom, args.max_zoom)
        return 0
    
    # Batch mode
    if len(valid_inputs) > 1 or not args.output:
        for inp in valid_inputs:
            process_file(inp, args.output_dir, args.name, args.min_zoom, args.max_zoom)
        return 0
    
    # Single file mode
    output_dir = Path(args.output).parent
    output_name = Path(args.output).stem
    process_file(valid_inputs[0], str(output_dir), output_name, args.min_zoom, args.max_zoom)
    
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("\n[yellow]Cancelled by user[/yellow]")
        sys.exit(1)
    except Exception as e:
        log(f"\n[red]Error: {e}[/red]")
        raise
