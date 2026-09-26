create table if not exists market_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project text not null default 'default',
  symbol text not null,
  indicator text not null check (indicator in ('price', 'rsi14')),
  comparator text not null check (comparator in ('above', 'below')),
  threshold numeric not null,
  enabled boolean not null default true,
  triggered_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists market_alerts_due_idx on market_alerts (enabled, deleted_at);
