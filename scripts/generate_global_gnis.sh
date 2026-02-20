#!/bin/bash
#
# Generate a global (national) GNIS place names MBTiles file.
#
# Downloads the full US GNIS dataset from USGS, filters for nautically
# relevant features across all coastal and Great Lakes states, converts
# to GeoJSON, and builds an MBTiles vector tile set.
#
# Output: charts/converted/global/gnis_names.mbtiles
#         charts/converted/global/gnis_names.mbtiles.zip  (for Firebase upload)
#
# Prerequisites: Python 3, tippecanoe, curl/wget
#
# Usage:
#   ./scripts/generate_global_gnis.sh
#
# After running, upload the zip to Firebase Storage:
#   gsutil cp charts/converted/global/gnis_names.mbtiles.zip \
#     gs://xnautical-8a296.firebasestorage.app/global/gnis/gnis_names.mbtiles.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WORK_DIR="$PROJECT_DIR/charts/converted/global"
DOWNLOAD_DIR="$PROJECT_DIR/charts/US Domestic Names/National"

mkdir -p "$WORK_DIR" "$DOWNLOAD_DIR"

# -----------------------------------------------------------------------
# Step 1: Download national GNIS data from USGS
# -----------------------------------------------------------------------
NATIONAL_ZIP="$DOWNLOAD_DIR/NationalFedCodes.zip"
NATIONAL_TXT="$DOWNLOAD_DIR/NationalFile.txt"

if [ -f "$NATIONAL_TXT" ]; then
    echo "National GNIS file already exists: $NATIONAL_TXT"
    echo "  (Delete it to re-download)"
else
    echo "Downloading national GNIS data from USGS..."
    # USGS GNIS download: https://www.usgs.gov/us-board-on-geographic-names/download-gnis-data
    # S3 bucket listing: https://prd-tnm.s3.amazonaws.com/?prefix=StagedProducts/GeographicNames/DomesticNames/
    GNIS_URL="https://prd-tnm.s3.amazonaws.com/StagedProducts/GeographicNames/DomesticNames/DomesticNames_National_Text.zip"

    curl -L --progress-bar -o "$NATIONAL_ZIP" "$GNIS_URL"

    echo "Extracting..."
    unzip -o "$NATIONAL_ZIP" -d "$DOWNLOAD_DIR"

    # Find the extracted text file (may be in a subdirectory like Text/)
    EXTRACTED=$(find "$DOWNLOAD_DIR" -name "*.txt" -size +1M | grep -iv "readme" | head -1)

    if [ -z "$EXTRACTED" ]; then
        echo "ERROR: Could not find extracted GNIS text file in $DOWNLOAD_DIR"
        echo "Contents:"
        ls -la "$DOWNLOAD_DIR"
        exit 1
    fi

    if [ "$EXTRACTED" != "$NATIONAL_TXT" ]; then
        mv "$EXTRACTED" "$NATIONAL_TXT"
    fi

    echo "Downloaded: $NATIONAL_TXT ($(du -h "$NATIONAL_TXT" | cut -f1))"
fi

# -----------------------------------------------------------------------
# Step 2: Convert to GeoJSON and MBTiles using existing script
# -----------------------------------------------------------------------
echo ""
echo "Converting national GNIS to GeoJSON + MBTiles..."

# The existing convert script derives the output name from the input filename.
# We want the output to be named "gnis_names" (no region suffix) so we
# create a symlink with the right name.
SYMLINK_TXT="$DOWNLOAD_DIR/DomesticNames_national.txt"
if [ ! -f "$SYMLINK_TXT" ] && [ -f "$NATIONAL_TXT" ]; then
    ln -sf "$(basename "$NATIONAL_TXT")" "$SYMLINK_TXT" 2>/dev/null || cp "$NATIONAL_TXT" "$SYMLINK_TXT"
fi

python3 "$SCRIPT_DIR/convert_gnis_names.py" "$SYMLINK_TXT" "$WORK_DIR"

# The script outputs gnis_names_national.{geojson,mbtiles}
# Rename to the canonical gnis_names.mbtiles
GENERATED="$WORK_DIR/gnis_names_national.mbtiles"
FINAL="$WORK_DIR/gnis_names.mbtiles"

if [ -f "$GENERATED" ]; then
    mv "$GENERATED" "$FINAL"
    echo "Renamed to: $FINAL"
fi

# Also clean up the geojson to save disk space (it can be huge for national)
GEOJSON="$WORK_DIR/gnis_names_national.geojson"
if [ -f "$GEOJSON" ]; then
    GEOJSON_SIZE=$(du -h "$GEOJSON" | cut -f1)
    echo "Removing intermediate GeoJSON ($GEOJSON_SIZE): $GEOJSON"
    rm -f "$GEOJSON"
fi

# -----------------------------------------------------------------------
# Step 3: Create zip for Firebase upload
# -----------------------------------------------------------------------
echo ""
ZIP_PATH="$WORK_DIR/gnis_names.mbtiles.zip"
echo "Creating zip for Firebase upload..."
cd "$WORK_DIR"
zip -j "$ZIP_PATH" "gnis_names.mbtiles"

MBTILES_SIZE=$(du -h "$FINAL" | cut -f1)
ZIP_SIZE=$(du -h "$ZIP_PATH" | cut -f1)

echo ""
echo "========================================="
echo "  Global GNIS Generation Complete!"
echo "========================================="
echo ""
echo "  MBTiles: $FINAL ($MBTILES_SIZE)"
echo "  Zip:     $ZIP_PATH ($ZIP_SIZE)"
echo ""
echo "To upload to Firebase Storage, run:"
echo ""
echo "  gsutil cp '$ZIP_PATH' \\"
echo "    gs://xnautical-8a296.firebasestorage.app/global/gnis/gnis_names.mbtiles.zip"
echo ""
echo "Then redeploy the district-metadata cloud function so all"
echo "regions pick up the global GNIS file."
echo ""
