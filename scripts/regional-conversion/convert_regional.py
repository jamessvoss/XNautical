#!/usr/bin/env python3
"""
Regional Chart Conversion Pipeline

Converts S-57 ENC charts into regional MBTiles packs optimized for mobile:
- Overview pack: US1+US2 for all of Alaska (~50MB)
- Regional detail packs: US3-US6 for specific areas (~200-600MB each)

Usage:
    python convert_regional.py /path/to/enc/files /path/to/output

The script will:
1. Scan all .000 files and determine their scale and bounds
2. Convert each chart to GeoJSON with proper zoom-level metadata
3. Group charts by region
4. Run tippecanoe to create optimized MBTiles for each region
"""

import subprocess
import os
import sys
import json
import shutil
import tempfile
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Dict, List, Optional, Tuple
import argparse

from regions import REGIONS, SCALE_ZOOM_RANGES, get_chart_scale, chart_in_region, get_zoom_range

# Feature types that should always be visible (navigation safety)
ALWAYS_VISIBLE_LAYERS = {
    'LIGHTS', 'BOYLAT', 'BOYCAR', 'BOYSAW', 'BOYSPP', 'BOYISD',
    'BCNLAT', 'BCNSPP', 'BCNCAR', 'BCNISD', 'BCNSAW',
    'WRECKS', 'UWTROC', 'OBSTRN', 'RESARE', 'CTNARE', 'MIPARE',
}


def get_chart_bounds(s57_path: Path) -> Optional[List[float]]:
    """Get bounds from S-57 file using ogrinfo"""
    try:
        result = subprocess.run(
            ["ogrinfo", "-so", "-al", str(s57_path)],
            capture_output=True, text=True, timeout=30
        )
        for line in result.stdout.split('\n'):
            if 'Extent:' in line:
                # Parse: Extent: (-134.567, 55.123) - (-133.456, 56.789)
                parts = line.replace('Extent:', '').strip()
                parts = parts.replace('(', '').replace(')', '')
                coords = [float(x.strip()) for x in parts.replace(' - ', ',').split(',')]
                if len(coords) == 4:
                    return [coords[0], coords[1], coords[2], coords[3]]  # west, south, east, north
    except Exception as e:
        print(f"  Warning: Could not get bounds for {s57_path}: {e}")
    return None


