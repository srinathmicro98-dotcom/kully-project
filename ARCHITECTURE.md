# Kully — architecture & runbook

This is the canonical, current reference for how Kully is built and deployed.
Update this file in the same commit as any structural change. (There's also
a nicer-looking `docs/ARCHITECTURE.html` — that's a point-in-time snapshot
from 2026-09-12 and is **not** kept current; this file is.)

## What Kully is

A multi-agent AI cofounder — text chat with persistent memory, a router that
dispatches to specialist agents, and automations (scheduled tasks, market
alerts) that run independently of whether you have the app open.

## Two-plane design

- **Control plane** — `lambda/control-plane`, Node 22 Lambda Function URL,
  region `ap-south-1`. Always on, effectively free. Owns login, EC2
  start/stop, the 5-minute EventBridge tick (idle-check + scheduled tasks +
  market alerts), push delivery (web push + Telegram), Telegram/Google OAuth
  handshakes, and serves the PWA itself so the login page loads even when
  EC2 is asleep.
- **Chat orchestrator** — `server/`, Node 22 + Express, on one EC2 t3.micro,
  region `ap-south-2` (chosen because it doesn't support Lambda Function
  URLs, which is why the control plane lives in a different region). Off by
  default, starts on demand, auto-stops after an hour idle. Behind Caddy for
  HTTPS. Stateless — everything persists in Supabase, so the process can
  restart or move without losing anything.
- **Sandboxed code execution** — `lambda/code-runner-node`,
  `lambda/code-runner-python`. S3-backed, own IAM role that can reach
  nothing else in the account. The `dev` agent's `run_code` tool leaves the
  EC2 process entirely to hit these — production secrets never touch
  arbitrary model-generated code.
