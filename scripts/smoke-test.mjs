#!/usr/bin/env node
// End-to-end plumbing check against a running Kully server (local dev box or
// the real EC2 instance). Checks that every route actually works — auth,
// each agent gets routed to and answers, background mode, market alerts and
// scheduled tasks CRUD, and that soft-delete really does show up in /trash.
//
// This does NOT judge answer quality/safety (see eval-agents.mjs for that) —
// it's plumbing only: did the request succeed, does the shape look right.
//
// Usage:
//   JWT_SECRET=... BASE_URL=http://localhost:3000 node scripts/smoke-test.mjs
//   JWT_SECRET=... BASE_URL=https://kully-cofounder.duckdns.org node scripts/smoke-test.mjs
//
// Only ever creates throwaway records under project "smoke-test" and
// soft-deletes them at the end (never a hard delete) — safe to run against
// the real database, including production, any time.
import { makeTestToken, TEST_USER_ID } from './lib/authToken.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PROJECT = 'smoke-test';
const token = makeTestToken();

const results = [];

async function req(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(path === '/health' ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function check(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log('PASS');
    results.push({ name, ok: true });
  } catch (err) {
    console.log(`FAIL — ${err.message}`);
    results.push({ name, ok: false, error: err.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log(`Kully smoke test against ${BASE_URL}\n`);

  await check('GET /health', async () => {
    const { status, body } = await req('GET', '/health');
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.ok !== false, 'health check reported not-ok');
  });

  await check('POST /chat routes to general and answers correctly', async () => {
    const { status, body } = await req('POST', '/chat', {
      user_id: TEST_USER_ID, project: PROJECT, message: 'What is 15 + 27? Reply with just the number.',
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.reply?.includes('42'), `expected reply to contain 42, got: ${body.reply}`);
  });

  await check('POST /chat routes to trading agent', async () => {
    const { status, body } = await req('POST', '/chat', {
      user_id: TEST_USER_ID, project: PROJECT, message: "What's RELIANCE's current RSI14 and SMA20?",
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.agent === 'trading', `expected agent "trading", got "${body.agent}"`);
    assert(body.reply?.length > 0, 'empty reply from trading agent');
  });

  await check('POST /chat routes to video agent', async () => {
    const { status, body } = await req('POST', '/chat', {
      user_id: TEST_USER_ID, project: PROJECT, message: 'Write a short YouTube video script about morning productivity tips.',
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.agent === 'video', `expected agent "video", got "${body.agent}"`);
  });

  await check('POST /chat/background starts and returns immediately', async () => {
    const { status, body } = await req('POST', '/chat/background', {
      user_id: TEST_USER_ID, project: PROJECT, message: 'What is 123 + 456? Reply with just the number.',
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.status === 'started', `expected status "started", got "${body.status}"`);
    assert(!!body.conversation_id, 'missing conversation_id');
  });

  let alertId;
  await check('POST /market-alerts creates an alert', async () => {
    const { status, body } = await req('POST', '/market-alerts', {
      user_id: TEST_USER_ID, project: PROJECT, symbol: 'RELIANCE', indicator: 'price', comparator: 'above', threshold: 999999999,
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(!!body.id, 'created alert missing id');
    alertId = body.id;
  });

  await check('GET /market-alerts lists the new alert', async () => {
    const { status, body } = await req('GET', `/market-alerts?user_id=${TEST_USER_ID}`);
    assert(status === 200, `expected 200, got ${status}`);
    assert(Array.isArray(body) && body.some((a) => a.id === alertId), 'created alert not found in list');
  });

  await check('DELETE /market-alerts/:id soft-deletes it', async () => {
    const { status, body } = await req('DELETE', `/market-alerts/${alertId}?user_id=${TEST_USER_ID}`);
    assert(status === 200 && body.ok, `expected {ok:true}, got ${status}: ${JSON.stringify(body)}`);
  });

  let taskId;
  await check('POST /scheduled-tasks creates a task', async () => {
    const { status, body } = await req('POST', '/scheduled-tasks', {
      user_id: TEST_USER_ID, project: PROJECT, prompt: 'smoke-test placeholder task',
      schedule_type: 'once', run_at: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(!!body.id, 'created task missing id');
    taskId = body.id;
  });

  await check('DELETE /scheduled-tasks/:id soft-deletes it', async () => {
    const { status, body } = await req('DELETE', `/scheduled-tasks/${taskId}?user_id=${TEST_USER_ID}`);
    assert(status === 200 && body.ok, `expected {ok:true}, got ${status}: ${JSON.stringify(body)}`);
  });

  await check('GET /trash shows both soft-deleted items', async () => {
    const { status, body } = await req('GET', `/trash?user_id=${TEST_USER_ID}`);
    assert(status === 200 && Array.isArray(body), `expected 200 + array, got ${status}`);
    assert(body.some((i) => i.type === 'market_alert' && i.id === alertId), 'deleted market alert missing from /trash');
    assert(body.some((i) => i.type === 'scheduled_task' && i.id === taskId), 'deleted scheduled task missing from /trash');
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) {
    console.log('\nFailed:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exitCode = 1;
});
