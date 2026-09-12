import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import {
  EC2Client,
  StartInstancesCommand,
  StopInstancesCommand,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The EC2 instance lives in ap-south-2; this Lambda runs in ap-south-1
// (ap-south-2 doesn't support Function URLs yet) — pin the region explicitly
// rather than inheriting whatever region the Lambda itself deploys in.
const ec2 = new EC2Client({ region: process.env.EC2_REGION || 'ap-south-2' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

webpush.setVapidDetails(
  'mailto:kully@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

const INSTANCE_ID = process.env.INSTANCE_ID;
const IDLE_TIMEOUT_SECONDS = Number(process.env.IDLE_TIMEOUT_SECONDS || 3600);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

// The frontend the Lambda serves — same files lambda/deploy.sh copies into public/.
const STATIC_FILES = new Set([
  'index.html',
  'app.js',
  'style.css',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'sw.js',
]);

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function serveStatic(filename) {
  try {
    const filePath = path.join(__dirname, 'public', filename);
    const ext = path.extname(filename);
    const isBinary = ext === '.png';
    const raw = fs.readFileSync(filePath);
    return {
      statusCode: 200,
      headers: { 'Content-Type': MIME_TYPES[ext] || 'text/plain' },
      body: isBinary ? raw.toString('base64') : raw.toString('utf8'),
      isBase64Encoded: isBinary,
    };
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

async function handleSubscribe(rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return json(400, { error: 'invalid body' });
  }

  const { user_id: userId, subscription } = payload;
  if (typeof userId !== 'string' || !subscription?.endpoint) {
    return json(400, { error: 'user_id and subscription are required' });
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: subscription.endpoint, keys_json: subscription },
    { onConflict: 'endpoint' },
  );
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
}

async function handleNotifyReady(rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return json(400, { error: 'invalid body' });
  }

  const userId = payload.user_id;
  if (typeof userId !== 'string') {
    return json(400, { error: 'user_id is required' });
  }

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys_json')
    .eq('user_id', userId);
  if (error) return json(500, { error: error.message });

  const payloadStr = JSON.stringify({ title: 'Kully', body: 'Your server is ready — come chat.' });

  await Promise.all(
    (data ?? []).map(async (row) => {
      try {
        await webpush.sendNotification(row.keys_json, payloadStr);
      } catch (err) {
        // A 404/410 means the subscription is stale — drop it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', row.endpoint);
        }
      }
    }),
  );

  return json(200, { ok: true, notified: (data ?? []).length });
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
    if (method === 'GET' && reqPath === '/') return serveStatic('index.html');
    if (method === 'GET' && STATIC_FILES.has(reqPath.slice(1))) return serveStatic(reqPath.slice(1));

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
    if (method === 'POST' && reqPath === '/push/subscribe') {
      return requireAuth(headers) ? await handleSubscribe(body) : json(401, { error: 'unauthorized' });
    }
    if (method === 'POST' && reqPath === '/push/notify-ready') {
      return requireAuth(headers) ? await handleNotifyReady(body) : json(401, { error: 'unauthorized' });
    }

    return json(404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'internal error' });
  }
};
