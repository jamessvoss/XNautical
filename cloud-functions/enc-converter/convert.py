#!/usr/bin/env python3
"""
Convert a single S-57 ENC file to MBTiles vector tiles.

Uses:
- GDAL ogr2ogr to convert S-57 to GeoJSON
- Mapbox tippecanoe to convert GeoJSON to MBTiles
"""

import subprocess
import os
import sys
import json
import shutil
import math
from pathlib import Path


def generate_arc_geometry(center_lon: float, center_lat: float, 
                          start_bearing: float, end_bearing: float,
                          radius_nm: float = 0.15, num_points: int = 32) -> dict:
    """
    Generate a LineString arc geometry for a light sector.
    
    S-57 SECTR1 and SECTR2 define the sector where the light IS VISIBLE.
    Bearings are "true bearings of the sector limits as seen FROM SEAWARD towards the light".
    
    Per S-57 specification (IHO S-57 Edition 3.1):
    - SECTR1: First limiting bearing of the sector (clockwise from north)
    - SECTR2: Second limiting bearing of the sector (clockwise from north)
    - The visible sector spans CLOCKWISE from SECTR1 to SECTR2
    
    The arc on the chart shows where the light shines FROM the light outward.
    Since SECTR1/SECTR2 are "bearings towards the light", we add 180° to get
    the direction the light shines (from the light towards the mariner).
    
    Example: SECTR1=119°, SECTR2=24° (Homer Spit)
    - Mariners at bearings 119° to 24° (clockwise, 265° span) can see the light
    - Light shines towards bearings 299° to 204° (after +180° conversion)
    - Arc on chart extends from light towards these directions
    
    Args:
        center_lon, center_lat: Light position
        start_bearing, end_bearing: Sector bearings in degrees (SECTR1 and SECTR2)
        radius_nm: Arc radius in nautical miles (default 0.15 nm for chart display)
        num_points: Number of points to approximate the arc
    
    Returns:
        GeoJSON LineString geometry
    """
    # Convert nautical miles to degrees (approximate)
    # 1 nautical mile = 1/60 degree of latitude
    radius_deg = radius_nm / 60.0
    
    # Adjust for longitude at this latitude
    lat_rad = math.radians(center_lat)
    lon_scale = math.cos(lat_rad)
    
    # Convert "bearing towards light" to "bearing from light" by adding 180°
    # This gives us the direction the light shines
    start = (start_bearing + 180) % 360
    end = (end_bearing + 180) % 360
    
    # S-57 specifies the sector spans CLOCKWISE from SECTR1 to SECTR2
    # After 180° conversion, we still go clockwise from start to end
    arc_span = (end - start) % 360
    
    # Handle edge case: if computed span is 0 but bearings differ, it's a full 360° arc
    if arc_span == 0 and start_bearing != end_bearing:
        arc_span = 360
    
    # Skip generating very small arcs (< 1°) - likely data errors
    if arc_span < 1:
        arc_span = 1
    
    # Adjust number of points based on arc span for smooth rendering
    # More points for larger arcs, minimum 8 for small arcs
    points_for_arc = max(8, int(num_points * arc_span / 90))
    
    # Generate arc points going CLOCKWISE from start to end
    coords = []
    
    for i in range(points_for_arc + 1):
        fraction = i / points_for_arc
        bearing = start + (arc_span * fraction)
        bearing_rad = math.radians(bearing)
        
        # Calculate point position
        # Bearing is clockwise from north, so:
        # x offset = sin(bearing), y offset = cos(bearing)
        dx = radius_deg * math.sin(bearing_rad) / lon_scale
        dy = radius_deg * math.cos(bearing_rad)
        
        coords.append([center_lon + dx, center_lat + dy])
    
    # Debug output for verification
    print(f"  Arc: SECTR1={start_bearing}° → SECTR2={end_bearing}° | "
          f"Direction: {start:.0f}° → {end:.0f}° (span={arc_span:.0f}°) | "
          f"{len(coords)} points")
    
    return {
        'type': 'LineString',
        'coordinates': coords
    }


