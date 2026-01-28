#!/usr/bin/env python3
"""
Generate Chart Index

Scans mbtiles files and generates a pre-built chart index with:
- Chart bounds
- Parent-child hierarchy (tree structure)
- Zoom ranges
- File sizes

The output chart_index.json is loaded instantly at app startup,
eliminating the need to build the tree at runtime.

Usage:
    python generate_chart_index.py /path/to/mbtiles/directory [output.json]
"""

import os
import sys
import json
import sqlite3
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import re


def get_chart_level(chart_id: str) -> int:
    """Extract scale level from chart ID (US1=1, US2=2, etc.)"""
    match = re.match(r'^US(\d)', chart_id)
    if match:
        return int(match.group(1))
    return 5  # Default to most detailed


def get_default_zoom_range(level: int) -> tuple:
    """Get default min/max zoom for a chart level.
    
    These ranges define when each chart level should be visible:
    - US1 (Overview): z0-8 - visible at very low zooms
    - US2 (General): z6-10 - transition zone from overview
    - US3 (Coastal): z8-12 - coastal navigation
    - US4 (Approach): z10-14 - harbor approaches
    - US5 (Harbor): z12-18 - harbor detail
    - US6 (Berthing): z14-18 - maximum detail
    
    Ranges overlap slightly to allow smooth transitions.
    """
    zoom_ranges = {
        1: (0, 8),    # US1 Overview
        2: (6, 10),   # US2 General
        3: (8, 12),   # US3 Coastal
        4: (10, 14),  # US4 Approach
        5: (12, 18),  # US5 Harbor
        6: (14, 18),  # US6 Berthing
    }
    return zoom_ranges.get(level, (0, 18))


def parse_bounds(bounds_str: str) -> Optional[List[float]]:
    """Parse bounds string from mbtiles metadata.
    
    Format can be: "west,south,east,north" or various other formats
    Returns: [west, south, east, north] or None
    """
    if not bounds_str:
        return None
    
    try:
        # Try comma-separated format
        parts = [float(x.strip()) for x in bounds_str.split(',')]
        if len(parts) == 4:
            return parts
    except (ValueError, AttributeError):
        pass
    
    return None


def get_mbtiles_metadata(mbtiles_path: str) -> Dict:
    """Extract metadata from an mbtiles file."""
    metadata = {
        'bounds': None,
        'minzoom': None,
        'maxzoom': None,
        'name': None,
        'format': None,
    }
    
    try:
        conn = sqlite3.connect(mbtiles_path)
        cursor = conn.cursor()
        
        # Read metadata table
        cursor.execute("SELECT name, value FROM metadata")
        for name, value in cursor.fetchall():
            if name == 'bounds':
                metadata['bounds'] = parse_bounds(value)
            elif name == 'minzoom':
                try:
                    metadata['minzoom'] = int(value)
                except ValueError:
                    pass
            elif name == 'maxzoom':
                try:
                    metadata['maxzoom'] = int(value)
                except ValueError:
                    pass
            elif name == 'name':
                metadata['name'] = value
            elif name == 'format':
                metadata['format'] = value
        
        conn.close()
    except Exception as e:
        print(f"  Warning: Could not read metadata from {mbtiles_path}: {e}")
    
    return metadata


def bounds_contain(outer: List[float], inner: List[float], threshold: float = 0.7) -> bool:
    """Check if outer bounds contain inner bounds (center point or significant overlap)."""
    if not outer or not inner:
        return False
    
    outer_west, outer_south, outer_east, outer_north = outer
    inner_west, inner_south, inner_east, inner_north = inner
    
    # Check if inner center is within outer
    inner_center_lon = (inner_west + inner_east) / 2
    inner_center_lat = (inner_south + inner_north) / 2
    
    center_contained = (
        outer_west <= inner_center_lon <= outer_east and
        outer_south <= inner_center_lat <= outer_north
    )
    
    if center_contained:
        return True
    
    # Check for significant overlap
    int_west = max(outer_west, inner_west)
    int_south = max(outer_south, inner_south)
    int_east = min(outer_east, inner_east)
    int_north = min(outer_north, inner_north)
    
    if int_west >= int_east or int_south >= int_north:
        return False
    
    int_area = (int_east - int_west) * (int_north - int_south)
    inner_area = (inner_east - inner_west) * (inner_north - inner_south)
    
    if inner_area > 0 and int_area / inner_area >= threshold:
        return True
    
    return False


