#!/bin/zsh
#
# delete_charts.sh - Delete nautical chart files from Android device
#

set -e

# Configuration
DEVICE_DIR="/storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Parse arguments
DELETE_US1=false
DELETE_US2=false
DELETE_US3=false
DELETE_US4=false
DELETE_US5=false
DELETE_US6=false
DELETE_BASEMAP=false
DELETE_GNIS=false
FORCE=false
ANY_SELECTED=false

for arg in "$@"; do
    case $arg in
        --US1|--us1)
            DELETE_US1=true
            ANY_SELECTED=true
            ;;
        --US2|--us2)
            DELETE_US2=true
            ANY_SELECTED=true
            ;;
        --US3|--us3)
            DELETE_US3=true
            ANY_SELECTED=true
            ;;
        --US4|--us4)
            DELETE_US4=true
            ANY_SELECTED=true
            ;;
        --US5|--us5)
            DELETE_US5=true
            ANY_SELECTED=true
            ;;
        --US6|--us6)
            DELETE_US6=true
            ANY_SELECTED=true
            ;;
        --basemap|--Basemap|--BASEMAP)
            DELETE_BASEMAP=true
            ANY_SELECTED=true
            ;;
        --gnis|--GNIS)
            DELETE_GNIS=true
            ANY_SELECTED=true
            ;;
        --all)
            DELETE_US1=true
            DELETE_US2=true
            DELETE_US3=true
            DELETE_US4=true
            DELETE_US5=true
            DELETE_US6=true
            DELETE_BASEMAP=true
            DELETE_GNIS=true
            ANY_SELECTED=true
            ;;
        --charts)
            DELETE_US1=true
            DELETE_US2=true
            DELETE_US3=true
            DELETE_US4=true
            DELETE_US5=true
            DELETE_US6=true
            ANY_SELECTED=true
            ;;
        --force|-f)
            FORCE=true
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Delete nautical chart files from Android device."
            echo ""
            echo "${BOLD}Chart Options:${NC}"
            echo "  --US1       Delete US1 charts (Overview)"
            echo "  --US2       Delete US2 charts (General)"
            echo "  --US3       Delete US3 charts (Coastal)"
            echo "  --US4       Delete US4 charts (Approach)"
            echo "  --US5       Delete US5 charts (Harbor)"
            echo "  --US6       Delete US6 charts (Berthing)"
            echo ""
            echo "${BOLD}Other Data:${NC}"
            echo "  --basemap   Delete basemap tiles"
            echo "  --gnis      Delete GNIS place names"
            echo ""
            echo "${BOLD}Shortcuts:${NC}"
            echo "  --charts    Delete all chart tiers (US1-US6)"
            echo "  --all       Delete everything"
            echo ""
            echo "${BOLD}Options:${NC}"
            echo "  --force     Skip confirmation prompt"
            echo ""
            echo "${BOLD}Examples:${NC}"
            echo "  $0 --US5                  Delete harbor charts only"
            echo "  $0 --US4 --US5            Delete approach and harbor charts"
            echo "  $0 --charts               Delete all nautical charts"
            echo "  $0 --all                  Delete everything"
            echo "  $0 --US5 --force          Delete without confirmation"
            exit 0
            ;;
    esac
done

# If nothing selected, show help
if [ "$ANY_SELECTED" = false ]; then
    echo "No options selected. Use --help for usage."
    echo ""
    echo "Quick examples:"
    echo "  $0 --US5          # Delete harbor charts"
    echo "  $0 --US4 --US5    # Delete approach + harbor"
    echo "  $0 --charts       # Delete all charts"
    echo "  $0 --all          # Delete everything"
    exit 1
fi

format_size() {
    local size=$1
    if [ $size -ge 1073741824 ]; then
        printf "%.1f GB" $(echo "$size / 1073741824" | bc -l)
    elif [ $size -ge 1048576 ]; then
        printf "%.1f MB" $(echo "$size / 1048576" | bc -l)
    elif [ $size -ge 1024 ]; then
        printf "%.1f KB" $(echo "$size / 1024" | bc -l)
    else
        printf "%d bytes" $size
    fi
}

