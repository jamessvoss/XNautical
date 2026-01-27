#!/bin/zsh
#
# push_charts.sh - Push nautical chart files to Android device with progress tracking
#

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="$PROJECT_DIR/charts/flat_mbtiles"
# App's external files directory - readable by app without permissions, writable via adb
DEVICE_DIR="/storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles"
ARCHIVE_DIR="/tmp/xnautical_archives"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Parse arguments - inclusive tier selection
PUSH_US1=false
PUSH_US2=false
PUSH_US3=false
PUSH_US4=false
PUSH_US5=false
PUSH_US6=false
PUSH_BASEMAP=false
PUSH_GNIS=false
ANY_SELECTED=false

for arg in "$@"; do
    case $arg in
        --US1|--us1)
            PUSH_US1=true
            ANY_SELECTED=true
            ;;
        --US2|--us2)
            PUSH_US2=true
            ANY_SELECTED=true
            ;;
        --US3|--us3)
            PUSH_US3=true
            ANY_SELECTED=true
            ;;
        --US4|--us4)
            PUSH_US4=true
            ANY_SELECTED=true
            ;;
        --US5|--us5)
            PUSH_US5=true
            ANY_SELECTED=true
            ;;
        --US6|--us6)
            PUSH_US6=true
            ANY_SELECTED=true
            ;;
        --basemap|--Basemap|--BASEMAP)
            PUSH_BASEMAP=true
            ANY_SELECTED=true
            ;;
        --gnis|--GNIS)
            PUSH_GNIS=true
            ANY_SELECTED=true
            ;;
        --all)
            PUSH_US1=true
            PUSH_US2=true
            PUSH_US3=true
            PUSH_US4=true
            PUSH_US5=true
            PUSH_US6=true
            PUSH_BASEMAP=true
            PUSH_GNIS=true
            ANY_SELECTED=true
            ;;
        --charts)
            # Just charts, no basemap or gnis
            PUSH_US1=true
            PUSH_US2=true
            PUSH_US3=true
            PUSH_US4=true
            PUSH_US5=true
            PUSH_US6=true
            ANY_SELECTED=true
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Push nautical chart files to Android device."
            echo ""
            echo "Chart Options:"
            echo "  --US1       Push US1 charts (Overview, ~16 files)"
            echo "  --US2       Push US2 charts (General, ~28 files)"
            echo "  --US3       Push US3 charts (Coastal, ~37 files)"
            echo "  --US4       Push US4 charts (Approach, ~768 files)"
            echo "  --US5       Push US5 charts (Harbor, ~366 files)"
            echo "  --US6       Push US6 charts (Berthing, ~1 file)"
            echo ""
            echo "Other Data:"
            echo "  --basemap   Push basemap tiles (requires generate_basemap.sh first)"
            echo "  --gnis      Push GNIS place names"
            echo ""
            echo "Shortcuts:"
            echo "  --charts    Push all chart tiers (US1-US6)"
            echo "  --all       Push everything (charts + basemap + gnis)"
            echo ""
            echo "Examples:"
            echo "  $0 --US1 --US2 --US3      Push overview charts only"
            echo "  $0 --charts               Push all nautical charts"
            echo "  $0 --basemap --gnis       Push basemap and place names"
            echo "  $0 --all                  Push everything"
            exit 0
            ;;
    esac
done

# If nothing selected, show help
if [ "$ANY_SELECTED" = false ]; then
    echo "No options selected. Use --help for usage."
    echo ""
    echo "Quick examples:"
    echo "  $0 --US1 --US2 --US3    # Overview charts (~478MB)"
    echo "  $0 --charts             # All nautical charts (~8.6GB)"
    echo "  $0 --basemap            # Vector basemap"
    echo "  $0 --all                # Everything"
    exit 1
fi

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
# Build tier list from selected options
TIERS=()
PUSH_ITEMS=""
[ "$PUSH_US1" = true ] && TIERS+=("US1") && PUSH_ITEMS="${PUSH_ITEMS}US1 "
[ "$PUSH_US2" = true ] && TIERS+=("US2") && PUSH_ITEMS="${PUSH_ITEMS}US2 "
[ "$PUSH_US3" = true ] && TIERS+=("US3") && PUSH_ITEMS="${PUSH_ITEMS}US3 "
[ "$PUSH_US4" = true ] && TIERS+=("US4") && PUSH_ITEMS="${PUSH_ITEMS}US4 "
[ "$PUSH_US5" = true ] && TIERS+=("US5") && PUSH_ITEMS="${PUSH_ITEMS}US5 "
[ "$PUSH_US6" = true ] && TIERS+=("US6") && PUSH_ITEMS="${PUSH_ITEMS}US6 "
[ "$PUSH_BASEMAP" = true ] && PUSH_ITEMS="${PUSH_ITEMS}Basemap "
[ "$PUSH_GNIS" = true ] && PUSH_ITEMS="${PUSH_ITEMS}GNIS "

