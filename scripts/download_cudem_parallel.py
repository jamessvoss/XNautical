#!/usr/bin/env python3
"""
CUDEM Bathymetry Parallel Downloader
Beautiful real-time progress display using Rich library
"""

import asyncio
import aiohttp
import aiofiles
from pathlib import Path
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Optional
import time
import os

from rich.console import Console
from rich.progress import (
    Progress,
    SpinnerColumn,
    BarColumn,
    TextColumn,
    DownloadColumn,
    TransferSpeedColumn,
    TimeRemainingColumn,
    TaskID,
)
from rich.live import Live
from rich.table import Table
from rich.panel import Panel
from rich.layout import Layout
from rich.text import Text
from rich import box

# Configuration
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
URL_FILE = PROJECT_ROOT / "data" / "cudem" / "ak_1-3_arcsec_urls_correct.txt"
OUTPUT_DIR = PROJECT_ROOT / "data" / "cudem" / "raw" / "alaska_1-3"
MAX_CONCURRENT = 4
CHUNK_SIZE = 1024 * 64  # 64KB chunks

console = Console()


@dataclass
class DownloadStats:
    """Global download statistics"""
    total_files: int = 0
    completed: int = 0
    failed: int = 0
    skipped: int = 0
    total_bytes: int = 0
    start_time: float = field(default_factory=time.time)
    active_downloads: dict = field(default_factory=dict)
    failed_files: list = field(default_factory=list)
    
    @property
    def elapsed(self) -> timedelta:
        return timedelta(seconds=time.time() - self.start_time)
    
    @property
    def avg_speed(self) -> float:
        elapsed = time.time() - self.start_time
        return self.total_bytes / elapsed if elapsed > 0 else 0
    
    @property
    def eta(self) -> Optional[timedelta]:
        if self.completed == 0:
            return None
        elapsed = time.time() - self.start_time
        rate = self.completed / elapsed
        remaining = self.total_files - self.completed - self.failed - self.skipped
        if rate > 0:
            return timedelta(seconds=remaining / rate)
        return None


def format_bytes(size: int) -> str:
    """Format bytes to human readable string"""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} PB"


def format_speed(bps: float) -> str:
    """Format bytes per second to human readable string"""
    return f"{format_bytes(bps)}/s"


def create_header_panel(stats: DownloadStats) -> Panel:
    """Create the header panel with overall progress"""
    progress_pct = (stats.completed + stats.skipped) / stats.total_files * 100 if stats.total_files > 0 else 0
    
    # Create progress bar manually
    bar_width = 40
    filled = int(bar_width * progress_pct / 100)
    bar = "█" * filled + "░" * (bar_width - filled)
    
    eta_str = str(stats.eta).split('.')[0] if stats.eta else "calculating..."
    elapsed_str = str(stats.elapsed).split('.')[0]
    
    content = Text()
    content.append("Progress: ", style="bold")
    content.append(f"[{bar}] ", style="cyan")
    content.append(f"{progress_pct:.1f}%\n\n", style="bold green")
    
    content.append(f"  📦 Total Files:     {stats.total_files}\n", style="white")
    content.append(f"  ✅ Completed:       {stats.completed}\n", style="green")
    content.append(f"  ⏭️  Skipped:         {stats.skipped}\n", style="yellow")
    content.append(f"  ❌ Failed:          {stats.failed}\n", style="red")
    content.append(f"  📥 Downloaded:      {format_bytes(stats.total_bytes)}\n", style="cyan")
    content.append(f"  ⚡ Avg Speed:       {format_speed(stats.avg_speed)}\n", style="magenta")
    content.append(f"  ⏱️  Elapsed:         {elapsed_str}\n", style="white")
    content.append(f"  🏁 ETA:             {eta_str}", style="white")
    
    return Panel(
        content,
        title="[bold blue]CUDEM 1/3 Arc-Second Alaska Download[/bold blue]",
        subtitle=f"[dim]{MAX_CONCURRENT} concurrent downloads[/dim]",
        box=box.ROUNDED,
        border_style="blue",
    )


