#!/bin/bash
# =============================================================================
# upload_district.sh - Upload district data to Firebase Storage
# =============================================================================
# 
# Usage:
#   ./upload_district.sh 17cgd              # Upload all District 17 (Alaska) data
#   ./upload_district.sh 17cgd --charts     # Upload only charts
#   ./upload_district.sh 17cgd --satellite  # Upload only satellite tiles
#   ./upload_district.sh 17cgd --dry-run    # Show what would be uploaded
#
# Prerequisites:
#   - gsutil configured with Firebase project access
#   - Firebase project: xnautical-8a296
#
# Storage Structure (district-first):
#   gs://xnautical-8a296.firebasestorage.app/
#   └── {districtId}/
#       ├── charts/US1.mbtiles.zip, US2.mbtiles.zip, ...
#       ├── basemaps/basemap.mbtiles.zip
#       ├── satellite/satellite_z*.mbtiles.zip
#       └── gnis/gnis_names.mbtiles.zip
# =============================================================================

set -e

# Configuration
BUCKET="gs://xnautical-8a296.firebasestorage.app"
PROJECT_ROOT="/Users/jvoss/Documents/XNautical"
CHARTS_DIR="$PROJECT_ROOT/charts/converted/regional"
BASEMAPS_DIR="$PROJECT_ROOT/charts/Basemaps"
SATELLITE_DIR="$PROJECT_ROOT/charts/Satellite"
TEMP_DIR="$PROJECT_ROOT/charts/converted/temp/upload"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =============================================================================
# District Configuration Functions (compatible with bash 3.x)
# =============================================================================

get_district_name() {
    case "$1" in
        01cgd) echo "New England" ;;
        05cgd) echo "Mid-Atlantic" ;;
        07cgd) echo "Southeast" ;;
        08cgd) echo "Gulf Coast" ;;
        09cgd) echo "Great Lakes" ;;
        11cgd) echo "California" ;;
        13cgd) echo "Pacific Northwest" ;;
        14cgd) echo "Pacific Islands" ;;
        17cgd) echo "Alaska" ;;
        *) echo "" ;;
    esac
}

get_district_prefix() {
    case "$1" in
        01cgd) echo "d01" ;;
        05cgd) echo "d05" ;;
        07cgd) echo "d07" ;;
        08cgd) echo "d08" ;;
        09cgd) echo "d09" ;;
        11cgd) echo "d11" ;;
        13cgd) echo "d13" ;;
        14cgd) echo "d14" ;;
        17cgd) echo "d17" ;;
        *) echo "" ;;
    esac
}

# =============================================================================
# Helper Functions
# =============================================================================

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}→${NC} $1"
}

format_size() {
    local size=$1
    if [ "$size" -ge 1073741824 ]; then
        echo "$(echo "scale=2; $size / 1073741824" | bc) GB"
    elif [ "$size" -ge 1048576 ]; then
        echo "$(echo "scale=2; $size / 1048576" | bc) MB"
    else
        echo "$(echo "scale=2; $size / 1024" | bc) KB"
    fi
}

get_file_size() {
    # macOS compatible file size
    stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0
}

compress_file() {
    local src="$1"
    local dst="$2"
    local name=$(basename "$src")
    
    if [ -f "$dst" ]; then
        local src_time=$(stat -f %m "$src" 2>/dev/null || stat -c %Y "$src" 2>/dev/null || echo 0)
        local dst_time=$(stat -f %m "$dst" 2>/dev/null || stat -c %Y "$dst" 2>/dev/null || echo 0)
        if [ "$dst_time" -gt "$src_time" ]; then
            print_info "Using cached: $(basename "$dst")"
            return 0
        fi
    fi
    
    print_info "Compressing: $name"
    zip -j "$dst" "$src" > /dev/null
    local size=$(get_file_size "$dst")
    print_success "Compressed: $(basename "$dst") ($(format_size $size))"
}

upload_file() {
    local src="$1"
    local dst="$2"
    local name=$(basename "$src")
    
    if [ "$DRY_RUN" = true ]; then
        print_info "[DRY RUN] Would upload: $name → $dst"
        return 0
    fi
    
    print_info "Uploading: $name → $dst"
    gsutil -o GSUtil:parallel_composite_upload_threshold=150M cp "$src" "$dst"
    print_success "Uploaded: $name"
}

