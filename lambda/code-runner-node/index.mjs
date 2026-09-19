// Ephemeral, isolated code execution for the dev agent's tools. This
// function's IAM role can ONLY read/write/list the one S3 workspace bucket —
// no access to Kully's Supabase/Groq/AWS-control secrets at all.
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const s3 = new S3Client({});
const BUCKET = process.env.WORKSPACE_BUCKET;
const WORKDIR = '/tmp/workspace';
const MAX_OUTPUT = 4000;
const EXEC_TIMEOUT_MS = 100_000; // Lambda's own timeout is set higher, leaving headroom for S3 sync.

// Dependency/vendor/VCS directories are never synced to/from S3 — with real
// npm/pip installs these can be thousands of small files, which would blow
// past any timeout doing one-at-a-time S3 calls. Reinstall them per call
// instead (e.g. `npm install && npm test` in one run_shell) rather than
// trying to persist them.
const EXCLUDE_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', '.cache']);

function isExcluded(relPath) {
  return relPath.split('/').some((seg) => EXCLUDE_DIRS.has(seg));
}

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function truncate(s) {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n… (truncated)` : s;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function prefixFor(userId, project) {
  return `${userId}/${project || 'default'}/`;
}

async function downloadWorkspace(prefix) {
  fs.rmSync(WORKDIR, { recursive: true, force: true });
  fs.mkdirSync(WORKDIR, { recursive: true });

  const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
  const objects = (list.Contents ?? []).filter((obj) => {
    const rel = obj.Key.slice(prefix.length);
    return rel && !isExcluded(rel);
  });

  await Promise.all(
    objects.map(async (obj) => {
      const rel = obj.Key.slice(prefix.length);
      const dest = path.join(WORKDIR, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
      fs.writeFileSync(dest, await streamToBuffer(got.Body));
    }),
  );
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (isExcluded(rel)) return [];
    return entry.isDirectory() ? walk(full, base) : [full];
  });
}

async function uploadWorkspace(prefix) {
  const files = fs.existsSync(WORKDIR) ? walk(WORKDIR) : [];
  await Promise.all(
    files.map((file) => {
      const rel = path.relative(WORKDIR, file).replace(/\\/g, '/');
      return s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: prefix + rel, Body: fs.readFileSync(file) }));
    }),
  );
}

function resolveInWorkdir(relPath) {
  const resolved = path.resolve(WORKDIR, relPath);
  if (!resolved.startsWith(path.resolve(WORKDIR))) {
    throw new Error('path escapes the workspace');
  }
  return resolved;
}

// npm (and some other tools) need a writable HOME to write their own config/
// cache/logs — the Lambda execution user's real home isn't writable.
const SANDBOX_ENV = { ...process.env, HOME: '/tmp' };

function doRun(code) {
  fs.writeFileSync(path.join(WORKDIR, 'main.js'), code);
  try {
    const stdout = execFileSync('node', ['main.js'], {
      cwd: WORKDIR,
      timeout: EXEC_TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      env: SANDBOX_ENV,
    });
    return { stdout: truncate(stdout), stderr: '', exitCode: 0, timedOut: false };
  } catch (err) {
    return {
      stdout: truncate(err.stdout ? err.stdout.toString() : ''),
      stderr: truncate(err.stderr ? err.stderr.toString() : String(err.message)),
      exitCode: typeof err.status === 'number' ? err.status : 1,
      timedOut: err.signal === 'SIGTERM',
    };
  }
}

function doRunShell(command) {
  try {
    const stdout = execFileSync('/bin/sh', ['-c', command], {
      cwd: WORKDIR,
      timeout: EXEC_TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      env: SANDBOX_ENV,
    });
    return { stdout: truncate(stdout), stderr: '', exitCode: 0, timedOut: false };
  } catch (err) {
    return {
      stdout: truncate(err.stdout ? err.stdout.toString() : ''),
      stderr: truncate(err.stderr ? err.stderr.toString() : String(err.message)),
      exitCode: typeof err.status === 'number' ? err.status : 1,
      timedOut: err.signal === 'SIGTERM',
    };
  }
}

function doReadFile(filePath, encoding) {
  const full = resolveInWorkdir(filePath);
  if (!fs.existsSync(full)) return { error: `no such file: ${filePath}` };
  if (encoding === 'base64') {
    return { content: fs.readFileSync(full).toString('base64'), encoding: 'base64' };
  }
  return { content: truncate(fs.readFileSync(full, 'utf8')) };
}

function doWriteFile(filePath, content, encoding) {
  const full = resolveInWorkdir(filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (encoding === 'base64') {
    fs.writeFileSync(full, Buffer.from(content ?? '', 'base64'));
  } else {
    fs.writeFileSync(full, content ?? '');
  }
  return { ok: true };
}

function doListFiles() {
  if (!fs.existsSync(WORKDIR)) return { files: [] };
  return { files: walk(WORKDIR).map((f) => path.relative(WORKDIR, f).replace(/\\/g, '/')) };
}

export const handler = async (event) => {
  const headers = event.headers || {};
  const secret = headers['x-code-runner-secret'] || headers['X-Code-Runner-Secret'];
  if (secret !== process.env.CODE_RUNNER_SECRET) {
    return json(401, { error: 'unauthorized' });
  }

  const rawBody = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return json(400, { error: 'invalid body' });
  }

  const { action = 'run', user_id: userId, project, code, path: filePath, content, command, encoding } = payload;
  if (typeof userId !== 'string') {
    return json(400, { error: 'user_id is required' });
  }

  const prefix = prefixFor(userId, project);

  try {
    await downloadWorkspace(prefix);

    let result;
    switch (action) {
      case 'run':
        if (typeof code !== 'string') return json(400, { error: 'code is required for action=run' });
        result = doRun(code);
        break;
      case 'run_shell':
        if (typeof command !== 'string') return json(400, { error: 'command is required for action=run_shell' });
        result = doRunShell(command);
        break;
      case 'read_file':
        if (typeof filePath !== 'string') return json(400, { error: 'path is required for action=read_file' });
        result = doReadFile(filePath, encoding);
        break;
      case 'write_file':
        if (typeof filePath !== 'string') return json(400, { error: 'path is required for action=write_file' });
        result = doWriteFile(filePath, content, encoding);
        break;
      case 'list_files':
        result = doListFiles();
        break;
      default:
        return json(400, { error: `unknown action: ${action}` });
    }

    await uploadWorkspace(prefix);
    return json(200, result);
  } catch (err) {
    return json(500, { error: String(err) });
  }
};
