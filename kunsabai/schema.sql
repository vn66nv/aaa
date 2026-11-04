-- Kunsabai — схема Supabase. Выполнить целиком в Supabase → SQL Editor.
-- Перед этим: Authentication → Sign In / Providers → включить «Allow anonymous sign-ins» и Email (OTP).

-- ---------- профили ----------
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 24),
  verified boolean not null default false,          -- «звёздочка»: ставится вручную в Table Editor
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "profiles read"   on profiles for select using (true);
create policy "profiles insert" on profiles for insert with check (id = auth.uid() and verified = false);
create policy "profiles update" on profiles for update using (id = auth.uid());
revoke update on profiles from anon, authenticated;
grant update (name) on profiles to authenticated;

-- имя для показа: профиль или «Пользователь 12345»
create or replace function display_name(uid uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from profiles where id = uid), 'Пользователь ' || (abs(hashtext(uid::text)) % 90000 + 10000));
$$;

-- ---------- метки ----------
create table if not exists marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  type text not null check (type in ('dps','warn')),
  lat double precision not null check (lat between 5.4 and 20.6),
  lng double precision not null check (lng between 97.2 and 105.8),
  note text check (char_length(note) <= 140),
  author text,
  author_verified boolean not null default false,
  confirms int not null default 0,
  denies int not null default 0,
  last_confirm_by text, last_confirm_at timestamptz,
  last_deny_by text,    last_deny_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists marks_seen on marks (last_seen_at desc);
create index if not exists marks_user on marks (user_id, created_at desc);
alter table marks enable row level security;
create policy "marks read"   on marks for select using (true);
create policy "marks insert" on marks for insert with check (auth.uid() is not null and user_id = auth.uid() and confirms = 0 and denies = 0);

-- автор, проверка и антиспам на сервере
create or replace function marks_before_insert() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from marks where user_id = new.user_id and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Слишком много меток. Подождите несколько минут.';
  end if;
  new.author := display_name(new.user_id);
  new.author_verified := coalesce((select verified from profiles where id = new.user_id), false);
  new.created_at := now(); new.last_seen_at := now();
  new.last_confirm_by := null; new.last_confirm_at := null; new.last_deny_by := null; new.last_deny_at := null;
  return new;
end $$;
drop trigger if exists marks_bi on marks;
create trigger marks_bi before insert on marks for each row execute function marks_before_insert();

-- ---------- голоса: один на метку на пользователя ----------
create table if not exists votes (
  mark_id uuid references marks on delete cascade,
  user_id uuid references auth.users on delete cascade,
  is_yes boolean not null,
  created_at timestamptz not null default now(),
  primary key (mark_id, user_id)
);
alter table votes enable row level security;
create policy "votes own read" on votes for select using (user_id = auth.uid());

create or replace function vote_mark(mark_id uuid, is_yes boolean) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); who text;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Авторизуйтесь, чтобы оставлять реакции к меткам';
  end if;
  insert into votes values (vote_mark.mark_id, uid, vote_mark.is_yes) on conflict do nothing;
  if not found then return 'already'; end if;
  who := display_name(uid);
  if is_yes then
    update marks set confirms = confirms + 1, last_confirm_by = who, last_confirm_at = now(), last_seen_at = now() where id = vote_mark.mark_id;
  else
    update marks set denies = denies + 1, last_deny_by = who, last_deny_at = now() where id = vote_mark.mark_id;
  end if;
  return 'ok';
end $$;
revoke execute on function vote_mark(uuid, boolean) from public, anon;
grant execute on function vote_mark(uuid, boolean) to authenticated;

create or replace function delete_mark(mark_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from marks where id = mark_id and user_id = auth.uid();
  return found;
end $$;
revoke execute on function delete_mark(uuid) from public, anon;
grant execute on function delete_mark(uuid) to authenticated;

-- ---------- живое обновление ----------
alter publication supabase_realtime add table marks;
