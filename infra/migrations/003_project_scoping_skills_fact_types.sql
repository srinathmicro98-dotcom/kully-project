-- Incremental migration for an already-provisioned Kully database.
-- (infra/schema.sql has been updated to include these for fresh deployments;
-- this file is what actually gets applied to the live DB.)

alter table facts add column if not exists fact_type text not null default 'other'
  check (fact_type in ('decision','todo','architecture','preference','other'));

create table if not exists skills (
  name text primary key,
  description text not null,
  body text not null,
  updated_at timestamptz not null default now()
);

drop function if exists match_facts(vector(1024), text, int);

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

insert into skills (name, description, body) values
  ('code-review', 'Use when reviewing a diff, PR, or pasted code for correctness/quality issues.',
   'Review the given code systematically: (1) correctness — logic errors, edge cases, off-by-ones; (2) security — injection, unsafe deserialization, secrets in code; (3) reliability — error handling, resource cleanup; (4) simplicity — unnecessary complexity or duplication. Report findings ranked by severity, each with the concrete failure scenario, not just a style nitpick list.'),
  ('debug-stack-trace', 'Use when the user pastes an error message, stack trace, or describes a crash/bug.',
   'Work backward from the trace: identify the exact failing line/frame first, form a hypothesis about root cause before proposing a fix, and state what evidence would confirm or rule out that hypothesis (a log line, a value to print, a test to run) rather than guessing at multiple unrelated fixes at once.'),
  ('write-tests', 'Use when asked to write or improve test coverage for a function, module, or bug fix.',
   'Cover: the happy path, at least one boundary/edge case, and at least one failure/error case. Name tests after the behavior being verified, not the implementation detail. Prefer testing observable behavior over internal state.'),
  ('refactor-plan', 'Use when asked how to restructure or clean up existing code without changing behavior.',
   'Propose refactors as a small ordered sequence of independently-safe steps (each one leaves the code working), not one big rewrite. Call out which steps are pure mechanical moves versus which change risk/behavior, so the user can stop partway if needed.'),
  ('commit-message', 'Use when asked to write a commit message or PR description for a change.',
   'Lead with why the change was made, not a restatement of the diff. One or two sentences for a commit message; for a PR description, add a short bulleted summary and a test plan checklist.')
on conflict (name) do nothing;
