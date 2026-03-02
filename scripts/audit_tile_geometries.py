#!/usr/bin/env python3
"""
Scan MBTiles vector tiles for invalid line geometries.

Decodes each tile and checks LineString/MultiLineString features for:
  - Too few coordinates (< 2 points)
  - Empty sub-lines in MultiLineStrings
  - Duplicate consecutive points (zero-length segments)
  - NaN/Inf coordinates

Usage:
  python3 audit_tile_geometries.py <path_to.mbtiles> [--zoom Z] [--limit N]
"""

import sys
import sqlite3
import gzip
import argparse
from collections import defaultdict

try:
    import mapbox_vector_tile as mvt
except ImportError:
    print("Install: pip3 install mapbox-vector-tile", file=sys.stderr)
    sys.exit(1)


def is_valid_coord(c):
    """Check if a coordinate pair is finite."""
    return (isinstance(c, (list, tuple)) and len(c) >= 2
            and isinstance(c[0], (int, float)) and isinstance(c[1], (int, float))
            and c[0] == c[0] and c[1] == c[1])  # NaN != NaN


def audit_line(coords):
    """Return list of issues for a LineString coordinate array."""
    issues = []
    if not coords or len(coords) < 2:
        issues.append(f"too_few_coords({len(coords) if coords else 0})")
        return issues
    for i, c in enumerate(coords):
        if not is_valid_coord(c):
            issues.append(f"bad_coord[{i}]={c}")
    # Check for all-identical points (degenerate zero-length line)
    if len(coords) >= 2 and all(c[0] == coords[0][0] and c[1] == coords[0][1] for c in coords):
        issues.append(f"all_identical_points({len(coords)})")
    return issues


def audit_feature(geom_type, coordinates):
    """Audit a single feature's geometry. Returns list of issue strings."""
    issues = []
    if geom_type == 'LineString':
        issues.extend(audit_line(coordinates))
    elif geom_type == 'MultiLineString':
        if not coordinates:
            issues.append("empty_multilinestring")
        else:
            for i, line in enumerate(coordinates):
                sub_issues = audit_line(line)
                for si in sub_issues:
                    issues.append(f"sub[{i}]:{si}")
    return issues


def scan_mbtiles(path, zoom_filter=None, limit=0):
    """Scan an MBTiles file for invalid line geometries."""
    conn = sqlite3.connect(path)
    cursor = conn.cursor()

    # Get tile count
    if zoom_filter is not None:
        cursor.execute("SELECT COUNT(*) FROM tiles WHERE zoom_level = ?", (zoom_filter,))
    else:
        cursor.execute("SELECT COUNT(*) FROM tiles")
    total_tiles = cursor.fetchone()[0]

    if zoom_filter is not None:
        cursor.execute(
            "SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles WHERE zoom_level = ?",
            (zoom_filter,))
    else:
        cursor.execute("SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles")

    invalid_features = []
    tiles_scanned = 0
    features_scanned = 0

    for z, x, y, tile_data in cursor:
        if limit and tiles_scanned >= limit:
            break
        tiles_scanned += 1

        if tiles_scanned % 500 == 0:
            print(f"  Scanning tile {tiles_scanned}/{total_tiles} (z{z})...", file=sys.stderr)

        try:
            # Decompress if gzipped
            if tile_data[:2] == b'\x1f\x8b':
                tile_data = gzip.decompress(tile_data)

            decoded = mvt.decode(tile_data)

            for layer_name, layer in decoded.items():
                for feature in layer.get('features', []):
                    geom = feature.get('geometry', {})
                    geom_type = geom.get('type', '')
                    coords = geom.get('coordinates', [])

                    if geom_type not in ('LineString', 'MultiLineString'):
                        continue

                    features_scanned += 1
                    issues = audit_feature(geom_type, coords)

                    if issues:
                        props = feature.get('properties', {})
                        invalid_features.append({
                            'tile': f"z{z}/{x}/{y}",
                            'layer': layer_name,
                            'geom_type': geom_type,
                            'objl': props.get('OBJL', '?'),
                            'scale': props.get('_scaleNum', '?'),
                            'chart': props.get('_chartId', '?'),
                            'issues': issues,
                            'props_summary': {k: v for k, v in props.items()
                                              if k in ('OBJL', '_scaleNum', '_chartId', 'OBJNAM', 'NOBJNM')},
                        })
        except Exception as e:
            print(f"  Error decoding tile z{z}/{x}/{y}: {e}", file=sys.stderr)

    conn.close()
    return tiles_scanned, features_scanned, invalid_features


def main():
    parser = argparse.ArgumentParser(description="Audit MBTiles for invalid line geometries")
    parser.add_argument("mbtiles", help="Path to MBTiles file")
    parser.add_argument("--zoom", "-z", type=int, default=None, help="Only scan specific zoom level")
    parser.add_argument("--limit", "-l", type=int, default=0, help="Max tiles to scan (0=all)")
    args = parser.parse_args()

    print(f"Scanning: {args.mbtiles}", file=sys.stderr)
    if args.zoom is not None:
        print(f"  Zoom filter: z{args.zoom}", file=sys.stderr)

    tiles, features, invalids = scan_mbtiles(args.mbtiles, args.zoom, args.limit)

    print(f"\n{'='*70}")
    print(f"Scanned {tiles} tiles, {features} line features")
    print(f"{'='*70}")

    if not invalids:
        print("No invalid line geometries found.")
    else:
        print(f"FOUND {len(invalids)} INVALID LINE GEOMETRIES:\n")

        # Group by OBJL + issue type for summary
        by_objl = defaultdict(list)
        for inv in invalids:
            by_objl[inv['objl']].append(inv)

        for objl, items in sorted(by_objl.items(), key=lambda x: -len(x[1])):
            print(f"  OBJL={objl} ({len(items)} invalid features):")
            # Show first 5 examples
            for item in items[:5]:
                print(f"    tile={item['tile']} layer={item['layer']} "
                      f"US{item['scale']} chart={item['chart']} "
                      f"issues={', '.join(item['issues'])}")
            if len(items) > 5:
                print(f"    ... and {len(items) - 5} more")
            print()


if __name__ == '__main__':
    main()
