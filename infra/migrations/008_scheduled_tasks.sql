create table if not exists scheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project text not null default 'default',
  prompt text not null,
  schedule_type text not null check (schedule_type in ('once', 'daily')),
  run_at timestamptz not null,
  time_of_day text, -- 'HH:MM' UTC, only meaningful for schedule_type='daily'
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists scheduled_tasks_due_idx on scheduled_tasks (enabled, run_at);
