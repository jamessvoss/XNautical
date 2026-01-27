#!/bin/bash
# Convert all charts overlapping US2PACZS (Gulf of Alaska)

SOURCE_DIR="/Users/jvoss/Documents/XNautical/charts/All_Alaska_ENC_ROOT"

# Read chart list, filter comments and empty lines
CHARTS=$(grep -v '^#' /Users/jvoss/Documents/XNautical/scripts/gulf_of_alaska_charts.txt | grep -v '^$' | tr '\n' ' ')

echo "Gulf of Alaska Chart Conversion"
echo "================================"
echo ""
echo "Charts to convert:"

# Verify which charts exist
EXISTING=()
MISSING=()

for chart in $CHARTS; do
    if [ -d "$SOURCE_DIR/$chart" ] && [ -f "$SOURCE_DIR/$chart/$chart.000" ]; then
        EXISTING+=("$chart")
        echo "  ✓ $chart"
    else
        MISSING+=("$chart")
        echo "  ✗ $chart (not found)"
    fi
done

echo ""
echo "Summary:"
echo "  Found: ${#EXISTING[@]}"
echo "  Missing: ${#MISSING[@]}"
echo ""

if [ ${#EXISTING[@]} -gt 0 ]; then
    echo "Converting ${#EXISTING[@]} charts..."
    echo ""
    
    # Convert using the script
    cd /Users/jvoss/Documents/XNautical
    ./scripts/convert-charts.sh "${EXISTING[@]}"
else
    echo "No charts to convert."
fi
