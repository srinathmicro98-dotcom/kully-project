-- Incremental migration for an already-provisioned Kully database.
-- (infra/schema.sql updated to match for fresh deployments.)

create table if not exists tool_config (
  tool_name text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project text not null default 'default',
  conversation_id uuid references conversations(id) on delete set null,
  title text not null,
  kind text not null check (kind in ('code','markdown','html','text')),
  language text,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists artifacts_user_project_idx on artifacts (user_id, project, created_at);

create table if not exists connectors (
  user_id text not null,
  provider text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
