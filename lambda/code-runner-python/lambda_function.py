# Ephemeral, isolated code execution for the dev agent's "run_code" tool.
# This function's IAM role can ONLY read/write/list the one S3 workspace
# bucket -- no access to Kully's Supabase/Groq/AWS-control secrets at all.
import base64
import json
import os
import shutil
import subprocess

import boto3

s3 = boto3.client("s3")
BUCKET = os.environ["WORKSPACE_BUCKET"]
WORKDIR = "/tmp/workspace"
MAX_OUTPUT = 4000


def truncate(s):
    return s if len(s) <= MAX_OUTPUT else s[:MAX_OUTPUT] + "\n… (truncated)"


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def download_workspace(user_id):
    if os.path.exists(WORKDIR):
        shutil.rmtree(WORKDIR)
    os.makedirs(WORKDIR, exist_ok=True)

    prefix = f"{user_id}/"
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            rel = obj["Key"][len(prefix):]
            if not rel:
                continue
            dest = os.path.join(WORKDIR, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            s3.download_file(BUCKET, obj["Key"], dest)


def upload_workspace(user_id):
    prefix = f"{user_id}/"
    for root, _dirs, files in os.walk(WORKDIR):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, WORKDIR).replace(os.sep, "/")
            s3.upload_file(full, BUCKET, prefix + rel)


def lambda_handler(event, _context):
    headers = event.get("headers") or {}
    secret = headers.get("x-code-runner-secret") or headers.get("X-Code-Runner-Secret")
    if secret != os.environ.get("CODE_RUNNER_SECRET"):
        return response(401, {"error": "unauthorized"})

    try:
        body_raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            body_raw = base64.b64decode(body_raw).decode("utf-8")
        payload = json.loads(body_raw)
    except Exception:
        return response(400, {"error": "invalid body"})

    code = payload.get("code")
    user_id = payload.get("user_id")
    if not isinstance(code, str) or not isinstance(user_id, str):
        return response(400, {"error": "code and user_id are required"})

    try:
        download_workspace(user_id)
        with open(os.path.join(WORKDIR, "main.py"), "w") as f:
            f.write(code)

        timed_out = False
        try:
            result = subprocess.run(
                ["python3", "main.py"],
                cwd=WORKDIR,
                timeout=10,
                capture_output=True,
                text=True,
            )
            stdout, stderr, exit_code = result.stdout, result.stderr, result.returncode
        except subprocess.TimeoutExpired as e:
            stdout = e.stdout or ""
            stderr = (e.stderr or "") + "\nExecution timed out."
            exit_code = 1
            timed_out = True

        upload_workspace(user_id)

        return response(200, {
            "stdout": truncate(stdout),
            "stderr": truncate(stderr),
            "exitCode": exit_code,
            "timedOut": timed_out,
        })
    except Exception as e:
        return response(500, {"error": str(e)})
