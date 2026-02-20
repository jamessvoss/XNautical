#!/bin/bash
# Regenerate download-metadata.json for all districts (or a specific one).
# This reads actual file sizes from Firebase Storage and updates the metadata
# that the app uses to display download sizes.
#
# Usage:
#   ./scripts/regenerate-metadata.sh           # All districts
#   ./scripts/regenerate-metadata.sh 05cgd     # Single district
#   ./scripts/regenerate-metadata.sh 05cgd 17cgd  # Multiple districts

set -euo pipefail

SERVICE_URL="https://generate-district-metadata-f2plukcj3a-uc.a.run.app"
ALL_DISTRICTS=("01cgd" "05cgd" "07cgd" "08cgd" "09cgd" "11cgd" "13cgd" "14cgd" "17cgd")

# Get ID token for authenticated Cloud Run request
TOKEN=$(gcloud auth print-identity-token 2>/dev/null) || {
  echo "Error: Could not get identity token. Run: gcloud auth login"
  exit 1
}

# Determine which districts to process
if [ $# -gt 0 ]; then
  DISTRICTS=("$@")
else
  DISTRICTS=("${ALL_DISTRICTS[@]}")
fi

echo "Regenerating metadata for ${#DISTRICTS[@]} district(s)..."
echo ""

FAILURES=0

for district in "${DISTRICTS[@]}"; do
  echo -n "  ${district}: "

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "${SERVICE_URL}/generateMetadata" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"districtId\": \"${district}\"}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "200" ]; then
    SIZE=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalSizeGB','?'))" 2>/dev/null || echo "?")
    PACKS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('packCount','?'))" 2>/dev/null || echo "?")
    echo "OK - ${SIZE} GB, ${PACKS} packs"
  else
    echo "FAILED (HTTP ${HTTP_CODE})"
    echo "    ${BODY}" | head -3
    FAILURES=$((FAILURES + 1))
  fi
done

echo ""
if [ $FAILURES -gt 0 ]; then
  echo "Done with ${FAILURES} failure(s)."
  exit 1
else
  echo "Done. All districts updated successfully."
fi
