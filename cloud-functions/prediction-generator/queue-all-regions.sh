#!/bin/bash
#
# Queue All Regions - Automated Prediction Generation (Cloud Run Jobs)
#
# Runs prediction generation for all regions sequentially, waiting for each
# to complete before starting the next. Each region runs tides first, then currents
# as SEPARATE Cloud Run Jobs (avoiding 1-hour timeout).
#
# Usage:
#   ./queue-all-regions.sh                    # Process all regions
#   ./queue-all-regions.sh --skip 07cgd       # Skip regions already done
#   ./queue-all-regions.sh --regions "01cgd 05cgd"  # Only specific regions
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
JOB_NAME="prediction-generator-job"
REGION="us-central1"
# Ordered from smallest to largest by total station count (tides + currents)
ALL_REGIONS=("14cgd" "11cgd" "08cgd" "13cgd" "05cgd" "01cgd" "17cgd" "07cgd")
SKIP_REGIONS=()

# Parse arguments
SPECIFIC_REGIONS=()
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip)
            IFS=' ' read -r -a SKIP_REGIONS <<< "$2"
            shift 2
            ;;
        --regions)
            IFS=' ' read -r -a SPECIFIC_REGIONS <<< "$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--skip \"region1 region2\"] [--regions \"region1 region2\"]"
            exit 1
            ;;
    esac
done

# Determine which regions to process
if [[ ${#SPECIFIC_REGIONS[@]} -gt 0 ]]; then
    REGIONS=("${SPECIFIC_REGIONS[@]}")
else
    REGIONS=("${ALL_REGIONS[@]}")
fi

# Filter out skipped regions
if [[ ${#SKIP_REGIONS[@]} -gt 0 ]]; then
    FILTERED_REGIONS=()
    for region in "${REGIONS[@]}"; do
        skip=false
        for skip_region in "${SKIP_REGIONS[@]}"; do
            if [[ "$region" == "$skip_region" ]]; then
                skip=true
                break
            fi
        done
        if [[ "$skip" == false ]]; then
            FILTERED_REGIONS+=("$region")
        fi
    done
    REGIONS=("${FILTERED_REGIONS[@]}")
fi

echo ""
print_info "Queuing ${#REGIONS[@]} region(s) via Cloud Run Jobs: ${REGIONS[*]}"
if [[ ${#SKIP_REGIONS[@]} -gt 0 ]]; then
    print_warning "Skipping: ${SKIP_REGIONS[*]}"
fi
echo ""

# Function to execute a Cloud Run Job and wait for completion
execute_job() {
    local region_id=$1
    local gen_type=$2
    
    print_info "Executing $gen_type job for $region_id..."
    
    # Execute the job with --wait flag (blocks until completion)
    gcloud run jobs execute $JOB_NAME \
        --region $REGION \
        --update-env-vars REGION_ID=$region_id,GEN_TYPE=$gen_type \
        --wait \
        > /tmp/job_${region_id}_${gen_type}.log 2>&1
    
    local exit_code=$?
    
    if [[ $exit_code -eq 0 ]]; then
        print_success "$gen_type complete for $region_id"
        return 0
    else
        print_error "$gen_type failed for $region_id (exit code: $exit_code)"
        print_info "Check logs with: gcloud logging read \"resource.labels.job_name=$JOB_NAME\""
        return 1
    fi
}

# Process each region
START_TIME=$(date +%s)

for region_id in "${REGIONS[@]}"; do
    echo ""
    echo "========================================="
    echo " Region: $region_id"
    echo "========================================="
    
    # Run tides job
    if ! execute_job "$region_id" "tides"; then
        print_warning "Skipping currents for $region_id due to tide failure"
        continue
    fi
    
    echo ""
    
    # Run currents job
    if ! execute_job "$region_id" "currents"; then
        print_warning "Currents failed for $region_id, continuing to next region"
    fi
done

# Summary
TOTAL_TIME=$(($(date +%s) - START_TIME))
echo ""
echo "========================================="
print_success "All regions complete!"
echo "Total time: $((TOTAL_TIME / 60)) minutes"
echo "========================================="
