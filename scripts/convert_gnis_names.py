#!/usr/bin/env python3
"""
Convert USGS GNIS (Geographic Names Information System) data to GeoJSON and MBTiles
for use as a place names layer in XNautical.

Input: Pipe-delimited text file from USGS (DomesticNames_XX.txt)
Output: GeoJSON file and MBTiles vector tiles

Usage:
    python convert_gnis_names.py <input_file> [output_dir]
    
Example:
    python convert_gnis_names.py "charts/US Domestic Names/Alaska/DomesticNames_AK.txt"
    
If output_dir is not specified, outputs to the same directory as the input file.
"""

import json
import sys
import os
import subprocess
from pathlib import Path


# Feature class categories for nautical relevance and styling
# These determine symbol priority and default visibility
FEATURE_CATEGORIES = {
    # Water features - highest nautical relevance
    'water': ['Bay', 'Channel', 'Gut', 'Sea', 'Harbor', 'Inlet', 'Sound', 'Strait'],
    
    # Coastal features - high nautical relevance  
    # Includes reefs, rocks, shoals - critical for navigation safety
    'coastal': ['Cape', 'Island', 'Beach', 'Bar', 'Isthmus', 'Pillar', 'Arch',
                'Reef', 'Rock', 'Rocks', 'Shoal', 'Ledge', 'Spit', 'Point'],
    
    # Navigational landmarks - visible from sea
    'landmark': ['Summit', 'Glacier', 'Cliff', 'Range', 'Ridge', 'Falls'],
    
    # Populated places - ports, harbors, towns
    'populated': ['Populated Place'],
    
    # Streams/Rivers - river mouths are important
    'stream': ['Stream', 'Canal', 'Rapids'],
    
    # Lakes - coastal lakes can be landmarks
    'lake': ['Lake', 'Reservoir', 'Swamp'],
    
    # Other terrain features
    'terrain': ['Valley', 'Basin', 'Gap', 'Flat', 'Plain', 'Slope', 'Bench', 'Crater', 'Lava'],
    
    # Administrative (lower priority for nautical)
    'admin': ['Census', 'Civil', 'Military', 'Area', 'Crossing', 'Levee', 'Woods', 'Bend', 'Spring'],
}


def get_feature_category(feature_class: str) -> str:
    """Determine the category for a feature class."""
    for category, classes in FEATURE_CATEGORIES.items():
        if feature_class in classes:
            return category
    return 'other'


def get_label_priority(feature_class: str, category: str) -> int:
    """
    Determine label priority for rendering (lower = higher priority).
    This affects which labels are shown at different zoom levels.
    
    Priority is based on both category AND feature class to ensure
    major features like "Cook Inlet" show before minor ones like "Barge Slough".
    """
    # Class-specific priorities within water category
    # Major water bodies should always show
    water_class_priority = {
        'Sea': 1,
        'Bay': 1,
        'Inlet': 1,
        'Sound': 1,
        'Strait': 1,
        'Harbor': 2,
        'Channel': 3,
        'Gut': 4,  # Sloughs, guts are minor
    }
    
    # Class-specific priorities within coastal category
    coastal_class_priority = {
        'Cape': 1,
        'Island': 2,
        'Point': 2,
        'Reef': 3,
        'Rock': 3,
        'Rocks': 3,
        'Shoal': 3,
        'Beach': 4,
        'Bar': 4,
        'Spit': 4,
    }
    
    # Base priorities by category (used as fallback)
    base_priorities = {
        'water': 5,      # Default for unclassified water
        'coastal': 6,    # Default for unclassified coastal
        'populated': 7,  # Towns and ports
        'landmark': 8,   # Navigational landmarks
        'stream': 9,     # River mouths
        'lake': 10,      # Lakes
        'terrain': 11,   # Terrain features
        'admin': 12,     # Administrative areas
        'other': 13,
    }
    
    # Check for class-specific priority first
    if category == 'water' and feature_class in water_class_priority:
        return water_class_priority[feature_class]
    if category == 'coastal' and feature_class in coastal_class_priority:
        return coastal_class_priority[feature_class]
    
    return base_priorities.get(category, 13)


def parse_gnis_file(filepath: str) -> list:
    """
    Parse a USGS GNIS pipe-delimited text file.
    Returns a list of feature dictionaries.
    """
    features = []
    
    # Use utf-8-sig to handle BOM (Byte Order Mark) at start of file
    with open(filepath, 'r', encoding='utf-8-sig', errors='replace') as f:
        # Read header
        header_line = f.readline().strip()
        headers = header_line.split('|')
        
        # Map column names to indices
        col_map = {name: idx for idx, name in enumerate(headers)}
        
        # Required columns
        required = ['feature_id', 'feature_name', 'feature_class', 'prim_lat_dec', 'prim_long_dec']
        for col in required:
            if col not in col_map:
                raise ValueError(f"Missing required column: {col}")
        
        line_num = 1
        for line in f:
            line_num += 1
            line = line.strip()
            if not line:
                continue
                
            fields = line.split('|')
            
            try:
                feature_id = fields[col_map['feature_id']]
                feature_name = fields[col_map['feature_name']]
                feature_class = fields[col_map['feature_class']]
                lat = fields[col_map['prim_lat_dec']]
                lon = fields[col_map['prim_long_dec']]
                
                # Skip if missing coordinates
                if not lat or not lon:
                    continue
                    
                lat = float(lat)
                lon = float(lon)
                
                # Skip invalid coordinates
                if lat == 0.0 and lon == 0.0:
                    continue
                if lat < -90 or lat > 90 or lon < -180 or lon > 180:
                    continue
                
                # Get optional fields
                county = fields[col_map.get('county_name', -1)] if 'county_name' in col_map and col_map['county_name'] < len(fields) else ''
                map_name = fields[col_map.get('map_name', -1)] if 'map_name' in col_map and col_map['map_name'] < len(fields) else ''
                
                category = get_feature_category(feature_class)
                priority = get_label_priority(feature_class, category)
                
                features.append({
                    'id': feature_id,
                    'name': feature_name,
                    'class': feature_class,
                    'category': category,
                    'priority': priority,
                    'lat': lat,
                    'lon': lon,
                    'county': county,
                    'map': map_name,
                })
                
            except (ValueError, IndexError) as e:
                # Skip malformed lines
                print(f"Warning: Skipping line {line_num}: {e}", file=sys.stderr)
                continue
    
    return features


