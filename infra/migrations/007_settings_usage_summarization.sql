-- Incremental migration for an already-provisioned Kully database.
-- (infra/schema.sql updated to match for fresh deployments.)

create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  model text not null,
  kind text not null check (kind in ('chat', 'image_gen')),
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists usage_log_user_created_idx on usage_log (user_id, created_at);

alter table conversations add column if not exists summary text;

-- Cross-project recall: match_facts (existing) prefers/limits to one project;
-- this variant searches every project the user has facts in, for an explicit
-- "did I decide this anywhere before" query.
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
