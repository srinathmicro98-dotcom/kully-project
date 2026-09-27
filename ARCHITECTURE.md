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

## Reasoning tier: Claude Opus 5.5 via Bedrock

As of 2026-09-27, the "smart" tier used by every specialist agent's tool loop
(`server/src/orchestrator/agents/toolLoop.js`) is **Claude Opus 5.5 via Amazon
Bedrock**, not Groq. `server/src/llm/bedrockClient.js` is a drop-in adapter —
same `chatCompletion`/`chatCompletionWithTools` signatures as
`groqClient.js` — that translates the app's OpenAI-shape messages/tools
(Groq is OpenAI-compatible) to/from Anthropic's Messages API shape, using the
Bedrock "Mantle" client (`@anthropic-ai/bedrock-sdk`), which mirrors the real
Claude API 1:1.

**Still on Groq, deliberately unchanged:** routing classification
(`MODELS.fast`), vision turns (`MODELS.vision`), fact extraction, and
conversation summarization — this swap is scoped to per-turn agent reasoning
only, where quality actually matters and the cost is easiest to justify.

**This is not free.** Unlike Groq, Bedrock has no free tier at all — it's
billed per token through AWS Marketplace from the first request. This was a
deliberate, explicit tradeoff (see chat history), not an oversight.

**Model-specific gotcha:** Claude Opus 5.5 returns HTTP 400 on
`temperature`/`top_p`/`top_k` — sampling params are removed on this model
entirely. `bedrockClient.js` silently drops any `temperature` an agent still
passes rather than forwarding it; `output_config.effort: "high"` is the
actual quality/cost knob used instead (the model's own default, `medium`,
would leave quality on the table for this specific swap).

**Region gotcha:** neither `ap-south-1` nor `ap-south-2` (this project's AWS
regions) support in-region or geo-restricted Bedrock routing for this model —
only global cross-region inference does. `bedrockClient.js` uses model ID
`global.anthropic.claude-opus-5-5`, meaning requests may be processed outside
India/APAC. Not a concern for this single-user personal app, but worth
knowing if that changes.

**Required IAM (not yet applied — needs AWS credentials to finish):** the
EC2 box has never needed AWS API access before this and has no instance
profile. It needs one now, scoped to Bedrock invoke only:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
    "Resource": "*"
  }]
}
```

`Resource: "*"` is a placeholder — tighten to the specific foundation-model/
inference-profile ARN once a live call confirms the exact ARN Bedrock expects
for the `global.` cross-region profile. No static AWS keys go in `.env` —
auth is the instance profile via the standard AWS credential chain, same
principle as every other credential-handling decision in this project.

**Deployment status:** code is written, unit-tested (the OpenAI↔Anthropic
message/tool format conversion), and committed — but **not yet deployed**.
Every specialist agent's tool loop hard-depends on this working once
deployed (no Groq fallback), so it should only ship to EC2 after the IAM
role is attached and a live call is confirmed working — deploying first and
debugging IAM against a broken production app would take the single-user
app down for every agent at once.

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
