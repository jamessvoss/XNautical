#!/bin/bash
# Push MBTiles files to the easy-access /sdcard/XNautical/mbtiles location
# Files here can be browsed with any file manager app!

DEVICE_DIR="/sdcard/XNautical/mbtiles"

# Create directory on device
echo "Creating $DEVICE_DIR on device..."
adb shell "mkdir -p $DEVICE_DIR"

# Push manifest if it exists
if [ -f "charts/converted/manifest.json" ]; then
    echo "Pushing manifest.json..."
    adb push charts/converted/manifest.json "$DEVICE_DIR/"
fi

# Push all mbtiles from command line args, or show usage
if [ $# -eq 0 ]; then
    echo ""
    echo "Usage: $0 <file1.mbtiles> [file2.mbtiles] ..."
    echo ""
    echo "Examples:"
    echo "  $0 charts/converted/regional/alaska_overview.mbtiles"
    echo "  $0 charts/converted/regional/*.mbtiles"
    echo "  $0 charts/converted/regional/alaska_*.mbtiles charts/gnis_names_ak.mbtiles"
    echo ""
    echo "Files will be pushed to: $DEVICE_DIR"
    echo "This location is browsable with file manager apps!"
    exit 0
fi

# Push each file
for FILE in "$@"; do
    if [ -f "$FILE" ]; then
        FILENAME=$(basename "$FILE")
        SIZE_MB=$(($(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE") / 1024 / 1024))
        echo ""
        echo "=== Pushing $FILENAME ($SIZE_MB MB) ==="
        adb push "$FILE" "$DEVICE_DIR/"
    else
        echo "WARNING: File not found: $FILE"
    fi
done

echo ""
echo "=== Done! ==="
echo "Files are at: $DEVICE_DIR"
echo "Browse with any file manager app on your phone!"
echo ""
echo "Restart the app to pick up the new files."
