#!/usr/bin/env python3
"""
Find all charts that overlap with a reference chart's coverage area.
"""

import subprocess
import sys
import json
import re
from pathlib import Path

def get_chart_bounds(chart_path):
    """Extract bounding box from S-57 chart using ogrinfo."""
    try:
        result = subprocess.run(
            ['ogrinfo', '-al', '-so', str(chart_path)],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        # Parse extent from ogrinfo output
        for line in result.stdout.split('\n'):
            if 'Extent:' in line:
                # Format: Extent: (minX, minY) - (maxX, maxY)
                match = re.search(r'Extent: \(([-\d.]+), ([-\d.]+)\) - \(([-\d.]+), ([-\d.]+)\)', line)
                if match:
                    return {
                        'minX': float(match.group(1)),
                        'minY': float(match.group(2)),
                        'maxX': float(match.group(3)),
                        'maxY': float(match.group(4))
                    }
        return None
    except Exception as e:
        print(f"Error reading {chart_path}: {e}", file=sys.stderr)
        return None

def bounds_overlap(bounds1, bounds2):
    """Check if two bounding boxes overlap."""
    if not bounds1 or not bounds2:
        return False
    
    # Two rectangles overlap if they overlap in both X and Y dimensions
    x_overlap = bounds1['maxX'] >= bounds2['minX'] and bounds2['maxX'] >= bounds1['minX']
    y_overlap = bounds1['maxY'] >= bounds2['minY'] and bounds2['maxY'] >= bounds1['minY']
    
    return x_overlap and y_overlap

def main():
    if len(sys.argv) < 2:
        print("Usage: find_overlapping_charts.py <reference_chart_id>")
        print("Example: find_overlapping_charts.py US2PACZS")
        sys.exit(1)
    
    reference_chart = sys.argv[1]
    source_dir = Path(__file__).parent.parent / 'charts' / 'All_Alaska_ENC_ROOT'
    
    # Get reference chart bounds
    reference_path = source_dir / reference_chart / f"{reference_chart}.000"
    if not reference_path.exists():
        print(f"Error: Reference chart not found: {reference_path}")
        sys.exit(1)
    
    print(f"Analyzing coverage area of {reference_chart}...")
    reference_bounds = get_chart_bounds(reference_path)
    
    if not reference_bounds:
        print(f"Error: Could not extract bounds from {reference_chart}")
        sys.exit(1)
    
    print(f"Reference bounds: {reference_bounds}")
    print(f"Scanning all charts in {source_dir}...")
    print()
    
    overlapping_charts = []
    total_charts = 0
    
    # Scan all chart directories
    for chart_dir in sorted(source_dir.iterdir()):
        if not chart_dir.is_dir():
            continue
        
        chart_id = chart_dir.name
        chart_file = chart_dir / f"{chart_id}.000"
        
        if not chart_file.exists():
            continue
        
        total_charts += 1
        
        # Skip the reference chart itself
        if chart_id == reference_chart:
            continue
        
        # Get bounds for this chart
        bounds = get_chart_bounds(chart_file)
        
        if bounds and bounds_overlap(reference_bounds, bounds):
            overlapping_charts.append(chart_id)
            print(f"✓ {chart_id} overlaps")
    
    print()
    print("=" * 60)
    print(f"Summary:")
    print(f"  Total charts scanned: {total_charts}")
    print(f"  Overlapping charts found: {len(overlapping_charts)}")
    print("=" * 60)
    print()
    
    if overlapping_charts:
        print("Overlapping chart IDs (space-separated):")
        print(" ".join(overlapping_charts))
        print()
        
        # Group by scale
        by_scale = {}
        for chart_id in overlapping_charts:
            match = re.match(r'^(US\d)', chart_id)
            if match:
                scale = match.group(1)
                by_scale.setdefault(scale, []).append(chart_id)
        
        print("Grouped by scale:")
        for scale in sorted(by_scale.keys()):
            print(f"  {scale}: {len(by_scale[scale])} charts")
            print(f"    {' '.join(by_scale[scale][:10])}")
            if len(by_scale[scale]) > 10:
                print(f"    ... and {len(by_scale[scale]) - 10} more")
        print()
        
        print("To convert all overlapping charts:")
        print(f"  ./scripts/convert-charts.sh {' '.join(overlapping_charts)}")

if __name__ == '__main__':
    main()
