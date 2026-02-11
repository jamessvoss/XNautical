#!/usr/bin/env python3
"""
Convert a single S-57 ENC file to MBTiles vector tiles.

Uses:
- GDAL Python bindings (osgeo.ogr) to read S-57 layers directly in-process
- Mapbox tippecanoe to convert GeoJSON to MBTiles
"""

import subprocess
import os
import sys
import json
import shutil
import math
from pathlib import Path

from osgeo import ogr, gdal

# Suppress GDAL warnings/errors to stdout (we handle errors ourselves)
gdal.UseExceptions()
gdal.SetConfigOption('CPL_LOG', '/dev/null')


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


def _ogr_feature_to_geojson(feature, layer_name: str) -> dict:
    """Convert an OGR feature to a GeoJSON dict with coordinates rounded to 6 decimals.

    Args:
        feature: ogr.Feature object
        layer_name: S-57 layer name (used for property enrichment upstream)

    Returns:
        GeoJSON feature dict, or None if no geometry
    """
    geom = feature.GetGeometryRef()
    if geom is None:
        return None

    # Export geometry to GeoJSON dict
    geom_json = json.loads(geom.ExportToJson())

    # Round coordinates to 6 decimal places (matching -lco COORDINATE_PRECISION=6)
    def round_coords(obj):
        if isinstance(obj, list):
            if obj and isinstance(obj[0], (int, float)):
                return [round(v, 6) for v in obj]
            return [round_coords(item) for item in obj]
        return obj

    geom_json['coordinates'] = round_coords(geom_json['coordinates'])

    # Build properties from feature fields
    props = {}
    defn = feature.GetDefnRef()
    for i in range(defn.GetFieldCount()):
        field_defn = defn.GetFieldDefn(i)
        name = field_defn.GetName()
        if feature.IsFieldSetAndNotNull(i):
            field_type = field_defn.GetType()
            if field_type == ogr.OFTInteger:
                props[name] = feature.GetFieldAsInteger(i)
            elif field_type == ogr.OFTReal:
                props[name] = feature.GetFieldAsDouble(i)
            elif field_type in (ogr.OFTIntegerList, ogr.OFTRealList, ogr.OFTStringList):
                props[name] = feature.GetFieldAsString(i)
            else:
                props[name] = feature.GetFieldAsString(i)

    return {
        'type': 'Feature',
        'geometry': geom_json,
        'properties': props,
    }