def get_s57_layers(s57_path: str) -> list:
    """Get list of layers in an S-57 file."""
    cmd = ["ogrinfo", "-so", "-q", s57_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    layers = []
    for line in result.stdout.split('\n'):
        # Lines look like: "1: DEPARE (Polygon)" or "1: DEPARE" (without geometry type)
        if ':' in line:
            # Extract layer name - handle both formats
            parts = line.split(':')
            if len(parts) >= 2:
                layer_part = parts[1].strip()
                # Remove geometry type if present (e.g., "(Polygon)")
                if '(' in layer_part:
                    layer_name = layer_part.split('(')[0].strip()
                else:
                    layer_name = layer_part.strip()
                
                if layer_name and not layer_name.startswith('DS'):  # Skip DS* metadata layers
                    # Skip M_* meta layers (coverage, quality, accuracy metadata - not for display)
                    if layer_name.startswith('M_'):
                        continue
                    layers.append(layer_name)
    
    return layers


def convert_s57_to_geojson(s57_path: str, output_dir: str) -> str:
    """Convert S-57 file to GeoJSON using GDAL, extracting all geometry layers."""
    
    s57_path = Path(s57_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Extract chart_id from filename (e.g., US4AK4PH.000 -> US4AK4PH)
    chart_id = s57_path.stem
    
    # Get all layers in the S-57 file
    layers = get_s57_layers(str(s57_path))
    print(f"Found {len(layers)} layers in {s57_path.name}: {', '.join(layers[:10])}{'...' if len(layers) > 10 else ''}")
    
    if not layers:
        raise Exception("No geometry layers found in S-57 file")
    
    # Convert each layer to GeoJSON and merge
    all_features = []
    
    # Navigation aids that should be visible at all zoom levels
    NAVIGATION_AIDS = {
        'LIGHTS', 'BOYLAT', 'BOYCAR', 'BOYSAW', 'BOYSPP', 'BOYISD',
        'BCNLAT', 'BCNSPP', 'BCNCAR', 'BCNISD', 'BCNSAW',
        'WRECKS', 'UWTROC', 'OBSTRN',  # Hazards also important
    }
    
    # Safety areas that should be visible at all zoom levels for route planning
    SAFETY_AREAS = {
        'RESARE',  # Restricted areas (no-go zones, nature reserves)
        'CTNARE',  # Caution areas
        'MIPARE',  # Military practice areas
        'ACHARE',  # Anchorage areas
        'ACHBRT',  # Anchor berths
        'MARCUL',  # Marine farms/aquaculture
    }
    
    for layer in layers:
        layer_output = output_dir / f"{layer}.geojson"
        
        cmd = [
            "ogr2ogr",
            "-f", "GeoJSON",
            str(layer_output),
            str(s57_path),
            layer,  # Specify the layer to extract
            "-skipfailures",
            "-lco", "COORDINATE_PRECISION=6",
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if layer_output.exists() and layer_output.stat().st_size > 100:
            try:
                with open(layer_output, 'r') as f:
                    data = json.load(f)
                    features = data.get('features', [])
                    # Add layer name to each feature
                    for feature in features:
                        if feature.get('geometry') is not None:
                            feature['properties']['_layer'] = layer
                            feature['properties']['_chartId'] = chart_id  # Track source chart for compositing
                            # Force navigation aids and safety areas to appear at all zoom levels
                            if layer in NAVIGATION_AIDS or layer in SAFETY_AREAS:
                                feature['tippecanoe'] = {'minzoom': 0, 'maxzoom': 17}
                            
                            # For LIGHTS, calculate orientation and generate sector arcs
                            if layer == 'LIGHTS':
                                props = feature['properties']
                                sectr1 = props.get('SECTR1')
                                sectr2 = props.get('SECTR2')
                                orient = props.get('ORIENT')  # S-57 ORIENT attribute
                                
                                # Calculate symbol orientation for the light
                                # S-52: Light flare symbol points toward where the light is visible from
                                if sectr1 is not None and sectr2 is not None:
                                    # For sector lights: calculate midpoint of visible sector
                                    # SECTR1/SECTR2 are bearings "toward the light" from seaward
                                    # Symbol should point toward the center of the visible sector
                                    s1 = float(sectr1)
                                    s2 = float(sectr2)
                                    # Calculate clockwise span from SECTR1 to SECTR2
                                    span = (s2 - s1) % 360
                                    # Midpoint bearing (toward the light from seaward)
                                    mid_bearing = (s1 + span / 2) % 360
                                    # Convert to direction FROM the light (add 180°)
                                    light_orient = (mid_bearing + 180) % 360
                                    props['_ORIENT'] = light_orient
                                elif orient is not None:
                                    # Use explicit ORIENT attribute if present
                                    props['_ORIENT'] = float(orient)
                                else:
                                    # No orientation data - use S-52 convention of ~135° (SE)
                                    # This matches NOAA's display standard for non-sector lights
                                    props['_ORIENT'] = 135
                                
                                if sectr1 is not None and sectr2 is not None:
                                    # This light has sector information - generate arc
                                    geom = feature['geometry']
                                    if geom['type'] == 'Point':
                                        coords = geom['coordinates']
                                        
                                        # Get color for the sector
                                        # S-57 COLOUR can be: list [3], string "[3]", int 3, etc.
                                        colour = props.get('COLOUR', [])
                                        if isinstance(colour, list) and len(colour) > 0:
                                            colour_code = str(colour[0])  # Ensure string
                                        elif isinstance(colour, str):
                                            # Handle string like "[3]" or "3"
                                            colour_code = colour.strip('[]').strip()
                                            if not colour_code:
                                                colour_code = '1'
                                        elif colour is not None:
                                            colour_code = str(colour)
                                        else:
                                            colour_code = '1'  # Default white
                                        
                                        print(f"    Sector light: SECTR1={sectr1}, SECTR2={sectr2}, "
                                              f"COLOUR={colour} → {colour_code}, ORIENT={props.get('_ORIENT'):.1f}°")
                                        
                                        # Create sector arc feature
                                        # Radius needs to be large enough to be visible at low zooms
                                        # 0.15nm (~280m) is visible at z10, reasonable at z15
                                        arc_geom = generate_arc_geometry(
                                            coords[0], coords[1],
                                            float(sectr1), float(sectr2),
                                            radius_nm=0.15  # 0.15 nautical miles (~280m)
                                        )
                                        
                                        sector_feature = {
                                            'type': 'Feature',
                                            'geometry': arc_geom,
                                            'properties': {
                                                '_layer': 'LIGHTS_SECTOR',
                                                'COLOUR': colour_code,
                                                'SECTR1': sectr1,
                                                'SECTR2': sectr2,
                                                'OBJNAM': props.get('OBJNAM'),
                                            },
                                            'tippecanoe': {'minzoom': 0, 'maxzoom': 17}
                                        }
                                        all_features.append(sector_feature)
                                
                                # Still add the light point itself
                                all_features.append(feature)
                            
                            # For soundings, extract depth from Z coordinate
                            elif layer == 'SOUNDG':
                                geom = feature['geometry']
                                coords = geom.get('coordinates', [])
                                props = feature.get('properties', {})
                                # Preserve SCAMIN from original feature for zoom filtering
                                scamin = props.get('SCAMIN')
                                
                                # Soundings are often MultiPoint with [lon, lat, depth]
                                if geom['type'] == 'MultiPoint':
                                    for coord in coords:
                                        if len(coord) >= 3:
                                            point_props = {
                                                '_layer': 'SOUNDG',
                                                'DEPTH': coord[2]
                                            }
                                            # Include SCAMIN if present for zoom-based filtering
                                            if scamin is not None:
                                                point_props['SCAMIN'] = scamin
                                            point_feature = {
                                                'type': 'Feature',
                                                'geometry': {
                                                    'type': 'Point',
                                                    'coordinates': [coord[0], coord[1]]
                                                },
                                                'properties': point_props
                                            }
                                            all_features.append(point_feature)
                                elif geom['type'] == 'Point' and len(coords) >= 3:
                                    feature['properties']['DEPTH'] = coords[2]
                                    feature['geometry']['coordinates'] = [coords[0], coords[1]]
                                    all_features.append(feature)
                                else:
                                    all_features.append(feature)
                            else:
                                all_features.append(feature)
            except Exception as e:
                print(f"  Warning: Could not read {layer}: {e}")
            
            # Clean up individual layer file
            layer_output.unlink()
    
    print(f"Extracted {len(all_features)} features from {len(layers)} layers")
    
    if not all_features:
        raise Exception("No features with geometry extracted from S-57 file")
    
    # Write combined GeoJSON
    combined_output = output_dir / f"{s57_path.stem}.geojson"
    combined_geojson = {
        "type": "FeatureCollection",
        "features": all_features
    }
    
    with open(combined_output, 'w') as f:
        json.dump(combined_geojson, f)
    
    print(f"Created GeoJSON: {combined_output} ({combined_output.stat().st_size / 1024:.1f} KB)")
    return str(combined_output)


def check_geojson_has_features(geojson_path: str) -> bool:
    """Check if GeoJSON file has valid features with geometry."""
    try:
        with open(geojson_path, 'r') as f:
            data = json.load(f)
        
        if 'features' not in data:
            return False
        
        # Check for at least one feature with valid geometry
        for feature in data.get('features', []):
            if feature.get('geometry') is not None:
                return True
        
        return False
    except Exception as e:
        print(f"Error checking GeoJSON: {e}")
        return False


def get_tippecanoe_settings(chart_id: str) -> tuple:
    """
    Get scale-appropriate tippecanoe settings based on chart ID.
    
    Returns: (max_zoom, min_zoom, additional_flags)
    
    Scale bands:
    - US1: Overview charts - z8 max (prevents GB-sized files)
    - US2: General charts - z10 max (prevents GB-sized files)  
    - US3: Coastal charts - z13 max (stop line simplification)
    - US4: Approach charts - z16 max (high precision)
    - US5: Harbor charts - z18 max (maximum detail)
    
    Note: We avoid --simplify-only-low-zooms for all chart types as it
    can cause significant polygon distortion (e.g., caution areas appearing
    way larger than they should be at low zoom levels).
    """
    
    # Detect chart scale from ID prefix
    if chart_id.startswith('US1'):
        # Overview charts: minimize file size, reasonable for overview
        # Use --no-line-simplification to preserve polygon shapes
        return (8, 0, [
            '--drop-densest-as-needed',
            '--no-line-simplification',
            '-r2.5'
        ])
    
    elif chart_id.startswith('US2'):
        # General charts: prevent GB-sized files, optimize for regional view
        # Use --no-line-simplification to preserve polygon shapes
        return (10, 8, [
            '--drop-densest-as-needed',
            '--no-line-simplification',
            '-r1'
        ])
    
    elif chart_id.startswith('US3'):
        # Coastal charts: preserve line accuracy, stop simplification
        return (13, 10, [
            '--no-line-simplification',
            '--maximum-tile-bytes=2500000',
            '-r1'
        ])
    
    elif chart_id.startswith('US4'):
        # Approach charts: high precision for channels
        return (16, 11, [
            '--no-feature-limit',
            '--no-line-simplification',
            '--maximum-tile-bytes=5000000',
            '-r1'
        ])
    
    elif chart_id.startswith('US5'):
        # Harbor charts: maximum detail, no compromises
        return (18, 13, [
            '--no-feature-limit',
            '--no-tile-size-limit',
            '--no-line-simplification',
            '--no-tiny-polygon-reduction',
            '-r1'
        ])
    
    else:
        # Default: assume high-detail chart
        print(f"Warning: Unknown chart scale for {chart_id}, using US5 settings")
        return (18, 13, [
            '--no-feature-limit',
            '--no-tile-size-limit',
            '--no-line-simplification',
            '--no-tiny-polygon-reduction',
            '-r1'
        ])


def check_geojson_has_safety_areas(geojson_path: str) -> bool:
    """Check if GeoJSON contains any safety area features (RESARE, MIPARE, etc.)."""
    SAFETY_AREAS = {'RESARE', 'CTNARE', 'MIPARE', 'ACHARE', 'ACHBRT', 'MARCUL'}
    try:
        with open(geojson_path, 'r') as f:
            data = json.load(f)
        for feature in data.get('features', []):
            layer = feature.get('properties', {}).get('_layer', '')
            if layer in SAFETY_AREAS:
                return True
        return False
    except Exception:
        return False


def convert_geojson_to_mbtiles(geojson_path: str, output_path: str, chart_id: str) -> str:
    """Convert GeoJSON to MBTiles using tippecanoe with scale-appropriate settings."""
    
    # First check if the GeoJSON has valid features
    if not check_geojson_has_features(geojson_path):
        raise Exception(f"GeoJSON has no valid features with geometry - skipping")
    
    # Get scale-appropriate settings
    max_zoom, min_zoom, additional_flags = get_tippecanoe_settings(chart_id)
    
    # If the chart has safety areas (MIPARE, RESARE, etc.), we need to generate tiles
    # at lower zoom levels so these large areas are visible when zoomed out
    has_safety_areas = check_geojson_has_safety_areas(geojson_path)
    if has_safety_areas and min_zoom > 0:
        print(f"  Chart has safety areas - extending min zoom from {min_zoom} to 0")
        min_zoom = 0
    
    print(f"Converting to MBTiles: {chart_id}")
    print(f"  Scale settings: z{min_zoom}-{max_zoom} ({chart_id[:3]} scale)")
    
    # Build tippecanoe command
    # Use common layer name "charts" for all charts to enable server-side compositing
    # Individual chart ID is stored in _chartId property on each feature
    cmd = [
        "tippecanoe",
        "-o", output_path,
        "-z", str(max_zoom),
        "-Z", str(min_zoom),
        "--force",
        "-l", "charts",  # Common layer name for compositing
        "--attribution", "NOAA ENC",
        "--name", chart_id,
        "--description", f"Vector tiles for {chart_id}",
    ]
    
    # Add scale-specific flags
    cmd.extend(additional_flags)
    cmd.append(geojson_path)
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"Tippecanoe error: {result.stderr}")
        raise Exception(f"Tippecanoe failed with code {result.returncode}")
    
    output = Path(output_path)
    if not output.exists():
        raise Exception(f"MBTiles output not created: {output_path}")
    
    print(f"Created MBTiles: {output_path} ({output.stat().st_size / 1024 / 1024:.1f} MB)")
    return output_path


def convert_chart(s57_path: str, output_dir: str = None, temp_dir: str = "/tmp") -> str:
    """Convert a single S-57 chart to MBTiles."""
    
    s57_path = Path(s57_path)
    chart_id = s57_path.stem
    
    # If output_dir not specified, use the source file's parent directory
    if output_dir is None:
        output_dir = s57_path.parent
    
    # Create temp directory for intermediate files
    temp_path = Path(temp_dir) / chart_id
    temp_path.mkdir(parents=True, exist_ok=True)
    
    try:
        # Step 1: Convert S-57 to GeoJSON
        geojson_path = convert_s57_to_geojson(str(s57_path), str(temp_path))
        
        # Step 2: Convert GeoJSON to MBTiles
        output_path = Path(output_dir) / f"{chart_id}.mbtiles"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        mbtiles_path = convert_geojson_to_mbtiles(geojson_path, str(output_path), chart_id)
        
        return mbtiles_path
        
    finally:
        # Cleanup temp files
        if temp_path.exists():
            shutil.rmtree(temp_path)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: convert.py <input.000> [output_dir]")
        print("  If output_dir is not specified, output will be in the same directory as the source file")
        sys.exit(1)
    
    s57_file = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) >= 3 else None
    
    result = convert_chart(s57_file, output_dir)
    print(f"Conversion complete: {result}")
