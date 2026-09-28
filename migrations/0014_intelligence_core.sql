-- One context row per user, and finding versions that keep the previous text.
-- No seeded facts.

create table if not exists ci_context_state (
  user_id text primary key references "user" ("id") on delete cascade,
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists ci_finding_versions (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  finding_id text not null,
  version integer not null,
  previous_value text not null default '',
  new_value text not null,
  reason text not null,
  source_note text not null default '',
  status text not null default 'current',
  created_at timestamptz not null default now()
);
create unique index if not exists ci_finding_versions_uq on ci_finding_versions (user_id, finding_id, version);
create index if not exists ci_finding_versions_idx on ci_finding_versions (user_id, finding_id, created_at desc);