echo ""
echo "${BOLD}${RED}══════════════════════════════════════════════════════════${NC}"
echo "${BOLD}${RED}  XNautical Chart Delete Tool${NC}"
echo "${BOLD}${RED}══════════════════════════════════════════════════════════${NC}"
echo ""

# Check device
if ! adb devices | grep -q "device$"; then
    echo "${RED}✗ No device connected${NC}"
    exit 1
fi
DEVICE_MODEL=$(adb shell getprop ro.product.model 2>/dev/null | tr -d '\r')
echo "${GREEN}✓${NC} Device: ${BOLD}$DEVICE_MODEL${NC}"

# Build list of what to delete
TIERS=()
DELETE_ITEMS=""
[ "$DELETE_US1" = true ] && TIERS+=("US1") && DELETE_ITEMS="${DELETE_ITEMS}US1 "
[ "$DELETE_US2" = true ] && TIERS+=("US2") && DELETE_ITEMS="${DELETE_ITEMS}US2 "
[ "$DELETE_US3" = true ] && TIERS+=("US3") && DELETE_ITEMS="${DELETE_ITEMS}US3 "
[ "$DELETE_US4" = true ] && TIERS+=("US4") && DELETE_ITEMS="${DELETE_ITEMS}US4 "
[ "$DELETE_US5" = true ] && TIERS+=("US5") && DELETE_ITEMS="${DELETE_ITEMS}US5 "
[ "$DELETE_US6" = true ] && TIERS+=("US6") && DELETE_ITEMS="${DELETE_ITEMS}US6 "
[ "$DELETE_BASEMAP" = true ] && DELETE_ITEMS="${DELETE_ITEMS}Basemap "
[ "$DELETE_GNIS" = true ] && DELETE_ITEMS="${DELETE_ITEMS}GNIS "

echo "${CYAN}▶${NC} Will delete: ${BOLD}${DELETE_ITEMS}${NC}"

# Scan device for files to delete
TOTAL_FILES=0
TOTAL_SIZE=0

echo ""
echo "${BOLD}Scanning device for files...${NC}"

# Scan chart tiers
for tier in "${TIERS[@]}"; do
    # Get file count
    count=$(adb shell "ls -1 '$DEVICE_DIR'/${tier}*.mbtiles 2>/dev/null | wc -l" 2>/dev/null | tr -d '\r ' || echo "0")
    
    if [ "$count" -gt 0 ] && [ "$count" != "0" ]; then
        # Get total size (parse ls -l output)
        size=$(adb shell "ls -l '$DEVICE_DIR'/${tier}*.mbtiles 2>/dev/null" | awk '{sum += $5} END {print sum+0}' | tr -d '\r')
        [ -z "$size" ] && size=0
        
        TOTAL_FILES=$((TOTAL_FILES + count))
        TOTAL_SIZE=$((TOTAL_SIZE + size))
        printf "  ${RED}✗${NC} %-4s: %4d files, %s\n" "$tier" "$count" "$(format_size $size)"
    else
        printf "  ${YELLOW}-${NC} %-4s: no files found\n" "$tier"
    fi
done

# Scan basemap
if [ "$DELETE_BASEMAP" = true ]; then
    basemap_exists=$(adb shell "[ -f '$DEVICE_DIR/basemap_alaska.mbtiles' ] && echo 'yes' || echo 'no'" | tr -d '\r')
    if [ "$basemap_exists" = "yes" ]; then
        basemap_size=$(adb shell "ls -l '$DEVICE_DIR/basemap_alaska.mbtiles'" | awk '{print $5}' | tr -d '\r')
        [ -z "$basemap_size" ] && basemap_size=0
        TOTAL_FILES=$((TOTAL_FILES + 1))
        TOTAL_SIZE=$((TOTAL_SIZE + basemap_size))
        printf "  ${RED}✗${NC} Basemap: 1 file, %s\n" "$(format_size $basemap_size)"
    else
        printf "  ${YELLOW}-${NC} Basemap: not found\n"
    fi
fi

