#!/usr/bin/env bash
# Build and deploy the db-backup Lambda's code (assumes the function already
# exists — one-time creation is a separate step, done via CLI).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_REGION_ARG="${LAMBDA_REGION:+--region $LAMBDA_REGION}"

DIR="$SCRIPT_DIR/db-backup"
(cd "$DIR" && npm install --omit=dev)
DIR_NATIVE=$(cd "$DIR" && pwd -W 2>/dev/null || echo "$DIR")
rm -f "$DIR/function.zip"
if command -v zip >/dev/null 2>&1; then
  (cd "$DIR" && zip -r -q function.zip index.mjs package.json node_modules)
else
  powershell.exe -NoProfile -Command "Compress-Archive -Path '$DIR_NATIVE/index.mjs','$DIR_NATIVE/package.json','$DIR_NATIVE/node_modules' -DestinationPath '$DIR_NATIVE/function.zip' -Force"
fi
aws lambda update-function-code $AWS_REGION_ARG \
  --function-name kully-db-backup \
  --zip-file "fileb://$DIR_NATIVE/function.zip"

echo "Done."