def build_hierarchy(charts: Dict[str, Dict]) -> Tuple[List[str], Dict[str, str], Dict[str, List[str]]]:
    """
    Build parent-child hierarchy based on geographic containment.
    
    Returns:
        roots: List of root chart IDs (US1 level)
        parent_of: Dict mapping child_id -> parent_id
        children_of: Dict mapping parent_id -> [child_ids]
    """
    # Group by level
    by_level: Dict[int, List[str]] = {}
    for chart_id, info in charts.items():
        level = info['level']
        if level not in by_level:
            by_level[level] = []
        by_level[level].append(chart_id)
    
    levels = sorted(by_level.keys())
    
    parent_of: Dict[str, str] = {}
    children_of: Dict[str, List[str]] = {chart_id: [] for chart_id in charts}
    
    # Build relationships from detailed to overview
    for i in range(len(levels) - 1, 0, -1):
        child_level = levels[i]
        parent_level = levels[i - 1]
        
        child_ids = by_level.get(child_level, [])
        parent_ids = by_level.get(parent_level, [])
        
        for child_id in child_ids:
            child_bounds = charts[child_id].get('bounds')
            if not child_bounds:
                continue
            
            # Find best parent (smallest one that contains this chart)
            best_parent = None
            best_area = float('inf')
            
            for parent_id in parent_ids:
                parent_bounds = charts[parent_id].get('bounds')
                if not parent_bounds:
                    continue
                
                if bounds_contain(parent_bounds, child_bounds):
                    # Calculate parent area - prefer smaller (more specific) parents
                    area = (parent_bounds[2] - parent_bounds[0]) * (parent_bounds[3] - parent_bounds[1])
                    if area < best_area:
                        best_area = area
                        best_parent = parent_id
            
            if best_parent:
                parent_of[child_id] = best_parent
                children_of[best_parent].append(child_id)
    
    # Sort children for consistent ordering
    for parent_id in children_of:
        children_of[parent_id].sort()
    
    # Roots are charts with no parent (typically US1 level)
    roots = [chart_id for chart_id in charts if chart_id not in parent_of]
    roots.sort()
    
    return roots, parent_of, children_of


