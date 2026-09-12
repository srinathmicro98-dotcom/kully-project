#!/usr/bin/env bash
# Build and deploy both code-runner Lambdas' code (assumes the functions
# already exist — one-time creation is a separate step, done via CLI).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_REGION_ARG="${LAMBDA_REGION:+--region $LAMBDA_REGION}"

echo "== node runner =="
NODE_DIR="$SCRIPT_DIR/code-runner-node"
(cd "$NODE_DIR" && npm install --omit=dev)
NODE_DIR_NATIVE=$(cd "$NODE_DIR" && pwd -W 2>/dev/null || echo "$NODE_DIR")
rm -f "$NODE_DIR/function.zip"
if command -v zip >/dev/null 2>&1; then
  (cd "$NODE_DIR" && zip -r -q function.zip index.mjs package.json node_modules)
else
  powershell.exe -NoProfile -Command "Compress-Archive -Path '$NODE_DIR_NATIVE/index.mjs','$NODE_DIR_NATIVE/package.json','$NODE_DIR_NATIVE/node_modules' -DestinationPath '$NODE_DIR_NATIVE/function.zip' -Force"
fi
aws lambda update-function-code $AWS_REGION_ARG \
  --function-name kully-code-runner-node \
  --zip-file "fileb://$NODE_DIR_NATIVE/function.zip"

echo "== python runner =="
PY_DIR="$SCRIPT_DIR/code-runner-python"
PY_DIR_NATIVE=$(cd "$PY_DIR" && pwd -W 2>/dev/null || echo "$PY_DIR")
rm -f "$PY_DIR/function.zip"
if command -v zip >/dev/null 2>&1; then
  (cd "$PY_DIR" && zip -q function.zip lambda_function.py)
else
  powershell.exe -NoProfile -Command "Compress-Archive -Path '$PY_DIR_NATIVE/lambda_function.py' -DestinationPath '$PY_DIR_NATIVE/function.zip' -Force"
fi
aws lambda update-function-code $AWS_REGION_ARG \
  --function-name kully-code-runner-python \
  --zip-file "fileb://$PY_DIR_NATIVE/function.zip"

echo "Done."
