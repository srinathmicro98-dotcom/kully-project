# Kully

A multi-agent AI cofounder — text chat with persistent memory today, voice + mobile + Kubernetes later.

## Phase 0+1 (this milestone)

Router + three specialist agents (`dev`, `general`, `search`) backed by Groq (LLM), Supabase (Postgres+pgvector memory), Cohere (embeddings), and Tavily (web search). See `infra/` for deployment and `server/` for the orchestrator.

### Local setup

```bash
cd server
cp .env.example .env   # fill in your API keys
npm install
npm start
```

Then `POST http://localhost:3000/chat` with `{ "user_id": "you", "message": "hello" }`, or open `web/index.html` in a browser (point it at your server's URL).

### Deployment

See `infra/setup-ec2.sh` for a from-scratch EC2 bootstrap (Node, Caddy, swap, systemd) and `infra/schema.sql` for the Supabase schema to run once in the Supabase SQL editor.
