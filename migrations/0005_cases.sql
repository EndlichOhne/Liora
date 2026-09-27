-- German case research. Per user. No seeded facts.

create table if not exists ci_cases (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  code text not null,
  title text not null,
  region text not null,
  state_name text not null default '',
  district text not null default '',
  city text not null default '',
  place text not null default '',
  case_type text not null,
  case_status text not null,
  investigation_status text not null default '',
  authority text not null default '',
  court_name text not null default '',
  summary text not null default '',
  abroad_relevant boolean not null default false,
  opened_on text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ci_cases_user_idx on ci_cases (user_id, region, updated_at desc);

create table if not exists ci_leads (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  region text not null,
  title text not null,
  url text not null default '',
  snippet text not null default '',
  evidence_class text not null,
  source_kind text not null,
  origin_key text not null default '',
  publisher text not null default '',
  status text not null default 'open',
  case_id text,
  created_at timestamptz not null default now()
);
create index if not exists ci_leads_user_idx on ci_leads (user_id, status, created_at desc);

create table if not exists ci_case_events (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  case_id text not null,
  occurred_on text not null default '',
  label text not null,
  detail text not null default '',
  evidence_class text not null,
  source_url text not null default '',
  historical boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ci_case_events_idx on ci_case_events (user_id, case_id, occurred_on);

create table if not exists ci_case_items (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  case_id text not null,
  kind text not null,
  evidence_class text not null,
  body text not null,
  source_url text not null default '',
  historical boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ci_case_items_idx on ci_case_items (user_id, case_id, evidence_class);

create table if not exists ci_case_people (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  case_id text not null,
  name text not null,
  role text not null,
  evidence_class text not null,
  note text not null default '',
  source_url text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ci_case_people_idx on ci_case_people (user_id, case_id);

create table if not exists ci_case_hypotheses (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  case_id text not null,
  title text not null,
  support_text text not null default '',
  contradict_text text not null default '',
  unknown_text text not null default '',
  alternatives text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create index if not exists ci_case_hyp_idx on ci_case_hypotheses (user_id, case_id);

create table if not exists ci_case_contradictions (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  case_id text not null,
  kind text not null,
  left_text text not null,
  right_text text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ci_case_contradictions_idx on ci_case_contradictions (user_id, case_id);

create table if not exists ci_case_edges (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  case_id text not null,
  from_label text not null,
  relation text not null,
  to_label text not null,
  proven boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ci_case_edges_idx on ci_case_edges (user_id, case_id);

create table if not exists ci_case_alerts (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  case_id text,
  title text not null,
  body text not null,
  source_label text not null default '',
  evidence_class text not null,
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ci_case_alerts_idx on ci_case_alerts (user_id, seen, created_at desc);

create table if not exists ci_watches (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  url text not null,
  title text not null,
  region text not null,
  content_hash text not null default '',
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ci_watches_user_idx on ci_watches (user_id, url);

create table if not exists ci_desk_jobs (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  agent text not null,
  kind text not null,
  region text not null default '',
  status text not null,
  web boolean not null default false,
  reason text not null default '',
  result_note text not null default '',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ci_desk_jobs_idx on ci_desk_jobs (user_id, created_at desc);
