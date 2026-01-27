#!/usr/bin/env python3
"""
Batch convert multiple S-57 ENC files to MBTiles with live dashboard.

Usage:
    python3 batch_convert.py /path/to/ENC_ROOT /path/to/output [--parallel N]

Examples:
    # Convert all charts in Alaska ENC directory
    python3 batch_convert.py /Users/me/Downloads/All_Alaska_ENC_ROOT ./output

    # Convert with 4 parallel workers
    python3 batch_convert.py /Users/me/Downloads/All_Alaska_ENC_ROOT ./output --parallel 4

    # Convert specific chart patterns (e.g., only US5* harbor charts)
    python3 batch_convert.py /Users/me/Downloads/All_Alaska_ENC_ROOT ./output --pattern "US5*"
"""

import os
import sys
import argparse
import json
import time
import threading
import shutil
from pathlib import Path
from datetime import datetime, timedelta
from concurrent.futures import ProcessPoolExecutor, as_completed
from collections import deque
import traceback

# Import the single-chart converter
from convert import convert_chart


# ═══════════════════════════════════════════════════════════════════════════════
# ANSI Escape Codes
# ═══════════════════════════════════════════════════════════════════════════════

class Term:
    """Terminal control codes."""
    # Colors
    RESET = '\033[0m'
    BOLD = '\033[1m'
    DIM = '\033[2m'
    
    RED = '\033[31m'
    GREEN = '\033[32m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    MAGENTA = '\033[35m'
    CYAN = '\033[36m'
    WHITE = '\033[37m'
    
    BRIGHT_RED = '\033[91m'
    BRIGHT_GREEN = '\033[92m'
    BRIGHT_YELLOW = '\033[93m'
    BRIGHT_CYAN = '\033[96m'
    BRIGHT_WHITE = '\033[97m'
    
    # Cursor control
    HIDE_CURSOR = '\033[?25l'
    SHOW_CURSOR = '\033[?25h'
    CLEAR_SCREEN = '\033[2J'
    HOME = '\033[H'
    CLEAR_LINE = '\033[2K'
    
    @staticmethod
    def move_to(row: int, col: int = 1) -> str:
        return f'\033[{row};{col}H'
    
    @staticmethod
    def clear_to_end():
        return '\033[J'


# ═══════════════════════════════════════════════════════════════════════════════
# Dashboard Display
# ═══════════════════════════════════════════════════════════════════════════════

class Dashboard:
    """
    Static dashboard that updates in place.
    
    Layout:
    ┌─────────────────────────────────────────────────────────────────────────────┐
    │  XNautical ENC Batch Converter                                              │
    ├─────────────────────────────────────────────────────────────────────────────┤
    │  Progress: [████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 35.2%             │
    │                                                                             │
    │  ✓ Completed: 412    ✗ Failed: 2      ○ Remaining: 757                      │
    │  ⏱ Elapsed: 1h 23m   ⏳ ETA: 2h 15m    📊 Rate: 298/hr                       │
    │  💾 Size: 4.2 GB                                                            │
    │                                                                             │
    │  Scale: US1: 4   US2: 12   US3: 35   US4: 280   US5: 81                     │
    ├─────────────────────────────────────────────────────────────────────────────┤
    │  ACTIVITY LOG                                                               │
    │  ──────────────────────────────────────────────────────────────────────     │
    │  [12:34:56] ✓ US4AK4PH    12.3 MB  (45.2s)                                  │
    │  [12:35:41] ✓ US4AK4PI     8.7 MB  (38.1s)                                  │
    │  [12:36:19] ✗ US4AK4PJ    Error: tippecanoe failed                          │
    │  [12:36:52] ✓ US4AK4PK    15.1 MB  (52.3s)                                  │
    │  [12:37:44] ► US5AK5SI    Converting...                                     │
    │                                                                             │
    │                                                                             │
    ├─────────────────────────────────────────────────────────────────────────────┤
    │  Log: conversion_log_20260127_123456.txt                                    │
    └─────────────────────────────────────────────────────────────────────────────┘
    """
    
    ACTIVITY_LOG_SIZE = 8  # Number of lines in activity log
    
    def __init__(self, total_charts: int, output_dir: str):
        self.total = total_charts
        self.output_dir = output_dir
        self.completed = 0
        self.successful = 0
        self.failed = 0
        self.total_size_mb = 0.0
        self.start_time = datetime.now()
        self.recent_times = deque(maxlen=20)
        self.scale_stats = {'US1': 0, 'US2': 0, 'US3': 0, 'US4': 0, 'US5': 0, 'US6': 0}
        self.scale_sizes = {'US1': 0.0, 'US2': 0.0, 'US3': 0.0, 'US4': 0.0, 'US5': 0.0, 'US6': 0.0}
        
        # Activity log (rolling buffer)
        self.activity_log = deque(maxlen=self.ACTIVITY_LOG_SIZE)
        self.current_chart = ""
        
        # Threading
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._refresh_thread = None
        
        # Log file
        self.timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        self.log_file_path = Path(output_dir) / f"conversion_log_{self.timestamp}.txt"
        self.log_file = None
        
        # Get terminal size
        self.term_width = min(shutil.get_terminal_size().columns, 85)
    
    def start(self):
        """Start the dashboard display and refresh thread."""
        # Open log file
        self.log_file = open(self.log_file_path, 'w')
        self._write_log(f"{'='*70}")
        self._write_log(f"XNautical ENC Batch Conversion")
        self._write_log(f"Started: {self.start_time.strftime('%Y-%m-%d %H:%M:%S')}")
        self._write_log(f"Total charts: {self.total}")
        self._write_log(f"{'='*70}\n")
        
        # Hide cursor and clear screen
        sys.stdout.write(Term.HIDE_CURSOR)
        sys.stdout.write(Term.CLEAR_SCREEN)
        sys.stdout.write(Term.HOME)
        sys.stdout.flush()
        
        # Initial render
        self._render()
        
        # Start refresh thread (updates display every 0.5s)
        self._refresh_thread = threading.Thread(target=self._refresh_loop, daemon=True)
        self._refresh_thread.start()
    
    def stop(self):
        """Stop the dashboard and restore terminal."""
        self._stop_event.set()
        if self._refresh_thread:
            self._refresh_thread.join(timeout=1.0)
        
        # Show cursor
        sys.stdout.write(Term.SHOW_CURSOR)
        sys.stdout.flush()
        
        # Close log file
        if self.log_file:
            self._write_log(f"\n{'='*70}")
            self._write_log(f"Conversion Complete")
            self._write_log(f"Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            self._write_log(f"Successful: {self.successful}, Failed: {self.failed}")
            self._write_log(f"Total size: {self.total_size_mb:.1f} MB")
            self._write_log(f"{'='*70}")
            self.log_file.close()
    
    def _write_log(self, message: str):
        """Write to log file with timestamp."""
        if self.log_file:
            timestamp = datetime.now().strftime('%H:%M:%S')
            self.log_file.write(f"[{timestamp}] {message}\n")
            self.log_file.flush()
    
    def _refresh_loop(self):
        """Background thread that refreshes the display."""
        while not self._stop_event.is_set():
            self._render()
            time.sleep(0.5)
    
    def set_current(self, chart_id: str):
        """Set the currently processing chart."""
        with self._lock:
            self.current_chart = chart_id
            timestamp = datetime.now().strftime('%H:%M:%S')
            # Add "in progress" entry to activity log
            self._add_activity(f"{Term.YELLOW}►{Term.RESET} {self._color_chart(chart_id):<12} Converting...")
    
    def record_success(self, chart_id: str, size_mb: float, duration: float):
        """Record a successful conversion."""
        with self._lock:
            self.completed += 1
            self.successful += 1
            self.total_size_mb += size_mb
            self.recent_times.append(duration)
            
            scale = self._get_scale(chart_id)
            self.scale_stats[scale] += 1
            self.scale_sizes[scale] += size_mb
            
            # Update activity log (replace "in progress" with result)
            self._add_activity(
                f"{Term.BRIGHT_GREEN}✓{Term.RESET} {self._color_chart(chart_id):<12} "
                f"{Term.GREEN}{size_mb:>6.1f} MB{Term.RESET}  {Term.DIM}({duration:.1f}s){Term.RESET}"
            )
            
            self._write_log(f"✓ {chart_id}: {size_mb:.2f} MB ({duration:.1f}s)")
    
    def record_failure(self, chart_id: str, error: str, duration: float):
        """Record a failed conversion."""
        with self._lock:
            self.completed += 1
            self.failed += 1
            self.recent_times.append(duration)
            
            # Update activity log
            error_short = error[:35] if len(error) > 35 else error
            self._add_activity(
                f"{Term.BRIGHT_RED}✗{Term.RESET} {self._color_chart(chart_id):<12} "
                f"{Term.RED}{error_short}{Term.RESET}"
            )
            
            self._write_log(f"✗ {chart_id}: FAILED - {error}")
    
    def _add_activity(self, line: str):
        """Add a line to the activity log, removing any previous 'in progress' for same chart."""
        # Remove any existing "Converting..." entry (we're replacing it with result)
        # The deque handles the max size automatically
        self.activity_log.append(line)
    
    def _get_scale(self, chart_id: str) -> str:
        """Get scale from chart ID."""
        for scale in ['US1', 'US2', 'US3', 'US4', 'US5', 'US6']:
            if chart_id.startswith(scale):
                return scale
        return 'US4'  # Default
    
    def _color_chart(self, chart_id: str) -> str:
        """Color a chart ID by its scale."""
        scale = chart_id[:3] if len(chart_id) >= 3 else ''
        colors = {
            'US1': Term.MAGENTA,
            'US2': Term.BLUE,
            'US3': Term.CYAN,
            'US4': Term.YELLOW,
            'US5': Term.GREEN,
            'US6': Term.BRIGHT_GREEN,
        }
        color = colors.get(scale, Term.WHITE)
        return f"{color}{chart_id}{Term.RESET}"
    
    @property
    def elapsed(self) -> timedelta:
        return datetime.now() - self.start_time
    
    @property
    def eta(self) -> timedelta:
        if not self.recent_times or self.completed == 0:
            return timedelta(0)
        avg_time = sum(self.recent_times) / len(self.recent_times)
        remaining = self.total - self.completed
        return timedelta(seconds=avg_time * remaining)
    
    @property
    def rate(self) -> float:
        elapsed_hours = self.elapsed.total_seconds() / 3600
        if elapsed_hours < 0.001:
            return 0.0
        return self.completed / elapsed_hours
    
    @property
    def progress_pct(self) -> float:
        if self.total == 0:
            return 100.0
        return (self.completed / self.total) * 100
    
    def _format_duration(self, td: timedelta) -> str:
        """Format timedelta as human readable."""
        total_seconds = int(td.total_seconds())
        if total_seconds < 0:
            return "calculating..."
        
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        
        if hours > 0:
            return f"{hours}h {minutes:02d}m"
        elif minutes > 0:
            return f"{minutes}m {seconds:02d}s"
        else:
            return f"{seconds}s"
    
    def _progress_bar(self, width: int = 45) -> str:
        """Create a progress bar."""
        pct = self.progress_pct
        filled = int(width * pct / 100)
        empty = width - filled
        
        if pct < 25:
            color = Term.RED
        elif pct < 50:
            color = Term.YELLOW
        elif pct < 75:
            color = Term.BRIGHT_YELLOW
        else:
            color = Term.GREEN
        
        bar = f"{color}{'█' * filled}{Term.DIM}{'░' * empty}{Term.RESET}"
        return bar
    
    def _render(self):
        """Render the entire dashboard."""
        with self._lock:
            lines = []
            w = self.term_width
            
            # Box drawing characters
            TL, TR, BL, BR = '┌', '┐', '└', '┘'
            H, V = '─', '│'
            LT, RT, TT, BT = '├', '┤', '┬', '┴'
            
            # Header
            lines.append(f"{Term.BRIGHT_CYAN}{TL}{H*(w-2)}{TR}{Term.RESET}")
            title = "XNautical ENC Batch Converter"
            lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}  {Term.BOLD}{Term.BRIGHT_WHITE}{title}{Term.RESET}{' '*(w-len(title)-5)}{Term.BRIGHT_CYAN}{V}{Term.RESET}")
            lines.append(f"{Term.BRIGHT_CYAN}{LT}{H*(w-2)}{RT}{Term.RESET}")
            
            # Progress bar
            bar = self._progress_bar(w - 25)
            pct_str = f"{self.progress_pct:5.1f}%"
            lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}  Progress: {bar} {Term.BOLD}{pct_str}{Term.RESET} {Term.BRIGHT_CYAN}{V}{Term.RESET}")
            lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}{' '*(w-2)}{Term.BRIGHT_CYAN}{V}{Term.RESET}")
            
            # Stats row 1
            remaining = self.total - self.completed
            stat1 = f"  {Term.BRIGHT_GREEN}✓{Term.RESET} Completed: {Term.BOLD}{self.successful:<5}{Term.RESET}"
            stat2 = f"{Term.BRIGHT_RED}✗{Term.RESET} Failed: {Term.BOLD}{self.failed:<5}{Term.RESET}"
            stat3 = f"{Term.DIM}○{Term.RESET} Remaining: {Term.BOLD}{remaining:<5}{Term.RESET}"
            stats_line = f"{stat1}   {stat2}   {stat3}"
            # Calculate visible length (without ANSI codes)
            visible_len = len(f"  ✓ Completed: {self.successful:<5}   ✗ Failed: {self.failed:<5}   ○ Remaining: {remaining:<5}")
            padding = w - visible_len - 3
            lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}{stats_line}{' '*max(0,padding)}{Term.BRIGHT_CYAN}{V}{Term.RESET}")
            
            # Stats row 2
            elapsed_str = self._format_duration(self.elapsed)
            eta_str = self._format_duration(self.eta)
            rate_str = f"{self.rate:.0f}/hr"
            stat4 = f"  {Term.CYAN}⏱{Term.RESET}  Elapsed: {Term.BOLD}{elapsed_str:<10}{Term.RESET}"
            stat5 = f"{Term.CYAN}⏳{Term.RESET} ETA: {Term.BOLD}{eta_str:<10}{Term.RESET}"
            stat6 = f"{Term.CYAN}📊{Term.RESET} Rate: {Term.BOLD}{rate_str:<8}{Term.RESET}"
            lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}{stat4} {stat5} {stat6}    {Term.BRIGHT_CYAN}{V}{Term.RESET}")
            
            # Stats row 3 - Size
            size_str = f"{self.total_size_mb:.1f} MB" if self.total_size_mb < 1024 else f"{self.total_size_mb/1024:.2f} GB"
            lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}  {Term.CYAN}💾{Term.RESET} Total Size: {Term.BOLD}{size_str:<12}{Term.RESET}{' '*(w-32)}{Term.BRIGHT_CYAN}{V}{Term.RESET}")
            lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}{' '*(w-2)}{Term.BRIGHT_CYAN}{V}{Term.RESET}")
            
            # Scale breakdown
            scale_parts = []
            scale_visible_len = 0
            for scale in ['US1', 'US2', 'US3', 'US4', 'US5', 'US6']:
                count = self.scale_stats[scale]
                colors = {'US1': Term.MAGENTA, 'US2': Term.BLUE, 'US3': Term.CYAN, 
                         'US4': Term.YELLOW, 'US5': Term.GREEN, 'US6': Term.BRIGHT_GREEN}
                if count > 0:
                    scale_parts.append(f"{colors[scale]}{scale}:{count}{Term.RESET}")
                    scale_visible_len += len(f"{scale}:{count}") + 2  # +2 for spacing
            
            if scale_parts:
                scale_str = "  ".join(scale_parts)
                scale_visible_len -= 2  # Remove trailing space count
            else:
                scale_str = f"{Term.DIM}Waiting...{Term.RESET}"
                scale_visible_len = 10
            
            scale_line = f"  Scale: {scale_str}"
            scale_padding = max(0, w - 10 - scale_visible_len - 3)
            lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}{scale_line}{' '*scale_padding}{Term.BRIGHT_CYAN}{V}{Term.RESET}")
            
            # Activity log section
            lines.append(f"{Term.BRIGHT_CYAN}{LT}{H*(w-2)}{RT}{Term.RESET}")
            lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}  {Term.BOLD}ACTIVITY LOG{Term.RESET}{' '*(w-17)}{Term.BRIGHT_CYAN}{V}{Term.RESET}")
            lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}  {Term.DIM}{'─'*(w-6)}{Term.RESET}  {Term.BRIGHT_CYAN}{V}{Term.RESET}")
            
            # Activity log entries
            timestamp = datetime.now().strftime('%H:%M:%S')
            for i in range(self.ACTIVITY_LOG_SIZE):
                if i < len(self.activity_log):
                    entry = list(self.activity_log)[i]
                    # Pad entry to fill the line
                    lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}  [{timestamp}] {entry}{' '*(w-60)}{Term.BRIGHT_CYAN}{V}{Term.RESET}")
                else:
                    lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}{' '*(w-2)}{Term.BRIGHT_CYAN}{V}{Term.RESET}")
            
            # Footer
            lines.append(f"{Term.BRIGHT_CYAN}{LT}{H*(w-2)}{RT}{Term.RESET}")
            log_display = str(self.log_file_path)[-50:] if len(str(self.log_file_path)) > 50 else str(self.log_file_path)
            lines.append(f"{Term.BRIGHT_CYAN}{V}{Term.RESET}  {Term.DIM}Log:{Term.RESET} {log_display}{' '*(w-len(log_display)-9)}{Term.BRIGHT_CYAN}{V}{Term.RESET}")
            lines.append(f"{Term.BRIGHT_CYAN}{BL}{H*(w-2)}{BR}{Term.RESET}")
            
            # Move to home and render
            output = Term.HOME + '\n'.join(lines)
            sys.stdout.write(output)
            sys.stdout.flush()


