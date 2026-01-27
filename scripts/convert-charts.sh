#!/bin/bash
#
# Convert multiple NOAA S-57 charts to MBTiles
#
# Usage:
#   ./scripts/convert-charts.sh                    # Convert predefined list
#   ./scripts/convert-charts.sh US4AK4PH US5AK5SI  # Convert specific charts
#   ./scripts/convert-charts.sh --all-us4          # Convert all US4* charts
#   ./scripts/convert-charts.sh --all-us5          # Convert all US5* charts

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$PROJECT_ROOT/charts/All_Alaska_ENC_ROOT"
CONVERTER="$PROJECT_ROOT/cloud-functions/enc-converter/convert.py"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default chart list - these were on your mobile device
DEFAULT_CHARTS=(
    # US2 - Coastal
    "US2PACZS"
    
    # US3 - General
    "US3AK12M"
    "US3AK1DM"
    
    # US4 - Harbor
    "US4AK4PH"
    "US4AK4PG"
    "US4AK4PF"
    "US4AK4PI"
    "US4AK4QG"
    "US4AK4QF"
    "US4AK4QI"
    "US4AK4QH"
    "US4AK4OG"
    "US4AK4OH"
    
    # US5 - Approach
    "US5AK5SI"
    "US5AK5SJ"
    "US5AK5QG"
    "US5AK5QF"
    "US5AK5PF"
    "US5AK5PE"
    "US5AK5NF"
    "US5AK5NG"
)

# Parse arguments
CHARTS=()
if [ $# -eq 0 ]; then
    # No arguments - use default list
    CHARTS=("${DEFAULT_CHARTS[@]}")
elif [ "$1" = "--all-us4" ]; then
    # Convert all US4* charts
    echo "Scanning for all US4* charts..."
    for dir in "$SOURCE_DIR"/US4*; do
        if [ -d "$dir" ]; then
            CHARTS+=("$(basename "$dir")")
        fi
    done
elif [ "$1" = "--all-us5" ]; then
    # Convert all US5* charts
    echo "Scanning for all US5* charts..."
    for dir in "$SOURCE_DIR"/US5*; do
        if [ -d "$dir" ]; then
            CHARTS+=("$(basename "$dir")")
        fi
    done
else
    # Use provided chart IDs
    CHARTS=("$@")
fi

echo "=========================================="
echo "XNautical Chart Converter"
echo "=========================================="
echo "Source:  $SOURCE_DIR"
echo "Output:  (same as source directory)"
echo "Charts:  ${#CHARTS[@]}"
echo "=========================================="
echo ""

# Track results
SUCCESS=0
FAILED=0
SKIPPED=0
FAILED_CHARTS=()

# Convert each chart
for chart_id in "${CHARTS[@]}"; do
    echo -e "${YELLOW}Processing: $chart_id${NC}"
    
    # Check if already converted
    if [ -f "$SOURCE_DIR/$chart_id/${chart_id}.mbtiles" ]; then
        SIZE=$(ls -lh "$SOURCE_DIR/$chart_id/${chart_id}.mbtiles" | awk '{print $5}')
        echo -e "${GREEN}  ✓ Already exists ($SIZE) - skipping${NC}"
        ((SKIPPED++))
        continue
    fi
    
    # Find source file
    SOURCE_FILE="$SOURCE_DIR/$chart_id/$chart_id.000"
    if [ ! -f "$SOURCE_FILE" ]; then
        echo -e "${RED}  ✗ Source file not found: $SOURCE_FILE${NC}"
        FAILED_CHARTS+=("$chart_id (source not found)")
        ((FAILED++))
        continue
    fi
    
    # Convert (output to source directory)
    if python3 "$CONVERTER" "$SOURCE_FILE" 2>&1 | grep -v "^$"; then
        if [ -f "$SOURCE_DIR/$chart_id/${chart_id}.mbtiles" ]; then
            SIZE=$(ls -lh "$SOURCE_DIR/$chart_id/${chart_id}.mbtiles" | awk '{print $5}')
            echo -e "${GREEN}  ✓ Converted successfully ($SIZE)${NC}"
            ((SUCCESS++))
        else
            echo -e "${RED}  ✗ Conversion reported success but file not found${NC}"
            FAILED_CHARTS+=("$chart_id (output missing)")
            ((FAILED++))
        fi
    else
        echo -e "${RED}  ✗ Conversion failed${NC}"
        FAILED_CHARTS+=("$chart_id (conversion error)")
        ((FAILED++))
    fi
    
    echo ""
done

# Summary
echo "=========================================="
echo "Conversion Summary"
echo "=========================================="
echo -e "${GREEN}Success:  $SUCCESS${NC}"
echo -e "${YELLOW}Skipped:  $SKIPPED${NC}"
echo -e "${RED}Failed:   $FAILED${NC}"

if [ ${#FAILED_CHARTS[@]} -gt 0 ]; then
    echo ""
    echo "Failed charts:"
    for chart in "${FAILED_CHARTS[@]}"; do
        echo "  - $chart"
    done
fi

echo ""
echo "Converted charts are in their respective source directories under: $SOURCE_DIR"
echo ""
