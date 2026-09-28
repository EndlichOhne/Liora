-- Person files for publicly documented names. No seeded people.

create table if not exists ci_persons (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  display_name text not null,
  normalized_name text not null,
  aliases text not null default '',
  role text not null,
  status text not null,
  birth_year integer,
  nationality text,
  region text,
  summary text not null default '',
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ci_persons_user_idx on ci_persons (user_id, normalized_name, updated_at desc);

create table if not exists ci_person_sources (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  person_id text not null,
  source_id text not null,
  relation text not null,
  evidence_class text not null,
  created_at timestamptz not null default now()
);
create index if not exists ci_person_sources_idx on ci_person_sources (user_id, person_id);

create table if not exists ci_person_cases (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  person_id text not null,
  case_id text not null,
  relation text not null,
  evidence_class text not null,
  source_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists ci_person_cases_idx on ci_person_cases (user_id, person_id, case_id);

alter table ci_case_people add column if not exists person_id text;
