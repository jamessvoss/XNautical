#!/bin/bash
#
# Regional Chart Conversion Script
#
# Converts all Alaska S-57 charts into optimized regional MBTiles packs.
#
# Usage:
#   ./run_conversion.sh [source_dir] [output_dir]
#
# Example:
#   ./run_conversion.sh ~/Downloads/ENC_ROOT ~/Documents/chart_packs
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="${1:-/Users/jvoss/Documents/XNautical/charts/All_Alaska_ENC_ROOT}"
OUTPUT_DIR="${2:-/Users/jvoss/Documents/XNautical/charts/regional_packs}"

echo "════════════════════════════════════════════════════════════"
echo "       REGIONAL CHART CONVERSION"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Source: $SOURCE_DIR"
echo "Output: $OUTPUT_DIR"
echo ""

# Check dependencies
echo "Checking dependencies..."
command -v ogr2ogr >/dev/null 2>&1 || { echo "ERROR: ogr2ogr not found. Install GDAL."; exit 1; }
command -v tippecanoe >/dev/null 2>&1 || { echo "ERROR: tippecanoe not found."; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found."; exit 1; }
echo "  All dependencies found ✓"
echo ""

# Check source directory
if [ ! -d "$SOURCE_DIR" ]; then
    echo "ERROR: Source directory not found: $SOURCE_DIR"
    exit 1
fi

# Count source files
ENC_COUNT=$(find "$SOURCE_DIR" -name "*.000" | wc -l | tr -d ' ')
echo "Found $ENC_COUNT S-57 chart files"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Run conversion
echo "Starting conversion (this may take 30-60 minutes)..."
echo ""

cd "$SCRIPT_DIR"
python3 convert_regional.py "$SOURCE_DIR" "$OUTPUT_DIR"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "       CONVERSION COMPLETE"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Output files:"
ls -lh "$OUTPUT_DIR"/*.mbtiles 2>/dev/null || echo "  No MBTiles files created"
echo ""
echo "Region index:"
cat "$OUTPUT_DIR/regions.json" 2>/dev/null | head -50 || echo "  No index created"
echo ""
echo "To push to device:"
echo "  adb push $OUTPUT_DIR/*.mbtiles /sdcard/Android/data/com.xnautical.app/files/mbtiles/"
echo "  adb push $OUTPUT_DIR/regions.json /sdcard/Android/data/com.xnautical.app/files/mbtiles/"
