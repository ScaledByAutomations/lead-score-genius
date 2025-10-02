-- Lead job queue tables to support durable background processing

create table if not exists lead_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'queued', -- queued | processing | completed | failed
  total integer not null,
  processed integer not null default 0,
  error text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lead_job_items (
  job_id uuid references lead_jobs(id) on delete cascade,
  item_index integer not null,
  payload jsonb not null,
  status text not null default 'queued', -- queued | processing | completed | failed
  error text,
  result jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, item_index)
);

create index if not exists lead_job_items_status_idx on lead_job_items (status);
create index if not exists lead_job_items_job_status_idx on lead_job_items (job_id, status);
create index if not exists lead_jobs_status_idx on lead_jobs (status);
create index if not exists lead_jobs_user_idx on lead_jobs (user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger lead_jobs_set_updated_at
before update on lead_jobs
for each row execute function public.set_updated_at();

create trigger lead_job_items_set_updated_at
before update on lead_job_items
for each row execute function public.set_updated_at();

-- Ensure RLS is enabled so auth context applies when accessed from edge functions/routes
alter table lead_jobs enable row level security;
alter table lead_job_items enable row level security;

-- Basic policies for owner access. Shared workers should authenticate with service role.
create policy if not exists "Lead jobs are viewable by owner" on lead_jobs
  for select using (auth.uid() = user_id);

create policy if not exists "Lead jobs insertable by owner" on lead_jobs
  for insert with check (auth.uid() = user_id);

create policy if not exists "Lead job items viewable by owner" on lead_job_items
  for select using (
    exists (
      select 1 from lead_jobs
      where lead_jobs.id = lead_job_items.job_id
        and lead_jobs.user_id = auth.uid()
    )
  );

create policy if not exists "Lead job items insertable by owner" on lead_job_items
  for insert with check (
    exists (
      select 1 from lead_jobs
      where lead_jobs.id = lead_job_items.job_id
        and lead_jobs.user_id = auth.uid()
    )
  );
