#!/bin/zsh
#
# generate_basemap.sh - Generate vector basemap MBTiles from free OpenStreetMap data
#
# This script:
#   1. Downloads Alaska OSM data from Geofabrik (free)
#   2. Downloads Planetiler if needed
#   3. Converts OSM data to MBTiles vector tiles
#
# Requirements: Java 21+ (for Planetiler)
#
# Usage: ./scripts/generate_basemap.sh
#

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_DIR/charts/Basemaps"
WORK_DIR="/tmp/basemap_generation"

# Planetiler version
PLANETILER_VERSION="0.8.2"
PLANETILER_JAR="planetiler-dist-${PLANETILER_VERSION}-with-deps.jar"
PLANETILER_URL="https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar"

# OSM Data source
OSM_URL="https://download.geofabrik.de/north-america/us/alaska-latest.osm.pbf"
OSM_FILE="alaska-latest.osm.pbf"

# Output file
OUTPUT_FILE="basemap_alaska.mbtiles"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

echo ""
echo "${BOLD}${BLUE}══════════════════════════════════════════════════════════${NC}"
echo "${BOLD}${BLUE}  XNautical Basemap Generator${NC}"
echo "${BOLD}${BLUE}══════════════════════════════════════════════════════════${NC}"
echo ""

# Check for Java 21
echo "${CYAN}▶${NC} Checking prerequisites..."

# Prefer Java 21 from Homebrew
if [ -x "/opt/homebrew/opt/openjdk@21/bin/java" ]; then
    JAVA_CMD="/opt/homebrew/opt/openjdk@21/bin/java"
    JAVA_VERSION=21
    echo "${GREEN}✓${NC} Using Java 21 from Homebrew"
elif command -v java &> /dev/null; then
    JAVA_CMD="java"
    JAVA_VERSION=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | cut -d'.' -f1)
    if [ "$JAVA_VERSION" -lt 21 ]; then
        echo "${RED}✗${NC} Java $JAVA_VERSION found, but Planetiler requires Java 21+"
        echo ""
        echo "Install with:"
        echo "  brew install openjdk@21"
        exit 1
    fi
    echo "${GREEN}✓${NC} Java found (version $JAVA_VERSION)"
else
    echo "${RED}✗${NC} Java not found!"
    echo ""
    echo "Planetiler requires Java 21+. Install with:"
    echo "  brew install openjdk@21"
    exit 1
fi

# Create directories
mkdir -p "$OUTPUT_DIR"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# Download Planetiler if needed
if [ ! -f "$WORK_DIR/planetiler.jar" ]; then
    echo ""
    echo "${CYAN}▶${NC} Downloading Planetiler..."
    curl -L -o planetiler.jar "$PLANETILER_URL"
    echo "${GREEN}✓${NC} Downloaded Planetiler"
else
    echo "${GREEN}✓${NC} Planetiler already downloaded"
fi

# Download OSM data if needed
if [ ! -f "$WORK_DIR/$OSM_FILE" ]; then
    echo ""
    echo "${CYAN}▶${NC} Downloading Alaska OSM data from Geofabrik..."
    echo "    This may take a few minutes (~150 MB)"
    curl -L -o "$OSM_FILE" "$OSM_URL"
    OSM_SIZE=$(du -h "$OSM_FILE" | cut -f1)
    echo "${GREEN}✓${NC} Downloaded $OSM_FILE ($OSM_SIZE)"
else
    OSM_SIZE=$(du -h "$OSM_FILE" | cut -f1)
    echo "${GREEN}✓${NC} OSM data already downloaded ($OSM_SIZE)"
fi

# Generate MBTiles
echo ""
echo "${CYAN}▶${NC} Generating MBTiles with Planetiler..."
echo "    This may take 5-15 minutes depending on your machine"
echo ""

START_TIME=$(date +%s)

# Run Planetiler with OpenMapTiles profile
"$JAVA_CMD" -Xmx4g -jar planetiler.jar \
    --osm-path="$OSM_FILE" \
    --output="$OUTPUT_FILE" \
    --download \
    --force \
    --nodemap-type=array \
    --storage=mmap

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

if [ -f "$WORK_DIR/$OUTPUT_FILE" ]; then
    OUTPUT_SIZE=$(du -h "$WORK_DIR/$OUTPUT_FILE" | cut -f1)
    echo ""
    echo "${GREEN}✓${NC} Generated $OUTPUT_FILE ($OUTPUT_SIZE) in ${DURATION}s"
    
    # Move to output directory
    mv "$WORK_DIR/$OUTPUT_FILE" "$OUTPUT_DIR/$OUTPUT_FILE"
    echo "${GREEN}✓${NC} Moved to $OUTPUT_DIR/$OUTPUT_FILE"
    
    # Cleanup work directory (keep planetiler.jar for future use)
    rm -f "$WORK_DIR/$OSM_FILE"
    echo "${GREEN}✓${NC} Cleaned up temporary files"
else
    echo "${RED}✗${NC} Failed to generate MBTiles"
    exit 1
fi

echo ""
echo "${BOLD}${BLUE}══════════════════════════════════════════════════════════${NC}"
echo "${BOLD}${BLUE}  COMPLETE${NC}"
echo "${BOLD}${BLUE}══════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Output: ${BOLD}$OUTPUT_DIR/$OUTPUT_FILE${NC}"
echo "  Size:   ${BOLD}$OUTPUT_SIZE${NC}"
echo "  Time:   ${BOLD}${DURATION}s${NC}"
echo ""
echo "  ${CYAN}Next steps:${NC}"
echo "  1. Push to device: ./scripts/push_charts.sh --basemap"
echo "  2. Restart the app to use the new basemap"
echo ""
