-- Выполнить один раз в Supabase → SQL Editor
create table if not exists marks (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('dps','warn')),
  lat double precision not null check (lat between 5.4 and 20.6),
  lng double precision not null check (lng between 97.2 and 105.8),
  note text check (char_length(note) <= 140),
  author text not null default 'Аноним' check (char_length(author) <= 24),
  confirms int not null default 0,
  denies int not null default 0,
  last_confirm_by text, last_confirm_at timestamptz,
  last_deny_by text,    last_deny_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists marks_seen on marks (last_seen_at desc);

alter table marks enable row level security;
create policy "read all"   on marks for select using (true);
create policy "insert any" on marks for insert with check (confirms = 0 and denies = 0);

create or replace function vote_mark(mark_id uuid, is_yes boolean, voter text) returns void
language plpgsql security definer set search_path = public as $$
begin
  voter := left(coalesce(nullif(trim(voter), ''), 'Аноним'), 24);
  if is_yes then
    update marks set confirms = confirms + 1, last_confirm_by = voter, last_confirm_at = now(), last_seen_at = now() where id = mark_id;
  else
    update marks set denies = denies + 1, last_deny_by = voter, last_deny_at = now() where id = mark_id;
  end if;
end $$;
grant execute on function vote_mark(uuid, boolean, text) to anon;

-- удаление своей метки (до подключения Supabase Auth проверяется по имени автора)
create or replace function delete_mark(mark_id uuid, who text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from marks where id = mark_id and author = who;
end $$;
grant execute on function delete_mark(uuid, text) to anon;
