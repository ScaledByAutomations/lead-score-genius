alter table lead_runs
  add column if not exists user_id uuid;

create index if not exists lead_runs_user_id_idx on lead_runs (user_id);