def create_active_downloads_table(stats: DownloadStats) -> Table:
    """Create table showing active downloads"""
    table = Table(
        title="Active Downloads",
        box=box.SIMPLE,
        show_header=True,
        header_style="bold cyan",
        expand=True,
    )
    
    table.add_column("File", style="white", ratio=3)
    table.add_column("Progress", justify="center", ratio=2)
    table.add_column("Size", justify="right", style="green", ratio=1)
    table.add_column("Speed", justify="right", style="magenta", ratio=1)
    
    for filename, info in stats.active_downloads.items():
        downloaded = info.get('downloaded', 0)
        total = info.get('total', 0)
        speed = info.get('speed', 0)
        
        if total > 0:
            pct = downloaded / total * 100
            bar_width = 20
            filled = int(bar_width * pct / 100)
            bar = "█" * filled + "░" * (bar_width - filled)
            progress_str = f"[cyan]{bar}[/cyan] {pct:.0f}%"
            size_str = f"{format_bytes(downloaded)}/{format_bytes(total)}"
        else:
            progress_str = "[yellow]Starting...[/yellow]"
            size_str = format_bytes(downloaded) if downloaded > 0 else "..."
        
        speed_str = format_speed(speed) if speed > 0 else "..."
        
        # Truncate filename if too long
        display_name = filename[:40] + "..." if len(filename) > 43 else filename
        
        table.add_row(display_name, progress_str, size_str, speed_str)
    
    # Fill empty rows to keep table height consistent
    for _ in range(MAX_CONCURRENT - len(stats.active_downloads)):
        table.add_row("[dim]waiting...[/dim]", "", "", "")
    
    return table


def create_display(stats: DownloadStats) -> Layout:
    """Create the full display layout"""
    layout = Layout()
    layout.split_column(
        Layout(create_header_panel(stats), name="header", size=14),
        Layout(create_active_downloads_table(stats), name="downloads"),
    )
    return layout


async def download_file(
    session: aiohttp.ClientSession,
    url: str,
    output_path: Path,
    stats: DownloadStats,
    semaphore: asyncio.Semaphore,
) -> bool:
    """Download a single file with progress tracking"""
    filename = output_path.name
    
    async with semaphore:
        # Skip if already exists
        if output_path.exists() and output_path.stat().st_size > 0:
            stats.skipped += 1
            return True
        
        # Initialize tracking
        stats.active_downloads[filename] = {
            'downloaded': 0,
            'total': 0,
            'speed': 0,
            'start_time': time.time(),
        }
        
        try:
            async with session.get(url) as response:
                if response.status != 200:
                    stats.failed += 1
                    stats.failed_files.append((filename, f"HTTP {response.status}"))
                    del stats.active_downloads[filename]
                    return False
                
                total_size = int(response.headers.get('content-length', 0))
                stats.active_downloads[filename]['total'] = total_size
                
                downloaded = 0
                last_update = time.time()
                last_downloaded = 0
                
                # Create temp file first, then rename on success
                temp_path = output_path.with_suffix('.tmp')
                
                async with aiofiles.open(temp_path, 'wb') as f:
                    async for chunk in response.content.iter_chunked(CHUNK_SIZE):
                        await f.write(chunk)
                        downloaded += len(chunk)
                        stats.total_bytes += len(chunk)
                        
                        # Update speed every 0.5 seconds
                        now = time.time()
                        if now - last_update >= 0.5:
                            elapsed = now - last_update
                            speed = (downloaded - last_downloaded) / elapsed
                            stats.active_downloads[filename]['speed'] = speed
                            last_update = now
                            last_downloaded = downloaded
                        
                        stats.active_downloads[filename]['downloaded'] = downloaded
                
                # Rename temp to final
                temp_path.rename(output_path)
                
                stats.completed += 1
                del stats.active_downloads[filename]
                return True
                
        except asyncio.CancelledError:
            raise
        except Exception as e:
            stats.failed += 1
            stats.failed_files.append((filename, str(e)))
            if filename in stats.active_downloads:
                del stats.active_downloads[filename]
            # Clean up partial file
            temp_path = output_path.with_suffix('.tmp')
            if temp_path.exists():
                temp_path.unlink()
            return False