def convert_s57_to_geojson(s57_path: str, output_dir: str):
    """Convert S-57 file to GeoJSON using GDAL Python bindings directly.

    Reads all layers in-process via osgeo.ogr, avoiding per-layer ogr2ogr
    subprocess forks and intermediate file I/O.

    Each feature will include a CHART_ID property with the source chart identifier,
    which helps with debugging and identifying which chart a feature came from.

    Returns:
        (geojson_path, has_safety_areas) tuple
    """

    s57_path = Path(s57_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Extract chart_id from filename (e.g., US4AK4PH.000 -> US4AK4PH)
    chart_id = s57_path.stem
    print(f"Chart ID: {chart_id}")

    # Open the S-57 data source
    ds = ogr.Open(str(s57_path))
    if ds is None:
        raise Exception(f"Could not open S-57 file: {s57_path}")

    # Get all layers, filtering out DS* metadata and M_* meta layers
    layers = []
    for i in range(ds.GetLayerCount()):
        layer = ds.GetLayerByIndex(i)
        name = layer.GetName()
        if not name.startswith('DS') and not name.startswith('M_'):
            layers.append(name)

    print(f"Found {len(layers)} layers in {s57_path.name}: {', '.join(layers[:10])}{'...' if len(layers) > 10 else ''}")

    if not layers:
        ds = None
        raise Exception("No geometry layers found in S-57 file")

    # Convert each layer and merge
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

    # S-57 Object Class codes - layer name to OBJL mapping
    S57_OBJL = {
        'ACHBRT': 3, 'ACHARE': 4,
        'BCNCAR': 5, 'BCNISD': 6, 'BCNLAT': 7, 'BCNSAW': 8, 'BCNSPP': 9,
        'BRIDGE': 11, 'BUISGL': 12,
        'BOYCAR': 14, 'BOYINB': 15, 'BOYISD': 16, 'BOYLAT': 17, 'BOYSAW': 18, 'BOYSPP': 19,
        'CBLARE': 20, 'CBLOHD': 21, 'CBLSUB': 22,
        'CANALS': 23, 'CAUSWY': 26,
        'CTNARE': 27, 'COALNE': 30, 'DAYMAR': 39,
        'DEPARE': 42, 'DEPCNT': 43, 'DRGARE': 46,
        'FAIRWY': 51, 'FOGSIG': 58, 'HULKES': 65, 'LAKARE': 69,
        'LNDARE': 71, 'LNDELV': 72, 'LNDRGN': 73, 'LNDMRK': 74,
        'LIGHTS': 75,
        'MARCUL': 82, 'MIPARE': 83, 'MORFAC': 84,
        'NAVLNE': 85, 'OBSTRN': 86,
        'PILPNT': 90, 'PIPARE': 92, 'PIPSOL': 94, 'PONTON': 95,
        'RECTRC': 109, 'RSCSTA': 111, 'RESARE': 112, 'RIVERS': 114,
        'SEAARE': 119, 'SBDARE': 121, 'SLCONS': 122, 'SOUNDG': 129,
        'TOPMAR': 144, 'TSELNE': 145, 'TSSLPT': 148,
        'UWTROC': 153, 'WATTUR': 156, 'WRECKS': 159,
    }

    has_safety_areas = False

    for layer_name in layers:
        ogr_layer = ds.GetLayerByName(layer_name)
        if ogr_layer is None:
            continue

        ogr_layer.ResetReading()
        ogr_feature = ogr_layer.GetNextFeature()

        while ogr_feature is not None:
            feature = _ogr_feature_to_geojson(ogr_feature, layer_name)
            ogr_feature = ogr_layer.GetNextFeature()

            if feature is None:
                continue

            # Add chart ID for debugging and quilting
            feature['properties']['CHART_ID'] = chart_id
            feature['properties']['_chartId'] = chart_id

            # Set OBJL from layer name (authoritative S-57 object class)
            if layer_name in S57_OBJL:
                feature['properties']['OBJL'] = S57_OBJL[layer_name]

            # Force navigation aids and safety areas to appear at all zoom levels
            if layer_name in NAVIGATION_AIDS or layer_name in SAFETY_AREAS:
                feature['tippecanoe'] = {'minzoom': 0, 'maxzoom': 17}
            if layer_name in SAFETY_AREAS:
                has_safety_areas = True

            # For LIGHTS, calculate orientation and generate sector arcs
            if layer_name == 'LIGHTS':
                props = feature['properties']
                sectr1 = props.get('SECTR1')
                sectr2 = props.get('SECTR2')
                orient = props.get('ORIENT')

                if sectr1 is not None and sectr2 is not None:
                    s1 = float(sectr1)
                    s2 = float(sectr2)
                    span = (s2 - s1) % 360
                    mid_bearing = (s1 + span / 2) % 360
                    light_orient = (mid_bearing + 180) % 360
                    props['_ORIENT'] = light_orient
                elif orient is not None:
                    props['_ORIENT'] = float(orient)
                else:
                    props['_ORIENT'] = 135

                if sectr1 is not None and sectr2 is not None:
                    geom = feature['geometry']
                    if geom['type'] == 'Point':
                        coords = geom['coordinates']

                        colour = props.get('COLOUR', [])
                        if isinstance(colour, list) and len(colour) > 0:
                            colour_code = str(colour[0])
                        elif isinstance(colour, str):
                            colour_code = colour.strip('[]').strip()
                            if not colour_code:
                                colour_code = '1'
                        elif colour is not None:
                            colour_code = str(colour)
                        else:
                            colour_code = '1'

                        print(f"    Sector light: SECTR1={sectr1}, SECTR2={sectr2}, "
                              f"COLOUR={colour} -> {colour_code}, ORIENT={props.get('_ORIENT'):.1f}")

                        arc_geom = generate_arc_geometry(
                            coords[0], coords[1],
                            float(sectr1), float(sectr2),
                            radius_nm=0.15
                        )

                        sector_feature = {
                            'type': 'Feature',
                            'geometry': arc_geom,
                            'properties': {
                                'OBJL': 75,
                                'COLOUR': colour_code,
                                'SECTR1': sectr1,
                                'SECTR2': sectr2,
                                'OBJNAM': props.get('OBJNAM'),
                                'CHART_ID': chart_id,
                                '_chartId': chart_id,
                            },
                            'tippecanoe': {'minzoom': 0, 'maxzoom': 17}
                        }
                        all_features.append(sector_feature)

                all_features.append(feature)

            # For soundings, extract depth from Z coordinate
            elif layer_name == 'SOUNDG':
                geom = feature['geometry']
                coords = geom.get('coordinates', [])
                props = feature.get('properties', {})
                scamin = props.get('SCAMIN')

                if geom['type'] == 'MultiPoint':
                    for coord in coords:
                        if len(coord) >= 3:
                            point_props = {
                                'OBJL': 129,
                                'DEPTH': coord[2],
                                'CHART_ID': chart_id,
                                '_chartId': chart_id,
                            }
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

    # Close the data source
    ds = None
    
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
    return str(combined_output), has_safety_areas


def get_tippecanoe_settings(chart_id: str) -> tuple:
    """
    Get scale-appropriate tippecanoe settings based on chart ID.
    
    Returns: (max_zoom, min_zoom, additional_flags)
    
    Scale bands (with extended min zoom for user-selectable detail levels):
    - US1: Overview charts - z0-8 (full coverage)
    - US2: General charts - z0-10 (full coverage)
    - US3: Coastal charts - z4-13 (extended 4 zooms earlier from z8)
    - US4: Approach charts - z6-16 (extended 4 zooms earlier from z10)
    - US5: Harbor charts - z8-18 (extended 4 zooms earlier from z12)
    - US6: Berthing charts - z10-18 (extended 4 zooms earlier from z14)
    
    The extended min zoom allows the app to offer low/medium/high detail settings
    where users can choose to see detail charts earlier when zoomed out.
    
    Note: We avoid --simplify-only-low-zooms for all chart types as it
    can cause significant polygon distortion (e.g., caution areas appearing
    way larger than they should be at low zoom levels).
    """
    
    # Detect chart scale from ID prefix
    # All charts use:
    #   --no-feature-limit: don't drop features to meet tile count limits
    #   --no-tile-size-limit: allow tiles to be any size (preserves all features)
    #   --no-line-simplification: keep line geometry exact
    #   -r1: drop rate 1 - no density-based feature dropping between zoom levels
    
    if chart_id.startswith('US1'):
        # Overview charts: z0-8
        return (8, 0, [
            '--no-feature-limit',
            '--no-tile-size-limit',
            '--no-line-simplification',
            '-r1'
        ])
    
    elif chart_id.startswith('US2'):
        # General charts: z0-10
        return (10, 0, [
            '--no-feature-limit',
            '--no-tile-size-limit',
            '--no-line-simplification',
            '-r1'
        ])
    
    elif chart_id.startswith('US3'):
        # Coastal charts: z4-13 (extended from z8 for detail level options)
        return (13, 4, [
            '--no-feature-limit',
            '--no-tile-size-limit',
            '--no-line-simplification',
            '-r1'
        ])
    
    elif chart_id.startswith('US4'):
        # Approach charts: z6-16 (extended from z10 for detail level options)
        return (16, 6, [
            '--no-feature-limit',
            '--no-tile-size-limit',
            '--no-line-simplification',
            '-r1'
        ])
    
    elif chart_id.startswith('US5'):
        # Harbor charts: z8-18 (extended from z12 for detail level options)
        return (18, 8, [
            '--no-feature-limit',
            '--no-tile-size-limit',
            '--no-line-simplification',
            '--no-tiny-polygon-reduction',
            '-r1'
        ])
    
    elif chart_id.startswith('US6'):
        # Berthing charts: z6-18 (extended from z14 for early detail visibility)
        # These are the most detailed charts - make them available earlier
        return (18, 6, [
            '--no-feature-limit',
            '--no-tile-size-limit',
            '--no-line-simplification',
            '--no-tiny-polygon-reduction',
            '-r1'
        ])
    
    else:
        # Default: assume high-detail chart (US5 settings)
        print(f"Warning: Unknown chart scale for {chart_id}, using US5 settings")
        return (18, 8, [
            '--no-feature-limit',
            '--no-tile-size-limit',
            '--no-line-simplification',
            '--no-tiny-polygon-reduction',
            '-r1'
        ])


def convert_geojson_to_mbtiles(geojson_path: str, output_path: str, chart_id: str,
                               has_safety_areas: bool = False) -> str:
    """Convert GeoJSON to MBTiles using tippecanoe with scale-appropriate settings."""

    # Get scale-appropriate settings
    max_zoom, min_zoom, additional_flags = get_tippecanoe_settings(chart_id)

    # If the chart has safety areas (MIPARE, RESARE, etc.), we need to generate tiles
    # at lower zoom levels so these large areas are visible when zoomed out
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
        geojson_path, has_safety_areas = convert_s57_to_geojson(str(s57_path), str(temp_path))

        # Step 2: Convert GeoJSON to MBTiles
        output_path = Path(output_dir) / f"{chart_id}.mbtiles"
        output_path.parent.mkdir(parents=True, exist_ok=True)

        mbtiles_path = convert_geojson_to_mbtiles(
            geojson_path, str(output_path), chart_id,
            has_safety_areas=has_safety_areas
        )

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