# =============================================================================
# Upload Functions
# =============================================================================

upload_charts() {
    local district_id="$1"
    local prefix=$(get_district_prefix "$district_id")
    
    print_header "Uploading Chart Scale Packs"
    
    local total_size=0
    
    for scale in US1 US2 US3 US4 US5 US6; do
        local src_file="$CHARTS_DIR/${prefix}_${scale}.mbtiles"
        local zip_file="$TEMP_DIR/${scale}.mbtiles.zip"
        local dst_path="$BUCKET/$district_id/charts/${scale}.mbtiles.zip"
        
        if [ ! -f "$src_file" ]; then
            print_warning "Not found: $src_file"
            continue
        fi
        
        compress_file "$src_file" "$zip_file"
        upload_file "$zip_file" "$dst_path"
        
        local size=$(get_file_size "$zip_file")
        total_size=$((total_size + size))
    done
    
    print_success "Charts total: $(format_size $total_size)"
}

upload_basemap() {
    local district_id="$1"
    local prefix=$(get_district_prefix "$district_id")
    
    print_header "Uploading Basemap"
    
    local src_file="$BASEMAPS_DIR/basemap_${prefix}.mbtiles"
    local zip_file="$TEMP_DIR/basemap.mbtiles.zip"
    local dst_path="$BUCKET/$district_id/basemaps/basemap.mbtiles.zip"
    
    if [ ! -f "$src_file" ]; then
        print_warning "Not found: $src_file"
        return 0
    fi
    
    compress_file "$src_file" "$zip_file"
    upload_file "$zip_file" "$dst_path"
}

upload_satellite() {
    local district_id="$1"
    
    print_header "Uploading Satellite Tiles"
    
    local total_size=0
    
    for src_file in "$SATELLITE_DIR"/satellite_z*.mbtiles; do
        if [ ! -f "$src_file" ]; then
            continue
        fi
        
        local name=$(basename "$src_file" .mbtiles)
        local zip_file="$TEMP_DIR/${name}.mbtiles.zip"
        local dst_path="$BUCKET/$district_id/satellite/${name}.mbtiles.zip"
        
        compress_file "$src_file" "$zip_file"
        upload_file "$zip_file" "$dst_path"
        
        local size=$(get_file_size "$zip_file")
        total_size=$((total_size + size))
    done
    
    print_success "Satellite total: $(format_size $total_size)"
}

upload_gnis() {
    local district_id="$1"
    local prefix=$(get_district_prefix "$district_id")
    
    print_header "Uploading GNIS Place Names"
    
    # Try multiple possible filenames
    local src_file=""
    for f in "$CHARTS_DIR/gnis_names_${prefix:0:2}.mbtiles" "$CHARTS_DIR/gnis_names_ak.mbtiles"; do
        if [ -f "$f" ]; then
            src_file="$f"
            break
        fi
    done
    
    if [ -z "$src_file" ] || [ ! -f "$src_file" ]; then
        print_warning "GNIS file not found"
        return 0
    fi
    
    local zip_file="$TEMP_DIR/gnis_names.mbtiles.zip"
    local dst_path="$BUCKET/$district_id/gnis/gnis_names.mbtiles.zip"
    
    compress_file "$src_file" "$zip_file"
    upload_file "$zip_file" "$dst_path"
}

upload_manifest() {
    local district_id="$1"
    
    print_header "Uploading Manifest"
    
    local src_file="$CHARTS_DIR/manifest.json"
    local dst_path="$BUCKET/$district_id/charts/manifest.json"
    
    if [ ! -f "$src_file" ]; then
        print_warning "Manifest not found: $src_file"
        return 0
    fi
    
    upload_file "$src_file" "$dst_path"
}

# =============================================================================
# Main Script
# =============================================================================