# ═══════════════════════════════════════════════════════════════════════════════
# Core Functions
# ═══════════════════════════════════════════════════════════════════════════════

def find_s57_files(root_dir: str, pattern: str = "*") -> list:
    """Find all S-57 (.000) files in a directory tree."""
    root = Path(root_dir)
    s57_files = []
    
    if pattern != "*":
        for s57_file in root.rglob(f"{pattern}.000"):
            s57_files.append(s57_file)
    else:
        for s57_file in root.rglob("*.000"):
            s57_files.append(s57_file)
    
    s57_files.sort(key=lambda x: x.stem)
    return s57_files


def convert_single(args: tuple) -> dict:
    """Convert a single chart."""
    s57_path, output_dir = args
    chart_id = Path(s57_path).stem
    start_time = time.time()
    
    result = {
        'chart_id': chart_id,
        's57_path': str(s57_path),
        'success': False,
        'output_path': None,
        'error': None,
        'size_mb': 0,
        'duration': 0,
    }
    
    try:
        output_path = convert_chart(str(s57_path), output_dir)
        result['success'] = True
        result['output_path'] = output_path
        result['size_mb'] = Path(output_path).stat().st_size / 1024 / 1024
    except Exception as e:
        result['error'] = str(e)
        result['traceback'] = traceback.format_exc()
    
    result['duration'] = time.time() - start_time
    return result


