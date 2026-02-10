#!/bin/bash
#
# Download ENC sources and convert to MBTiles for multiple districts
#
# Usage:
#   ./download-and-convert-all.sh                    # Process all 5 districts
#   ./download-and-convert-all.sh 01 05 08          # Process specific districts
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
DOWNLOADER_URL="https://enc-downloader-653355603694.us-central1.run.app"
CONVERTER_JOB="enc-converter"
REGION="us-central1"

# Districts to process (01, 05, 08, 13, 14)
if [ $# -eq 0 ]; then
    DISTRICTS=("01" "05" "08" "13" "14")
else
    DISTRICTS=("$@")
fi

echo ""
print_info "Processing ${#DISTRICTS[@]} district(s): ${DISTRICTS[*]}"
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
    
    # Step 1: Download ENC sources
    print_info "Step 1: Downloading ENC sources from NOAA..."
    
    response=$(curl -s -w "\n%{http_code}" -X POST "${DOWNLOADER_URL}/download" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"districtId\": \"${DISTRICT}\"}" \
        2>&1)
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [[ "$http_code" == "200" ]]; then
        print_success "ENC sources downloaded"
        echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    else
        print_error "Failed to download ENC sources (HTTP $http_code)"
        echo "$body"
        continue
    fi
    
    echo ""
    
    # Step 2: Convert to MBTiles using Cloud Run Job
    print_info "Step 2: Converting to MBTiles (this may take 20-60 minutes)..."
    
    gcloud run jobs execute $CONVERTER_JOB \
        --region $REGION \
        --update-env-vars DISTRICT_ID=${DISTRICT} \
        --wait
    
    exit_code=$?
    
    if [[ $exit_code -eq 0 ]]; then
        print_success "Conversion complete for ${DISTRICT}cgd"
        print_info "Chart packs uploaded to: ${DISTRICT}cgd/charts/"
    else
        print_error "Conversion failed for ${DISTRICT}cgd (exit code: $exit_code)"
        print_info "Check logs: gcloud logging read \"resource.labels.job_name=$CONVERTER_JOB\""
    fi
done

# Summary
TOTAL_TIME=$(($(date +%s) - START_TIME))
echo ""
echo "========================================="
print_success "All districts processed!"
echo "Total time: $((TOTAL_TIME / 60)) minutes"
echo "========================================="
echo ""
print_info "Chart packs are now available in Firebase Storage:"
for DISTRICT in "${DISTRICTS[@]}"; do
    echo "  • ${DISTRICT}cgd/charts/pack-US{1,2,3,4,5,6}.mbtiles.zip"
done
