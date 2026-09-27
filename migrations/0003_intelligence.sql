-- Continuous intelligence. Per-user. The app never invents metric rows.

create table if not exists ci_versions (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  kind text not null,
  version integer not null,
  label text not null,
  note text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ci_versions_user_idx on ci_versions (user_id, kind, created_at desc);

create table if not exists ci_sources (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  url text not null default '',
  title text not null default '',
  kind text not null,
  reliability text not null,
  note text not null default '',
  published_at text not null default '',
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ci_sources_user_idx on ci_sources (user_id, created_at desc);

create table if not exists ci_knowledge (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  topic text not null default '',
  statement text not null,
  normalized text not null,
  status text not null,
  source_id text,
  supersedes_id text,
  last_verified_at timestamptz,
  origin text not null,
  pipeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ci_knowledge_user_idx on ci_knowledge (user_id, status, updated_at desc);

create table if not exists ci_intake (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  body text not null,
  url text not null default '',
  title text not null default '',
  status text not null default 'pending',
  result_note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ci_intake_user_idx on ci_intake (user_id, status, created_at desc);

create table if not exists ci_errors (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  original_answer text not null default '',
  error_text text not null,
  correction text not null default '',
  source_note text not null default '',
  cause text not null default '',
  lesson text not null default '',
  corrected_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ci_errors_user_idx on ci_errors (user_id, created_at desc);

create table if not exists ci_rules (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  rule text not null,
  source_quote text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ci_rules_user_idx on ci_rules (user_id, active, created_at desc);

create table if not exists ci_gaps (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  question text not null,
  missing text not null,
  status text not null default 'open',
  resolution text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ci_gaps_user_idx on ci_gaps (user_id, status, updated_at desc);

create table if not exists ci_runs (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  agent text not null,
  parent_id text,
  mode text not null,
  tier text not null,
  status text not null,
  summary text not null default '',
  detail jsonb not null default '{}'::jsonb,
  duration_ms integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ci_runs_user_idx on ci_runs (user_id, started_at desc);

create table if not exists ci_cycles (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  status text not null,
  report jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ci_cycles_user_idx on ci_cycles (user_id, started_at desc);

create table if not exists ci_bench_runs (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  passed integer not null,
  failed integer not null,
  latency_ms integer not null,
  failures jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ci_bench_user_idx on ci_bench_runs (user_id, created_at desc);

create table if not exists ci_proposals (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  agent text not null,
  kind text not null,
  title text not null,
  body text not null,
  risk text not null,
  status text not null default 'pending',
  effect text not null default '',
  snapshot_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists ci_proposals_user_idx on ci_proposals (user_id, status, created_at desc);

create table if not exists ci_models (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  model_id text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists ci_models_user_idx on ci_models (user_id, model_id);

create table if not exists ci_probes (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  model_id text not null,
  expected text not null,
  output text not null,
  passed boolean not null,
  latency_ms integer not null,
  created_at timestamptz not null default now()
);
create index if not exists ci_probes_user_idx on ci_probes (user_id, created_at desc);

create table if not exists ci_claims (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  claim text not null,
  status text not null,
  primary_note text not null default '',
  secondary_note text not null default '',
  conflict_note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ci_claims_user_idx on ci_claims (user_id, created_at desc);

create table if not exists ci_perf (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  kind text not null,
  latency_ms integer not null,
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists ci_perf_user_idx on ci_perf (user_id, created_at desc);

create table if not exists ci_snapshots (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  kind text not null,
  version integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ci_snapshots_user_idx on ci_snapshots (user_id, kind, created_at desc);

create table if not exists ci_evals (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  message_id text,
  flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ci_evals_user_idx on ci_evals (user_id, created_at desc);
