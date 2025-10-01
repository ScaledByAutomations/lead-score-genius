alter table lead_runs enable row level security;

drop policy if exists "allow_service_role_full_access" on lead_runs;
create policy "allow_service_role_full_access" on lead_runs
  for all
  using (auth.role() = 'service_role');

drop policy if exists "allow_public_read" on lead_runs;
create policy "allow_public_read" on lead_runs
  for select
  using (true);
