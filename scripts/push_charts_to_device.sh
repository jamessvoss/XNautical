#!/bin/bash
# Push chart packs to Android device for XNautical app
# Usage: ./push_charts_to_device.sh [pack_name]
#        ./push_charts_to_device.sh              # Push manifest + overview + gnis
#        ./push_charts_to_device.sh alaska_full  # Push a specific pack

set -e

REGIONAL_DIR="/Users/jvoss/Documents/XNautical/charts/converted/regional"
# App's internal files dir - where the tile server actually reads from
DEVICE_INTERNAL_DIR="files/mbtiles"
TMP_DIR="/data/local/tmp"

# Check adb connection
if ! adb devices | grep -q "device$"; then
    echo "Error: No Android device connected"
    echo "Run 'adb devices' to check connection"
    exit 1
fi

# Create mbtiles directory on device (internal storage via run-as)
echo "Creating mbtiles directory on device..."
adb shell "run-as com.xnautical.app mkdir -p $DEVICE_INTERNAL_DIR"

push_file() {
    local FILE="$1"
    local FILENAME=$(basename "$FILE")
    local SIZE_MB=$(($(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE") / 1024 / 1024))
    
    echo ""
    echo "=== Pushing $FILENAME ($SIZE_MB MB) ==="
    # Push to temp, then copy to internal storage via run-as
    adb push "$FILE" "$TMP_DIR/$FILENAME"
    adb shell "run-as com.xnautical.app cp $TMP_DIR/$FILENAME $DEVICE_INTERNAL_DIR/"
    adb shell "rm $TMP_DIR/$FILENAME"
    echo "  Done: $FILENAME"
}

# Determine what to push
if [ -n "$1" ]; then
    # Push specific pack
    PACK_FILE="$REGIONAL_DIR/$1.mbtiles"
    if [ ! -f "$PACK_FILE" ]; then
        echo "Error: Pack not found: $1"
        echo "Available packs:"
        ls -1 "$REGIONAL_DIR"/*.mbtiles | xargs -n1 basename | sed 's/.mbtiles//'
        exit 1
    fi
    push_file "$PACK_FILE"
else
    # Push default set: manifest + gnis + overview
    echo "Pushing default chart pack set..."
    
    push_file "$REGIONAL_DIR/manifest.json"
    push_file "$REGIONAL_DIR/gnis_names_ak.mbtiles"
    push_file "$REGIONAL_DIR/alaska_overview.mbtiles"
    
    echo ""
    echo "=== Default set pushed ==="
    echo "To push additional packs:"
    echo "  ./push_charts_to_device.sh alaska_coastal   # 423 MB"
    echo "  ./push_charts_to_device.sh alaska_detail    # 10 GB"
fi

echo ""
echo "=== Verifying files on device ==="
adb shell "run-as com.xnautical.app ls -la $DEVICE_INTERNAL_DIR/"

echo ""
echo "Files pushed to internal storage: /data/user/0/com.xnautical.app/$DEVICE_INTERNAL_DIR/"
echo ""
echo "Done! Restart the app to pick up new files."
