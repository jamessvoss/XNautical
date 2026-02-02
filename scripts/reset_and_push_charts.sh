#!/bin/bash
#
# Reset and Push Charts Script
# Clears all mbtiles from device and pushes fresh regional packs
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Paths
INTERNAL_PATH="/storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles"
SDCARD_PATH="/sdcard/XNautical/mbtiles"
LOCAL_REGIONAL="/Users/jvoss/Documents/XNautical/charts/converted/regional"
LOCAL_GNIS="/Users/jvoss/Documents/XNautical/charts/US Domestic Names/Alaska/gnis_names_ak.mbtiles"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  XNautical Chart Reset & Push Script  ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Check adb connection
echo -e "${YELLOW}Checking ADB connection...${NC}"
if ! adb devices | grep -q "device$"; then
    echo -e "${RED}ERROR: No device connected via ADB${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Device connected${NC}"
echo ""

# Step 1: Clear internal storage mbtiles
echo -e "${YELLOW}Step 1: Clearing internal storage mbtiles...${NC}"
INTERNAL_FILES=$(adb shell "ls ${INTERNAL_PATH}/*.mbtiles 2>/dev/null" 2>/dev/null || true)
if [ -n "$INTERNAL_FILES" ]; then
    echo "  Found files in internal storage:"
    echo "$INTERNAL_FILES" | sed 's/^/    /'
    adb shell "rm -f ${INTERNAL_PATH}/*.mbtiles" 2>/dev/null || true
    adb shell "rm -f ${INTERNAL_PATH}/manifest.json" 2>/dev/null || true
    echo -e "${GREEN}  ✓ Cleared internal storage${NC}"
else
    echo -e "  No mbtiles found in internal storage"
fi
echo ""

# Step 2: Clear SD card mbtiles
echo -e "${YELLOW}Step 2: Clearing SD card mbtiles...${NC}"
SDCARD_FILES=$(adb shell "ls ${SDCARD_PATH}/*.mbtiles 2>/dev/null" 2>/dev/null || true)
if [ -n "$SDCARD_FILES" ]; then
    echo "  Found files on SD card:"
    echo "$SDCARD_FILES" | sed 's/^/    /'
    adb shell "rm -f ${SDCARD_PATH}/*.mbtiles" 2>/dev/null || true
    adb shell "rm -f ${SDCARD_PATH}/manifest.json" 2>/dev/null || true
    echo -e "${GREEN}  ✓ Cleared SD card${NC}"
else
    echo -e "  No mbtiles found on SD card"
fi
echo ""

# Step 3: Create target directory and push files
echo -e "${YELLOW}Step 3: Creating target directory...${NC}"
adb shell "mkdir -p ${INTERNAL_PATH}"
echo -e "${GREEN}  ✓ Directory ready${NC}"
echo ""

echo -e "${YELLOW}Step 4: Pushing regional packs...${NC}"
echo ""

# Count total files to push
TOTAL_FILES=$(ls -1 ${LOCAL_REGIONAL}/*.mbtiles 2>/dev/null | wc -l | tr -d ' ')
CURRENT=0

# Push each regional pack
for pack in ${LOCAL_REGIONAL}/alaska_US*.mbtiles; do
    if [ -f "$pack" ]; then
        CURRENT=$((CURRENT + 1))
        FILENAME=$(basename "$pack")
        SIZE=$(du -h "$pack" | cut -f1)
        echo -e "  [${CURRENT}/${TOTAL_FILES}] Pushing ${CYAN}${FILENAME}${NC} (${SIZE})..."
        adb push "$pack" "${INTERNAL_PATH}/" > /dev/null
        echo -e "       ${GREEN}✓${NC}"
    fi
done

# Push manifest
if [ -f "${LOCAL_REGIONAL}/manifest.json" ]; then
    echo -e "  Pushing ${CYAN}manifest.json${NC}..."
    adb push "${LOCAL_REGIONAL}/manifest.json" "${INTERNAL_PATH}/" > /dev/null
    echo -e "       ${GREEN}✓${NC}"
fi

# Push GNIS if exists
if [ -f "$LOCAL_GNIS" ]; then
    SIZE=$(du -h "$LOCAL_GNIS" | cut -f1)
    echo -e "  Pushing ${CYAN}gnis_names_ak.mbtiles${NC} (${SIZE})..."
    adb push "$LOCAL_GNIS" "${INTERNAL_PATH}/" > /dev/null
    echo -e "       ${GREEN}✓${NC}"
fi

echo ""

# Step 5: Verify
echo -e "${YELLOW}Step 5: Verifying...${NC}"
echo ""
adb shell "ls -lh ${INTERNAL_PATH}/" 2>/dev/null | while read line; do
    echo "  $line"
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Done! Charts pushed to device.       ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Run ${CYAN}npx expo run:android${NC} to test."
