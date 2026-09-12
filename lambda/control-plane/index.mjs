import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {
  EC2Client,
  StartInstancesCommand,
  StopInstancesCommand,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ec2 = new EC2Client({});

const INSTANCE_ID = process.env.INSTANCE_ID;
const IDLE_TIMEOUT_SECONDS = Number(process.env.IDLE_TIMEOUT_SECONDS || 3600);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function serveStatic(filename) {
  try {
    const filePath = path.join(__dirname, 'public', filename);
    const body = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filename);
    return { statusCode: 200, headers: { 'Content-Type': MIME_TYPES[ext] || 'text/plain' }, body };
  } catch {
    return json(404, { error: 'not found' });
  }
}

function getBearerToken(headers) {
  const auth = headers.authorization || headers.Authorization || '';
  const [scheme, token] = auth.split(' ');
  return scheme === 'Bearer' ? token : null;
}

function requireAuth(headers) {
  const token = getBearerToken(headers);
  if (!token) return false;
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

async function handleLogin(rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return json(400, { error: 'invalid body' });
  }

  const { username, password } = payload;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return json(400, { error: 'username and password are required' });
  }

  const validUsername = username === process.env.AUTH_USERNAME;
  const validPassword = await bcrypt.compare(password, process.env.AUTH_PASSWORD_HASH);

  if (!validUsername || !validPassword) {
    return json(401, { error: 'invalid credentials' });
  }

  const token = jwt.sign({ sub: username }, process.env.JWT_SECRET, { expiresIn: '30d' });
  return json(200, { token });
}

async function getInstanceState() {
  const res = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
  return res.Reservations?.[0]?.Instances?.[0]?.State?.Name ?? 'unknown';
}

async function handleConnect() {
  await ec2.send(new StartInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
  return json(200, { ok: true });
}

async function handleDisconnect() {
  await ec2.send(new StopInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
  return json(200, { ok: true });
}

async function handleStatus() {
  return json(200, { state: await getInstanceState() });
}

// EventBridge scheduled invocation — no HTTP fields on the event at all.
async function handleIdleCheck() {
  const state = await getInstanceState();
  if (state !== 'running') {
    return { skipped: true, state };
  }

  try {
    const res = await fetch(process.env.CHAT_INTERNAL_URL, {
      headers: { 'X-Internal-Secret': process.env.INTERNAL_API_SECRET },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { skipped: true, reason: `internal endpoint returned ${res.status}` };

    const { lastActivityAt } = await res.json();
    const idleSeconds = (Date.now() - lastActivityAt) / 1000;

    if (idleSeconds > IDLE_TIMEOUT_SECONDS) {
      await ec2.send(new StopInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
      return { stopped: true, idleSeconds };
    }
    return { idleSeconds };
  } catch (err) {
    return { error: String(err) };
  }
}

export const handler = async (event) => {
  if (!event.requestContext?.http) {
    return handleIdleCheck();
  }

  const { method, path: reqPath } = event.requestContext.http;
  const headers = event.headers || {};
  const body = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  try {
    if (method === 'GET' && (reqPath === '/' || reqPath === '/index.html')) return serveStatic('index.html');
    if (method === 'GET' && reqPath === '/app.js') return serveStatic('app.js');
    if (method === 'GET' && reqPath === '/style.css') return serveStatic('style.css');

    if (method === 'POST' && reqPath === '/auth/login') return await handleLogin(body);

    if (method === 'POST' && reqPath === '/connect') {
      return requireAuth(headers) ? await handleConnect() : json(401, { error: 'unauthorized' });
    }
    if (method === 'POST' && reqPath === '/disconnect') {
      return requireAuth(headers) ? await handleDisconnect() : json(401, { error: 'unauthorized' });
    }
    if (method === 'GET' && reqPath === '/status') {
      return requireAuth(headers) ? await handleStatus() : json(401, { error: 'unauthorized' });
    }

    return json(404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'internal error' });
  }
};