echo "${CYAN}▶${NC} Pushing: ${BOLD}${PUSH_ITEMS}${NC}"

# Scan chart files (only if tiers selected)
if [ ${#TIERS[@]} -gt 0 ]; then
    echo ""
    echo "${BOLD}Scanning chart files...${NC}"
    for tier in "${TIERS[@]}"; do
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
fi

# Confirm (skip for basemap/gnis only)
if [ ${#TIERS[@]} -gt 0 ]; then
    echo ""
    echo -n "${YELLOW}Proceed? [y/N]${NC} "
    read -r REPLY
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
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

# Push each tier (if any selected)
if [ ${#TIERS[@]} -gt 0 ]; then
    for tier in "${TIERS[@]}"; do
        push_tier "$tier"
    done
fi

# Push basemap if requested
if [ "$PUSH_BASEMAP" = true ]; then
    BASEMAP_FILE="$PROJECT_DIR/charts/Basemaps/basemap_alaska.mbtiles"
    if [ -f "$BASEMAP_FILE" ]; then
        echo "${CYAN}━━━ Basemap ━━━${NC}"
        BASEMAP_SIZE=$(stat -f%z "$BASEMAP_FILE" 2>/dev/null)
        echo "  File: basemap_alaska.mbtiles ($(format_size $BASEMAP_SIZE))"
        echo "  Pushing to device..."
        adb push "$BASEMAP_FILE" "$DEVICE_DIR/basemap_alaska.mbtiles"
        adb shell "chmod 775 '$DEVICE_DIR/basemap_alaska.mbtiles'" 2>/dev/null || true
        echo "  ${GREEN}✓ Basemap pushed${NC}"
        echo ""
        TOTAL_SIZE=$((TOTAL_SIZE + BASEMAP_SIZE))
    else
        echo "${YELLOW}⚠ Basemap not found at $BASEMAP_FILE${NC}"
        echo "  Run: ./scripts/generate_basemap.sh"
        echo ""
    fi
fi

# Push GNIS if requested
if [ "$PUSH_GNIS" = true ]; then
    # Check multiple locations
    GNIS_FILE=""
    GNIS_LOCATIONS=(
        "$PROJECT_DIR/charts/US Domestic Names/Alaska/gnis_names_ak.mbtiles"
        "$PROJECT_DIR/assets/Maps/gnis_names_ak.mbtiles"
    )
    for loc in "${GNIS_LOCATIONS[@]}"; do
        if [ -f "$loc" ]; then
            GNIS_FILE="$loc"
            break
        fi
    done
    
    if [ -n "$GNIS_FILE" ]; then
        echo "${CYAN}━━━ GNIS Place Names ━━━${NC}"
        GNIS_SIZE=$(stat -f%z "$GNIS_FILE" 2>/dev/null)
        echo "  File: gnis_names_ak.mbtiles ($(format_size $GNIS_SIZE))"
        echo "  Pushing to device..."
        adb push "$GNIS_FILE" "$DEVICE_DIR/gnis_names_ak.mbtiles"
        adb shell "chmod 775 '$DEVICE_DIR/gnis_names_ak.mbtiles'" 2>/dev/null || true
        echo "  ${GREEN}✓ GNIS pushed${NC}"
        echo ""
        TOTAL_SIZE=$((TOTAL_SIZE + GNIS_SIZE))
    else
        echo "${YELLOW}⚠ GNIS file not found${NC}"
        echo "  Run: python scripts/convert_gnis_names.py 'charts/US Domestic Names/Alaska/DomesticNames_AK.txt'"
        echo ""
    fi
fi

# Push chart index (if any charts were pushed)
if [ ${#TIERS[@]} -gt 0 ]; then
    echo "${CYAN}━━━ Chart Index ━━━${NC}"
    if [ -f "$SOURCE_DIR/chart_index.json" ]; then
        adb push "$SOURCE_DIR/chart_index.json" "$DEVICE_DIR/chart_index.json"
        echo ""
    else
        echo "  ${YELLOW}⚠ chart_index.json not found${NC}"
        echo ""
    fi
fi

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