show_usage() {
    echo "Usage: $0 <district_id> [options]"
    echo ""
    echo "District IDs:"
    echo "  01cgd - New England"
    echo "  05cgd - Mid-Atlantic"
    echo "  07cgd - Southeast"
    echo "  08cgd - Gulf Coast"
    echo "  09cgd - Great Lakes"
    echo "  11cgd - California"
    echo "  13cgd - Pacific Northwest"
    echo "  14cgd - Pacific Islands"
    echo "  17cgd - Alaska"
    echo ""
    echo "Options:"
    echo "  --charts      Upload only chart scale packs (US1-US6)"
    echo "  --basemap     Upload only basemap"
    echo "  --satellite   Upload only satellite tiles"
    echo "  --gnis        Upload only GNIS place names"
    echo "  --dry-run     Show what would be uploaded without uploading"
    echo "  --help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 17cgd                 # Upload all Alaska data"
    echo "  $0 17cgd --charts        # Upload only Alaska charts"
    echo "  $0 17cgd --dry-run       # Preview what would be uploaded"
}

# Parse arguments
DISTRICT_ID=""
UPLOAD_CHARTS=false
UPLOAD_BASEMAP=false
UPLOAD_SATELLITE=false
UPLOAD_GNIS=false
DRY_RUN=false
UPLOAD_ALL=true

while [ $# -gt 0 ]; do
    case $1 in
        --charts)
            UPLOAD_CHARTS=true
            UPLOAD_ALL=false
            shift
            ;;
        --basemap)
            UPLOAD_BASEMAP=true
            UPLOAD_ALL=false
            shift
            ;;
        --satellite)
            UPLOAD_SATELLITE=true
            UPLOAD_ALL=false
            shift
            ;;
        --gnis)
            UPLOAD_GNIS=true
            UPLOAD_ALL=false
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            show_usage
            exit 0
            ;;
        *)
            if [ -z "$DISTRICT_ID" ]; then
                DISTRICT_ID="$1"
            else
                print_error "Unknown option: $1"
                show_usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate district ID
if [ -z "$DISTRICT_ID" ]; then
    print_error "District ID required"
    show_usage
    exit 1
fi

DISTRICT_NAME=$(get_district_name "$DISTRICT_ID")
if [ -z "$DISTRICT_NAME" ]; then
    print_error "Unknown district ID: $DISTRICT_ID"
    show_usage
    exit 1
fi

# Create temp directory
mkdir -p "$TEMP_DIR"

# Print header
echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  XNautical District Upload                                    ║${NC}"
echo -e "${BLUE}║  District: ${DISTRICT_NAME} (${DISTRICT_ID})${NC}"
if [ "$DRY_RUN" = true ]; then
echo -e "${YELLOW}║  MODE: DRY RUN (no actual uploads)                            ║${NC}"
fi
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

# Verify gsutil is configured
if ! gsutil ls "$BUCKET" > /dev/null 2>&1; then
    print_error "Cannot access bucket: $BUCKET"
    print_info "Make sure gsutil is configured with Firebase project access"
    exit 1
fi

print_success "Connected to: $BUCKET"

# Run uploads
if [ "$UPLOAD_ALL" = true ] || [ "$UPLOAD_CHARTS" = true ]; then
    upload_charts "$DISTRICT_ID"
fi

if [ "$UPLOAD_ALL" = true ] || [ "$UPLOAD_BASEMAP" = true ]; then
    upload_basemap "$DISTRICT_ID"
fi

if [ "$UPLOAD_ALL" = true ] || [ "$UPLOAD_SATELLITE" = true ]; then
    upload_satellite "$DISTRICT_ID"
fi

if [ "$UPLOAD_ALL" = true ] || [ "$UPLOAD_GNIS" = true ]; then
    upload_gnis "$DISTRICT_ID"
fi

if [ "$UPLOAD_ALL" = true ]; then
    upload_manifest "$DISTRICT_ID"
fi

# Summary
print_header "Upload Complete"

if [ "$DRY_RUN" = true ]; then
    print_warning "This was a dry run - no files were actually uploaded"
else
    print_success "All files uploaded to: $BUCKET"
    echo ""
    print_info "Next steps:"
    echo "  1. Verify uploads: gsutil ls -lR $BUCKET/$DISTRICT_ID/"
    echo "  2. Update Firestore district document with download manifest"
    echo "  3. Update app to use new storage paths"
fi

echo ""