- **DB backup** — `lambda/db-backup`. Daily EventBridge cron, dumps every
  Supabase table to gzipped JSON in S3, then purges soft-deleted rows older
  than 30 days (only after that day's backup is confirmed written), then
  prunes backups older than 30 days.

## Agents (`server/src/orchestrator/agents/`)

Router (`router.js`) is a cheap Groq call that reads the message and returns
one word: `dev`, `general`, `search`, `trading`, or `video`.

| Agent | Job | Hard safety boundary |
|---|---|---|
| `dev` | code execution, file/skill access | — |
| `general` | everyday conversation, Calendar (dormant) | — |
| `search` | live web search via Tavily | — |
| `trading` | NSE technical analysis (SMA/RSI/MACD via free Yahoo Finance data) | **Never executes a real trade or gives personalized investment advice, even if explicitly "authorized" by the user** — only ever produces a "DRAFT ORDER — NOT EXECUTED" artifact. Adversarially tested; see `scripts/eval-agents.mjs`. |
| `video` | YouTube scripts + thumbnails, channel analytics (dormant, needs Google OAuth) | **Never suggests bots, fake engagement, or anything risking a YouTube ToS violation.** Adversarially tested; see `scripts/eval-agents.mjs`. |

## Data safety

- **Soft delete**: `facts`, `scheduled_tasks`, `skills`, `market_alerts` all
  have `deleted_at`. Deleting sets it instead of removing the row; every
  read path (including the `match_facts`/`match_facts_global` Postgres RPCs)
  filters `deleted_at is null`. `GET /trash` + `POST /trash/restore` power
  the "Recently deleted" Settings panel.
- **Permanent purge** only happens inside the daily `db-backup` Lambda,
  30 days after deletion, and only after that day's backup is confirmed
  written to S3.
- **Backups**: `kully-db-backups-<account-id>` S3 bucket, one gzip-JSON dump
  per table per day, 30-day retention.
- **Restore**: `infra/restore-backup/restore.js`, deliberately manual and
  `--yes`-gated. Never automated — restoring overwrites live data.

This whole system exists because a test-cleanup script once deleted real
`default`-project conversation data with no backup to recover it from
(Supabase's Free plan has zero backups). Never scope a delete/cleanup
operation to the `default` project again without checking what's in it
first.

## Automations

- **Scheduled tasks** (`scheduled_tasks` table) — checked every 5 minutes by
  the Lambda directly against Supabase (works even while EC2 is stopped).
  Dispatch and idle-check run **sequentially, dispatch first** — see
  Gotchas below for why.
- **Background-task mode** (`POST /chat/background`) — responds immediately,
  keeps running unawaited for up to 30 tool iterations, delivers the result
  via push. Use for anything that would otherwise make an HTTP caller wait
  too long or risk a client timeout.
- **Market alerts** (`market_alerts` table) — condition-based (e.g. "RSI
  below 30"), checked on the same 5-minute tick, entirely inside the Lambda,
  no Groq/EC2 involved. Fires once then auto-disables.

## Reasoning tier: tried Bedrock, reverted to Groq (2026-09-27→30)

Attempted swapping the "smart" tier (every specialist agent's tool loop,
`toolLoop.js`) from Groq to Claude Opus 5.5 via Amazon Bedrock. Built and
unit-tested a drop-in adapter (`bedrockClient.js`, since deleted) that
translated the app's OpenAI-shape messages/tools to/from Anthropic's Messages
API shape — that part worked and is a reusable pattern if this is retried.

**Blocked and reverted**, not because of the code, but AWS account access:
even after Bedrock's `get-foundation-model-availability` API reported
`AUTHORIZED`/`AVAILABLE` for Claude Opus 5.5 (and separately for Claude Opus
5), every actual `InvokeModel` call still failed with `AccessDeniedException:
... not available for this account ... contact AWS Sales`. Confirmed this
wasn't a propagation delay (retried over ~2 minutes) or model-specific (both
Opus 5.5 and Opus 5 failed identically) — this looks like an account-level
Bedrock/Marketplace provisioning gate that self-service console steps can't
clear, needing actual AWS Sales contact or a Marketplace subscription fix.

Given that could take arbitrarily long, the call was made to drop Bedrock
entirely and stay on Groq for now. **If revisited:** Anthropic's own direct
API (not Bedrock) is a self-service alternative with no AWS Marketplace gate
— same model, just a different client/auth (`Anthropic({apiKey})` instead of
`AnthropicBedrockMantle`), and most of the deleted adapter's conversion logic
would carry over directly.

**Residual AWS resources** (harmless, no cost, left in place rather than
spending more effort tearing down): IAM role `kully-ec2-bedrock-role` +
instance profile `kully-ec2-bedrock-profile`, attached to the EC2 instance.
Scoped to Bedrock invoke only — safe to leave, or delete later if tidying up.

## Connectors — status

| Connector | State | What's needed |
|---|---|---|
| Telegram | Built, dormant | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET` on the Lambda, then call `setWebhook` once |
| Google (Calendar, YouTube, Gmail, Drive) | Built, dormant | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; re-run the connect flow if scopes changed since last connected |
| GitHub | Built, dormant | A fine-grained PAT |
| TTS (voice replies) | Built, dormant | Accept Groq's TTS model terms in the Groq console |

## Verifying a deploy

Two scripts, deliberately separate concerns:

- **`scripts/smoke-test.mjs`** — plumbing. Did the request succeed, does
  every route/agent/CRUD path work. Run this after every deploy.
- **`scripts/eval-agents.mjs`** — agent quality. Did the router pick the
  right specialist, did trading/video refuse unsafe requests. Run this
  after any prompt or routing change.

```bash
cd scripts && npm install   # once
JWT_SECRET=<same as server/lambda> BASE_URL=https://kully-cofounder.duckdns.org node smoke-test.mjs
JWT_SECRET=<same as server/lambda> BASE_URL=https://kully-cofounder.duckdns.org node eval-agents.mjs
```

Both only ever create throwaway records (project `smoke-test`/`eval-agents`)
and soft-delete them — safe to run against production data at any time.

## Deploying

1. **EC2**: `git pull`, `sudo cp infra/Caddyfile /etc/caddy/Caddyfile`,
   `sudo systemctl reload caddy`, `sudo systemctl restart kully`.
   (The Caddyfile is **not** auto-synced — always copy it by hand.)
2. **Control-plane Lambda**: `bash lambda/deploy.sh`
3. **DB-backup Lambda**: `bash lambda/deploy-db-backup.sh`
4. Run both verification scripts above.

## Gotchas (hard-won, don't rediscover these)

- **Supabase direct host is IPv6-only** (`db.<ref>.supabase.co` has no A
  record). AWS Lambda's default networking is IPv4-only, so Lambda code that
  talks to Postgres directly must use the Supavisor pooler
  (`aws-0-<region>.pooler.supabase.com:6543`, username
  `postgres.<project-ref>`) instead. `psql` from a machine with real IPv6
  connectivity can use the direct host fine.
- **Caddy `handle /x` is an exact match, not a prefix.** `/chat/*` needed
  its own `handle` block separate from `/chat` — a new route under an
  existing path silently 404s otherwise.
- **RSI must use Wilder's smoothing**, not a naive "average of the last N
  changes" — the two give materially different numbers (verified: 25.66 vs
  37.40 on identical RELIANCE data) and only Wilder's matches what brokers
  actually show. The math now lives in exactly one place,
  `shared/marketIndicators.mjs`; `lambda/deploy.sh` copies it into
  `lambda/control-plane/` before every zip. Never hand-fork it again.
- **EventBridge tick ordering**: scheduled-task dispatch and idle-check must
  run sequentially (dispatch first), not concurrently — `/internal/*` calls
  don't touch the EC2 app's own activity timer, so idle-check could
  otherwise decide to stop the box mid-dispatch.
- **Groq free-tier TPM limits are real** (8000 TPM on the smart model). Never
  have the model round-trip large binary/base64 payloads through its own
  output tokens — e.g. `save_chart` reads a sandbox file server-side and
  only passes the model a file path, not the file's bytes.
- **A generated Lambda `function.zip` (and now `marketIndicators.mjs` in
  `lambda/control-plane/`) must stay gitignored** — both are build output,
  regenerated by `lambda/deploy.sh` on every deploy.

## Standing rules

- Never write AWS (or any) credentials to a file, git repo, or memory. Use
  session-scoped shell env vars only; ask for them fresh each session/task.
- The trading agent must never execute real trades or give personalized
  investment advice — this is a hard boundary, not a style choice.
- The video agent must never suggest view manipulation, bots, fake
  engagement, or anything risking a YouTube ToS violation.
- Deletion is soft by default everywhere it's user-facing; hard deletes only
  happen inside the backup Lambda's 30-day purge, after that day's backup is
  confirmed safe.
