-- Incremental migration for an already-provisioned Kully database.
-- (infra/schema.sql has been updated to include these tables for fresh
-- deployments; this file is what actually got applied to the live DB.)

create table agent_config (
  agent_name text primary key,
  system_prompt text not null,
  updated_at timestamptz not null default now()
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  endpoint text not null unique,
  keys_json jsonb not null,
  created_at timestamptz not null default now()
);
create index on push_subscriptions (user_id);