def create_geojson(features: list) -> dict:
    """Convert parsed features to GeoJSON FeatureCollection."""
    geojson = {
        'type': 'FeatureCollection',
        'features': []
    }
    
    for f in features:
        feature = {
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [f['lon'], f['lat']]
            },
            'properties': {
                'FEATURE_ID': f['id'],
                'NAME': f['name'],
                'CLASS': f['class'],
                'CATEGORY': f['category'],
                'PRIORITY': f['priority'],
                'COUNTY': f['county'],
                'MAP': f['map'],
            }
        }
        geojson['features'].append(feature)
    
    return geojson


def convert_to_mbtiles(geojson_path: str, mbtiles_path: str, name: str = 'gnis_names'):
    """
    Convert GeoJSON to MBTiles using tippecanoe.
    
    Tippecanoe settings optimized for place names:
    - z6-z14: Show names from overview to harbor detail
    - Keep ALL features at ALL zoom levels (no dropping)
    """
    cmd = [
        'tippecanoe',
        '-o', mbtiles_path,
        '--name', name,
        '--layer', 'gnis_names',
        '--minimum-zoom', '6',
        '--maximum-zoom', '14',
        # CRITICAL: Keep ALL features at ALL zoom levels
        '--no-feature-limit',
        '--no-tile-size-limit', 
        # Prevent ANY dropping of features
        '-r', '1',  # Drop rate = 1 means keep everything
        # Base zoom determines when features first appear
        # Setting to 6 means all features appear at z6
        '-B', '6',
        # Sort by priority for rendering order
        '--order-by', 'PRIORITY',
        # CRITICAL: Maximum buffer for text labels extending beyond tile boundaries
        # Default is only 5 units - 127 is the max tippecanoe allows
        # This helps but may not fully solve cross-tile label clipping
        '--buffer', '127',
        # Force overwrite
        '--force',
        geojson_path
    ]
    
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"Error running tippecanoe: {result.stderr}", file=sys.stderr)
        raise RuntimeError("tippecanoe failed")
    
    print(result.stdout)
    return True


def main():
    if len(sys.argv) < 2:
        print("Usage: python convert_gnis_names.py <input_file> [output_dir]")
        print("Example: python convert_gnis_names.py 'charts/US Domestic Names/Alaska/DomesticNames_AK.txt'")
        print("\nIf output_dir is not specified, outputs to the same directory as input file.")
        sys.exit(1)
    
    input_file = sys.argv[1]
    # Default output_dir to the same directory as the input file
    output_dir = sys.argv[2] if len(sys.argv) >= 3 else str(Path(input_file).parent)
    
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    # Derive output filenames from input
    input_path = Path(input_file)
    state_name = input_path.stem.replace('DomesticNames_', '').lower()
    
    geojson_path = os.path.join(output_dir, f'gnis_names_{state_name}.geojson')
    mbtiles_path = os.path.join(output_dir, f'gnis_names_{state_name}.mbtiles')
    
    print(f"Input: {input_file}")
    print(f"Output GeoJSON: {geojson_path}")
    print(f"Output MBTiles: {mbtiles_path}")
    print()
    
    # Parse GNIS file
    print("Parsing GNIS file...")
    features = parse_gnis_file(input_file)
    print(f"Parsed {len(features)} features")
    
    # Count by category
    category_counts = {}
    for f in features:
        cat = f['category']
        category_counts[cat] = category_counts.get(cat, 0) + 1
    
    print("\nFeatures by category:")
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")
    
    # Create GeoJSON
    print("\nCreating GeoJSON...")
    geojson = create_geojson(features)
    
    with open(geojson_path, 'w', encoding='utf-8') as f:
        json.dump(geojson, f)
    
    file_size_mb = os.path.getsize(geojson_path) / (1024 * 1024)
    print(f"Wrote {geojson_path} ({file_size_mb:.2f} MB)")
    
    # Convert to MBTiles
    print("\nConverting to MBTiles...")
    try:
        convert_to_mbtiles(geojson_path, mbtiles_path, f'gnis_{state_name}')
        mbtiles_size_mb = os.path.getsize(mbtiles_path) / (1024 * 1024)
        print(f"Wrote {mbtiles_path} ({mbtiles_size_mb:.2f} MB)")
    except Exception as e:
        print(f"Warning: MBTiles conversion failed: {e}")
        print("GeoJSON file was created successfully. You can convert manually with tippecanoe.")
    
    print("\nDone!")


if __name__ == '__main__':
    main()
