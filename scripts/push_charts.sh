#!/bin/zsh
#
# push_charts.sh - Push nautical chart files to Android device with progress tracking
#

set -e

# Configuration
SOURCE_DIR="/Users/jvoss/Documents/XNautical/charts/flat_mbtiles"
# App's external files directory - readable by app without permissions, writable via adb
DEVICE_DIR="/storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles"
ARCHIVE_DIR="/tmp/xnautical_archives"
TIER1_ONLY=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Parse arguments
for arg in "$@"; do
    case $arg in
        --tier1-only)
            TIER1_ONLY=true
            ;;
    esac
done

TOTAL_FILES=0
TOTAL_SIZE=0
START_TIME=$(date +%s)

format_size() {
    local size=$1
    if [ $size -ge 1073741824 ]; then
        printf "%.1f GB" $(echo "$size / 1073741824" | bc -l)
    elif [ $size -ge 1048576 ]; then
        printf "%.1f MB" $(echo "$size / 1048576" | bc -l)
    else
        printf "%.1f KB" $(echo "$size / 1024" | bc -l)
    fi
}

format_time() {
    local seconds=$1
    if [ $seconds -ge 3600 ]; then
        printf "%dh %dm %ds" $((seconds/3600)) $((seconds%3600/60)) $((seconds%60))
    elif [ $seconds -ge 60 ]; then
        printf "%dm %ds" $((seconds/60)) $((seconds%60))
    else
        printf "%ds" $seconds
    fi
}

echo ""
echo "${BOLD}${BLUE}══════════════════════════════════════════════════════════${NC}"
echo "${BOLD}${BLUE}  XNautical Chart Push Tool${NC}"
echo "${BOLD}${BLUE}══════════════════════════════════════════════════════════${NC}"
echo ""

# Check device
if ! adb devices | grep -q "device$"; then
    echo "${RED}✗ No device connected${NC}"
    exit 1
fi
DEVICE_MODEL=$(adb shell getprop ro.product.model 2>/dev/null | tr -d '\r')
echo "${GREEN}✓${NC} Device: ${BOLD}$DEVICE_MODEL${NC}"

# Define tiers
if [ "$TIER1_ONLY" = true ]; then
    TIERS=("US1" "US2" "US3")
    echo "${CYAN}▶${NC} Mode: ${BOLD}Tier 1 only${NC} (US1/US2/US3)"
else
    TIERS=("US1" "US2" "US3" "US4" "US5" "US6")
    echo "${CYAN}▶${NC} Mode: ${BOLD}All tiers${NC}"
fi

# Scan files
echo ""
echo "${BOLD}Scanning files...${NC}"
for tier in $TIERS; do
    count=$(ls "$SOURCE_DIR"/${tier}*.mbtiles 2>/dev/null | wc -l | tr -d ' ')
    if [ "$count" -gt 0 ]; then
        size=$(stat -f%z "$SOURCE_DIR"/${tier}*.mbtiles 2>/dev/null | awk '{s+=$1} END {print s}')
        TOTAL_FILES=$((TOTAL_FILES + count))
        TOTAL_SIZE=$((TOTAL_SIZE + size))
        printf "  %-4s: %4d files, %s\n" "$tier" "$count" "$(format_size $size)"
    fi
done
echo "  ─────────────────────────"
echo "  ${BOLD}Total: $TOTAL_FILES files, $(format_size $TOTAL_SIZE)${NC}"

# Confirm
echo ""
echo -n "${YELLOW}Proceed? [y/N]${NC} "
read -r REPLY
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Setup
mkdir -p "$ARCHIVE_DIR"
adb shell "mkdir -p '$DEVICE_DIR'" 2>/dev/null

echo ""
echo "${BOLD}Pushing files...${NC}"
echo ""

push_tier() {
    local tier=$1
    local count=$(ls "$SOURCE_DIR"/${tier}*.mbtiles 2>/dev/null | wc -l | tr -d ' ')
    
    if [ "$count" -eq 0 ]; then
        return
    fi
    
    local size=$(stat -f%z "$SOURCE_DIR"/${tier}*.mbtiles 2>/dev/null | awk '{s+=$1} END {print s}')
    local archive="$ARCHIVE_DIR/${tier}_charts.tar.gz"
    local tier_start=$(date +%s)
    
    echo "${CYAN}━━━ $tier: $count files, $(format_size $size) ━━━${NC}"
    
    # Create archive
    echo "  Creating archive..."
    cd "$SOURCE_DIR"
    # Exclude macOS resource fork files (._*)
    tar -czf "$archive" --exclude='._*' ${tier}*.mbtiles 2>/dev/null
    local archive_size=$(stat -f%z "$archive" 2>/dev/null)
    echo "  Archive: $(format_size $archive_size) compressed"
    
    # Push using adb push (shows its own progress)
    echo "  Pushing to device..."
    adb push "$archive" "$DEVICE_DIR/${tier}_charts.tar.gz"
    
    # Extract on device
    echo "  Extracting on device..."
    adb shell "cd '$DEVICE_DIR' && tar -xzf '${tier}_charts.tar.gz' && rm '${tier}_charts.tar.gz'"
    
    # Verify
    local device_files=$(adb shell "ls -1 '$DEVICE_DIR'/${tier}*.mbtiles 2>/dev/null | wc -l" | tr -d '\r ')
    
    local tier_end=$(date +%s)
    local tier_time=$((tier_end - tier_start))
    [ $tier_time -eq 0 ] && tier_time=1
    local speed=$((size / tier_time))
    
    if [ "$device_files" -eq "$count" ]; then
        echo "  ${GREEN}✓ Verified: $device_files files ($(format_time $tier_time), $(format_size $speed)/s)${NC}"
    else
        echo "  ${YELLOW}⚠ Expected $count, found $device_files${NC}"
    fi
    
    rm -f "$archive"
    echo ""
}

# Push each tier
for tier in $TIERS; do
    push_tier "$tier"
done

# Push index
echo "${CYAN}━━━ Chart Index ━━━${NC}"
adb push "$SOURCE_DIR/chart_index.json" "$DEVICE_DIR/chart_index.json"
echo ""

# Summary
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
[ $TOTAL_TIME -eq 0 ] && TOTAL_TIME=1
TOTAL_SPEED=$((TOTAL_SIZE / TOTAL_TIME))

DEVICE_TOTAL=$(adb shell "ls -1 '$DEVICE_DIR'/*.mbtiles 2>/dev/null | wc -l" | tr -d '\r ')

echo "${BOLD}${BLUE}══════════════════════════════════════════════════════════${NC}"
echo "${BOLD}${BLUE}  COMPLETE${NC}"
echo "${BOLD}${BLUE}══════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Files:    ${BOLD}$DEVICE_TOTAL${NC} / $TOTAL_FILES"
echo "  Size:     ${BOLD}$(format_size $TOTAL_SIZE)${NC}"
echo "  Time:     ${BOLD}$(format_time $TOTAL_TIME)${NC}"
echo "  Speed:    ${BOLD}$(format_size $TOTAL_SPEED)/s${NC}"
echo ""
echo "  ${GREEN}${BOLD}Location: $DEVICE_DIR${NC}"
echo ""

rm -rf "$ARCHIVE_DIR"
