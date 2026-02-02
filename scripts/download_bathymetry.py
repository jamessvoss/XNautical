#!/usr/bin/env python3
"""
Download NOAA bathymetry data for Alaska.

Sources:
1. NOAA NCEI CUDEM - High resolution (~3m) coastal bathymetry/topography
2. NOAA ETOPO 2022 - Complete coverage (~450m) for all Alaska waters
3. GEBCO - Global coverage (~450m) alternative

Usage:
    python3 scripts/download_bathymetry.py --cudem     # Download NOAA CUDEM tiles (high-res coastal)
    python3 scripts/download_bathymetry.py --etopo     # Download ETOPO 2022 tiles (complete coverage)
    python3 scripts/download_bathymetry.py --gebco     # Show GEBCO download instructions
    python3 scripts/download_bathymetry.py --list      # List all available tiles

Requires: pip install rich httpx
"""

import os
import sys
import argparse
import time
from pathlib import Path

try:
    from rich.console import Console
    from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, DownloadColumn, TransferSpeedColumn, TimeRemainingColumn
    from rich.table import Table
    from rich.panel import Panel
    from rich.live import Live
    from rich import box
    import httpx
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False
    import urllib.request

console = Console() if RICH_AVAILABLE else None

# NOAA CUDEM Alaska tiles (1/9 arc-second resolution = ~3m)
# Source: https://coast.noaa.gov/htdata/raster2/elevation/NCEI_ninth_Topobathy_2014_8483/AK/
CUDEM_BASE_URL = "https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/NCEI_ninth_Topobathy_2014_8483/AK/"

CUDEM_TILES = [
    # Southeast Alaska (Juneau area)
    ("ncei19_n58x50_w135x75_2024v1.tif", 176.38, "SE Alaska - Juneau"),
    ("ncei19_n58x50_w136x00_2024v1.tif", 173.38, "SE Alaska - Juneau"),
    
    # Cook Inlet / Kenai Peninsula
    ("ncei19_n59x75_w152x00_2022v1.tif", 141.81, "Cook Inlet South"),
    ("ncei19_n60x00_w151x75_2022v1.tif", 159.43, "Cook Inlet - Kenai"),
    ("ncei19_n60x00_w152x00_2022v1.tif", 147.73, "Cook Inlet - Kenai"),
    ("ncei19_n60x25_w151x50_2022v1.tif", 161.00, "Cook Inlet - Kenai"),
    ("ncei19_n60x25_w151x75_2022v1.tif", 151.51, "Cook Inlet - Kenai"),
    ("ncei19_n60x25_w152x00_2022v1.tif", 129.66, "Cook Inlet - Kenai"),
    ("ncei19_n60x50_w151x25_2022v1.tif", 172.14, "Cook Inlet - Anchorage"),
    ("ncei19_n60x50_w151x50_2022v1.tif", 163.35, "Cook Inlet - Anchorage"),
    ("ncei19_n60x75_w151x25_2022v1.tif", 179.52, "Cook Inlet - Anchorage"),
    ("ncei19_n60x75_w151x50_2022v1.tif", 166.34, "Cook Inlet - Anchorage"),
    
    # Norton Sound / Nome area
    ("ncei19_n64x50_w165x50_2024v1.tif", 251.21, "Norton Sound - Nome"),
    ("ncei19_n64x50_w165x75_2024v1.tif", 251.21, "Norton Sound - Nome"),
    ("ncei19_n64x75_w165x50_2024v1.tif", 251.12, "Norton Sound - Nome"),
    ("ncei19_n64x75_w165x75_2024v1.tif", 251.21, "Norton Sound - Nome"),
]

# NOAA ETOPO 2022 tiles (15 arc-second resolution = ~450m)
# Complete Alaska coverage including offshore
# Source: https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/15s/15s_surface_elev_gtif/
ETOPO_BASE_URL = "https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/15s/15s_surface_elev_gtif/"