async def main():
    """Main download orchestrator"""
    # Read URLs
    if not URL_FILE.exists():
        console.print(f"[red]Error: URL file not found: {URL_FILE}[/red]")
        return
    
    urls = [line.strip() for line in URL_FILE.read_text().splitlines() if line.strip()]
    
    if not urls:
        console.print("[red]Error: No URLs found in file[/red]")
        return
    
    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Initialize stats
    stats = DownloadStats(total_files=len(urls))
    
    console.clear()
    console.print(Panel(
        f"[bold]Starting download of {len(urls)} files[/bold]\n"
        f"Output: {OUTPUT_DIR}\n"
        f"Concurrent downloads: {MAX_CONCURRENT}",
        title="[bold blue]CUDEM Downloader[/bold blue]",
        border_style="blue",
    ))
    await asyncio.sleep(2)
    
    # Create semaphore for concurrency control
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    
    # Configure client
    timeout = aiohttp.ClientTimeout(total=3600, connect=30)
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT, limit_per_host=MAX_CONCURRENT)
    
    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        # Create download tasks
        tasks = []
        for url in urls:
            filename = url.split('/')[-1]
            output_path = OUTPUT_DIR / filename
            task = asyncio.create_task(
                download_file(session, url, output_path, stats, semaphore)
            )
            tasks.append(task)
        
        # Run with live display
        with Live(create_display(stats), console=console, refresh_per_second=4) as live:
            while not all(task.done() for task in tasks):
                live.update(create_display(stats))
                await asyncio.sleep(0.25)
            
            # Final update
            live.update(create_display(stats))
    
    # Print summary
    console.print()
    elapsed_str = str(stats.elapsed).split('.')[0]
    
    if stats.failed == 0:
        console.print(Panel(
            f"[bold green]✅ Download Complete![/bold green]\n\n"
            f"  Files downloaded: {stats.completed}\n"
            f"  Files skipped:    {stats.skipped}\n"
            f"  Total size:       {format_bytes(stats.total_bytes)}\n"
            f"  Time elapsed:     {elapsed_str}\n"
            f"  Average speed:    {format_speed(stats.avg_speed)}",
            title="[bold green]Success[/bold green]",
            border_style="green",
        ))
    else:
        console.print(Panel(
            f"[bold yellow]⚠️ Download Complete with Errors[/bold yellow]\n\n"
            f"  Files downloaded: {stats.completed}\n"
            f"  Files skipped:    {stats.skipped}\n"
            f"  Files failed:     {stats.failed}\n"
            f"  Total size:       {format_bytes(stats.total_bytes)}\n"
            f"  Time elapsed:     {elapsed_str}",
            title="[bold yellow]Complete with Errors[/bold yellow]",
            border_style="yellow",
        ))
        
        if stats.failed_files:
            console.print("\n[bold red]Failed files:[/bold red]")
            for fname, error in stats.failed_files[:10]:
                console.print(f"  • {fname}: {error}")
            if len(stats.failed_files) > 10:
                console.print(f"  ... and {len(stats.failed_files) - 10} more")
    
    # Next steps
    console.print()
    console.print("[bold]Next step:[/bold] Convert to MBTiles:")
    console.print(f"  python scripts/convert_bathymetry.py --merge {OUTPUT_DIR}/ncei13_*.tif --output BATHY_ALASKA_1-3.mbtiles")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        console.print("\n[yellow]Download cancelled by user[/yellow]")
