#!/usr/bin/env python3
"""
Batch convert multiple S-57 ENC files to MBTiles.

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
from pathlib import Path
from datetime import datetime
from concurrent.futures import ProcessPoolExecutor, as_completed
import traceback

# Import the single-chart converter
from convert import convert_chart


def find_s57_files(root_dir: str, pattern: str = "*") -> list:
    """Find all S-57 (.000) files in a directory tree."""
    root = Path(root_dir)
    s57_files = []
    
    # Handle glob pattern
    if pattern != "*":
        # Convert shell glob to Path glob
        for s57_file in root.rglob(f"{pattern}.000"):
            s57_files.append(s57_file)
    else:
        for s57_file in root.rglob("*.000"):
            s57_files.append(s57_file)
    
    # Sort by chart ID for consistent ordering
    s57_files.sort(key=lambda x: x.stem)
    return s57_files


def convert_single(args: tuple) -> dict:
    """Convert a single chart (for parallel processing)."""
    s57_path, output_dir = args
    chart_id = Path(s57_path).stem
    
    result = {
        'chart_id': chart_id,
        's57_path': str(s57_path),
        'success': False,
        'output_path': None,
        'error': None,
        'layers': 0,
        'features': 0,
        'size_mb': 0,
    }
    
    try:
        output_path = convert_chart(str(s57_path), output_dir)
        result['success'] = True
        result['output_path'] = output_path
        result['size_mb'] = Path(output_path).stat().st_size / 1024 / 1024
    except Exception as e:
        result['error'] = str(e)
        result['traceback'] = traceback.format_exc()
    
    return result


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
    
    # Find all S-57 files
    print(f"Scanning {args.input_dir} for S-57 files (pattern: {args.pattern})...")
    s57_files = find_s57_files(args.input_dir, args.pattern)
    
    if not s57_files:
        print("No S-57 files found!")
        sys.exit(1)
    
    print(f"Found {len(s57_files)} charts to convert")
    
    # Filter if resuming
    if args.resume:
        output_dir = Path(args.output_dir)
        original_count = len(s57_files)
        s57_files = [
            f for f in s57_files 
            if not (output_dir / f"{f.stem}.mbtiles").exists()
        ]
        skipped = original_count - len(s57_files)
        if skipped > 0:
            print(f"Skipping {skipped} already converted charts")
    
    # Dry run - just list charts
    if args.dry_run:
        print("\nCharts to convert:")
        for f in s57_files:
            print(f"  {f.stem}: {f}")
        print(f"\nTotal: {len(s57_files)} charts")
        sys.exit(0)
    
    # Create output directory
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    
    # Track results
    results = []
    start_time = datetime.now()
    
    # Convert charts
    if args.parallel > 1:
        print(f"\nConverting with {args.parallel} parallel workers...")
        work_items = [(str(f), args.output_dir) for f in s57_files]
        
        with ProcessPoolExecutor(max_workers=args.parallel) as executor:
            futures = {executor.submit(convert_single, item): item for item in work_items}
            
            for i, future in enumerate(as_completed(futures), 1):
                result = future.result()
                results.append(result)
                
                status = "✓" if result['success'] else "✗"
                size = f"{result['size_mb']:.1f}MB" if result['success'] else result['error'][:50]
                print(f"[{i}/{len(s57_files)}] {status} {result['chart_id']}: {size}")
    else:
        print("\nConverting sequentially...")
        for i, s57_file in enumerate(s57_files, 1):
            result = convert_single((str(s57_file), args.output_dir))
            results.append(result)
            
            status = "✓" if result['success'] else "✗"
            size = f"{result['size_mb']:.1f}MB" if result['success'] else result['error'][:50]
            print(f"[{i}/{len(s57_files)}] {status} {result['chart_id']}: {size}")
    
    # Summary
    elapsed = datetime.now() - start_time
    successful = [r for r in results if r['success']]
    failed = [r for r in results if not r['success']]
    total_size = sum(r['size_mb'] for r in successful)
    
    print(f"\n{'='*60}")
    print(f"CONVERSION COMPLETE")
    print(f"{'='*60}")
    print(f"Time elapsed: {elapsed}")
    print(f"Successful:   {len(successful)}/{len(results)}")
    print(f"Failed:       {len(failed)}")
    print(f"Total size:   {total_size:.1f} MB")
    print(f"Output dir:   {args.output_dir}")
    
    if failed:
        print(f"\nFailed charts:")
        for r in failed:
            print(f"  {r['chart_id']}: {r['error']}")
    
    # Write results to JSON for reference
    results_file = Path(args.output_dir) / "conversion_results.json"
    with open(results_file, 'w') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'input_dir': args.input_dir,
            'output_dir': args.output_dir,
            'total_charts': len(results),
            'successful': len(successful),
            'failed': len(failed),
            'total_size_mb': total_size,
            'elapsed_seconds': elapsed.total_seconds(),
            'results': results,
        }, f, indent=2)
    print(f"\nResults saved to: {results_file}")
    
    sys.exit(0 if not failed else 1)


if __name__ == "__main__":
    main()
