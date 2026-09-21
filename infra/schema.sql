-- Run once in the Supabase SQL editor for the Kully project.

create extension if not exists vector;
create extension if not exists pgcrypto;

create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project text not null default 'default',
  title text,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_project_idx on conversations (user_id, project);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  agent text,
  content text not null,
  created_at timestamptz not null default now()
);
create index on messages (conversation_id, created_at);

create table facts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project text,
  fact_type text not null default 'other' check (fact_type in ('decision','todo','architecture','preference','other')),
  content text not null,
  embedding vector(1024),
  source_message_id uuid references messages(id) on delete set null,
  created_at timestamptz not null default now()
);
create index facts_embedding_idx on facts using hnsw (embedding vector_cosine_ops);
create index on facts (user_id);

create table routing_logs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete set null,
  classified_agent text not null,
  raw_model_output text,
  created_at timestamptz not null default now()
);

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

create table skills (
  name text primary key,
  description text not null,
  body text not null,
  updated_at timestamptz not null default now()
);

create table tool_config (
  tool_name text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project text not null default 'default',
  conversation_id uuid references conversations(id) on delete set null,
  title text not null,
  kind text not null check (kind in ('code','markdown','html','text','image','video')),
  language text,
  content text not null,
  created_at timestamptz not null default now()
);
create index on artifacts (user_id, project, created_at);

create table app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  model text not null,
  kind text not null check (kind in ('chat', 'image_gen')),
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  created_at timestamptz not null default now()
);
create index on usage_log (user_id, created_at);

create table connectors (
  user_id text not null,
  provider text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create or replace function match_facts(
  query_embedding vector(1024),
  match_user_id text,
  match_count int default 5,
  match_project text default null
) returns table (id uuid, content text, project text, fact_type text, similarity float)
language sql stable as $$
  select id, content, project, fact_type, 1 - (embedding <=> query_embedding) as similarity
  from facts
  where user_id = match_user_id and embedding is not null
    and (match_project is null or project = match_project or project is null)
  order by
    case when match_project is not null and project = match_project then 0 else 1 end,
    embedding <=> query_embedding
  limit match_count;
$$;

-- Cross-project recall: match_facts (above) prefers/limits to one project;
-- this variant searches every project the user has facts in.
create or replace function match_facts_global(
  query_embedding vector(1024),
  match_user_id text,
  match_count int default 5
) returns table (id uuid, content text, project text, fact_type text, similarity float)
language sql stable as $$
  select id, content, project, fact_type, 1 - (embedding <=> query_embedding) as similarity
  from facts
  where user_id = match_user_id and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
