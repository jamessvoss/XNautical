#!/bin/bash
# Deploy generate-district-metadata service to Cloud Run

set -e

PROJECT_ID="xnautical-8a296"
SERVICE_NAME="generate-district-metadata"
REGION="us-central1"

echo "Building and deploying $SERVICE_NAME..."

gcloud run deploy $SERVICE_NAME \
  --source . \
  --platform managed \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --set-env-vars BUCKET_NAME=xnautical-8a296.firebasestorage.app

echo "✓ Deployed: $SERVICE_NAME"