def print_final_summary(dashboard: Dashboard, results: list, output_dir: str):
    """Print final summary after dashboard closes."""
    print(f"\n{Term.BRIGHT_CYAN}{'═'*70}{Term.RESET}")
    print(f"{Term.BOLD}{Term.BRIGHT_WHITE}CONVERSION COMPLETE{Term.RESET}")
    print(f"{Term.BRIGHT_CYAN}{'═'*70}{Term.RESET}\n")
    
    success_rate = (dashboard.successful / dashboard.total * 100) if dashboard.total > 0 else 0
    
    print(f"  {Term.BRIGHT_GREEN}✓ Successful:{Term.RESET}  {dashboard.successful}")
    print(f"  {Term.BRIGHT_RED}✗ Failed:{Term.RESET}      {dashboard.failed}")
    print(f"  {Term.WHITE}Success Rate:{Term.RESET} {success_rate:.1f}%")
    print()
    print(f"  {Term.CYAN}⏱  Total Time:{Term.RESET}  {dashboard._format_duration(dashboard.elapsed)}")
    
    size_str = f"{dashboard.total_size_mb:.1f} MB" if dashboard.total_size_mb < 1024 else f"{dashboard.total_size_mb/1024:.2f} GB"
    print(f"  {Term.CYAN}💾 Total Size:{Term.RESET}  {size_str}")
    print(f"  {Term.CYAN}📊 Avg Rate:{Term.RESET}    {dashboard.rate:.1f} charts/hour")
    print()
    
    # Scale breakdown
    print(f"  {Term.BOLD}Scale Breakdown:{Term.RESET}")
    for scale in ['US1', 'US2', 'US3', 'US4', 'US5', 'US6']:
        count = dashboard.scale_stats[scale]
        size = dashboard.scale_sizes[scale]
        if count > 0:
            avg = size / count
            colors = {'US1': Term.MAGENTA, 'US2': Term.BLUE, 'US3': Term.CYAN,
                     'US4': Term.YELLOW, 'US5': Term.GREEN, 'US6': Term.BRIGHT_GREEN}
            print(f"    {colors[scale]}{scale}{Term.RESET}: {count} charts, {size:.1f} MB (avg {avg:.1f} MB)")
    
    # Failed charts
    failed = [r for r in results if not r['success']]
    if failed:
        print(f"\n  {Term.BRIGHT_RED}{Term.BOLD}Failed Charts:{Term.RESET}")
        for r in failed[:10]:
            print(f"    {Term.RED}✗{Term.RESET} {r['chart_id']}: {r['error'][:50]}")
        if len(failed) > 10:
            print(f"    {Term.DIM}... and {len(failed) - 10} more (see log file){Term.RESET}")
    
    print()
    print(f"  {Term.DIM}Output:{Term.RESET} {output_dir}")
    print(f"  {Term.DIM}Log:{Term.RESET}    {dashboard.log_file_path}")
    print()


