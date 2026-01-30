#!/usr/bin/env python3
"""
Debug script to examine LIGHTS_SECTOR features in MBTiles files.
Uses tippecanoe-decode to extract and analyze the arc geometry.
"""

import subprocess
import json
import sys
import math

def decode_mbtiles(mbtiles_path):
    """Decode MBTiles and extract LIGHTS_SECTOR features."""
    cmd = ["tippecanoe-decode", mbtiles_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"Error decoding MBTiles: {result.stderr}")
        return None
    
    return result.stdout

def analyze_arc(coords):
    """Analyze an arc's geometry to determine its span and direction."""
    if len(coords) < 2:
        return None
    
    # Calculate center (approximate - should be average of all points at same distance)
    first = coords[0]
    last = coords[-1]
    
    # Get angular span by looking at bearings of first and last points from center
    # First, estimate center from all points
    avg_lon = sum(c[0] for c in coords) / len(coords)
    avg_lat = sum(c[1] for c in coords) / len(coords)
    
    # Calculate bearing from center to first and last points
    def bearing_to_point(center_lon, center_lat, point_lon, point_lat):
        # Approximate bearing calculation
        dx = point_lon - center_lon
        dy = point_lat - center_lat
        # Adjust for latitude
        dx *= math.cos(math.radians(center_lat))
        bearing = math.degrees(math.atan2(dx, dy))
        return (bearing + 360) % 360
    
    # This is rough - we need the actual light position to calculate properly
    # For now, just report the raw coordinates
    
    return {
        'num_points': len(coords),
        'first_point': first,
        'last_point': last,
        'approx_center': [avg_lon, avg_lat],
        'arc_length_deg': math.sqrt(
            (last[0] - first[0])**2 + (last[1] - first[1])**2
        ),
    }

def main():
    if len(sys.argv) < 2:
        print("Usage: debug-lights-sector.py <mbtiles_file>")
        print("\nThis script decodes an MBTiles file and shows all LIGHTS_SECTOR features")
        sys.exit(1)
    
    mbtiles_path = sys.argv[1]
    print(f"Decoding: {mbtiles_path}\n")
    
    decoded = decode_mbtiles(mbtiles_path)
    if not decoded:
        sys.exit(1)
    
    # Parse the decoded output (it's newline-delimited GeoJSON)
    lights_sectors = []
    
    for line in decoded.strip().split('\n'):
        if not line:
            continue
        try:
            feature = json.loads(line)
            props = feature.get('properties', {})
            geom = feature.get('geometry', {})
            # LIGHTS_SECTOR: OBJL=75 (LIGHTS) with LineString geometry (arc)
            # Note: LIGHTS points have Point geometry, sectors have LineString
            if props.get('OBJL') == 75 and geom.get('type') == 'LineString':
                lights_sectors.append(feature)
        except json.JSONDecodeError:
            continue
    
    print(f"Found {len(lights_sectors)} LIGHTS_SECTOR features:\n")
    print("=" * 80)
    
    for i, feature in enumerate(lights_sectors):
        props = feature.get('properties', {})
        geom = feature.get('geometry', {})
        coords = geom.get('coordinates', [])
        
        print(f"\nFeature {i+1}:")
        print(f"  SECTR1: {props.get('SECTR1')}")
        print(f"  SECTR2: {props.get('SECTR2')}")
        print(f"  COLOUR: {props.get('COLOUR')} (type: {type(props.get('COLOUR')).__name__})")
        print(f"  OBJNAM: {props.get('OBJNAM')}")
        print(f"  Geometry type: {geom.get('type')}")
        print(f"  Num coordinates: {len(coords)}")
        
        if coords:
            print(f"  First coord: {coords[0]}")
            print(f"  Last coord: {coords[-1]}")
            
            # Calculate approximate arc span
            if len(coords) >= 2:
                # First and last point distance (chord length)
                dx = coords[-1][0] - coords[0][0]
                dy = coords[-1][1] - coords[0][1]
                chord = math.sqrt(dx*dx + dy*dy)
                print(f"  Chord length (deg): {chord:.6f}")
                
                # Estimate arc length by summing segments
                arc_len = 0
                for j in range(1, len(coords)):
                    sdx = coords[j][0] - coords[j-1][0]
                    sdy = coords[j][1] - coords[j-1][1]
                    arc_len += math.sqrt(sdx*sdx + sdy*sdy)
                print(f"  Arc length (deg): {arc_len:.6f}")
                
                # Calculate expected arc span from SECTR1/SECTR2
                s1 = float(props.get('SECTR1', 0))
                s2 = float(props.get('SECTR2', 0))
                # Current code picks SHORTER arc
                cw = (s2 - s1) % 360
                ccw = (s1 - s2) % 360
                shorter = min(cw, ccw)
                longer = max(cw, ccw)
                print(f"  Clockwise span: {cw}°, Counter-clockwise span: {ccw}°")
                print(f"  Current code uses: SHORTER = {shorter}° ({'CW' if cw <= ccw else 'CCW'})")
                print(f"  S-57 correct: ALWAYS CW = {cw}° (from {s1}° to {s2}°)")
        
        print()
    
    # Also look for LIGHTS points to get center positions
    print("\n" + "=" * 80)
    print("Looking for corresponding LIGHTS points with sectors...")
    
    lights_with_sectors = []
    for line in decoded.strip().split('\n'):
        if not line:
            continue
        try:
            feature = json.loads(line)
            props = feature.get('properties', {})
            geom = feature.get('geometry', {})
            # LIGHTS: OBJL=75 with Point geometry and sector info
            if props.get('OBJL') == 75 and geom.get('type') == 'Point':
                s1 = props.get('SECTR1')
                s2 = props.get('SECTR2')
                if s1 is not None and s2 is not None:
                    lights_with_sectors.append(feature)
        except json.JSONDecodeError:
            continue
    
    print(f"\nFound {len(lights_with_sectors)} LIGHTS with sector info:\n")
    for i, feature in enumerate(lights_with_sectors):
        props = feature.get('properties', {})
        geom = feature.get('geometry', {})
        coords = geom.get('coordinates', [])
        
        print(f"Light {i+1}:")
        print(f"  Position: {coords}")
        print(f"  SECTR1: {props.get('SECTR1')}, SECTR2: {props.get('SECTR2')}")
        print(f"  COLOUR: {props.get('COLOUR')}")
        print(f"  OBJNAM: {props.get('OBJNAM')}")
        print()

if __name__ == "__main__":
    main()
