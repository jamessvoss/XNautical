#!/usr/bin/env python3
"""
Test script to verify light sector arc generation.
Run this to verify the arc geometry is correct before reconverting charts.
"""

import math
import json

def generate_arc_geometry(center_lon: float, center_lat: float, 
                          start_bearing: float, end_bearing: float,
                          radius_nm: float = 0.15, num_points: int = 32) -> dict:
    """
    Generate a LineString arc geometry for a light sector.
    (Copied from convert.py for testing)
    """
    radius_deg = radius_nm / 60.0
    lat_rad = math.radians(center_lat)
    lon_scale = math.cos(lat_rad)
    
    # Convert "bearing towards light" to "bearing from light" by adding 180°
    start = (start_bearing + 180) % 360
    end = (end_bearing + 180) % 360
    
    # Clockwise from start to end
    arc_span = (end - start) % 360
    
    if arc_span == 0 and start_bearing != end_bearing:
        arc_span = 360
    if arc_span < 1:
        arc_span = 1
    
    points_for_arc = max(8, int(num_points * arc_span / 90))
    
    coords = []
    for i in range(points_for_arc + 1):
        fraction = i / points_for_arc
        bearing = start + (arc_span * fraction)
        bearing_rad = math.radians(bearing)
        dx = radius_deg * math.sin(bearing_rad) / lon_scale
        dy = radius_deg * math.cos(bearing_rad)
        coords.append([center_lon + dx, center_lat + dy])
    
    return {
        'type': 'LineString',
        'coordinates': coords
    }

def test_arc(name, sectr1, sectr2, colour, center_lon, center_lat):
    """Test arc generation for a specific light."""
    print(f"\n{'='*60}")
    print(f"Test: {name}")
    print(f"{'='*60}")
    
    # Calculate expected values
    orig_cw = (sectr2 - sectr1) % 360  # Original clockwise span
    
    # After 180° conversion
    start = (sectr1 + 180) % 360
    end = (sectr2 + 180) % 360
    arc_span = (end - start) % 360
    
    print(f"Input: SECTR1={sectr1}°, SECTR2={sectr2}°, COLOUR={colour}")
    print(f"Position: {center_lon}, {center_lat}")
    print(f"\nOriginal sector span (CW from {sectr1}° to {sectr2}°): {orig_cw}°")
    print(f"Arc drawn from light: {start}° → {end}° (span={arc_span}°)")
    
    # Generate arc
    arc = generate_arc_geometry(center_lon, center_lat, sectr1, sectr2)
    coords = arc['coordinates']
    
    print(f"\nGenerated {len(coords)} points")
    print(f"First point: [{coords[0][0]:.6f}, {coords[0][1]:.6f}]")
    print(f"Last point:  [{coords[-1][0]:.6f}, {coords[-1][1]:.6f}]")
    
    # Calculate actual bearing of first and last points
    dx_first = coords[0][0] - center_lon
    dy_first = coords[0][1] - center_lat
    # Adjust for latitude
    dx_first *= math.cos(math.radians(center_lat))
    bearing_first = (math.degrees(math.atan2(dx_first, dy_first)) + 360) % 360
    
    dx_last = coords[-1][0] - center_lon
    dy_last = coords[-1][1] - center_lat
    dx_last *= math.cos(math.radians(center_lat))
    bearing_last = (math.degrees(math.atan2(dx_last, dy_last)) + 360) % 360
    
    print(f"\nActual bearing of first point: {bearing_first:.1f}° (expected: {start}°)")
    print(f"Actual bearing of last point:  {bearing_last:.1f}° (expected: {end}°)")
    
    # Verify arc spans the correct angular range
    error_start = abs(bearing_first - start)
    error_end = abs(bearing_last - end)
    if error_start > 180:
        error_start = 360 - error_start
    if error_end > 180:
        error_end = 360 - error_end
    
    if error_start < 1 and error_end < 1:
        print(f"\n✓ PASS: Arc direction is correct")
    else:
        print(f"\n✗ FAIL: Arc direction error (start: {error_start:.1f}°, end: {error_end:.1f}°)")
    
    # Output as GeoJSON for visual verification
    feature = {
        "type": "Feature",
        "properties": {
            "name": name,
            "SECTR1": sectr1,
            "SECTR2": sectr2,
            "COLOUR": colour,
            "arc_span": arc_span
        },
        "geometry": arc
    }
    
    return feature

def main():
    print("Light Sector Arc Generation Test")
    print("=" * 60)
    print("\nTesting arcs from US4AK4PH chart (Homer Spit area)")
    
    # Test cases from the user's data
    # All positions approximate to Homer area
    
    features = []
    
    # Homer Spit light - large visible sector
    features.append(test_arc(
        "Homer Spit (95° original span → 265° visible from seaward)",
        sectr1=119, sectr2=24, colour=3,  # RED
        center_lon=-151.21, center_lat=59.60
    ))
    
    # 104° arc
    features.append(test_arc(
        "104° arc (WHITE)",
        sectr1=98, sectr2=202, colour=1,  # WHITE
        center_lon=-151.22, center_lat=59.61
    ))
    
    # 8° arc (the one that currently shows)
    features.append(test_arc(
        "8° arc (WHITE) - SHOWS CURRENTLY",
        sectr1=80, sectr2=88, colour=1,  # WHITE
        center_lon=-151.23, center_lat=59.62
    ))
    
    # 20° arc (340° original CW span)
    features.append(test_arc(
        "20° arc (GREEN) - original CW span is 340°",
        sectr1=60, sectr2=40, colour=4,  # GREEN
        center_lon=-151.24, center_lat=59.63
    ))
    
    # Save all features as GeoJSON for visual inspection
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }
    
    output_file = "/tmp/test-arcs.geojson"
    with open(output_file, 'w') as f:
        json.dump(geojson, f, indent=2)
    
    print(f"\n{'='*60}")
    print(f"Saved test arcs to: {output_file}")
    print("View with: geojson.io or https://geojson.tools/")
    print("Or: python3 -c \"import json; print(json.load(open('{}')))\"".format(output_file))
    
    print(f"\n{'='*60}")
    print("SUMMARY")
    print("="*60)
    print("""
The arc generation now:
1. Takes SECTR1 and SECTR2 (bearings "towards the light" from seaward)
2. Adds 180° to convert to "bearing FROM the light" (direction it shines)
3. Goes CLOCKWISE from start to end (per S-57 specification)

For SECTR1=119, SECTR2=24 (Homer Spit):
- Original: Visible from 119° to 24° (clockwise = 265° span)
- Arc direction: 299° to 204° (clockwise = 265° span)
- The arc shows WHERE the light shines (towards 299°-204°)

To verify against NOAA ENC Viewer:
1. Go to: https://nauticalcharts.noaa.gov/enconline/enconline.html
2. Navigate to Homer Spit, Alaska
3. Click on the sector light to see its details
4. Compare the arc direction with our generated arcs
""")

if __name__ == "__main__":
    main()
