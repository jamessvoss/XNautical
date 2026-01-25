#!/usr/bin/env python3
"""
ENC Feature Extraction Script
=============================

Extracts S-57 features from Electronic Navigational Charts (ENC) and converts
them to GeoJSON format for use in the React Native map application.

This script is designed to be:
- Robust: Handles missing layers, empty data, mixed geometry types
- Consistent: Same output format every time
- Extensible: Easy to add new feature types
- Thorough: Extracts all configured features with validation

Usage:
    # Extract from a single chart
    python extract-enc-features.py /path/to/US4AK4PG_ENC_ROOT
    
    # Extract from all charts in a directory
    python extract-enc-features.py /path/to/Maps --all
    
    # Dry run (show what would be extracted)
    python extract-enc-features.py /path/to/Maps --all --dry-run
    
    # Verbose output
    python extract-enc-features.py /path/to/Maps --all --verbose

Author: XNautical Project
Version: 1.0.0
"""

import argparse
import json
import os
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple


# =============================================================================
# CONFIGURATION
# =============================================================================

@dataclass
class FeatureConfig:
    """Configuration for a feature type extraction."""
    output_suffix: str              # e.g., "_depare.json"
    s57_layers: List[str]           # S-57 layer names to extract
    description: str                # Human-readable description
    merge_layers: bool = False      # If True, merge multiple layers into one file
    post_processor: Optional[str] = None  # Name of post-processing function
    required: bool = False          # If True, warn if missing from chart