# Alaska bounding box: roughly 50°N to 72°N, 130°W to 172°E (crossing antimeridian)
# ETOPO tiles are 15x15 degrees, named by SW corner
ETOPO_TILES = [
    # Main Alaska (eastern)
    ("ETOPO_2022_v1_15s_N45W135_surface.tif", 85, "SE Alaska / BC border"),
    ("ETOPO_2022_v1_15s_N45W150_surface.tif", 85, "Gulf of Alaska SE"),
    ("ETOPO_2022_v1_15s_N60W135_surface.tif", 85, "SE Alaska / Yukon"),
    ("ETOPO_2022_v1_15s_N60W150_surface.tif", 85, "Southcentral Alaska"),
    ("ETOPO_2022_v1_15s_N60W165_surface.tif", 85, "SW Alaska / Bristol Bay"),
    
    # Western Alaska & Aleutians
    ("ETOPO_2022_v1_15s_N45W165_surface.tif", 85, "Gulf of Alaska / Aleutians E"),
    ("ETOPO_2022_v1_15s_N45W180_surface.tif", 85, "Aleutians Central"),
    ("ETOPO_2022_v1_15s_N45E165_surface.tif", 85, "Aleutians West"),
    ("ETOPO_2022_v1_15s_N60W180_surface.tif", 85, "Bering Sea South"),
    ("ETOPO_2022_v1_15s_N60E165_surface.tif", 85, "Bering Sea West"),
    
    # Northern Alaska & Arctic
    ("ETOPO_2022_v1_15s_N75W135_surface.tif", 85, "Arctic - Beaufort Sea E"),
    ("ETOPO_2022_v1_15s_N75W150_surface.tif", 85, "Arctic - North Slope"),
    ("ETOPO_2022_v1_15s_N75W165_surface.tif", 85, "Arctic - Chukchi Sea"),
    ("ETOPO_2022_v1_15s_N75W180_surface.tif", 85, "Arctic - Bering Strait"),
]

CUDEM_OUTPUT_DIR = Path(__file__).parent.parent / "data" / "bathymetry" / "cudem"
ETOPO_OUTPUT_DIR = Path(__file__).parent.parent / "data" / "bathymetry" / "etopo"


def list_tiles():
    """List available tiles with sizes."""
    if not RICH_AVAILABLE:
        print("Install rich for better display: pip install rich httpx")
        return _list_tiles_plain()
    
    # CUDEM Table
    cudem_table = Table(
        title="[bold cyan]OPTION 1: NOAA CUDEM[/] - High Resolution Coastal (~3m)",
        box=box.ROUNDED,
        show_header=True,
        header_style="bold magenta"
    )
    cudem_table.add_column("Filename", style="dim")
    cudem_table.add_column("Size", justify="right", style="green")
    cudem_table.add_column("Region", style="yellow")
    
    cudem_total = 0
    for filename, size_mb, region in CUDEM_TILES:
        cudem_table.add_row(filename, f"{size_mb:.1f} MB", region)
        cudem_total += size_mb
    
    cudem_table.add_section()
    cudem_table.add_row("[bold]TOTAL[/]", f"[bold green]{cudem_total:.1f} MB ({cudem_total/1024:.2f} GB)[/]", "")
    
    # ETOPO Table
    etopo_table = Table(
        title="[bold cyan]OPTION 2: NOAA ETOPO 2022[/] - Complete Coverage (~450m)",
        box=box.ROUNDED,
        show_header=True,
        header_style="bold magenta"
    )
    etopo_table.add_column("Filename", style="dim")
    etopo_table.add_column("Size", justify="right", style="green")
    etopo_table.add_column("Region", style="yellow")
    
    etopo_total = 0
    for filename, size_mb, region in ETOPO_TILES:
        etopo_table.add_row(filename, f"{size_mb:.0f} MB", region)
        etopo_total += size_mb
    
    etopo_table.add_section()
    etopo_table.add_row("[bold]TOTAL[/]", f"[bold green]{etopo_total:.0f} MB ({etopo_total/1024:.2f} GB)[/]", "")
    
    console.print()
    console.print(Panel.fit(
        "[dim]Limited to specific surveyed coastal areas only[/]",
        title="CUDEM Info"
    ))
    console.print(cudem_table)
    
    console.print()
    console.print(Panel.fit(
        "[dim]Full Alaska coverage including all offshore areas[/]",
        title="ETOPO Info"
    ))
    console.print(etopo_table)
    
    console.print()
    console.print(Panel(
        "[green]--etopo[/]  Complete Alaska bathymetry coverage [bold](RECOMMENDED)[/]\n"
        "[green]--cudem[/]  High-resolution data in specific coastal areas only",
        title="[bold]Recommendation[/]",
        box=box.DOUBLE
    ))


