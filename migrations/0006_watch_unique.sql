delete from ci_watches w
where exists (
  select 1 from ci_watches o
  where o.user_id = w.user_id and o.url = w.url and o.id < w.id
);

create unique index if not exists ci_watches_user_url_uidx on ci_watches (user_id, url);
