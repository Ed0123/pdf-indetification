#!/usr/bin/env bash
# deploy.sh – Build and deploy frontend to Firebase Hosting + backend to Cloud Run
# Usage: ./deploy.sh <GCP_PROJECT_ID> <CLOUD_RUN_REGION>
#   e.g. ./deploy.sh my-firebase-project asia-east1

set -e

PROJECT="${1:?Please pass GCP project ID as first arg}"
REGION="${2:-asia-east1}"
SERVICE="pdf-backend"

echo "=== 1. Build React frontend ==="
cd frontend
npm ci
VITE_API_URL="https://${SERVICE}-$(gcloud run services describe ${SERVICE} --region=${REGION} --project=${PROJECT} --format='value(status.url)' 2>/dev/null | sed 's|https://||' || echo 'YOUR_CLOUD_RUN_URL')" \
  npm run build
cd ..

echo "=== 2. Deploy backend to Cloud Run ==="
STORAGE_BUCKET="${PROJECT}.firebasestorage.app"
gcloud run deploy "${SERVICE}" \
  --source . \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars "STORAGE_BUCKET=${STORAGE_BUCKET}"

BACKEND_URL=$(gcloud run services describe "${SERVICE}" --region="${REGION}" --project="${PROJECT}" --format="value(status.url)")

echo "=== 3. Rebuild frontend with correct API URL ==="
cd frontend
VITE_API_URL="${BACKEND_URL}" npm run build
cd ..

echo "=== 4. Deploy frontend to Firebase Hosting ==="
npx firebase-tools deploy --only hosting --project "${PROJECT}"

echo ""
echo "✅ Done!"
echo "   Frontend : https://${PROJECT}.web.app"
echo "   Backend  : ${BACKEND_URL}"
