-- Run once in the Supabase SQL editor for the Kully project.

create extension if not exists vector;
create extension if not exists pgcrypto;

create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create or replace function match_facts(
  query_embedding vector(1024),
  match_user_id text,
  match_count int default 5
) returns table (id uuid, content text, project text, similarity float)
language sql stable as $$
  select id, content, project, 1 - (embedding <=> query_embedding) as similarity
  from facts
  where user_id = match_user_id and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
