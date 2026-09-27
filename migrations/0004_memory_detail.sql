alter table memories add column if not exists source_note text not null default '';
alter table memories add column if not exists confidence text not null default '';
alter table memories add column if not exists status text not null default 'active';
alter table memories add column if not exists verified_at timestamptz;
