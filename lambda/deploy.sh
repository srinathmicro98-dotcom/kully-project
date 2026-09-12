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

echo "== install production deps =="
(cd "$CP_DIR" && npm install --omit=dev)

echo "== copy frontend into public/ =="
rm -rf "$CP_DIR/public"
mkdir -p "$CP_DIR/public"
cp "$SCRIPT_DIR/../web/index.html" "$CP_DIR/public/index.html"
cp "$SCRIPT_DIR/../web/app.js" "$CP_DIR/public/app.js"
cp "$SCRIPT_DIR/../web/style.css" "$CP_DIR/public/style.css"

echo "== zip =="
rm -f "$CP_DIR/function.zip"
(cd "$CP_DIR" && zip -r -q function.zip index.mjs package.json node_modules public)

echo "== deploy =="
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file "fileb://$CP_DIR/function.zip"

echo "Done."