def generate_chart_index(mbtiles_dir: str, output_path: str) -> Dict:
    """
    Scan mbtiles directory and generate chart index.
    Supports both flat directories and nested structures.
    """
    print(f"Scanning directory: {mbtiles_dir}")
    
    # Find all .mbtiles files (recursive search)
    mbtiles_files = []
    mbtiles_paths = {}  # chartId -> full path
    
    for root, dirs, files in os.walk(mbtiles_dir):
        for filename in files:
            if filename.endswith('.mbtiles'):
                # Skip non-chart files (GNIS, bathymetry, etc.)
                if filename.startswith('gnis_') or filename.startswith('BATHY_'):
                    print(f"  Skipping non-chart file: {filename}")
                    continue
                chart_id = filename.replace('.mbtiles', '')
                full_path = os.path.join(root, filename)
                mbtiles_files.append(filename)
                mbtiles_paths[chart_id] = full_path
    
    print(f"Found {len(mbtiles_files)} chart files")
    
    # Extract metadata from each file
    charts: Dict[str, Dict] = {}
    
    for filename in sorted(mbtiles_files):
        chart_id = filename.replace('.mbtiles', '')
        filepath = mbtiles_paths.get(chart_id, os.path.join(mbtiles_dir, filename))
        filesize = os.path.getsize(filepath)
        
        print(f"  Processing: {chart_id}")
        
        metadata = get_mbtiles_metadata(filepath)
        level = get_chart_level(chart_id)
        
        # ALWAYS use level-based zoom ranges for quilting logic
        # The mbtiles minzoom/maxzoom are tippecanoe's tile generation range,
        # not the "preferred viewing" range for quilting chart selection
        min_zoom, max_zoom = get_default_zoom_range(level)
        
        charts[chart_id] = {
            'bounds': metadata['bounds'],
            'level': level,
            'levelName': ['', 'Overview', 'General', 'Coastal', 'Approach', 'Harbor'][min(level, 5)],
            'minZoom': min_zoom,
            'maxZoom': max_zoom,
            'name': metadata['name'],
            'format': metadata['format'] or 'pbf',
            'fileSizeBytes': filesize,
            'parent': None,  # Will be filled by hierarchy builder
            'children': [],  # Will be filled by hierarchy builder
        }
    
    print(f"\nBuilding hierarchy...")
    
    # Build hierarchy
    roots, parent_of, children_of = build_hierarchy(charts)
    
    # Update charts with parent/children
    for chart_id, parent_id in parent_of.items():
        charts[chart_id]['parent'] = parent_id
    
    for chart_id, child_ids in children_of.items():
        charts[chart_id]['children'] = child_ids
    
    # Count by level
    level_counts = {}
    for chart_id, info in charts.items():
        level = info['level']
        level_counts[level] = level_counts.get(level, 0) + 1
    
    # Calculate tier assignments
    tier1_charts = []  # Memory-resident (US1, US2, US3)
    tier2_charts = []  # Dynamic loading (US4, US5)
    
    for chart_id, info in charts.items():
        if info['level'] <= 3:
            tier1_charts.append(chart_id)
        else:
            tier2_charts.append(chart_id)
    
    tier1_size = sum(charts[cid]['fileSizeBytes'] for cid in tier1_charts)
    tier2_size = sum(charts[cid]['fileSizeBytes'] for cid in tier2_charts)
    
    # Build final index
    index = {
        'version': 1,
        'generated': datetime.now().isoformat(),
        'stats': {
            'totalCharts': len(charts),
            'byLevel': {
                f'US{level}': count 
                for level, count in sorted(level_counts.items())
            },
            'tier1': {
                'description': 'Memory-resident (US1/US2/US3)',
                'chartCount': len(tier1_charts),
                'totalSizeBytes': tier1_size,
                'totalSizeMB': round(tier1_size / 1024 / 1024, 1),
            },
            'tier2': {
                'description': 'Dynamic loading (US4/US5)',
                'chartCount': len(tier2_charts),
                'totalSizeBytes': tier2_size,
                'totalSizeMB': round(tier2_size / 1024 / 1024, 1),
            },
        },
        'roots': roots,
        'tier1Charts': sorted(tier1_charts),
        'tier2Charts': sorted(tier2_charts),
        'charts': charts,
    }
    
    # Write output
    print(f"\nWriting index to: {output_path}")
    with open(output_path, 'w') as f:
        json.dump(index, f, indent=2)
    
    # Print summary
    print(f"\n{'='*50}")
    print("CHART INDEX SUMMARY")
    print(f"{'='*50}")
    print(f"Total charts: {len(charts)}")
    print(f"Root charts (US1): {len(roots)}")
    print()
    print("By level:")
    for level, count in sorted(level_counts.items()):
        level_name = ['', 'Overview', 'General', 'Coastal', 'Approach', 'Harbor'][min(level, 5)]
        print(f"  US{level} ({level_name}): {count}")
    print()
    print(f"Tier 1 (Memory): {len(tier1_charts)} charts, {tier1_size/1024/1024:.1f} MB")
    print(f"Tier 2 (Dynamic): {len(tier2_charts)} charts, {tier2_size/1024/1024:.1f} MB")
    print()
    print(f"Index file: {output_path}")
    print(f"Index size: {os.path.getsize(output_path) / 1024:.1f} KB")
    
    return index


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python generate_chart_index.py <mbtiles_directory> [output.json]")
        print()
        print("Example:")
        print("  python generate_chart_index.py ./converted_charts chart_index.json")
        sys.exit(1)
    
    mbtiles_dir = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else 'chart_index.json'
    
    if not os.path.isdir(mbtiles_dir):
        print(f"Error: Directory not found: {mbtiles_dir}")
        sys.exit(1)
    
    generate_chart_index(mbtiles_dir, output_path)