# Scan GNIS
if [ "$DELETE_GNIS" = true ]; then
    gnis_exists=$(adb shell "[ -f '$DEVICE_DIR/gnis_names_ak.mbtiles' ] && echo 'yes' || echo 'no'" | tr -d '\r')
    if [ "$gnis_exists" = "yes" ]; then
        gnis_size=$(adb shell "ls -l '$DEVICE_DIR/gnis_names_ak.mbtiles'" | awk '{print $5}' | tr -d '\r')
        [ -z "$gnis_size" ] && gnis_size=0
        TOTAL_FILES=$((TOTAL_FILES + 1))
        TOTAL_SIZE=$((TOTAL_SIZE + gnis_size))
        printf "  ${RED}✗${NC} GNIS:    1 file, %s\n" "$(format_size $gnis_size)"
    else
        printf "  ${YELLOW}-${NC} GNIS:    not found\n"
    fi
fi

echo "  ─────────────────────────"
echo "  ${BOLD}Total: $TOTAL_FILES files, $(format_size $TOTAL_SIZE)${NC}"

# Exit if nothing to delete
if [ "$TOTAL_FILES" -eq 0 ]; then
    echo ""
    echo "${YELLOW}No files to delete.${NC}"
    exit 0
fi

# Confirm deletion
echo ""
if [ "$FORCE" = false ]; then
    echo -n "${RED}${BOLD}Delete these files? This cannot be undone! [y/N]${NC} "
    read -r REPLY
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

echo ""
echo "${BOLD}Deleting files...${NC}"
echo ""

DELETED_FILES=0

# Delete chart tiers
for tier in "${TIERS[@]}"; do
    count=$(adb shell "ls -1 '$DEVICE_DIR'/${tier}*.mbtiles 2>/dev/null | wc -l" 2>/dev/null | tr -d '\r ' || echo "0")
    
    if [ "$count" -gt 0 ] && [ "$count" != "0" ]; then
        echo -n "  Deleting $tier charts ($count files)... "
        adb shell "rm '$DEVICE_DIR'/${tier}*.mbtiles" 2>/dev/null
        
        # Verify deletion
        remaining=$(adb shell "ls -1 '$DEVICE_DIR'/${tier}*.mbtiles 2>/dev/null | wc -l" 2>/dev/null | tr -d '\r ' || echo "0")
        if [ "$remaining" = "0" ] || [ -z "$remaining" ]; then
            echo "${GREEN}✓${NC}"
            DELETED_FILES=$((DELETED_FILES + count))
        else
            echo "${YELLOW}⚠ $remaining remaining${NC}"
        fi
    fi
done

# Delete basemap
if [ "$DELETE_BASEMAP" = true ]; then
    basemap_exists=$(adb shell "[ -f '$DEVICE_DIR/basemap_alaska.mbtiles' ] && echo 'yes' || echo 'no'" | tr -d '\r')
    if [ "$basemap_exists" = "yes" ]; then
        echo -n "  Deleting basemap... "
        adb shell "rm '$DEVICE_DIR/basemap_alaska.mbtiles'" 2>/dev/null
        echo "${GREEN}✓${NC}"
        DELETED_FILES=$((DELETED_FILES + 1))
    fi
fi

# Delete GNIS
if [ "$DELETE_GNIS" = true ]; then
    gnis_exists=$(adb shell "[ -f '$DEVICE_DIR/gnis_names_ak.mbtiles' ] && echo 'yes' || echo 'no'" | tr -d '\r')
    if [ "$gnis_exists" = "yes" ]; then
        echo -n "  Deleting GNIS... "
        adb shell "rm '$DEVICE_DIR/gnis_names_ak.mbtiles'" 2>/dev/null
        echo "${GREEN}✓${NC}"
        DELETED_FILES=$((DELETED_FILES + 1))
    fi
fi

# Summary
echo ""
REMAINING=$(adb shell "ls -1 '$DEVICE_DIR'/*.mbtiles 2>/dev/null | wc -l" 2>/dev/null | tr -d '\r ' || echo "0")
[ -z "$REMAINING" ] && REMAINING=0

echo "${BOLD}${GREEN}══════════════════════════════════════════════════════════${NC}"
echo "${BOLD}${GREEN}  COMPLETE${NC}"
echo "${BOLD}${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Deleted:   ${BOLD}$DELETED_FILES${NC} files"
echo "  Freed:     ${BOLD}$(format_size $TOTAL_SIZE)${NC}"
echo "  Remaining: ${BOLD}$REMAINING${NC} files on device"
echo ""
