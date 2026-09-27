-- Calculated fields on versioned insights, plus the current derived rows.
-- Empty strings mean the row predates this analysis and must be recomputed once.

alter table ci_insights add column if not exists data_class text not null default '';
alter table ci_insights add column if not exists marks text not null default '';
alter table ci_insights add column if not exists rarity text not null default '';
alter table ci_insights add column if not exists calculations text not null default '';
alter table ci_insights add column if not exists differences text not null default '';
alter table ci_insights add column if not exists unknown_note text not null default '';
alter table ci_insights add column if not exists next_questions text not null default '';
alter table ci_insights add column if not exists method text not null default '';

create table if not exists ci_derived (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  kind text not null,
  value text not null,
  method text not null,
  inputs text not null,
  case_ids text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ci_derived_user_idx on ci_derived (user_id, created_at desc);