def _list_tiles_plain():
    """Fallback plain text listing."""
    print("\nCUDEM Tiles (High Resolution ~3m):")
    print("-" * 60)
    cudem_total = 0
    for filename, size_mb, region in CUDEM_TILES:
        print(f"  {filename}: {size_mb:.1f} MB - {region}")
        cudem_total += size_mb
    print(f"  Total: {cudem_total:.1f} MB")
    
    print("\nETOPO Tiles (Complete Coverage ~450m):")
    print("-" * 60)
    etopo_total = 0
    for filename, size_mb, region in ETOPO_TILES:
        print(f"  {filename}: {size_mb:.0f} MB - {region}")
        etopo_total += size_mb
    print(f"  Total: {etopo_total:.0f} MB")


def download_file_rich(url: str, output_path: Path, progress: Progress, task_id) -> bool:
    """Download a file with rich progress bar."""
    try:
        with httpx.stream("GET", url, follow_redirects=True, timeout=60.0) as response:
            response.raise_for_status()
            total = int(response.headers.get("content-length", 0))
            progress.update(task_id, total=total)
            
            with open(output_path, "wb") as f:
                for chunk in response.iter_bytes(chunk_size=8192):
                    f.write(chunk)
                    progress.update(task_id, advance=len(chunk))
        return True
    except Exception as e:
        console.print(f"[red]Error: {e}[/]")
        return False


def download_file_plain(url: str, output_path: Path, expected_size: float) -> bool:
    """Download a file with basic progress."""
    def progress(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            percent = min(100, downloaded * 100 / total_size)
            sys.stdout.write(f"\r  {percent:5.1f}%")
            sys.stdout.flush()
    
    try:
        urllib.request.urlretrieve(url, output_path, progress)
        print(" Done!")
        return True
    except Exception as e:
        print(f" Error: {e}")
        return False


def download_tiles(base_url, tiles, output_dir, source_name, region_filter=None, skip_existing=True):
    """Download tiles from a URL source with rich progress display."""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    if region_filter:
        tiles = [t for t in tiles if any(x.lower() in t[2].lower() for x in region_filter)]
    
    if not tiles:
        if RICH_AVAILABLE:
            console.print("[yellow]No tiles match the filter[/]")
        else:
            print("No tiles match the filter")
        return 0, 0, 0
    
    # Calculate totals
    total_size = sum(t[1] for t in tiles)
    
    # Check which files need downloading
    to_download = []
    skipped = 0
    for filename, size_mb, region in tiles:
        output_path = output_dir / filename
        if skip_existing and output_path.exists():
            existing_size = output_path.stat().st_size / (1024 * 1024)
            if existing_size > 1:
                skipped += 1
                continue
        to_download.append((filename, size_mb, region, output_path))
    
    if not RICH_AVAILABLE:
        return _download_tiles_plain(base_url, to_download, skipped)
    
    # Rich display
    console.print()
    console.print(Panel(
        f"[bold]{source_name}[/]\n"
        f"Output: [cyan]{output_dir}[/]\n"
        f"Tiles: [green]{len(tiles)}[/] total, [yellow]{skipped}[/] skipped, [blue]{len(to_download)}[/] to download\n"
        f"Total size: [green]{total_size:.1f} MB[/]",
        title="[bold blue]Download Started[/]",
        box=box.DOUBLE
    ))
    
    if not to_download:
        console.print("[green]✓ All files already downloaded![/]")
        return 0, skipped, 0
    
    downloaded = 0
    failed = 0
    
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(bar_width=40),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        DownloadColumn(),
        TransferSpeedColumn(),
        TimeRemainingColumn(),
        console=console,
        expand=True
    ) as progress:
        
        # Overall progress
        overall_task = progress.add_task(
            f"[bold cyan]Overall ({len(to_download)} files)",
            total=len(to_download)
        )
        
        for filename, size_mb, region, output_path in to_download:
            url = base_url + filename
            
            # File progress
            file_task = progress.add_task(
                f"[green]{filename[:40]}...[/]" if len(filename) > 40 else f"[green]{filename}[/]",
                total=int(size_mb * 1024 * 1024)
            )
            
            if download_file_rich(url, output_path, progress, file_task):
                downloaded += 1
                progress.update(file_task, description=f"[dim green]✓ {filename[:35]}...[/]" if len(filename) > 35 else f"[dim green]✓ {filename}[/]")
            else:
                failed += 1
                progress.update(file_task, description=f"[red]✗ {filename[:35]}...[/]" if len(filename) > 35 else f"[red]✗ {filename}[/]")
            
            progress.update(overall_task, advance=1)
    
    # Summary
    console.print()
    if failed == 0:
        console.print(Panel(
            f"[green]✓ Downloaded:[/] {downloaded}\n"
            f"[yellow]⊘ Skipped:[/] {skipped}\n"
            f"[red]✗ Failed:[/] {failed}",
            title="[bold green]Download Complete![/]",
            box=box.ROUNDED
        ))
    else:
        console.print(Panel(
            f"[green]✓ Downloaded:[/] {downloaded}\n"
            f"[yellow]⊘ Skipped:[/] {skipped}\n"
            f"[red]✗ Failed:[/] {failed}",
            title="[bold yellow]Download Finished with Errors[/]",
            box=box.ROUNDED
        ))
    
    return downloaded, skipped, failed


