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

function getAuthedUserId(headers) {
  const token = getBearerToken(headers);
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET).sub;
  } catch {
    return null;
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

const GOOGLE_ENABLED = !!process.env.GOOGLE_CLIENT_ID;
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
].join(' ');

function googleRedirectUri(event) {
  // Same Function URL this request came in on — one less thing to keep in sync.
  return `https://${event.requestContext.domainName}/connectors/google/callback`;
}

async function handleGoogleStart(event) {
  const token = event.queryStringParameters?.token;
  if (!token) return json(401, { error: 'missing token' });
  let userId;
  try {
    userId = jwt.verify(token, process.env.JWT_SECRET).sub;
  } catch {
    return json(401, { error: 'invalid token' });
  }

  // Short-lived signed state carries the user identity through Google's
  // redirect — Google's callback can't send back our own Authorization header.
  const state = jwt.sign({ sub: userId, purpose: 'google-oauth' }, process.env.JWT_SECRET, { expiresIn: '10m' });

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', googleRedirectUri(event));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);

  return { statusCode: 302, headers: { Location: url.toString() } };
}

async function handleGoogleCallback(event) {
  const { code, state, error: oauthError } = event.queryStringParameters || {};
  if (oauthError) return { statusCode: 302, headers: { Location: `/?connector_error=${encodeURIComponent(oauthError)}` } };

  let userId;
  try {
    const decoded = jwt.verify(state, process.env.JWT_SECRET);
    if (decoded.purpose !== 'google-oauth') throw new Error('wrong purpose');
    userId = decoded.sub;
  } catch {
    return json(401, { error: 'invalid or expired state' });
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(event),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    console.error('Google token exchange failed:', await tokenRes.text());
    return { statusCode: 302, headers: { Location: '/?connector_error=google_token_exchange_failed' } };
  }

  const tokens = await tokenRes.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error: dbError } = await supabase.from('connectors').upsert({
    user_id: userId,
    provider: 'google',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token, // only present on first consent — upsert preserves it otherwise via the ignoreDuplicates:false default merge
    expires_at: expiresAt,
    scopes: tokens.scope,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider', ignoreDuplicates: false });

  if (dbError) {
    console.error('storing google connector failed:', dbError);
    return { statusCode: 302, headers: { Location: '/?connector_error=storage_failed' } };
  }

  return { statusCode: 302, headers: { Location: '/?connected=google' } };
}

async function handleListConnectors(userId) {
  const { data, error } = await supabase.from('connectors').select('provider, scopes, updated_at').eq('user_id', userId);
  if (error) return json(500, { error: error.message });
  return json(200, data);
}

async function handleDisconnectProvider(userId, provider) {
  const { error } = await supabase.from('connectors').delete().eq('user_id', userId).eq('provider', provider);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
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

async function sendPush(userId, title, body) {
  const { data } = await supabase.from('push_subscriptions').select('endpoint, keys_json').eq('user_id', userId);
  const payloadStr = JSON.stringify({ title, body });
  await Promise.all(
    (data ?? []).map(async (row) => {
      try {
        await webpush.sendNotification(row.keys_json, payloadStr);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', row.endpoint);
        }
      }
    }),
  );
}

// Same tick as the idle-check (every 5 min) — due-task detection only needs
// Supabase, which this Lambda already talks to directly, so it works even
// while the EC2 box is stopped. Only actually RUNNING a task needs the box up.
async function handleScheduledTasks() {
  const { data: due, error } = await supabase
    .from('scheduled_tasks')
    .select('id, user_id, project, prompt, schedule_type, time_of_day')
    .eq('enabled', true)
    .lte('run_at', new Date().toISOString());
  if (error || !due?.length) return { due: due?.length ?? 0 };

  const state = await getInstanceState();
  if (state === 'stopped') {
    await ec2.send(new StartInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
    // Box takes a minute or two to boot — this tick just wakes it; the next
    // 5-minute tick (once it's running) is what actually dispatches the tasks.
    return { due: due.length, waking: true };
  }
  if (state !== 'running') {
    return { due: due.length, state }; // 'pending'/'stopping' — try again next tick
  }

  const chatBase = new URL(process.env.CHAT_INTERNAL_URL).origin;
  const results = [];
  for (const task of due) {
    try {
      const res = await fetch(`${chatBase}/internal/run-scheduled-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': process.env.INTERNAL_API_SECRET },
        body: JSON.stringify({ user_id: task.user_id, project: task.project, prompt: task.prompt }),
        signal: AbortSignal.timeout(100_000),
      });
      const { reply, error: runError } = await res.json();
      if (!res.ok) throw new Error(runError || `status ${res.status}`);

      await sendPush(task.user_id, 'Kully — scheduled check-in', reply.slice(0, 180));

      const patch = { last_run_at: new Date().toISOString() };
      if (task.schedule_type === 'once') {
        patch.enabled = false;
      } else {
        const [h, m] = task.time_of_day.split(':').map(Number);
        const next = new Date();
        next.setUTCHours(h, m, 0, 0);
        next.setUTCDate(next.getUTCDate() + 1); // always tomorrow — this run just consumed today's slot
        patch.run_at = next.toISOString();
      }
      await supabase.from('scheduled_tasks').update(patch).eq('id', task.id);
      results.push({ id: task.id, ok: true });
    } catch (err) {
      results.push({ id: task.id, error: String(err) });
    }
  }
  return { due: due.length, results };
}

export const handler = async (event) => {
  if (!event.requestContext?.http) {
    // Sequential, not concurrent: dispatching a task doesn't touch the
    // EC2 app's activity timer (it's an /internal/* call), so idle-check
    // must run AFTER any due task has fully finished, never alongside it —
    // otherwise it could stop the box mid-task.
    const tasks = await handleScheduledTasks();
    const idle = await handleIdleCheck();
    return { idle, tasks };
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
    if (method === 'POST' && reqPath === '/internal/push') {
      // Called by the EC2 app (background-task completion), not the browser —
      // same shared secret used everywhere else on this internal channel.
      if (headers['x-internal-secret'] !== process.env.INTERNAL_API_SECRET) return json(401, { error: 'unauthorized' });
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        return json(400, { error: 'invalid body' });
      }
      const { user_id: userId, title, body: pushBody } = payload;
      if (typeof userId !== 'string' || typeof title !== 'string' || typeof pushBody !== 'string') {
        return json(400, { error: 'user_id, title, and body are required' });
      }
      await sendPush(userId, title, pushBody);
      return json(200, { ok: true });
    }

    if (GOOGLE_ENABLED && method === 'GET' && reqPath === '/connectors/google/start') {
      return handleGoogleStart(event);
    }
    if (GOOGLE_ENABLED && method === 'GET' && reqPath === '/connectors/google/callback') {
      return handleGoogleCallback(event);
    }
    if (method === 'GET' && reqPath === '/connectors') {
      const userId = getAuthedUserId(headers);
      return userId ? await handleListConnectors(userId) : json(401, { error: 'unauthorized' });
    }
    if (method === 'DELETE' && reqPath.startsWith('/connectors/')) {
      const userId = getAuthedUserId(headers);
      if (!userId) return json(401, { error: 'unauthorized' });
      return handleDisconnectProvider(userId, reqPath.slice('/connectors/'.length));
    }

    return json(404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'internal error' });
  }
};
