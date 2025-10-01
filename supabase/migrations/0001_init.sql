create extension if not exists "pgcrypto";

create table if not exists lead_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  company text not null,
  industry text,
  final_score numeric(5,2) not null,
  interpretation text not null,
  weights jsonb not null,
  scores jsonb not null,
  reasoning text not null,
  enriched jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_runs_created_at_idx on lead_runs (created_at desc);