# Define all feature types to extract
FEATURE_CONFIGS: Dict[str, FeatureConfig] = {
    # Depth/Bathymetry
    "depare": FeatureConfig(
        output_suffix="_depare.json",
        s57_layers=["DEPARE"],
        description="Depth Areas (polygons with depth ranges)",
        required=True,
    ),
    "depcnt": FeatureConfig(
        output_suffix="_depcnt.json",
        s57_layers=["DEPCNT"],
        description="Depth Contours (lines)",
        required=True,
    ),
    "soundg": FeatureConfig(
        output_suffix="_soundg.json",
        s57_layers=["SOUNDG"],
        description="Soundings (spot depths)",
        post_processor="convert_soundings",
        required=True,
    ),
    
    # Land Features
    "lndare": FeatureConfig(
        output_suffix="_lndare.json",
        s57_layers=["LNDARE"],
        description="Land Areas (polygons)",
        required=True,
    ),
    "coalne": FeatureConfig(
        output_suffix="_coalne.json",
        s57_layers=["COALNE"],
        description="Coastline (lines)",
    ),
    
    # Navigation Aids
    "lights": FeatureConfig(
        output_suffix="_lights.json",
        s57_layers=["LIGHTS"],
        description="Navigation Lights",
    ),
    "buoys": FeatureConfig(
        output_suffix="_buoys.json",
        s57_layers=["BOYLAT", "BOYCAR", "BOYSAW", "BOYISD", "BOYSPP"],
        description="Buoys (lateral, cardinal, safe water, isolated danger, special purpose)",
        merge_layers=True,
    ),
    "beacons": FeatureConfig(
        output_suffix="_beacons.json",
        s57_layers=["BCNLAT", "BCNCAR", "BCNSAW", "BCNISD", "BCNSPP"],
        description="Beacons (lateral, cardinal, safe water, isolated danger, special purpose)",
        merge_layers=True,
    ),
    "landmarks": FeatureConfig(
        output_suffix="_landmarks.json",
        s57_layers=["LNDMRK"],
        description="Landmarks (towers, stacks, etc.)",
    ),
    "daymar": FeatureConfig(
        output_suffix="_daymar.json",
        s57_layers=["DAYMAR"],
        description="Daymarks/Daybeacons",
    ),
    
    # Hazards
    "wrecks": FeatureConfig(
        output_suffix="_wrecks.json",
        s57_layers=["WRECKS"],
        description="Wrecks (dangerous/non-dangerous)",
    ),
    "uwtroc": FeatureConfig(
        output_suffix="_uwtroc.json",
        s57_layers=["UWTROC"],
        description="Underwater Rocks",
    ),
    "obstrn": FeatureConfig(
        output_suffix="_obstrn.json",
        s57_layers=["OBSTRN"],
        description="Obstructions (general underwater hazards)",
    ),
    
    # Infrastructure
    "slcons": FeatureConfig(
        output_suffix="_slcons.json",
        s57_layers=["SLCONS"],
        description="Shoreline Constructions (piers, jetties, etc.)",
    ),
    "cblare": FeatureConfig(
        output_suffix="_cblare.json",
        s57_layers=["CBLARE", "CBLSUB"],
        description="Cable Areas and Submarine Cables",
        merge_layers=True,
    ),
    "pipsol": FeatureConfig(
        output_suffix="_pipsol.json",
        s57_layers=["PIPSOL"],
        description="Pipelines (submarine/overhead)",
    ),
    
    # Seabed/Environment
    "sbdare": FeatureConfig(
        output_suffix="_sbdare.json",
        s57_layers=["SBDARE"],
        description="Seabed Areas (bottom type)",
    ),
    "seaare": FeatureConfig(
        output_suffix="_seaare.json",
        s57_layers=["SEAARE"],
        description="Sea Areas (named water bodies)",
    ),
    
    # Other Navigation
    "pilpnt": FeatureConfig(
        output_suffix="_pilpnt.json",
        s57_layers=["PILPNT"],
        description="Pilot Boarding Points",
    ),
    "anchrg": FeatureConfig(
        output_suffix="_anchrg.json",
        s57_layers=["ACHARE", "ACHBRT"],
        description="Anchorage Areas and Berths",
        merge_layers=True,
    ),
    "fairwy": FeatureConfig(
        output_suffix="_fairwy.json",
        s57_layers=["FAIRWY"],
        description="Fairways/Channels",
    ),
    "drgare": FeatureConfig(
        output_suffix="_drgare.json",
        s57_layers=["DRGARE"],
        description="Dredged Areas",
    ),
    
    # Restricted Areas
    "resare": FeatureConfig(
        output_suffix="_resare.json",
        s57_layers=["RESARE"],
        description="Restricted Areas",
    ),
    
    # Rivers/Water
    "rivers": FeatureConfig(
        output_suffix="_rivers.json",
        s57_layers=["RIVERS"],
        description="Rivers",
    ),
    
    # Land Regions (named areas)
    "lndrgn": FeatureConfig(
        output_suffix="_lndrgn.json",
        s57_layers=["LNDRGN"],
        description="Land Regions (named land areas)",
    ),
}


# =============================================================================
# POST-PROCESSORS
# =============================================================================

