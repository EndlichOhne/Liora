-- Links from a person file to dated events, conflicts and possible duplicates.
-- No seeded people.

create table if not exists ci_person_events (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  person_id text not null,
  occurred_on text not null default '',
  label text not null,
  detail text not null default '',
  evidence_class text not null,
  source_id text not null,
  case_id text not null default '',
  confidence text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ci_person_events_idx on ci_person_events (user_id, person_id, occurred_on);

create table if not exists ci_person_claims (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  person_id text not null,
  field text not null,
  value text not null,
  source_id text not null,
  evidence_class text not null,
  created_at timestamptz not null default now()
);
create index if not exists ci_person_claims_idx on ci_person_claims (user_id, person_id, field);

create table if not exists ci_person_conflicts (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  person_id text not null,
  field text not null,
  left_value text not null,
  right_value text not null,
  left_source_id text not null,
  right_source_id text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create index if not exists ci_person_conflicts_idx on ci_person_conflicts (user_id, person_id, status);

create table if not exists ci_person_duplicates (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  person_id text not null,
  other_id text not null,
  reason text not null,
  status text not null default 'needs_review',
  created_at timestamptz not null default now()
);
create index if not exists ci_person_duplicates_idx on ci_person_duplicates (user_id, person_id, status);

create table if not exists ci_person_changes (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  person_id text not null,
  action text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ci_person_changes_idx on ci_person_changes (user_id, person_id, created_at desc);

create table if not exists ci_person_hints (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  person_id text not null,
  source_id text not null,
  note text not null default '',
  status text not null default 'needs_review',
  created_at timestamptz not null default now()
);
create index if not exists ci_person_hints_idx on ci_person_hints (user_id, person_id, status);

create index if not exists ci_person_cases_case_idx on ci_person_cases (user_id, case_id);
create index if not exists ci_person_sources_source_idx on ci_person_sources (user_id, source_id);
