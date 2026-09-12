#!/usr/bin/env bash
# Build and deploy the control-plane Lambda's code. Run from the repo root
# or from lambda/ — paths are resolved relative to this script.
#
# One-time setup (IAM role, function creation, Function URL, EventBridge
# schedule) is NOT done by this script — see infra/lambda-setup.md.
# This script only pushes code changes to an already-created function.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CP_DIR="$SCRIPT_DIR/control-plane"
FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-kully-control-plane}"
AWS_REGION_ARG="${LAMBDA_REGION:+--region $LAMBDA_REGION}"
# aws.exe doesn't understand Git Bash's /d/... paths inside a fileb:// URI —
# needs the native D:/... form.
CP_DIR_NATIVE=$(cd "$CP_DIR" && pwd -W 2>/dev/null || echo "$CP_DIR")

echo "== install production deps =="
(cd "$CP_DIR" && npm install --omit=dev)

echo "== copy frontend into public/ =="
rm -rf "$CP_DIR/public"
mkdir -p "$CP_DIR/public"
cp "$SCRIPT_DIR/../web/index.html" "$CP_DIR/public/index.html"
cp "$SCRIPT_DIR/../web/app.js" "$CP_DIR/public/app.js"
cp "$SCRIPT_DIR/../web/style.css" "$CP_DIR/public/style.css"
cp "$SCRIPT_DIR/../web/manifest.json" "$CP_DIR/public/manifest.json"
cp "$SCRIPT_DIR/../web/icon-192.png" "$CP_DIR/public/icon-192.png"
cp "$SCRIPT_DIR/../web/icon-512.png" "$CP_DIR/public/icon-512.png"
cp "$SCRIPT_DIR/../web/apple-touch-icon.png" "$CP_DIR/public/apple-touch-icon.png"

echo "== zip =="
rm -f "$CP_DIR/function.zip"
if command -v zip >/dev/null 2>&1; then
  (cd "$CP_DIR" && zip -r -q function.zip index.mjs package.json node_modules public)
else
  # Windows dev boxes often lack `zip` — fall back to PowerShell's Compress-Archive.
  powershell.exe -NoProfile -Command "Compress-Archive -Path '$CP_DIR_NATIVE/index.mjs','$CP_DIR_NATIVE/package.json','$CP_DIR_NATIVE/node_modules','$CP_DIR_NATIVE/public' -DestinationPath '$CP_DIR_NATIVE/function.zip' -Force"
fi

echo "== deploy =="
aws lambda update-function-code $AWS_REGION_ARG \
  --function-name "$FUNCTION_NAME" \
  --zip-file "fileb://$CP_DIR_NATIVE/function.zip"

echo "Done."