def main():
    parser = argparse.ArgumentParser(
        description='Batch convert S-57 ENC files to MBTiles',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('input_dir', help='Root directory containing S-57 files')
    parser.add_argument('output_dir', help='Output directory for MBTiles files')
    parser.add_argument('--parallel', '-p', type=int, default=1,
                        help='Number of parallel workers (default: 1)')
    parser.add_argument('--pattern', default='*',
                        help='Chart ID pattern to match (e.g., "US5*" for harbor charts)')
    parser.add_argument('--dry-run', action='store_true',
                        help='List charts to convert without actually converting')
    parser.add_argument('--resume', action='store_true',
                        help='Skip charts that already have MBTiles output')
    
    args = parser.parse_args()
    
    # Find S-57 files (before dashboard starts)
    print(f"{Term.CYAN}🔍 Scanning for S-57 files...{Term.RESET}")
    s57_files = find_s57_files(args.input_dir, args.pattern)
    
    if not s57_files:
        print(f"{Term.RED}No S-57 files found!{Term.RESET}")
        sys.exit(1)
    
    print(f"{Term.GREEN}✓ Found {len(s57_files)} charts{Term.RESET}")
    
    # Filter if resuming
    skipped_count = 0
    if args.resume:
        original_count = len(s57_files)
        s57_files = [
            f for f in s57_files 
            if not (f.parent / f"{f.stem}.mbtiles").exists()
        ]
        skipped_count = original_count - len(s57_files)
        if skipped_count > 0:
            print(f"{Term.YELLOW}⏭  Skipping {skipped_count} already converted{Term.RESET}")
    
    print(f"{Term.GREEN}📋 {len(s57_files)} charts to process{Term.RESET}")
    
    # Dry run
    if args.dry_run:
        print(f"\n{Term.BOLD}Charts to convert:{Term.RESET}")
        for f in s57_files[:30]:
            print(f"  • {f.stem}")
        if len(s57_files) > 30:
            print(f"  {Term.DIM}... and {len(s57_files) - 30} more{Term.RESET}")
        sys.exit(0)
    
    if len(s57_files) == 0:
        print(f"{Term.GREEN}✓ All charts already converted!{Term.RESET}")
        sys.exit(0)
    
    # Create output directory
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    
    # Brief pause before dashboard
    print(f"\n{Term.DIM}Starting dashboard in 2 seconds...{Term.RESET}")
    time.sleep(2)
    
    # Create and start dashboard
    dashboard = Dashboard(len(s57_files), args.output_dir)
    results = []
    
    try:
        dashboard.start()
        
        # Convert charts
        if args.parallel > 1:
            work_items = [(str(f), str(f.parent)) for f in s57_files]
            
            with ProcessPoolExecutor(max_workers=args.parallel) as executor:
                futures = {executor.submit(convert_single, item): item for item in work_items}
                
                for future in as_completed(futures):
                    result = future.result()
                    results.append(result)
                    
                    if result['success']:
                        dashboard.record_success(result['chart_id'], result['size_mb'], result['duration'])
                    else:
                        dashboard.record_failure(result['chart_id'], result['error'] or "Unknown error", result['duration'])
        else:
            for s57_file in s57_files:
                dashboard.set_current(s57_file.stem)
                result = convert_single((str(s57_file), str(s57_file.parent)))
                results.append(result)
                
                if result['success']:
                    dashboard.record_success(result['chart_id'], result['size_mb'], result['duration'])
                else:
                    dashboard.record_failure(result['chart_id'], result['error'] or "Unknown error", result['duration'])
    
    except KeyboardInterrupt:
        pass
    
    finally:
        dashboard.stop()
    
    # Write results JSON
    timestamp = dashboard.timestamp
    results_file = Path(args.output_dir) / f"conversion_results_{timestamp}.json"
    with open(results_file, 'w') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'input_dir': args.input_dir,
            'output_dir': args.output_dir,
            'total_charts': len(results),
            'successful': dashboard.successful,
            'failed': dashboard.failed,
            'skipped': skipped_count,
            'total_size_mb': dashboard.total_size_mb,
            'elapsed_seconds': dashboard.elapsed.total_seconds(),
            'scale_stats': dashboard.scale_stats,
            'scale_sizes': dashboard.scale_sizes,
            'results': results,
        }, f, indent=2)
    
    # Print final summary
    print_final_summary(dashboard, results, args.output_dir)
    
    sys.exit(0 if dashboard.failed == 0 else 1)


if __name__ == "__main__":
    main()
