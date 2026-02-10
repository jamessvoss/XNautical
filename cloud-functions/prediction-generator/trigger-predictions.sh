#!/bin/bash
#
# Prediction Generator Helper Script (Cloud Run Jobs)
# 
# Triggers NOAA prediction generation for Coast Guard districts via Cloud Run Jobs.
# Tides and currents MUST be run as separate jobs to avoid timeout.
#
# Usage:
#   ./trigger-predictions.sh <regionId> [type] [maxStations]
#   ./trigger-predictions.sh <regionId> clear-lock
#
# Arguments:
#   regionId     - Coast Guard district ID (e.g., 07cgd, 17cgd, 01cgd)
#   type         - Required: "tides" or "currents" (NO "all" support - run separately!)
#   maxStations  - Optional: limit stations for testing (e.g., 10)
#   clear-lock   - Manually clear a stale lock
#
# Examples:
#   ./trigger-predictions.sh 07cgd tides              # Generate tides only
#   ./trigger-predictions.sh 07cgd currents           # Generate currents only
#   ./trigger-predictions.sh 07cgd tides 10           # TEST: Generate only 10 tide stations
#   ./trigger-predictions.sh 07cgd clear-lock         # Clear stale lock
#

set -e

# Configuration
JOB_NAME="prediction-generator-job"
REGION="us-central1"
SERVICE_URL="https://prediction-generator-653355603694.us-central1.run.app"
VALID_REGIONS=("01cgd" "05cgd" "07cgd" "08cgd" "09cgd" "11cgd" "13cgd" "14cgd" "17cgd")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored message
print_info() { echo -e "${BLUE}ℹ ${NC}$1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }

# Print usage
usage() {
    echo "Usage: $0 <regionId> [type|clear-lock]"
    echo ""
    echo "Arguments:"
    echo "  regionId    Coast Guard district ID (${VALID_REGIONS[*]})"
    echo "  type        'tides' or 'currents' (NO 'all' support - run separately!)"
    echo "  clear-lock  Manually clear a stale lock (use when crashed/hung)"
    echo ""
    echo "Examples:"
    echo "  $0 07cgd tides        # Generate tides only"
    echo "  $0 07cgd currents     # Generate currents only"
    echo "  $0 07cgd clear-lock   # Force-clear stale lock"
    exit 1
}

# Validate region ID
validate_region() {
    local region=$1
    for valid in "${VALID_REGIONS[@]}"; do
        if [[ "$valid" == "$region" ]]; then
            return 0
        fi
    done
    return 1
}

# Get auth token
get_token() {
    TOKEN=$(gcloud auth print-identity-token 2>/dev/null)
    if [[ -z "$TOKEN" ]]; then
        print_error "Failed to get authentication token"
        echo "Run: gcloud auth login"
        exit 1
    fi
    echo "$TOKEN"
}

# Clear lock (uses Service endpoint, not Job)
clear_lock() {
    local region_id=$1
    local token=$2
    
    print_warning "Clearing lock for $region_id..."
    print_warning "This will force-reset the lock even if a job is actually running!"
    read -p "Are you sure? (y/N): " confirm
    
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        print_info "Cancelled"
        exit 0
    fi
    
    response=$(curl -s -w "\n%{http_code}" -X POST "${SERVICE_URL}/clear-lock" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        -d "{\"regionId\": \"${region_id}\"}")
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [[ "$http_code" == "200" ]]; then
        print_success "Lock cleared for $region_id"
        echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    else
        print_error "Failed to clear lock (HTTP $http_code)"
        echo "$body"
        exit 1
    fi
}

# Trigger generation via Cloud Run Job
trigger_generation() {
    local region_id=$1
    local gen_type=$2
    local max_stations=$3
    
    print_info "Region: $region_id"
    print_info "Type: $gen_type"
    
    if [[ -n "$max_stations" ]]; then
        print_warning "TEST MODE: Limited to $max_stations stations"
    fi
    
    # Estimate duration
    if [[ -n "$max_stations" ]]; then
        print_warning "Estimated duration: 2-5 minutes (testing with $max_stations stations)"
    else
        case $gen_type in
            tides)
                print_info "Estimated duration: 40-50 minutes (large regions)"
                ;;
            currents)
                print_info "Estimated duration: 20-25 minutes (large regions)"
                ;;
        esac
    fi
    
    echo ""
    print_info "Executing Cloud Run Job..."
    
    # Build env vars
    local env_vars="REGION_ID=${region_id},GEN_TYPE=${gen_type}"
    if [[ -n "$max_stations" ]]; then
        env_vars="${env_vars},MAX_STATIONS=${max_stations}"
    fi
    
    # Execute the job with --wait (blocks until completion)
    gcloud run jobs execute $JOB_NAME \
        --region $REGION \
        --update-env-vars "$env_vars" \
        --wait
    
    local exit_code=$?
    
    if [[ $exit_code -eq 0 ]]; then
        print_success "Job completed successfully!"
        echo ""
        print_info "Files uploaded to Firebase Storage:"
        echo "  • ${region_id}/predictions/${gen_type}_${region_id}.db.zip"
        echo "  • ${region_id}/predictions/${gen_type}_stations.json"
        echo "  • ${region_id}/predictions/${gen_type}_raw.json"
        
        if [[ "$gen_type" == "tides" ]]; then
            echo ""
            print_info "Next step: Run currents"
            echo "  $0 $region_id currents"
        fi
    else
        print_error "Job failed (exit code: $exit_code)"
        echo ""
        print_info "Check logs with:"
        echo "  gcloud logging read \"resource.labels.job_name=$JOB_NAME\" --limit 50"
        exit 1
    fi
}

# Main
main() {
    # Check arguments
    if [[ $# -lt 2 ]]; then
        usage
    fi
    
    REGION_ID=$1
    TYPE=$2
    MAX_STATIONS=${3:-}
    
    # Validate region
    if ! validate_region "$REGION_ID"; then
        print_error "Invalid region: $REGION_ID"
        echo "Valid regions: ${VALID_REGIONS[*]}"
        exit 1
    fi
    
    # Get auth token (needed for clear-lock)
    TOKEN=$(get_token)
    
    # Validate type
    case $TYPE in
        tides|currents)
            trigger_generation "$REGION_ID" "$TYPE" "$MAX_STATIONS"
            ;;
        clear-lock)
            clear_lock "$REGION_ID" "$TOKEN"
            ;;
        *)
            print_error "Invalid type: $TYPE"
            echo "Valid types: tides, currents, clear-lock"
            echo "NOTE: 'all' is no longer supported - run tides and currents separately!"
            exit 1
            ;;
    esac
}

main "$@"
