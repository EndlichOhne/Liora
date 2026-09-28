-- Structured features, named datasets, evidence chains, case links, source provenance.
-- No seeded facts.

alter table ci_sources add column if not exists canonical_source_id text not null default '';
alter table ci_sources add column if not exists source_parent_id text not null default '';
alter table ci_sources add column if not exists source_origin text not null default '';
alter table ci_sources add column if not exists source_relationship text not null default 'UNKNOWN';
alter table ci_sources add column if not exists duplicate_group text not null default '';
alter table ci_sources add column if not exists independence_status text not null default 'unknown';

create table if not exists ci_structured_features (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  case_id text not null default '',
  feature text not null,
  normalized_value text not null,
  original_text text not null,
  source text not null default '',
  source_id text not null default '',
  confidence text not null default 'low',
  status text not null default 'extracted',
  created_at timestamptz not null default now()
);
create index if not exists ci_structured_features_idx on ci_structured_features (user_id, case_id, feature);

create table if not exists ci_datasets (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  dataset_name text not null,
  dataset_size integer not null,
  filters text not null default '',
  region text not null default '',
  time_range text not null default '',
  generated_at timestamptz not null default now()
);
create index if not exists ci_datasets_idx on ci_datasets (user_id, generated_at desc);

create table if not exists ci_evidence_chains (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  finding text not null,
  input_facts text not null default '',
  source_ids text not null default '',
  derivation_method text not null,
  confidence text not null,
  alternative_explanation text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists ci_evidence_chains_idx on ci_evidence_chains (user_id, created_at desc);

create table if not exists ci_case_links (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  left_case_id text not null,
  right_case_id text not null,
  link_kind text not null,
  link_strength text not null,
  supporting_features text not null default '',
  contradicting_features text not null default '',
  source_count integer not null default 0,
  independent_source_count integer not null default 0,
  note text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists ci_case_links_uq on ci_case_links (user_id, left_case_id, right_case_id, link_kind);
create index if not exists ci_case_links_idx on ci_case_links (user_id, created_at desc);

alter table ci_finding_versions add column if not exists change_kind text not null default 'CHANGED';
