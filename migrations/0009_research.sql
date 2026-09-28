-- Persistent research tasks. Extends sources and gaps. No seeded facts.

alter table ci_sources add column if not exists origin_source_id text;
alter table ci_sources add column if not exists source_family_id text;
alter table ci_sources add column if not exists publisher text not null default '';
alter table ci_sources add column if not exists content_hash text not null default '';
alter table ci_sources add column if not exists parent_source_id text;
alter table ci_sources add column if not exists independence_status text not null default 'unknown';
alter table ci_sources add column if not exists case_id text;
alter table ci_sources add column if not exists task_id text;

alter table ci_gaps add column if not exists case_id text;
alter table ci_gaps add column if not exists task_id text;
alter table ci_gaps add column if not exists priority text not null default 'medium';
alter table ci_gaps add column if not exists source_ids text not null default '';
alter table ci_gaps add column if not exists resolved_at timestamptz;

create table if not exists ci_research_tasks (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  session_id text not null,
  case_id text,
  title text not null,
  original_request text not null,
  normalized_request text not null,
  status text not null,
  priority text not null default 'medium',
  scope text not null,
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  context_json jsonb not null default '{}'::jsonb,
  result_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ci_research_tasks_user_idx on ci_research_tasks (user_id, updated_at desc);
create index if not exists ci_research_tasks_session_idx on ci_research_tasks (user_id, session_id);

create table if not exists ci_research_steps (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  task_id text not null,
  position integer not null,
  name text not null,
  note text not null default '',
  status text not null default 'queued',
  created_at timestamptz not null default now()
);
create index if not exists ci_research_steps_idx on ci_research_steps (user_id, task_id, position);

create table if not exists ci_research_elements (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  task_id text not null,
  case_id text,
  kind text not null,
  raw_value text not null,
  normalized_value text not null,
  normalization_method text not null default '',
  status text not null,
  polarity text not null default 'unknown',
  source_url text not null default '',
  evidence_class text not null default 'unknown',
  confidence text not null default 'unverified',
  created_at timestamptz not null default now()
);
create index if not exists ci_research_elements_idx on ci_research_elements (user_id, task_id);
