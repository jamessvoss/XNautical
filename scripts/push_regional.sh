#!/bin/bash
#
# push_regional.sh - Push regional chart packs to Android device
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="$PROJECT_DIR/charts/converted/regional"
DEVICE_DIR="/storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo "${CYAN}  XNautical Regional Chart Push${NC}"
echo "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Check source directory
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Source directory not found: $SOURCE_DIR"
    exit 1
fi

# Check for device
if ! adb devices | grep -q "device$"; then
    echo "Error: No Android device connected"
    exit 1
fi

# Create destination directory on device
echo "Creating destination directory..."
adb shell "mkdir -p '$DEVICE_DIR'"

# Push each file with progress (excluding deprecated alaska_full)
echo ""
echo "Pushing files to device..."
echo ""

for file in "$SOURCE_DIR"/*; do
    filename=$(basename "$file")
    
    # Skip alaska_full - use tiered packs (overview + coastal + detail) instead
    if [[ "$filename" == "alaska_full.mbtiles" ]]; then
        echo "  ${filename} - ${CYAN}SKIPPED (deprecated, use tiered packs)${NC}"
        continue
    fi
    
    size=$(du -h "$file" | cut -f1)
    echo -n "  ${filename} (${size})... "
    adb push "$file" "$DEVICE_DIR/" > /dev/null 2>&1
    echo "${GREEN}✓${NC}"
done

echo ""
echo "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo "${GREEN}  Done! Restart the app to load charts.${NC}"
echo "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Show what's on device
echo "Files on device:"
adb shell "ls -lh '$DEVICE_DIR/'"
