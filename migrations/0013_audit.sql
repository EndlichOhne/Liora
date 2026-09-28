-- Security audit. Action, resource and result only. No bodies, tokens or secrets.

create table if not exists ci_audit (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  action text not null,
  resource text not null,
  result text not null,
  created_at timestamptz not null default now()
);
create index if not exists ci_audit_user_idx on ci_audit (user_id, created_at desc);
