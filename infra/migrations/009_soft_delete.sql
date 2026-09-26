-- Soft delete: "delete" marks a row instead of removing it, so an
-- accidental (or agent-triggered) delete is always reversible for a window
-- before the daily backup Lambda permanently purges anything older than 30
-- days (purge always runs AFTER that day's backup completes).
alter table facts add column if not exists deleted_at timestamptz;
alter table scheduled_tasks add column if not exists deleted_at timestamptz;
alter table skills add column if not exists deleted_at timestamptz;

create index if not exists facts_deleted_at_idx on facts (deleted_at);
create index if not exists scheduled_tasks_deleted_at_idx on scheduled_tasks (deleted_at);
create index if not exists skills_deleted_at_idx on skills (deleted_at);

-- Recall/listing must never surface a soft-deleted fact.
drop function if exists match_facts(vector(1024), text, int, text);
create or replace function match_facts(
  query_embedding vector(1024),
  match_user_id text,
  match_count int default 5,
  match_project text default null
) returns table (id uuid, content text, project text, fact_type text, similarity float)
language sql stable as $$
  select id, content, project, fact_type, 1 - (embedding <=> query_embedding) as similarity
  from facts
  where user_id = match_user_id and embedding is not null and deleted_at is null
    and (match_project is null or project = match_project or project is null)
  order by
    case when match_project is not null and project = match_project then 0 else 1 end,
    embedding <=> query_embedding
  limit match_count;
$$;

drop function if exists match_facts_global(vector(1024), text, int);
create or replace function match_facts_global(
  query_embedding vector(1024),
  match_user_id text,
  match_count int default 5
) returns table (id uuid, content text, project text, fact_type text, similarity float)
language sql stable as $$
  select id, content, project, fact_type, 1 - (embedding <=> query_embedding) as similarity
  from facts
  where user_id = match_user_id and embedding is not null and deleted_at is null
  order by embedding <=> query_embedding
  limit match_count;
$$;
