-- Выполнить один раз в Supabase → SQL Editor
create table if not exists marks (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('post','patrol','camera','accident','road','check')),
  lat double precision not null check (lat between 5.4 and 20.6),
  lng double precision not null check (lng between 97.2 and 105.8),
  note text check (char_length(note) <= 140),
  confirms int not null default 1,
  denies int not null default 0,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists marks_seen on marks (last_seen_at desc);

alter table marks enable row level security;
create policy "read all"   on marks for select using (true);
create policy "insert any" on marks for insert with check (confirms = 1 and denies = 0);

-- голосование только через функцию (прямой update запрещён)
create or replace function vote_mark(mark_id uuid, is_yes boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if is_yes then
    update marks set confirms = confirms + 1, last_seen_at = now() where id = mark_id;
  else
    update marks set denies = denies + 1,
      last_seen_at = case when denies + 1 >= 3 and denies + 1 > confirms then now() - interval '24 hours' else last_seen_at end
    where id = mark_id;
  end if;
end $$;
grant execute on function vote_mark(uuid, boolean) to anon;
