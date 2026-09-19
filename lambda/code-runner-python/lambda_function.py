# Ephemeral, isolated code execution for the dev agent's tools. This
# function's IAM role can ONLY read/write/list the one S3 workspace bucket --
# no access to Kully's Supabase/Groq/AWS-control secrets at all.
import base64
import json
import os
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor

import boto3

s3 = boto3.client("s3")
BUCKET = os.environ["WORKSPACE_BUCKET"]
WORKDIR = "/tmp/workspace"
MAX_OUTPUT = 4000
EXEC_TIMEOUT_SECONDS = 100  # Lambda's own timeout is set higher, leaving headroom for S3 sync.

# Dependency/vendor/VCS directories are never synced to/from S3 -- with real
# pip/npm installs these can be thousands of small files, which would blow
# past any timeout doing one-at-a-time S3 calls. Reinstall them per call
# instead (e.g. "pip install -r requirements.txt && pytest" in one
# run_shell) rather than trying to persist them.
EXCLUDE_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next", ".cache"}


def is_excluded(rel_path):
    return any(seg in EXCLUDE_DIRS for seg in rel_path.split("/"))


def truncate(s):
    return s if len(s) <= MAX_OUTPUT else s[:MAX_OUTPUT] + "\n… (truncated)"


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def prefix_for(user_id, project):
    return f"{user_id}/{project or 'default'}/"


def download_workspace(prefix):
    if os.path.exists(WORKDIR):
        shutil.rmtree(WORKDIR)
    os.makedirs(WORKDIR, exist_ok=True)

    keys = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            rel = obj["Key"][len(prefix):]
            if rel and not is_excluded(rel):
                keys.append(obj["Key"])

    def fetch(key):
        rel = key[len(prefix):]
        dest = os.path.join(WORKDIR, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        s3.download_file(BUCKET, key, dest)

    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(fetch, keys))


def upload_workspace(prefix):
    files = []
    for root, _dirs, names in os.walk(WORKDIR):
        for name in names:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, WORKDIR).replace(os.sep, "/")
            if not is_excluded(rel):
                files.append((full, rel))

    def push(item):
        full, rel = item
        s3.upload_file(full, BUCKET, prefix + rel)

    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(push, files))


def resolve_in_workdir(rel_path):
    resolved = os.path.abspath(os.path.join(WORKDIR, rel_path))
    if not resolved.startswith(os.path.abspath(WORKDIR)):
        raise ValueError("path escapes the workspace")
    return resolved


def list_files():
    if not os.path.exists(WORKDIR):
        return {"files": []}
    files = []
    for root, _dirs, names in os.walk(WORKDIR):
        for name in names:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, WORKDIR).replace(os.sep, "/")
            if not is_excluded(rel):
                files.append(rel)
    return {"files": files}


# pip (and some other tools) need a writable HOME to write their own config/
# cache/logs -- the Lambda execution user's real home isn't writable.
SANDBOX_ENV = {**os.environ, "HOME": "/tmp"}


def do_run(code):
    with open(os.path.join(WORKDIR, "main.py"), "w") as f:
        f.write(code)
    try:
        result = subprocess.run(
            ["python3", "main.py"], cwd=WORKDIR, timeout=EXEC_TIMEOUT_SECONDS, capture_output=True, text=True,
            env=SANDBOX_ENV,
        )
        return {
            "stdout": truncate(result.stdout),
            "stderr": truncate(result.stderr),
            "exitCode": result.returncode,
            "timedOut": False,
        }
    except subprocess.TimeoutExpired as e:
        return {
            "stdout": truncate(e.stdout or ""),
            "stderr": truncate((e.stderr or "") + "\nExecution timed out."),
            "exitCode": 1,
            "timedOut": True,
        }


def do_run_shell(command):
    try:
        result = subprocess.run(
            command, shell=True, cwd=WORKDIR, timeout=EXEC_TIMEOUT_SECONDS, capture_output=True, text=True,
            env=SANDBOX_ENV,
        )
        return {
            "stdout": truncate(result.stdout),
            "stderr": truncate(result.stderr),
            "exitCode": result.returncode,
            "timedOut": False,
        }
    except subprocess.TimeoutExpired as e:
        return {
            "stdout": truncate(e.stdout or ""),
            "stderr": truncate((e.stderr or "") + "\nExecution timed out."),
            "exitCode": 1,
            "timedOut": True,
        }


def do_read_file(rel_path, encoding=None):
    full = resolve_in_workdir(rel_path)
    if not os.path.exists(full):
        return {"error": f"no such file: {rel_path}"}
    if encoding == "base64":
        with open(full, "rb") as f:
            return {"content": base64.b64encode(f.read()).decode("ascii"), "encoding": "base64"}
    with open(full, "r") as f:
        return {"content": truncate(f.read())}


def do_write_file(rel_path, content, encoding=None):
    full = resolve_in_workdir(rel_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    if encoding == "base64":
        with open(full, "wb") as f:
            f.write(base64.b64decode(content or ""))
    else:
        with open(full, "w") as f:
            f.write(content or "")
    return {"ok": True}


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

    action = payload.get("action", "run")
    user_id = payload.get("user_id")
    project = payload.get("project")
    encoding = payload.get("encoding")
    if not isinstance(user_id, str):
        return response(400, {"error": "user_id is required"})

    prefix = prefix_for(user_id, project)

    try:
        download_workspace(prefix)

        if action == "run":
            code = payload.get("code")
            if not isinstance(code, str):
                return response(400, {"error": "code is required for action=run"})
            result = do_run(code)
        elif action == "run_shell":
            command = payload.get("command")
            if not isinstance(command, str):
                return response(400, {"error": "command is required for action=run_shell"})
            result = do_run_shell(command)
        elif action == "read_file":
            rel_path = payload.get("path")
            if not isinstance(rel_path, str):
                return response(400, {"error": "path is required for action=read_file"})
            result = do_read_file(rel_path, encoding)
        elif action == "write_file":
            rel_path = payload.get("path")
            if not isinstance(rel_path, str):
                return response(400, {"error": "path is required for action=write_file"})
            result = do_write_file(rel_path, payload.get("content"), encoding)
        elif action == "list_files":
            result = list_files()
        else:
            return response(400, {"error": f"unknown action: {action}"})

        upload_workspace(prefix)
        return response(200, result)
    except Exception as e:
        return response(500, {"error": str(e)})