def _download_tiles_plain(base_url, to_download, skipped):
    """Fallback plain download without rich."""
    print(f"\nDownloading {len(to_download)} files...")
    downloaded = 0
    failed = 0
    
    for filename, size_mb, region, output_path in to_download:
        url = base_url + filename
        print(f"\n[{downloaded+failed+1}/{len(to_download)}] {filename} ({size_mb:.1f} MB)")
        print(f"  Region: {region}")
        
        if download_file_plain(url, output_path, size_mb):
            downloaded += 1
        else:
            failed += 1
    
    print(f"\nSummary: {downloaded} downloaded, {skipped} skipped, {failed} failed")
    return downloaded, skipped, failed


def download_cudem(region_filter=None, skip_existing=True):
    """Download NOAA CUDEM tiles (high-resolution coastal)."""
    return download_tiles(
        CUDEM_BASE_URL, CUDEM_TILES, CUDEM_OUTPUT_DIR,
        "NOAA CUDEM - High Resolution Coastal Bathymetry (~3m)",
        region_filter, skip_existing
    )


def download_etopo(region_filter=None, skip_existing=True):
    """Download NOAA ETOPO 2022 tiles (complete coverage)."""
    return download_tiles(
        ETOPO_BASE_URL, ETOPO_TILES, ETOPO_OUTPUT_DIR,
        "NOAA ETOPO 2022 - Complete Alaska Bathymetry (~450m)",
        region_filter, skip_existing
    )


def show_gebco_instructions():
    """Show instructions for downloading GEBCO data."""
    print("""
GEBCO Bathymetry Download Instructions
======================================

GEBCO provides global bathymetry at 15 arc-second (~450m) resolution.
This is lower resolution than NOAA but covers ALL offshore areas.

To download GEBCO data for Alaska:

1. Go to: https://download.gebco.net/

2. Select grid version: GEBCO_2024 (or latest)

3. Define Alaska region bounds:
   - North: 72°N
   - South: 50°N  
   - West: -180°W (or 180°E)
   - East: -130°W

4. Select format: GeoTIFF or 2D netCDF

5. Add to basket and enter email

6. Download link will be emailed to you

7. Save the file to: data/bathymetry/gebco/

Alternative - Full GEBCO Grid:
------------------------------
Download the full global grid from:
https://www.gebco.net/data_and_products/gridded_bathymetry_data/

The full grid is ~8GB but includes everything.
""")