def convert_soundings(geojson: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert 3D MultiPoint soundings to 2D Point features with DEPTH property.
    
    S-57 soundings are stored as MultiPoint with 3D coordinates [lon, lat, depth].
    We convert each point to a separate Point feature with depth as a property.
    """
    new_features = []
    
    for feature in geojson.get("features", []):
        geom = feature.get("geometry", {})
        props = feature.get("properties", {})
        
        if geom.get("type") == "MultiPoint":
            coords = geom.get("coordinates", [])
            for i, coord in enumerate(coords):
                if len(coord) >= 3:
                    lon, lat, depth = coord[0], coord[1], coord[2]
                else:
                    lon, lat = coord[0], coord[1]
                    depth = props.get("DEPTH", 0)
                
                new_feature = {
                    "type": "Feature",
                    "properties": {
                        **props,
                        "DEPTH": round(depth, 1),
                        "_sounding_index": i,
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon, lat]
                    }
                }
                new_features.append(new_feature)
        
        elif geom.get("type") == "Point":
            # Already a point, just ensure DEPTH property exists
            coords = geom.get("coordinates", [])
            if len(coords) >= 3:
                props["DEPTH"] = round(coords[2], 1)
                feature["geometry"]["coordinates"] = [coords[0], coords[1]]
            new_features.append(feature)
        
        else:
            # Keep other geometry types as-is
            new_features.append(feature)
    
    return {
        "type": "FeatureCollection",
        "features": new_features
    }


POST_PROCESSORS: Dict[str, Callable] = {
    "convert_soundings": convert_soundings,
}


# =============================================================================
# EXTRACTION FUNCTIONS
# =============================================================================

def find_enc_file(chart_dir: Path) -> Optional[Path]:
    """
    Find the .000 ENC file within a chart directory.
    
    Expected structure: US4AK4PG_ENC_ROOT/US4AK4PG/US4AK4PG.000
    """
    # Try standard structure first
    chart_name = chart_dir.name.replace("_ENC_ROOT", "")
    standard_path = chart_dir / chart_name / f"{chart_name}.000"
    if standard_path.exists():
        return standard_path
    
    # Try EMC_ROOT variant
    chart_name_emc = chart_dir.name.replace("_EMC_ROOT", "")
    emc_path = chart_dir / chart_name_emc / f"{chart_name_emc}.000"
    if emc_path.exists():
        return emc_path
    
    # Search for any .000 file
    for path in chart_dir.rglob("*.000"):
        return path
    
    return None


def get_chart_name(chart_dir: Path) -> str:
    """Extract the chart name from directory path."""
    name = chart_dir.name
    for suffix in ["_ENC_ROOT", "_EMC_ROOT"]:
        name = name.replace(suffix, "")
    return name


def extract_layer(enc_path: Path, layer_name: str) -> Optional[Dict[str, Any]]:
    """
    Extract a single S-57 layer to GeoJSON using ogr2ogr.
    
    Returns None if layer doesn't exist or extraction fails.
    """
    try:
        result = subprocess.run(
            ["ogr2ogr", "-f", "GeoJSON", "/dev/stdout", str(enc_path), layer_name, "-skipfailures"],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        if result.stdout:
            return json.loads(result.stdout)
        return None
        
    except subprocess.TimeoutExpired:
        print(f"    WARNING: Timeout extracting {layer_name}", file=sys.stderr)
        return None
    except json.JSONDecodeError:
        return None
    except Exception as e:
        print(f"    WARNING: Error extracting {layer_name}: {e}", file=sys.stderr)
        return None


def list_available_layers(enc_path: Path) -> List[str]:
    """List all available layers in an ENC file."""
    try:
        result = subprocess.run(
            ["ogrinfo", "-so", str(enc_path)],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        layers = []
        for line in result.stdout.split("\n"):
            # Lines like "1: DEPARE (Polygon)"
            if line.strip() and ":" in line:
                parts = line.split(":")
                if len(parts) >= 2:
                    layer_info = parts[1].strip()
                    layer_name = layer_info.split()[0] if layer_info else ""
                    if layer_name and layer_name.isupper():
                        layers.append(layer_name)
        return layers
        
    except Exception as e:
        print(f"    WARNING: Could not list layers: {e}", file=sys.stderr)
        return []


def create_empty_geojson() -> Dict[str, Any]:
    """Create a valid empty GeoJSON FeatureCollection."""
    return {
        "type": "FeatureCollection",
        "features": []
    }


def merge_geojson(geojsons: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Merge multiple GeoJSON FeatureCollections into one."""
    all_features = []
    for gj in geojsons:
        if gj and "features" in gj:
            all_features.extend(gj["features"])
    
    return {
        "type": "FeatureCollection",
        "features": all_features
    }


def validate_geojson(geojson: Dict[str, Any], feature_name: str) -> Tuple[bool, List[str]]:
    """
    Validate a GeoJSON structure and return (is_valid, warnings).
    """
    warnings = []
    
    if not isinstance(geojson, dict):
        return False, ["Not a valid JSON object"]
    
    if geojson.get("type") != "FeatureCollection":
        warnings.append("Not a FeatureCollection")
    
    features = geojson.get("features", [])
    if not isinstance(features, list):
        return False, ["Features is not a list"]
    
    # Check for mixed geometry types
    geom_types = defaultdict(int)
    null_geoms = 0
    
    for i, feature in enumerate(features):
        if not isinstance(feature, dict):
            warnings.append(f"Feature {i} is not a valid object")
            continue
        
        geom = feature.get("geometry")
        if geom is None:
            null_geoms += 1
        elif isinstance(geom, dict):
            geom_types[geom.get("type", "unknown")] += 1
    
    if null_geoms > 0:
        warnings.append(f"{null_geoms} features with null geometry")
    
    if len(geom_types) > 1:
        types_str = ", ".join(f"{k}:{v}" for k, v in geom_types.items())
        warnings.append(f"Mixed geometry types: {types_str}")
    
    return True, warnings


@dataclass
class ExtractionResult:
    """Result of extracting a single feature type."""
    feature_name: str
    output_path: Path
    feature_count: int
    layers_extracted: List[str]
    layers_missing: List[str]
    warnings: List[str]
    success: bool


@dataclass
class ChartExtractionResult:
    """Result of extracting all features from a chart."""
    chart_name: str
    enc_path: Path
    available_layers: List[str]
    feature_results: List[ExtractionResult]
    total_features: int = 0
    
    def __post_init__(self):
        self.total_features = sum(r.feature_count for r in self.feature_results)


def extract_feature(
    enc_path: Path,
    chart_name: str,
    feature_key: str,
    config: FeatureConfig,
    output_dir: Path,
    verbose: bool = False
) -> ExtractionResult:
    """
    Extract a single feature type from an ENC file.
    """
    output_path = output_dir / f"{chart_name}{config.output_suffix}"
    layers_extracted = []
    layers_missing = []
    warnings = []
    
    # Extract each configured S-57 layer
    geojsons = []
    for layer in config.s57_layers:
        result = extract_layer(enc_path, layer)
        if result and result.get("features"):
            geojsons.append(result)
            layers_extracted.append(f"{layer}({len(result['features'])})")
            if verbose:
                print(f"      {layer}: {len(result['features'])} features")
        else:
            layers_missing.append(layer)
            if verbose:
                print(f"      {layer}: (none)")
    
    # Merge or use single result
    if config.merge_layers or len(geojsons) > 1:
        geojson = merge_geojson(geojsons)
    elif geojsons:
        geojson = geojsons[0]
    else:
        geojson = create_empty_geojson()
    
    # Apply post-processor if configured
    if config.post_processor and config.post_processor in POST_PROCESSORS:
        processor = POST_PROCESSORS[config.post_processor]
        original_count = len(geojson.get("features", []))
        geojson = processor(geojson)
        new_count = len(geojson.get("features", []))
        if original_count != new_count:
            warnings.append(f"Post-processor changed feature count: {original_count} -> {new_count}")
    
    # Validate
    is_valid, validation_warnings = validate_geojson(geojson, feature_key)
    warnings.extend(validation_warnings)
    
    # Warn if required feature is missing
    if config.required and len(geojson.get("features", [])) == 0:
        warnings.append("REQUIRED feature has no data")
    
    # Write output
    with open(output_path, "w") as f:
        json.dump(geojson, f)
    
    return ExtractionResult(
        feature_name=feature_key,
        output_path=output_path,
        feature_count=len(geojson.get("features", [])),
        layers_extracted=layers_extracted,
        layers_missing=layers_missing,
        warnings=warnings,
        success=is_valid
    )


def extract_chart(
    chart_dir: Path,
    output_dir: Optional[Path] = None,
    feature_keys: Optional[List[str]] = None,
    verbose: bool = False,
    dry_run: bool = False
) -> Optional[ChartExtractionResult]:
    """
    Extract all configured features from a chart.
    
    Args:
        chart_dir: Path to chart directory (e.g., US4AK4PG_ENC_ROOT)
        output_dir: Where to write output files (defaults to chart_dir parent)
        feature_keys: Specific features to extract (defaults to all)
        verbose: Print detailed progress
        dry_run: Don't write files, just show what would be done
    
    Returns:
        ChartExtractionResult or None if chart not found
    """
    # Find ENC file
    enc_path = find_enc_file(chart_dir)
    if not enc_path:
        print(f"  ERROR: No ENC file found in {chart_dir}", file=sys.stderr)
        return None
    
    chart_name = get_chart_name(chart_dir)
    
    if output_dir is None:
        output_dir = chart_dir.parent
    
    print(f"\n{'='*60}")
    print(f"Extracting: {chart_name}")
    print(f"ENC File: {enc_path}")
    print(f"Output Dir: {output_dir}")
    print(f"{'='*60}")
    
    # List available layers
    available_layers = list_available_layers(enc_path)
    if verbose:
        print(f"\nAvailable layers ({len(available_layers)}): {', '.join(sorted(available_layers))}")
    
    # Determine which features to extract
    if feature_keys is None:
        feature_keys = list(FEATURE_CONFIGS.keys())
    
    # Extract each feature
    results = []
    for key in feature_keys:
        if key not in FEATURE_CONFIGS:
            print(f"  WARNING: Unknown feature key: {key}", file=sys.stderr)
            continue
        
        config = FEATURE_CONFIGS[key]
        print(f"\n  {key}: {config.description}")
        
        if dry_run:
            print(f"    Would extract: {', '.join(config.s57_layers)}")
            print(f"    Output: {chart_name}{config.output_suffix}")
            continue
        
        result = extract_feature(
            enc_path=enc_path,
            chart_name=chart_name,
            feature_key=key,
            config=config,
            output_dir=output_dir,
            verbose=verbose
        )
        
        # Print summary
        if result.feature_count > 0:
            print(f"    ✓ {result.feature_count} features from {', '.join(result.layers_extracted)}")
        else:
            print(f"    - No data ({', '.join(result.layers_missing)} not found)")
        
        if result.warnings:
            for warn in result.warnings:
                print(f"    ⚠ {warn}")
        
        results.append(result)
    
    if dry_run:
        return None
    
    return ChartExtractionResult(
        chart_name=chart_name,
        enc_path=enc_path,
        available_layers=available_layers,
        feature_results=results
    )


def find_chart_directories(base_dir: Path) -> List[Path]:
    """Find all chart directories in a base directory."""
    charts = []
    
    for item in base_dir.iterdir():
        if item.is_dir() and ("_ENC_ROOT" in item.name or "_EMC_ROOT" in item.name):
            charts.append(item)
    
    # Sort by chart name
    charts.sort(key=lambda p: get_chart_name(p))
    return charts


def generate_manifest(results: List[ChartExtractionResult], output_path: Path):
    """Generate a manifest file summarizing all extractions."""
    manifest = {
        "generated": subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], 
                                     capture_output=True, text=True).stdout.strip(),
        "charts": {}
    }
    
    for result in results:
        chart_data = {
            "enc_file": str(result.enc_path),
            "available_layers": result.available_layers,
            "total_features": result.total_features,
            "features": {}
        }
        
        for fr in result.feature_results:
            chart_data["features"][fr.feature_name] = {
                "count": fr.feature_count,
                "layers": fr.layers_extracted,
                "warnings": fr.warnings if fr.warnings else None
            }
        
        manifest["charts"][result.chart_name] = chart_data
    
    with open(output_path, "w") as f:
        json.dump(manifest, f, indent=2)
    
    print(f"\nManifest written to: {output_path}")


