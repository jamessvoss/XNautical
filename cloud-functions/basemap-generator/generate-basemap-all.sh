#!/bin/bash
#
# Generate Basemap Vector Tiles for Multiple Districts
#
# Downloads OpenMapTiles-format PBF vector tiles from VersaTiles and packages
# them into MBTiles files for offline use. Uses coastal buffering (50nm) to
# minimize tile counts.
#
# Usage:
#   ./generate-basemap-all.sh                    # Process all 5 districts
#   ./generate-basemap-all.sh 01 05 08          # Process specific districts
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() { echo -e "${BLUE}ℹ ${NC}$1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }

# Configuration
BASEMAP_URL="https://basemap-generator-653355603694.us-central1.run.app"

# Districts to process (01, 05, 08, 13, 14)
if [ $# -eq 0 ]; then
    DISTRICTS=("01" "05" "08" "13" "14")
else
    DISTRICTS=("$@")
fi

echo ""
print_info "Generating basemap tiles for ${#DISTRICTS[@]} district(s): ${DISTRICTS[*]}"
print_info "This will download OpenMapTiles PBF vector tiles from VersaTiles (zoom 0-14)"
print_info "Using 50nm coastal buffer to minimize tile counts"
echo ""

# Get auth token
print_info "Getting authentication token..."
TOKEN=$(gcloud auth print-identity-token 2>/dev/null)
if [ -z "$TOKEN" ]; then
    print_error "Failed to get authentication token"
    echo "Run: gcloud auth login"
    exit 1
fi
print_success "Token obtained"

START_TIME=$(date +%s)

for DISTRICT in "${DISTRICTS[@]}"; do
    echo ""
    echo "========================================="
    echo " District: ${DISTRICT}cgd"
    echo "========================================="
    
    REGION_ID="${DISTRICT}cgd"
    
    # Step 1: Get estimate
    print_info "Step 1: Estimating tile counts..."
    
    estimate_response=$(curl -s "${BASEMAP_URL}/estimate?regionId=${REGION_ID}&bufferNm=50" \
        -H "Authorization: Bearer ${TOKEN}" \
        2>&1)
    
    echo "$estimate_response" | python3 -m json.tool 2>/dev/null || echo "$estimate_response"
    
    total_tiles=$(echo "$estimate_response" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('totalTiles', 0))" 2>/dev/null || echo "unknown")
    
    if [[ "$total_tiles" != "unknown" && "$total_tiles" != "0" ]]; then
        print_info "Estimated tiles: $total_tiles"
    fi
    
    echo ""
    
    # Step 2: Generate basemap tiles
    print_info "Step 2: Generating basemap tiles (this may take 30-120 minutes)..."
    print_warning "Progress will be logged to Cloud Run, no local progress shown"
    print_info "Monitor at: https://console.cloud.google.com/run/detail/us-central1/basemap-generator"
    
    response=$(curl -s -w "\n%{http_code}" -X POST "${BASEMAP_URL}/generate" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"regionId\": \"${REGION_ID}\", \"bufferNm\": 50}" \
        --max-time 10 \
        2>&1)
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [[ "$http_code" == "200" ]] || [[ "$http_code" == "000" ]]; then
        print_success "Basemap generation started for ${REGION_ID}"
        echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    else
        print_error "Failed to start generation (HTTP $http_code)"
        echo "$body"
        continue
    fi
    
    # Step 3: Wait for completion (poll status)
    print_info "Step 3: Waiting for completion..."
    
    max_wait=7200  # 2 hours
    poll_interval=60  # Check every minute
    elapsed=0
    
    while [ $elapsed -lt $max_wait ]; do
        sleep $poll_interval
        elapsed=$((elapsed + poll_interval))
        
        status_response=$(curl -s "${BASEMAP_URL}/status?regionId=${REGION_ID}" \
            -H "Authorization: Bearer ${TOKEN}" \
            2>&1)
        
        state=$(echo "$status_response" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('basemapStatus', {}).get('state', 'unknown'))" 2>/dev/null || echo "unknown")
        
        if [[ "$state" == "complete" ]]; then
            print_success "Basemap generation complete for ${REGION_ID}"
            echo "$status_response" | python3 -m json.tool 2>/dev/null
            break
        elif [[ "$state" == "failed" ]]; then
            print_error "Basemap generation failed for ${REGION_ID}"
            echo "$status_response" | python3 -m json.tool 2>/dev/null
            break
        elif [[ "$state" == "generating" ]]; then
            progress=$(echo "$status_response" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('basemapStatus', {}).get('progress', 'N/A'))" 2>/dev/null || echo "N/A")
            print_info "[${elapsed}s / ${max_wait}s] Status: $state, Progress: $progress"
        else
            print_info "[${elapsed}s] Status: $state"
        fi
    done
    
    if [ $elapsed -ge $max_wait ]; then
        print_warning "Timeout waiting for ${REGION_ID} (likely still processing)"
        print_info "Check status later: curl \"${BASEMAP_URL}/status?regionId=${REGION_ID}\""
    fi
done

# Summary
TOTAL_TIME=$(($(date +%s) - START_TIME))
echo ""
echo "========================================="
print_success "Basemap generation initiated for all districts!"
echo "Total script time: $((TOTAL_TIME / 60)) minutes"
echo "========================================="
echo ""
print_info "Basemap tiles will be available in Firebase Storage:"
for DISTRICT in "${DISTRICTS[@]}"; do
    echo "  • ${DISTRICT}cgd/basemap/basemap_z0-5.mbtiles"
    echo "  • ${DISTRICT}cgd/basemap/basemap_z{6..14}.mbtiles"
done
echo ""
print_info "Monitor progress:"
echo "  • Cloud Console: https://console.cloud.google.com/run/detail/us-central1/basemap-generator"
echo "  • Logs: gcloud logging read \"resource.labels.service_name=basemap-generator\" --limit 50"
