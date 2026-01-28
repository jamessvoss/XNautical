#!/bin/bash
#
# Fast Regional Merging Script
#
# Uses existing MBTiles files and tile-join to create regional packs.
# Much faster than re-converting from S-57 (~5-10 minutes vs hours).
#

set -e

CHARTS_DIR="${1:-/Users/jvoss/Documents/XNautical/charts/All_Alaska_ENC_ROOT}"
OUTPUT_DIR="${2:-/Users/jvoss/Documents/XNautical/charts/regional_packs}"

mkdir -p "$OUTPUT_DIR"

echo "════════════════════════════════════════════════════════════"
echo "       REGIONAL PACK CREATION (using existing MBTiles)"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Source: $CHARTS_DIR"
echo "Output: $OUTPUT_DIR"
echo ""

# Function to merge charts for a region
merge_region() {
    local name="$1"
    local output_file="$2"
    local scales="$3"
    local bounds="$4"  # west,south,east,north
    
    echo ""
    echo "────────────────────────────────────────────────────────────"
    echo "Creating: $name"
    echo "Scales: $scales"
    echo "Bounds: $bounds"
    echo "────────────────────────────────────────────────────────────"
    
    # Parse bounds
    IFS=',' read -r west south east north <<< "$bounds"
    
    # Find matching MBTiles files
    local files=""
    local count=0
    
    for scale in $scales; do
        pattern="US${scale}*.mbtiles"
        for f in $(find "$CHARTS_DIR" -name "$pattern" -type f 2>/dev/null); do
            # Get bounds from mbtiles
            file_bounds=$(sqlite3 "$f" "SELECT value FROM metadata WHERE name='bounds'" 2>/dev/null)
            if [ -n "$file_bounds" ]; then
                IFS=',' read -r fw fs fe fn <<< "$file_bounds"
                
                # Check if file bounds overlap with region bounds (simple check)
                # Skip files completely outside the region
                if (( $(echo "$fe < $west" | bc -l) )) || \
                   (( $(echo "$fw > $east" | bc -l) )) || \
                   (( $(echo "$fn < $south" | bc -l) )) || \
                   (( $(echo "$fs > $north" | bc -l) )); then
                    continue
                fi
                
                files="$files $f"
                count=$((count + 1))
            fi
        done
    done
    
    echo "Found $count matching MBTiles files"
    
    if [ $count -eq 0 ]; then
        echo "  No files found, skipping region"
        return
    fi
    
    # Run tile-join
    echo "Merging..."
    tile-join -o "$output_file" -f --no-tile-size-limit $files 2>&1 | tail -3
    
    if [ -f "$output_file" ]; then
        size=$(du -h "$output_file" | cut -f1)
        tiles=$(sqlite3 "$output_file" "SELECT COUNT(*) FROM tiles")
        echo "  Created: $output_file"
        echo "  Size: $size"
        echo "  Tiles: $tiles"
    else
        echo "  FAILED to create $output_file"
    fi
}

# Create Overview Pack (US1 + US2, all of Alaska)
merge_region "Alaska Overview" \
    "$OUTPUT_DIR/alaska_overview.mbtiles" \
    "1 2" \
    "-180,48,-130,75"

# Create Southeast Alaska Pack (US3-6)
merge_region "Southeast Alaska" \
    "$OUTPUT_DIR/southeast_alaska.mbtiles" \
    "3 4 5 6" \
    "-140,54.5,-130,60.5"

# Create Southcentral Alaska Pack (US3-6)
merge_region "Southcentral Alaska" \
    "$OUTPUT_DIR/southcentral_alaska.mbtiles" \
    "3 4 5 6" \
    "-155,57,-140,62"

# Create Southwest Alaska Pack (US3-6) - Aleutians
merge_region "Southwest Alaska" \
    "$OUTPUT_DIR/southwest_alaska.mbtiles" \
    "3 4 5 6" \
    "-180,50,-155,57"

# Create Western Alaska Pack (US3-6) - Bristol Bay to Nome
merge_region "Western Alaska" \
    "$OUTPUT_DIR/western_alaska.mbtiles" \
    "3 4 5 6" \
    "-180,57,-155,67"

# Create Northern Alaska Pack (US3-6) - Arctic
merge_region "Northern Alaska" \
    "$OUTPUT_DIR/northern_alaska.mbtiles" \
    "3 4 5 6" \
    "-180,67,-130,75"

# Create regions.json index
echo ""
echo "Creating regions.json index..."
cat > "$OUTPUT_DIR/regions.json" << 'JSONEOF'
{
  "version": "3.0",
  "format": "regional-packs",
  "description": "Alaska nautical chart packs",
  "regions": {
JSONEOF

first=true
for f in "$OUTPUT_DIR"/*.mbtiles; do
    if [ -f "$f" ]; then
        name=$(basename "$f" .mbtiles)
        size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null)
        size_mb=$(echo "scale=1; $size / 1024 / 1024" | bc)
        bounds=$(sqlite3 "$f" "SELECT value FROM metadata WHERE name='bounds'" 2>/dev/null || echo "-180,-90,180,90")
        minz=$(sqlite3 "$f" "SELECT MIN(zoom_level) FROM tiles" 2>/dev/null || echo "0")
        maxz=$(sqlite3 "$f" "SELECT MAX(zoom_level) FROM tiles" 2>/dev/null || echo "18")
        
        if [ "$first" = true ]; then
            first=false
        else
            echo "," >> "$OUTPUT_DIR/regions.json"
        fi
        
        cat >> "$OUTPUT_DIR/regions.json" << EOF
    "$name": {
      "filename": "$(basename $f)",
      "bounds": [$bounds],
      "minZoom": $minz,
      "maxZoom": $maxz,
      "sizeBytes": $size,
      "sizeMB": $size_mb
    }
EOF
    fi
done

cat >> "$OUTPUT_DIR/regions.json" << 'JSONEOF'
  }
}
JSONEOF

echo ""
echo "════════════════════════════════════════════════════════════"
echo "                    COMPLETE"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Created files:"
ls -lh "$OUTPUT_DIR"/*.mbtiles 2>/dev/null
echo ""
echo "Total size:"
du -sh "$OUTPUT_DIR"
echo ""
echo "To push to device:"
echo "  adb push $OUTPUT_DIR/*.mbtiles /sdcard/Android/data/com.xnautical.app/files/mbtiles/"
echo "  adb push $OUTPUT_DIR/regions.json /sdcard/Android/data/com.xnautical.app/files/mbtiles/"