def get_s57_layers(s57_path: str) -> List[str]:
    """Get list of layers in an S-57 file."""
    cmd = ["ogrinfo", "-so", "-q", s57_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    layers = []
    for line in result.stdout.split('\n'):
        if ':' in line:
            parts = line.split(':')
            if len(parts) >= 2:
                layer_part = parts[1].strip()
                if '(' in layer_part:
                    layer_name = layer_part.split('(')[0].strip()
                else:
                    layer_name = layer_part.strip()
                
                if layer_name and not layer_name.startswith('DS') and not layer_name.startswith('M_'):
                    layers.append(layer_name)
    
    return layers


def convert_chart_to_geojson(s57_path: Path, output_dir: Path, chart_scale: int) -> Optional[Path]:
    """
    Convert a single S-57 chart to GeoJSON with zoom-level metadata.
    
    Each feature gets tippecanoe properties for zoom-based filtering.
    """
    chart_id = s57_path.stem
    min_zoom, max_zoom = get_zoom_range(chart_scale)
    
    # Get layers
    layers = get_s57_layers(str(s57_path))
    if not layers:
        print(f"  No layers found in {chart_id}")
        return None
    
    all_features = []
    
    for layer in layers:
        layer_output = output_dir / f"{chart_id}_{layer}.geojson"
        
        cmd = [
            "ogr2ogr",
            "-f", "GeoJSON",
            str(layer_output),
            str(s57_path),
            layer,
            "-skipfailures",
            "-lco", "COORDINATE_PRECISION=6",
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if layer_output.exists() and layer_output.stat().st_size > 100:
            try:
                with open(layer_output, 'r') as f:
                    data = json.load(f)
                    features = data.get('features', [])
                    
                    for feature in features:
                        if feature.get('geometry') is not None:
                            # Add metadata
                            feature['properties']['_layer'] = layer
                            feature['properties']['_chartId'] = chart_id
                            feature['properties']['_scale'] = chart_scale
                            
                            # Set zoom range based on layer type
                            if layer in ALWAYS_VISIBLE_LAYERS:
                                # Navigation aids visible at all zooms
                                feature['tippecanoe'] = {
                                    'minzoom': 0,
                                    'maxzoom': 22
                                }
                            else:
                                # Regular features follow scale-based zoom
                                feature['tippecanoe'] = {
                                    'minzoom': min_zoom,
                                    'maxzoom': max_zoom
                                }
                            
                            all_features.append(feature)
                            
            except Exception as e:
                print(f"  Warning: Could not read {layer}: {e}")
            
            # Clean up individual layer file
            layer_output.unlink()
    
    if not all_features:
        return None
    
    # Write combined GeoJSON
    combined_output = output_dir / f"{chart_id}.geojson"
    combined_geojson = {
        "type": "FeatureCollection",
        "features": all_features
    }
    
    with open(combined_output, 'w') as f:
        json.dump(combined_geojson, f)
    
    print(f"  {chart_id}: {len(all_features)} features, z{min_zoom}-{max_zoom}")
    return combined_output


def scan_charts(enc_dir: Path) -> List[Dict]:
    """Scan directory for S-57 charts and collect metadata"""
    charts = []
    
    for s57_file in enc_dir.rglob("*.000"):
        chart_id = s57_file.stem
        
        # Skip non-US charts
        if not chart_id.startswith("US"):
            continue
        
        scale = get_chart_scale(chart_id)
        bounds = get_chart_bounds(s57_file)
        
        if bounds:
            charts.append({
                "id": chart_id,
                "path": s57_file,
                "scale": scale,
                "bounds": bounds,
            })
    
    return charts


def assign_charts_to_regions(charts: List[Dict]) -> Dict[str, List[Dict]]:
    """Assign each chart to appropriate regions"""
    region_charts = {region_id: [] for region_id in REGIONS.keys()}
    
    for chart in charts:
        scale = chart["scale"]
        bounds = chart["bounds"]
        
        for region_id, region in REGIONS.items():
            # Check if this scale belongs in this region
            if scale not in region["scales"]:
                continue
            
            # Check if chart overlaps region bounds
            if chart_in_region(bounds, region["bounds"]):
                region_charts[region_id].append(chart)
    
    return region_charts


def create_regional_mbtiles(
    region_id: str,
    charts: List[Dict],
    temp_dir: Path,
    output_dir: Path
) -> Optional[Path]:
    """Create MBTiles for a region from its charts"""
    
    region = REGIONS[region_id]
    print(f"\n{'='*60}")
    print(f"Creating: {region['name']}")
    print(f"Charts: {len(charts)}")
    print(f"Scales: {region['scales']}")
    print(f"Zoom: z{region['min_zoom']}-{region['max_zoom']}")
    print(f"{'='*60}")
    
    if not charts:
        print(f"  No charts for this region, skipping")
        return None
    
    # Create temp dir for this region's GeoJSON files
    region_temp = temp_dir / region_id
    region_temp.mkdir(parents=True, exist_ok=True)
    
    # Convert each chart to GeoJSON
    geojson_files = []
    for chart in charts:
        geojson_path = convert_chart_to_geojson(
            chart["path"],
            region_temp,
            chart["scale"]
        )
        if geojson_path:
            geojson_files.append(geojson_path)
    
    if not geojson_files:
        print(f"  No GeoJSON files generated, skipping")
        return None
    
    # Run tippecanoe
    output_path = output_dir / f"{region['id']}.mbtiles"
    
    cmd = [
        "tippecanoe",
        "-o", str(output_path),
        "-Z", str(region["min_zoom"]),
        "-z", str(region["max_zoom"]),
        "--force",
        "-l", "charts",  # Single layer name
        "--no-feature-limit",
        "--no-tile-size-limit" if region_id == "overview" else "--maximum-tile-bytes=2500000",
        "--detect-shared-borders",
        "--coalesce-densest-as-needed",
        "--extend-zooms-if-still-dropping",
        "--attribution", "NOAA ENC",
        "--name", region["name"],
        "--description", region["description"],
    ]
    
    # Add all GeoJSON files
    cmd.extend([str(f) for f in geojson_files])
    
    print(f"\n  Running tippecanoe...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        print(f"  Tippecanoe error: {result.stderr}")
        return None
    
    if output_path.exists():
        size_mb = output_path.stat().st_size / 1024 / 1024
        print(f"  Created: {output_path.name} ({size_mb:.1f} MB)")
        return output_path
    
    return None


def create_region_index(output_dir: Path, created_regions: Dict[str, Path]):
    """Create index file describing available regions"""
    
    index = {
        "version": "3.0",
        "format": "regional-packs",
        "description": "Alaska nautical chart packs",
        "regions": {}
    }
    
    for region_id, mbtiles_path in created_regions.items():
        if mbtiles_path and mbtiles_path.exists():
            region = REGIONS[region_id]
            size_bytes = mbtiles_path.stat().st_size
            
            index["regions"][region_id] = {
                "name": region["name"],
                "filename": mbtiles_path.name,
                "description": region["description"],
                "bounds": region["bounds"],
                "minZoom": region["min_zoom"],
                "maxZoom": region["max_zoom"],
                "sizeBytes": size_bytes,
                "sizeMB": round(size_bytes / 1024 / 1024, 1),
                "required": region.get("required", False),
            }
    
    index_path = output_dir / "regions.json"
    with open(index_path, 'w') as f:
        json.dump(index, f, indent=2)
    
    print(f"\nCreated region index: {index_path}")
    return index_path


def main():
    parser = argparse.ArgumentParser(description="Convert S-57 charts to regional MBTiles packs")
    parser.add_argument("enc_dir", help="Directory containing S-57 .000 files")
    parser.add_argument("output_dir", help="Output directory for MBTiles files")
    parser.add_argument("--region", help="Convert only this region (e.g., 'southeast')")
    parser.add_argument("--keep-temp", action="store_true", help="Keep temporary GeoJSON files")
    
    args = parser.parse_args()
    
    enc_dir = Path(args.enc_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print("="*60)
    print("REGIONAL CHART CONVERSION PIPELINE")
    print("="*60)
    print(f"Source: {enc_dir}")
    print(f"Output: {output_dir}")
    
    # Scan for charts
    print("\nScanning for S-57 charts...")
    charts = scan_charts(enc_dir)
    print(f"Found {len(charts)} charts")
    
    # Count by scale
    scale_counts = {}
    for c in charts:
        scale_counts[c["scale"]] = scale_counts.get(c["scale"], 0) + 1
    print(f"By scale: {scale_counts}")
    
    # Assign to regions
    print("\nAssigning charts to regions...")
    region_charts = assign_charts_to_regions(charts)
    
    for region_id, region_chart_list in region_charts.items():
        region = REGIONS[region_id]
        print(f"  {region['name']}: {len(region_chart_list)} charts")
    
    # Create temp directory
    temp_dir = Path(tempfile.mkdtemp(prefix="chart_conversion_"))
    print(f"\nTemp directory: {temp_dir}")
    
    try:
        # Convert each region
        created_regions = {}
        
        regions_to_process = [args.region] if args.region else REGIONS.keys()
        
        for region_id in regions_to_process:
            if region_id not in REGIONS:
                print(f"Unknown region: {region_id}")
                continue
                
            mbtiles_path = create_regional_mbtiles(
                region_id,
                region_charts.get(region_id, []),
                temp_dir,
                output_dir
            )
            created_regions[region_id] = mbtiles_path
        
        # Create index
        create_region_index(output_dir, created_regions)
        
        # Summary
        print("\n" + "="*60)
        print("CONVERSION COMPLETE")
        print("="*60)
        
        total_size = 0
        for region_id, path in created_regions.items():
            if path and path.exists():
                size = path.stat().st_size / 1024 / 1024
                total_size += size
                required = " (required)" if REGIONS[region_id].get("required") else ""
                print(f"  {path.name}: {size:.1f} MB{required}")
        
        print(f"\nTotal: {total_size:.1f} MB")
        
    finally:
        # Cleanup
        if not args.keep_temp:
            print(f"\nCleaning up temp files...")
            shutil.rmtree(temp_dir, ignore_errors=True)
        else:
            print(f"\nTemp files kept at: {temp_dir}")


if __name__ == "__main__":
    main()
