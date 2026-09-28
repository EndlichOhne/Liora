-- Short-lived confirmation for export and account deletion. No secrets.

create table if not exists ci_reauth (
  user_id text primary key references "user" ("id") on delete cascade,
  confirmed_at timestamptz not null default now()
);
