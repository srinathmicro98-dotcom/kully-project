-- Extend artifacts.kind to support generated/uploaded images and video
-- (content is still a text column — image/video store a data URI or URL).
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'artifacts'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%';

  if constraint_name is not null then
    execute format('alter table artifacts drop constraint %I', constraint_name);
  end if;

  alter table artifacts add constraint artifacts_kind_check
    check (kind in ('code','markdown','html','text','image','video'));
end $$;
