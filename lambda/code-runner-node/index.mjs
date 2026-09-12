// Ephemeral, isolated code execution for the dev agent's "run_code" tool.
// This function's IAM role can ONLY read/write/list the one S3 workspace
// bucket — no access to Kully's Supabase/Groq/AWS-control secrets at all.
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const s3 = new S3Client({});
const BUCKET = process.env.WORKSPACE_BUCKET;
const WORKDIR = '/tmp/workspace';
const MAX_OUTPUT = 4000;

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function truncate(s) {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n… (truncated)` : s;
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function downloadWorkspace(userId) {
  fs.rmSync(WORKDIR, { recursive: true, force: true });
  fs.mkdirSync(WORKDIR, { recursive: true });

  const prefix = `${userId}/`;
  const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
  for (const obj of list.Contents ?? []) {
    const rel = obj.Key.slice(prefix.length);
    if (!rel) continue;
    const dest = path.join(WORKDIR, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
    fs.writeFileSync(dest, await streamToString(got.Body));
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

async function uploadWorkspace(userId) {
  const prefix = `${userId}/`;
  for (const file of walk(WORKDIR)) {
    const rel = path.relative(WORKDIR, file).replace(/\\/g, '/');
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: prefix + rel, Body: fs.readFileSync(file) }));
  }
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

  const { code, user_id: userId } = payload;
  if (typeof code !== 'string' || typeof userId !== 'string') {
    return json(400, { error: 'code and user_id are required' });
  }

  try {
    await downloadWorkspace(userId);
    fs.writeFileSync(path.join(WORKDIR, 'main.js'), code);

    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let timedOut = false;
    try {
      stdout = execFileSync('node', ['main.js'], {
        cwd: WORKDIR,
        timeout: 10000,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err) {
      stdout = err.stdout ? err.stdout.toString() : '';
      stderr = err.stderr ? err.stderr.toString() : String(err.message);
      exitCode = typeof err.status === 'number' ? err.status : 1;
      timedOut = err.signal === 'SIGTERM';
    }

    await uploadWorkspace(userId);

    return json(200, { stdout: truncate(stdout), stderr: truncate(stderr), exitCode, timedOut });
  } catch (err) {
    return json(500, { error: String(err) });
  }
};
