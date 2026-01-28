#!/bin/bash
# Merge all charts of the same scale (US1, US2, etc.) into composite MBTiles
# This solves the tile overlap issue where quilting picks only one chart
#
# The problem: At low zoom levels, tiles cover large areas. Multiple charts
# overlap the same tile, but the quilting logic picks only ONE chart per tile.
# This causes most chart data to be invisible until zooming in far enough that
# tiles become small enough to be exclusively within one chart's bounds.
#
# The solution: Pre-merge charts of the same scale into a single composite file.
# tile-join merges overlapping tiles by combining their vector features.

set -e

CHARTS_DIR="${1:-/Users/jvoss/Documents/XNautical/charts/All_Alaska_ENC_ROOT}"
OUTPUT_DIR="${2:-/Users/jvoss/Documents/XNautical/charts/composite}"
SCALE="${3:-US1}"  # Which scale to merge: US1, US2, US3, US4, US5

mkdir -p "$OUTPUT_DIR"

echo "═══════════════════════════════════════════════════════════"
echo "  CHART COMPOSITOR - Merging ${SCALE}* Charts"
echo "═══════════════════════════════════════════════════════════"
echo "Charts dir: $CHARTS_DIR"
echo "Output dir: $OUTPUT_DIR"
echo "Scale: ${SCALE}"
echo ""

# Find all MBTiles files for this scale
MBTILES_FILES=$(find "$CHARTS_DIR" -name "${SCALE}*.mbtiles" -type f | sort)
COUNT=$(echo "$MBTILES_FILES" | grep -c . || echo 0)

if [ "$COUNT" -eq 0 ]; then
    echo "ERROR: No ${SCALE}*.mbtiles files found in $CHARTS_DIR"
    exit 1
fi

echo "Found $COUNT ${SCALE} MBTiles files:"
echo "$MBTILES_FILES" | while read f; do
    chart=$(basename "$f" .mbtiles)
    size=$(du -h "$f" | cut -f1)
    echo "  $chart ($size)"
done

OUTPUT_FILE="$OUTPUT_DIR/${SCALE}_composite.mbtiles"

echo ""
echo "───────────────────────────────────────────────────────────"
echo "Running tile-join to merge all ${SCALE} charts..."
echo "Output: $OUTPUT_FILE"
echo ""

# tile-join merges MBTiles files - it handles overlapping tiles by combining features
# --no-tile-size-limit prevents dropping features due to tile size
# -f/--force overwrites existing file
tile-join \
    -o "$OUTPUT_FILE" \
    -f \
    --no-tile-size-limit \
    $MBTILES_FILES

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  COMPOSITE CREATED SUCCESSFULLY"
echo "═══════════════════════════════════════════════════════════"
echo "File: $OUTPUT_FILE"
echo "Size: $(du -h "$OUTPUT_FILE" | cut -f1)"

# Show tile counts per zoom
echo ""
echo "Tile counts per zoom level:"
sqlite3 "$OUTPUT_FILE" "SELECT 'z' || zoom_level || ': ' || COUNT(*) || ' tiles' FROM tiles GROUP BY zoom_level ORDER BY zoom_level"

# Compare with individual charts
echo ""
echo "Comparison - z0 tile size:"
echo "  Composite: $(sqlite3 "$OUTPUT_FILE" "SELECT length(tile_data) FROM tiles WHERE zoom_level=0" | awk '{sum+=$1} END {printf "%.0f KB\n", sum/1024}')"

# Calculate sum of individual charts at z0
INDIVIDUAL_SUM=0
for mbtiles in $MBTILES_FILES; do
    size=$(sqlite3 "$mbtiles" "SELECT length(tile_data) FROM tiles WHERE zoom_level=0" 2>/dev/null || echo 0)
    INDIVIDUAL_SUM=$((INDIVIDUAL_SUM + size))
done
echo "  Individual sum: $((INDIVIDUAL_SUM / 1024)) KB (from $COUNT charts)"

echo ""
echo "───────────────────────────────────────────────────────────"
echo "NEXT STEPS:"
echo "1. Copy ${SCALE}_composite.mbtiles to device"
echo "2. Remove individual ${SCALE}*.mbtiles from device"
echo "3. Update chart_index.json to reference the composite"
echo "───────────────────────────────────────────────────────────"

# Generate chart_index entry for the composite
echo ""
echo "Add this to chart_index.json:"
echo ""

# Calculate bounds from all charts
WEST=$(sqlite3 "$OUTPUT_FILE" "SELECT value FROM metadata WHERE name='bounds'" 2>/dev/null | cut -d',' -f1 || echo "-180")
SOUTH=$(sqlite3 "$OUTPUT_FILE" "SELECT value FROM metadata WHERE name='bounds'" 2>/dev/null | cut -d',' -f2 || echo "-90")
EAST=$(sqlite3 "$OUTPUT_FILE" "SELECT value FROM metadata WHERE name='bounds'" 2>/dev/null | cut -d',' -f3 || echo "180")
NORTH=$(sqlite3 "$OUTPUT_FILE" "SELECT value FROM metadata WHERE name='bounds'" 2>/dev/null | cut -d',' -f4 || echo "90")
MINZOOM=$(sqlite3 "$OUTPUT_FILE" "SELECT MIN(zoom_level) FROM tiles")
MAXZOOM=$(sqlite3 "$OUTPUT_FILE" "SELECT MAX(zoom_level) FROM tiles")

cat << EOF
"${SCALE}_composite": {
  "bounds": [$WEST, $SOUTH, $EAST, $NORTH],
  "level": 1,
  "levelName": "Overview",
  "minZoom": $MINZOOM,
  "maxZoom": $MAXZOOM,
  "name": "${SCALE}_composite",
  "format": "pbf"
}
EOF

echo ""
echo "Done!"