def show_banner():
    """Show application banner."""
    if RICH_AVAILABLE:
        console.print()
        console.print(Panel.fit(
            "[bold blue]Alaska Bathymetry Download Tool[/]\n"
            "[dim]NOAA ETOPO 2022 & CUDEM Data[/]",
            box=box.DOUBLE,
            border_style="blue"
        ))
    else:
        print("\n" + "=" * 50)
        print("  ALASKA BATHYMETRY DOWNLOAD TOOL")
        print("=" * 50)


def show_usage():
    """Show usage information."""
    if RICH_AVAILABLE:
        usage_table = Table(box=box.SIMPLE, show_header=False, padding=(0, 2))
        usage_table.add_column("Option", style="green")
        usage_table.add_column("Description")
        
        usage_table.add_row("--list", "List available tiles and sizes")
        usage_table.add_row("--etopo", "[bold]Download ETOPO 2022 (~1.2GB) - RECOMMENDED[/]")
        usage_table.add_row("", "[dim]Complete Alaska coverage at ~450m resolution[/]")
        usage_table.add_row("--cudem", "Download CUDEM (~2.9GB)")
        usage_table.add_row("", "[dim]High-res (~3m) for specific coastal areas only[/]")
        usage_table.add_row("--all", "Download both ETOPO and CUDEM")
        usage_table.add_row("--gebco", "Show GEBCO alternative download instructions")
        usage_table.add_row("", "")
        usage_table.add_row("--region", "Filter by region name (e.g., --region Cook Arctic)")
        usage_table.add_row("--no-skip", "Re-download existing files")
        
        console.print()
        console.print(Panel(usage_table, title="[bold]Usage[/]", box=box.ROUNDED))
        
        console.print()
        console.print("[bold]Examples:[/]")
        console.print("  [cyan]python3 scripts/download_bathymetry.py --etopo[/]")
        console.print("  [cyan]python3 scripts/download_bathymetry.py --cudem --region Cook[/]")
        console.print("  [cyan]python3 scripts/download_bathymetry.py --all[/]")
    else:
        print("\nUsage:")
        print("  --list    List available tiles and sizes")
        print("  --etopo   Download ETOPO 2022 (~1.2GB) - RECOMMENDED")
        print("  --cudem   Download CUDEM (~2.9GB)")
        print("  --all     Download both")
        print("  --gebco   Show GEBCO instructions")
        print("  --region  Filter by region")
        print("  --no-skip Re-download existing files")


def check_dependencies():
    """Check and report on dependencies."""
    if not RICH_AVAILABLE:
        print("\n[!] For a better experience, install: pip install rich httpx")
        print("    Falling back to basic progress display.\n")


def main():
    parser = argparse.ArgumentParser(description="Download bathymetry data for Alaska")
    parser.add_argument("--cudem", action="store_true", help="Download NOAA CUDEM tiles (high-res coastal)")
    parser.add_argument("--etopo", action="store_true", help="Download NOAA ETOPO 2022 tiles (complete coverage)")
    parser.add_argument("--all", action="store_true", help="Download both CUDEM and ETOPO")
    parser.add_argument("--gebco", action="store_true", help="Show GEBCO download instructions")
    parser.add_argument("--list", action="store_true", help="List available tiles")
    parser.add_argument("--region", type=str, nargs="+", help="Filter by region (e.g., 'Cook', 'Nome', 'Arctic')")
    parser.add_argument("--no-skip", action="store_true", help="Re-download existing files")
    
    args = parser.parse_args()
    
    show_banner()
    check_dependencies()
    
    if args.list:
        list_tiles()
    elif args.cudem:
        download_cudem(region_filter=args.region, skip_existing=not args.no_skip)
    elif args.etopo:
        download_etopo(region_filter=args.region, skip_existing=not args.no_skip)
    elif args.all:
        if RICH_AVAILABLE:
            console.print("[bold]Downloading ALL bathymetry data...[/]")
        else:
            print("\nDownloading ALL bathymetry data...")
        download_etopo(skip_existing=not args.no_skip)
        download_cudem(skip_existing=not args.no_skip)
    elif args.gebco:
        show_gebco_instructions()
    else:
        show_usage()
        list_tiles()


if __name__ == "__main__":
    main()