def print_summary(results: List[ChartExtractionResult]):
    """Print a summary of all extractions."""
    print("\n" + "="*60)
    print("EXTRACTION SUMMARY")
    print("="*60)
    
    total_features = 0
    total_warnings = 0
    
    for result in results:
        warnings = sum(len(r.warnings) for r in result.feature_results)
        total_features += result.total_features
        total_warnings += warnings
        
        status = "✓" if warnings == 0 else f"⚠ ({warnings} warnings)"
        print(f"  {result.chart_name}: {result.total_features:,} features {status}")
    
    print(f"\nTotal: {total_features:,} features across {len(results)} charts")
    if total_warnings > 0:
        print(f"Warnings: {total_warnings}")


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Extract S-57 features from ENC charts to GeoJSON",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Extract from a single chart
  %(prog)s /path/to/US4AK4PG_ENC_ROOT
  
  # Extract from all charts in a directory
  %(prog)s /path/to/Maps --all
  
  # Extract only specific features
  %(prog)s /path/to/Maps --all --features depare,depcnt,soundg
  
  # Dry run to see what would be extracted
  %(prog)s /path/to/Maps --all --dry-run
        """
    )
    
    parser.add_argument(
        "path",
        type=Path,
        nargs="?",
        help="Path to chart directory or parent directory containing charts"
    )
    parser.add_argument(
        "--all", "-a",
        action="store_true",
        help="Process all charts in the directory"
    )
    parser.add_argument(
        "--features", "-f",
        type=str,
        help="Comma-separated list of features to extract (default: all)"
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        help="Output directory (default: same as input)"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Print detailed progress"
    )
    parser.add_argument(
        "--dry-run", "-n",
        action="store_true",
        help="Show what would be extracted without writing files"
    )
    parser.add_argument(
        "--manifest", "-m",
        type=Path,
        help="Write extraction manifest to this file"
    )
    parser.add_argument(
        "--list-features",
        action="store_true",
        help="List all available feature types and exit"
    )
    
    args = parser.parse_args()
    
    # List features mode
    if args.list_features:
        print("Available feature types:")
        print("-" * 60)
        for key, config in FEATURE_CONFIGS.items():
            req = " [REQUIRED]" if config.required else ""
            print(f"  {key:12} {config.description}{req}")
            print(f"             Layers: {', '.join(config.s57_layers)}")
        return 0
    
    # Validate path is provided
    if args.path is None:
        print("ERROR: Path is required", file=sys.stderr)
        parser.print_help()
        return 1
    
    # Validate path exists
    if not args.path.exists():
        print(f"ERROR: Path does not exist: {args.path}", file=sys.stderr)
        return 1
    
    # Parse feature list
    feature_keys = None
    if args.features:
        feature_keys = [f.strip() for f in args.features.split(",")]
        unknown = [f for f in feature_keys if f not in FEATURE_CONFIGS]
        if unknown:
            print(f"ERROR: Unknown features: {', '.join(unknown)}", file=sys.stderr)
            print(f"Use --list-features to see available features", file=sys.stderr)
            return 1
    
    # Find charts to process
    if args.all:
        chart_dirs = find_chart_directories(args.path)
        if not chart_dirs:
            print(f"ERROR: No chart directories found in {args.path}", file=sys.stderr)
            return 1
        print(f"Found {len(chart_dirs)} charts to process")
    else:
        chart_dirs = [args.path]
    
    # Process each chart
    results = []
    for chart_dir in chart_dirs:
        result = extract_chart(
            chart_dir=chart_dir,
            output_dir=args.output,
            feature_keys=feature_keys,
            verbose=args.verbose,
            dry_run=args.dry_run
        )
        if result:
            results.append(result)
    
    if not args.dry_run and results:
        # Print summary
        print_summary(results)
        
        # Write manifest if requested
        if args.manifest:
            generate_manifest(results, args.manifest)
        elif args.all:
            # Auto-generate manifest for batch processing
            manifest_path = (args.output or args.path) / "extraction_manifest.json"
            generate_manifest(results, manifest_path)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
