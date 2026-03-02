#!/bin/bash
# Build and deploy an imagery generator with shared code.
#
# Usage:
#   ./build-generator.sh <generator-name> [--deploy]
#
# Examples:
#   ./build-generator.sh ocean-generator
#   ./build-generator.sh basemap-generator --deploy
#   ./build-generator.sh all --deploy          # build and deploy all 4
#
# The shared code (tile_utils.py, config.py) is copied into the generator's
# directory before building, then cleaned up after.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED_DIR="$SCRIPT_DIR/generators-base"
PROJECT_ID="xnautical-8a296"
REGION="us-central1"

GENERATORS=(basemap-generator ocean-generator terrain-generator satellite-generator)

# Clean up shared code copies on interrupt
_cleanup_files=()
cleanup() {
    for f in "${_cleanup_files[@]}"; do
        rm -f "$f" 2>/dev/null
    done
}
trap cleanup EXIT INT TERM

# Parse args
DEPLOY=false
TARGETS=()
for arg in "$@"; do
    if [ "$arg" = "--deploy" ]; then
        DEPLOY=true
    elif [ "$arg" = "all" ]; then
        TARGETS=("${GENERATORS[@]}")
    else
        TARGETS+=("$arg")
    fi
done

if [ ${#TARGETS[@]} -eq 0 ]; then
    echo "Usage: $0 <generator-name|all> [--deploy]"
    echo "  Generators: ${GENERATORS[*]}"
    exit 1
fi

build_generator() {
    local gen="$1"
    local gen_dir="$SCRIPT_DIR/$gen"

    if [ ! -d "$gen_dir" ]; then
        echo "ERROR: Generator directory not found: $gen_dir"
        return 1
    fi

    echo "=== Building $gen ==="

    # Regenerate config.py from regions.json (single source of truth)
    local repo_root="$SCRIPT_DIR/.."
    local codegen="$repo_root/scripts/generate-config-py.py"
    if [ -f "$codegen" ]; then
        echo "  Regenerating config.py from regions.json..."
        python3 "$codegen" --output "$SHARED_DIR/config.py"
    else
        echo "WARNING: codegen script not found at $codegen, using existing config.py"
    fi

    # Tag image with commit SHA for traceability
    local IMAGE_TAG
    IMAGE_TAG=$(git -C "$repo_root" rev-parse --short HEAD 2>/dev/null || echo "unknown")

    # Copy shared code (registered for cleanup on interrupt)
    cp "$SHARED_DIR/tile_utils.py" "$gen_dir/"
    cp "$SHARED_DIR/config.py" "$gen_dir/"
    _cleanup_files+=("$gen_dir/tile_utils.py" "$gen_dir/config.py")

    # Build via Cloud Build
    (cd "$gen_dir" && gcloud builds submit --config=cloudbuild.yaml \
        --project="$PROJECT_ID")
    local rc=$?

    # Clean up shared code copies
    rm -f "$gen_dir/tile_utils.py" "$gen_dir/config.py"

    if [ $rc -ne 0 ]; then
        echo "ERROR: Build failed for $gen"
        return 1
    fi

    echo "=== Build complete: $gen ==="

    # Deploy if requested
    if [ "$DEPLOY" = true ]; then
        echo "=== Deploying $gen ==="
        gcloud run services update "$gen" \
            --image="gcr.io/$PROJECT_ID/$gen:latest" \
            --region="$REGION" \
            --project="$PROJECT_ID"
        echo "=== Deployed: $gen ==="
    fi
}

# Run builds
for target in "${TARGETS[@]}"; do
    build_generator "$target"
done

echo "Done."
