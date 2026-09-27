-- Liora personal assistant schema. Per-user rows; every query is scoped by session user id.

create table if not exists profiles (
  user_id text primary key references "user" ("id") on delete cascade,
  display_name text not null default '',
  language text not null default 'de',
  writing_notes text not null default '',
  response_style text not null default 'balanced',
  theme text not null default 'system',
  model_id text not null default 'grok-4.5',
  voice_id text not null default 'eve',
  voice_auto boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists recovery_codes (
  user_id text primary key references "user" ("id") on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  name text not null,
  summary text not null default '',
  context_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_idx on projects (user_id, updated_at desc);

create table if not exists project_notes (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  user_id text not null references "user" ("id") on delete cascade,
  title text not null,
  body text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists project_notes_idx on project_notes (project_id, updated_at desc);

create table if not exists project_tasks (
  id text primary key,
  project_id text not null references projects (id) on delete cascade,
  user_id text not null references "user" ("id") on delete cascade,
  title text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists project_tasks_idx on project_tasks (project_id, created_at);

create table if not exists conversations (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  project_id text references projects (id) on delete set null,
  title text not null default 'Neue Unterhaltung',
  mode text not null default 'normal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_idx on conversations (user_id, updated_at desc);

create table if not exists messages (
  id text primary key,
  conversation_id text not null references conversations (id) on delete cascade,
  user_id text not null references "user" ("id") on delete cascade,
  role text not null,
  content text not null default '',
  reasoning text not null default '',
  citations jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  image_data text,
  status text not null default 'complete',
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on messages (conversation_id, created_at);
create index if not exists messages_user_idx on messages (user_id, created_at desc);

create table if not exists memories (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  category text not null,
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists memories_user_idx on memories (user_id, updated_at desc);

create table if not exists files (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  project_id text references projects (id) on delete set null,
  name text not null,
  mime text not null,
  size_bytes integer not null,
  kind text not null,
  extracted_text text not null default '',
  image_data text,
  created_at timestamptz not null default now()
);
create index if not exists files_user_idx on files (user_id, created_at desc);

create table if not exists usage_events (
  id text primary key,
  user_id text not null,
  kind text not null,
  created_at timestamptz not null default now()
);
create index if not exists usage_user_idx on usage_events (user_id, kind, created_at desc);
