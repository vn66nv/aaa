-- Проверка правил schema.sql. Запуск: tests/schema.sh
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');
create function pg_temp.act(uid text, anon boolean) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false), set_config('request.jwt.claims', json_build_object('sub', uid, 'is_anonymous', anon)::text, false); $$;
create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c then raise notice '✔ %', msg; else raise exception '✘ %', msg; end if; end $$;
create function pg_temp.fails(q text, msg text) returns void language plpgsql as $$
begin execute q; raise exception '✘ % (не упало)', msg; exception when others then if sqlerrm like '✘%' then raise; end if; raise notice '✔ % (%)', msg, sqlerrm; end $$;
grant execute on all functions in schema pg_temp to authenticated;

set role authenticated;
-- A: гость
select pg_temp.act('00000000-0000-0000-0000-00000000000a', true);
insert into marks (type, lat, lng, note) values ('dps', 13.75, 100.5, 'у 7-Eleven');
select pg_temp.ok((select author like 'Пользователь %' and user_id = auth.uid() from marks limit 1), 'гость ставит метку, автор «Пользователь N»');
select pg_temp.fails($$insert into marks (type, lat, lng) values ('dps', 48.8, 2.3)$$, 'метка вне Таиланда отклонена');
select pg_temp.fails($$insert into marks (type, lat, lng, confirms) values ('dps', 13.7, 100.5, 50)$$, 'нельзя создать метку с накрученными голосами');
select pg_temp.fails($$insert into marks (type, lat, lng, user_id) values ('dps', 13.7, 100.5, '00000000-0000-0000-0000-00000000000b')$$, 'нельзя поставить метку от чужого имени');
select pg_temp.fails($$select vote_mark((select id from marks limit 1), true)$$, 'гость не может голосовать');
insert into marks (type, lat, lng) select 'warn', 13.7, 100.5 from generate_series(1, 4);
select pg_temp.fails($$insert into marks (type, lat, lng) values ('warn', 13.7, 100.5)$$, 'антиспам: 6-я метка за 10 минут отклонена');

-- B: вошёл по почте
select pg_temp.act('00000000-0000-0000-0000-00000000000b', false);
insert into profiles (id, name) values (auth.uid(), 'Сомчай');
select pg_temp.fails($$insert into profiles (id, name) values ('00000000-0000-0000-0000-00000000000c', 'Чужой')$$, 'нельзя создать профиль за другого');
select pg_temp.fails($$update profiles set verified = true where id = auth.uid()$$, 'нельзя выдать себе «звёздочку»');
update profiles set name = 'Сомчай Т.' where id = auth.uid();
select pg_temp.ok((select name = 'Сомчай Т.' from profiles where id = auth.uid()), 'своё имя менять можно');
select pg_temp.ok(vote_mark((select id from marks where note = 'у 7-Eleven'), true) = 'ok', 'голос ✔ принят');
select pg_temp.ok(vote_mark((select id from marks where note = 'у 7-Eleven'), true) = 'already', 'второй голос того же человека не засчитан');
select pg_temp.ok((select confirms = 1 and last_confirm_by = 'Сомчай Т.' from marks where note = 'у 7-Eleven'), 'счётчик 1 и имя последнего проголосовавшего');
update marks set confirms = 999;
select pg_temp.ok((select max(confirms) = 1 from marks), 'прямая накрутка счётчика не работает');
delete from marks;
select pg_temp.ok((select count(*) = 5 from marks), 'прямое удаление чужих меток не работает');
select pg_temp.ok(not delete_mark((select id from marks where note = 'у 7-Eleven')), 'delete_mark чужой метки → false');
insert into marks (type, lat, lng) values ('dps', 18.79, 98.98);
select pg_temp.ok((select author = 'Сомчай Т.' from marks where lat = 18.79), 'автор метки берётся из профиля');

-- C: второй пользователь голосует ✖
select pg_temp.act('00000000-0000-0000-0000-00000000000c', false);
select pg_temp.ok(vote_mark((select id from marks where note = 'у 7-Eleven'), false) = 'ok', 'голос ✖ принят');
select pg_temp.ok((select denies = 1 and last_deny_by like 'Пользователь %' from marks where note = 'у 7-Eleven'), 'счётчик ✖ и имя');

-- A удаляет свою
select pg_temp.act('00000000-0000-0000-0000-00000000000a', true);
select pg_temp.ok(delete_mark((select id from marks where note = 'у 7-Eleven')), 'автор удаляет свою метку');
select pg_temp.ok((select count(*) = 0 from marks where note = 'у 7-Eleven'), 'метка удалена вместе с голосами');
reset role;
select pg_temp.ok((select count(*) = 0 from votes v left join marks m on m.id = v.mark_id where m.id is null), 'голоса удалённой метки не остались');
select pg_temp.ok((select count(*) = 1 from pg_publication_tables where tablename = 'marks'), 'marks в публикации Realtime');
\echo Все проверки схемы прошли
