#!/bin/bash
#
# Push converted charts to Android device
#
# Usage:
#   ./scripts/push-to-device.sh US4AK4PH           # Push single chart
#   ./scripts/push-to-device.sh US4AK4PH US5AK5SI  # Push multiple charts
#   ./scripts/push-to-device.sh --all              # Push all converted charts

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_ROOT="$PROJECT_ROOT/charts/All_Alaska_ENC_ROOT"
APP_PACKAGE="com.xnautical.app"
APP_DATA_DIR="/data/data/${APP_PACKAGE}/files/mbtiles"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "=========================================="
echo "XNautical Chart Pusher"
echo "=========================================="

# Check if device is connected
if ! adb devices | grep -q "device$"; then
    echo -e "${RED}✗ No Android device connected${NC}"
    echo "Connect your device and enable USB debugging"
    exit 1
fi

DEVICE=$(adb devices | grep "device$" | awk '{print $1}')
echo -e "${GREEN}✓ Device connected: $DEVICE${NC}"
echo "Source:  $SOURCE_ROOT"
echo "Target:  $APP_DATA_DIR"
echo "=========================================="
echo ""

# Determine which charts to push
CHARTS=()
if [ "$1" = "--all" ]; then
    # Push all .mbtiles files found in source directories
    while IFS= read -r file; do
        chart_id=$(basename "$file" .mbtiles)
        CHARTS+=("$chart_id")
    done < <(find "$SOURCE_ROOT" -name "*.mbtiles" -type f)
elif [ $# -eq 0 ]; then
    echo -e "${RED}Error: No charts specified${NC}"
    echo ""
    echo "Usage:"
    echo "  $0 US4AK4PH           # Push single chart"
    echo "  $0 US4AK4PH US5AK5SI  # Push multiple charts"
    echo "  $0 --all              # Push all converted charts"
    exit 1
else
    CHARTS=("$@")
fi

if [ ${#CHARTS[@]} -eq 0 ]; then
    echo -e "${YELLOW}No charts found to push.${NC}"
    echo "Convert charts first with: ./scripts/convert-charts.sh"
    exit 0
fi

echo "Charts to push: ${#CHARTS[@]}"
echo ""

SUCCESS=0
FAILED=0
FAILED_CHARTS=()

for chart_id in "${CHARTS[@]}"; do
    FILE="$SOURCE_ROOT/${chart_id}/${chart_id}.mbtiles"
    
    if [ ! -f "$FILE" ]; then
        echo -e "${YELLOW}⊘ $chart_id - file not found, skipping${NC}"
        FAILED_CHARTS+=("$chart_id (file not found)")
        ((FAILED++))
        continue
    fi
    
    SIZE=$(ls -lh "$FILE" | awk '{print $5}')
    echo -e "${BLUE}→ Pushing $chart_id ($SIZE)...${NC}"
    
    # Step 1: Push to Download folder
    echo "  1/4 Copying to device Download folder..."
    if ! adb push "$FILE" /sdcard/Download/${chart_id}.mbtiles 2>&1 | grep -E '(pushed|sec)'; then
        echo -e "${RED}  ✗ Failed to push to device${NC}"
        FAILED_CHARTS+=("$chart_id (adb push failed)")
        ((FAILED++))
        continue
    fi
    
    # Step 2: Move to app data directory
    echo "  2/4 Moving to app data directory..."
    if ! adb shell "cat /sdcard/Download/${chart_id}.mbtiles | run-as $APP_PACKAGE tee $APP_DATA_DIR/${chart_id}.mbtiles > /dev/null" 2>&1; then
        echo -e "${RED}  ✗ Failed to move to app directory${NC}"
        adb shell "rm /sdcard/Download/${chart_id}.mbtiles" 2>/dev/null || true
        FAILED_CHARTS+=("$chart_id (run-as failed - app installed?)")
        ((FAILED++))
        continue
    fi
    
    # Step 3: Clean up Download folder
    echo "  3/4 Cleaning up..."
    adb shell "rm /sdcard/Download/${chart_id}.mbtiles" 2>/dev/null || true
    
    # Step 4: Verify
    echo "  4/4 Verifying..."
    if adb shell "run-as $APP_PACKAGE ls -l $APP_DATA_DIR/${chart_id}.mbtiles" 2>&1 | grep -q "${chart_id}.mbtiles"; then
        echo -e "${GREEN}  ✓ Successfully pushed and verified${NC}"
        ((SUCCESS++))
    else
        echo -e "${RED}  ✗ Failed verification${NC}"
        FAILED_CHARTS+=("$chart_id (verification failed)")
        ((FAILED++))
    fi
    
    echo ""
done

# Summary
echo "=========================================="
echo "Push Summary"
echo "=========================================="
echo -e "${GREEN}Success:  $SUCCESS${NC}"
echo -e "${RED}Failed:   $FAILED${NC}"

if [ ${#FAILED_CHARTS[@]} -gt 0 ]; then
    echo ""
    echo "Failed charts:"
    for chart in "${FAILED_CHARTS[@]}"; do
        echo "  - $chart"
    done
fi

echo ""

if [ $FAILED -eq 0 ] && [ $SUCCESS -gt 0 ]; then
    echo -e "${GREEN}All charts pushed successfully!${NC}"
    echo ""
    echo "Charts are now available in the XNautical app."
    echo "Open the app to view the charts."
    echo ""
fi

# Show what's on the device
if [ $SUCCESS -gt 0 ]; then
    echo "Charts on device:"
    adb shell "run-as $APP_PACKAGE ls -lh $APP_DATA_DIR/" 2>/dev/null | grep ".mbtiles" || echo "  (unable to list - check in app)"
    echo ""
fi
