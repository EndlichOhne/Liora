-- Case candidates staged from real public sources. No seeded cases.

create table if not exists ci_case_candidates (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  title text not null,
  region text not null,
  city text not null default '',
  case_type text not null,
  case_status text not null,
  opened_on text not null default '',
  summary text not null default '',
  source_ids text not null default '',
  source_url text not null default '',
  origin_key text not null default '',
  evidence_class text not null default 'unknown',
  confidence text not null default 'low',
  status text not null,
  missing_note text not null default '',
  case_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ci_case_candidates_user_idx on ci_case_candidates (user_id, status, updated_at desc);
create unique index if not exists ci_case_candidates_origin_idx on ci_case_candidates (user_id, origin_key) where origin_key <> '';
