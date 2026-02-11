#!/bin/bash
# Deploy Cloud Run Job for ENC scale merging
#
# Usage: ./deploy-merge-job.sh [project-id] [region]
#
# This creates a Cloud Run Job named "enc-converter-merge" that can be executed
# with different memory allocations based on the scale being merged.

set -e

PROJECT_ID="${1:-xnautical-8a296}"
REGION="${2:-us-central1}"
JOB_NAME="enc-converter-merge"
IMAGE="gcr.io/${PROJECT_ID}/enc-converter:latest"
SERVICE_ACCOUNT="${PROJECT_ID%%[^0-9]*}-compute@developer.gserviceaccount.com"

echo "Deploying Cloud Run Job: ${JOB_NAME}"
echo "  Project: ${PROJECT_ID}"
echo "  Region: ${REGION}"
echo "  Image: ${IMAGE}"

# Create/update the job with default settings
# Actual memory/CPU will be set per-execution via overrides
gcloud run jobs create "${JOB_NAME}" \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --service-account="${SERVICE_ACCOUNT}" \
  --max-retries=2 \
  --task-timeout=3600 \
  --memory=32Gi \
  --cpu=8 \
  --set-env-vars="BUCKET_NAME=xnautical-8a296.firebasestorage.app" \
  --command="python3" \
  --args="/app/merge_job.py" \
  2>/dev/null || \
gcloud run jobs update "${JOB_NAME}" \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --service-account="${SERVICE_ACCOUNT}" \
  --max-retries=2 \
  --task-timeout=3600 \
  --memory=32Gi \
  --cpu=8 \
  --set-env-vars="BUCKET_NAME=xnautical-8a296.firebasestorage.app" \
  --command="python3" \
  --args="/app/merge_job.py"

echo ""
echo "✓ Job deployed successfully"
echo ""
echo "To execute the job for a specific scale, use:"
echo "  gcloud run jobs execute ${JOB_NAME} \\"
echo "    --region=${REGION} \\"
echo "    --update-env-vars='DISTRICT_ID=13,SCALE=US5' \\"
echo "    --memory=32Gi \\"
echo "    --cpu=8"
echo ""
echo "Default memory is 32Gi/8CPU to handle all scales."
echo "Minimum memory by scale:"
echo "  US1-US3: 8Gi/2CPU"
echo "  US4:     16Gi/4CPU"
echo "  US5-US6: 32Gi/8CPU"
