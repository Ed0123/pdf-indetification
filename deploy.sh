#!/usr/bin/env bash
# deploy.sh – Build and deploy frontend to Firebase Hosting + backend to Cloud Run
#
# This script is invoked by human or by our AI deployment agent.  It performs
# a full release: builds the React frontend, deploys the Python backend to
# Cloud Run, then publishes the frontend to Firebase Hosting.
#
# IMPORTANT: the backend uses Gmail SMTP for notification emails.  Three
# environment variables **must** be provided in the shell before running this
# script or via a preceding `gcloud run services update` call:
#
#     GMAIL_USER           – sender address (mcqshk@gmail.com)
#     GMAIL_APP_PASSWORD   – 16‑character App Password (Google Account > Security > App Passwords)
#     ADMIN_NOTIFY_EMAIL   – (optional) recipient for new-user alerts; default is GMAIL_USER
#     DEPLOY_UPDATE_TOKEN  – (optional) token for posting deploy update notes
#
# Optional deploy note env vars:
#     DEPLOY_UPDATE_HEADING  – update heading (default: 系統更新)
#     DEPLOY_UPDATE_TEXT     – simple Chinese summary for end users
#
# If the agent runs this script, it must set those vars (or the run will
# succeed but email functionality will be disabled); the script itself will
# remind and then automatically persist them to the Cloud Run service.
#
# Usage: ./deploy.sh <GCP_PROJECT_ID> <CLOUD_RUN_REGION>
#   e.g. ./deploy.sh my-firebase-project asia-east1

set -e

PROJECT="${1:?Please pass GCP project ID as first arg}"
REGION="${2:-asia-east1}"
SERVICE="pdf-backend"

echo "=== 0. Sync Firestore schema defaults ==="
if [[ "${SKIP_FIREBASE_SCHEMA_SYNC:-0}" == "1" ]]; then
  echo "Skip schema sync (SKIP_FIREBASE_SCHEMA_SYNC=1)."
else
  python3 -m backend.scripts.firebase_schema_sync
fi

# ensure required Gmail credentials are present; deployment without them will
# result in a working service but with email notifications permanently
# disabled, which confuses our automation.
if [[ -z "$GMAIL_USER" || -z "$GMAIL_APP_PASSWORD" ]]; then
  echo "ERROR: GMAIL_USER and GMAIL_APP_PASSWORD must be set in the environment."
  echo "Set them before running deploy.sh or have the agent provide them."
  exit 1
fi

echo "=== 1. Build React frontend ==="
cd frontend
npm ci
VITE_API_URL="https://${SERVICE}-$(gcloud run services describe ${SERVICE} --region=${REGION} --project=${PROJECT} --format='value(status.url)' 2>/dev/null | sed 's|https://||' || echo 'YOUR_CLOUD_RUN_URL')" \
  npm run build
cd ..

echo "=== 2. Deploy backend to Cloud Run ==="
STORAGE_BUCKET="${PROJECT}.firebasestorage.app"
# gather optional Gmail credentials from environment (must be set manually beforehand)
if [[ -z "$GMAIL_USER" || -z "$GMAIL_APP_PASSWORD" ]]; then
  echo "WARNING: GMAIL_USER and/or GMAIL_APP_PASSWORD not set in environment."
  echo "  Email notifications will be disabled unless you add them later with `gcloud run services update`"
fi
# include ADMIN_NOTIFY_EMAIL if provided
ENV_VARS="STORAGE_BUCKET=${STORAGE_BUCKET}"
[[ -n "$GMAIL_USER" ]] && ENV_VARS="${ENV_VARS},GMAIL_USER=${GMAIL_USER}"
[[ -n "$GMAIL_APP_PASSWORD" ]] && ENV_VARS="${ENV_VARS},GMAIL_APP_PASSWORD=${GMAIL_APP_PASSWORD}"
[[ -n "$ADMIN_NOTIFY_EMAIL" ]] && ENV_VARS="${ENV_VARS},ADMIN_NOTIFY_EMAIL=${ADMIN_NOTIFY_EMAIL}"
[[ -n "$DEPLOY_UPDATE_TOKEN" ]] && ENV_VARS="${ENV_VARS},DEPLOY_UPDATE_TOKEN=${DEPLOY_UPDATE_TOKEN}"

gcloud run deploy "${SERVICE}" \
  --source . \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars "${ENV_VARS}"

# after deploy, reapply env vars to ensure persistence across revisions
if [[ -n "$GMAIL_USER" || -n "$GMAIL_APP_PASSWORD" || -n "$ADMIN_NOTIFY_EMAIL" ]]; then
  echo "Re-applying environment variables to service configuration..."
  gcloud run services update "${SERVICE}" \
    --region "${REGION}" \
    --project "${PROJECT}" \
    --update-env-vars "${ENV_VARS}"
fi

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

if [[ -n "$DEPLOY_UPDATE_TEXT" ]]; then
  if [[ -z "$DEPLOY_UPDATE_TOKEN" ]]; then
    echo "⚠ DEPLOY_UPDATE_TEXT 已提供，但未設定 DEPLOY_UPDATE_TOKEN，略過更新日誌推送。"
  else
    echo "=== 5. Push deploy update note ==="
    HEADING="${DEPLOY_UPDATE_HEADING:-系統更新}"
    NOW_UTC=$(date -u +"%Y-%m-%d %H:%M UTC")
    CONTENT="${NOW_UTC} 更新：${DEPLOY_UPDATE_TEXT}"
    curl -sS -X POST "${BACKEND_URL}/api/system-updates/deploy-push" \
      -H "Content-Type: application/json" \
      -H "X-Deploy-Token: ${DEPLOY_UPDATE_TOKEN}" \
      -d "$(printf '{"heading":"%s","content":"%s"}' "${HEADING//\"/\\\"}" "${CONTENT//\"/\\\"}")" \
      >/dev/null && echo "已推送更新日誌。"
  fi
fi
