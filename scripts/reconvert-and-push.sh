#!/bin/bash
# Reconvert chart and push to device
# Usage: ./reconvert-and-push.sh /path/to/US4AK4PH.000

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 /path/to/chart.000"
    echo "Example: $0 /path/to/ENC_ROOT/US4AK4PH/US4AK4PH.000"
    exit 1
fi

S57_FILE="$1"
CHART_ID=$(basename "$S57_FILE" .000)
OUTPUT_DIR="/tmp/mbtiles-output"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONVERTER="$SCRIPT_DIR/../cloud-functions/enc-converter/convert.py"

echo "==========================================="
echo "Reconverting $CHART_ID with updated arc generation"
echo "==========================================="

mkdir -p "$OUTPUT_DIR"

# Step 1: Convert S-57 to MBTiles
echo ""
echo "Step 1: Converting S-57 to MBTiles..."
python3 "$CONVERTER" "$S57_FILE" "$OUTPUT_DIR"

MBTILES_FILE="$OUTPUT_DIR/${CHART_ID}.mbtiles"
if [ ! -f "$MBTILES_FILE" ]; then
    echo "Error: MBTiles file not created"
    exit 1
fi

echo ""
echo "Created: $MBTILES_FILE"
ls -lh "$MBTILES_FILE"

# Step 2: Verify LIGHTS_SECTOR features
echo ""
echo "Step 2: Verifying LIGHTS_SECTOR features..."
echo "Decoding MBTiles to check arc data..."
tippecanoe-decode "$MBTILES_FILE" 2>/dev/null | grep -A 5 "LIGHTS_SECTOR" | head -30 || echo "(tippecanoe-decode not found or no LIGHTS_SECTOR features)"

# Step 3: Check if device is connected
echo ""
echo "Step 3: Checking for connected device..."
if ! adb devices | grep -q "device$"; then
    echo "No device connected. Skipping push."
    echo ""
    echo "To manually push the file later:"
    echo "  adb push $MBTILES_FILE /sdcard/Download/${CHART_ID}.mbtiles"
    echo "  adb shell \"cat /sdcard/Download/${CHART_ID}.mbtiles | run-as com.xnautical.app tee /data/data/com.xnautical.app/files/mbtiles/${CHART_ID}.mbtiles > /dev/null\""
    echo "  adb shell \"rm /sdcard/Download/${CHART_ID}.mbtiles\""
    exit 0
fi

# Step 4: Push to device
echo ""
echo "Step 4: Pushing to device..."
adb push "$MBTILES_FILE" /sdcard/Download/${CHART_ID}.mbtiles
adb shell "cat /sdcard/Download/${CHART_ID}.mbtiles | run-as com.xnautical.app tee /data/data/com.xnautical.app/files/mbtiles/${CHART_ID}.mbtiles > /dev/null"
adb shell "rm /sdcard/Download/${CHART_ID}.mbtiles"

# Step 5: Verify on device
echo ""
echo "Step 5: Verifying on device..."
adb shell "run-as com.xnautical.app ls -lh /data/data/com.xnautical.app/files/mbtiles/${CHART_ID}.mbtiles"

echo ""
echo "==========================================="
echo "Done! Now restart the app to load the new tiles."
echo ""
echo "IMPORTANT: You may need to fully uninstall and reinstall the app"
echo "to clear any native tile caches."
echo "==========================================="
