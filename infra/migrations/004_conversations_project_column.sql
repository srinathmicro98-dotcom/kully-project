-- Incremental migration for an already-provisioned Kully database.
-- (infra/schema.sql updated to match for fresh deployments.)

alter table conversations add column if not exists project text not null default 'default';
create index if not exists conversations_user_project_idx on conversations (user_id, project);
