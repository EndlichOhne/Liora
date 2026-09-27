-- Stored features and versioned cross-case notes. No seeded facts.

create table if not exists ci_case_features (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  case_id text not null,
  feature_key text not null,
  feature_value text not null,
  origin text not null,
  evidence_class text not null,
  source_url text not null default '',
  auto boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ci_case_features_idx on ci_case_features (user_id, case_id);

create table if not exists ci_insights (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  insight_key text not null,
  version integer not null,
  title text not null,
  kind text not null,
  priority text not null,
  confidence text not null,
  status text not null,
  reason text not null,
  alternative text not null,
  disconfirmation text not null,
  chain text not null default '',
  sources text not null default '',
  case_ids text not null default '',
  feature_note text not null default '',
  official_note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ci_insights_user_idx on ci_insights (user_id, status, created_at desc);
create index if not exists ci_insights_key_idx on ci_insights (user_id, insight_key, version desc);

create table if not exists ci_discovery_state (
  user_id text primary key references "user" ("id") on delete cascade,
  fingerprint text not null default '',
  updated_at timestamptz not null default now()
);
