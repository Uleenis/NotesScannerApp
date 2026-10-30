begin;

select plan(62);

create function pg_temp.make_user(uid uuid) returns void
language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at) values (uid, uid::text || '@example.test', now());
  update public.profiles
  set birth_year = extract(year from now() at time zone 'Europe/Paris')::integer - 30, country = 'FR'
  where id = uid;
end;
$$;

create function pg_temp.login(uid uuid) returns void
language sql as $$
  select
    set_config('role', 'authenticated', true),
    set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.as_server() returns void
language sql as $$
  select set_config('role', 'service_role', true);
$$;

create function pg_temp.day(d date) returns integer
language sql as $$
  select d - date '2000-01-01';
$$;

create function pg_temp.pair(header text) returns text
language sql as $$
  select coalesce((select p.num || ':' || p.day from private.date_pair(header) p), 'none');
$$;

create function pg_temp.header(n integer, shift integer default 0) returns text
language sql as $$
  select 'Jour ' || n || ' ' || to_char(date '2026-01-01' + n + shift, 'DD/MM/YYYY') || E'\nSuite de la page';
$$;

create function pg_temp.page_id(n integer) returns uuid
language sql as $$
  select ('e0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$$;

create function pg_temp.add_page(n integer, nb uuid, shown text, lang text default 'fr', st text default 'read', kind text default 'text') returns void
language plpgsql as $$
declare
  v_user uuid;
begin
  select n2.user_id into v_user from public.notebooks n2 where n2.id = nb;
  insert into public.pages (id, user_id, notebook_id, status, page_type, language, captured_at, uploaded_at)
  values (pg_temp.page_id(n), v_user, nb, st, kind, lang, '2026-01-01 12:00:00+00', '2026-01-01 12:00:00+00');
  insert into public.page_texts (user_id, page_id, text, pipeline_version) values (v_user, pg_temp.page_id(n), shown, 'b1-raw');
end;
$$;

create function pg_temp.flagged(nb uuid) returns text
language sql as $$
  select coalesce(string_agg(ltrim(right(a.page_id::text, 12), '0'), ',' order by a.page_id), '')
  from public.page_alerts a
  join public.pages p on p.id = a.page_id
  where p.notebook_id = nb and a.kind = 'date_incoherent';
$$;

create function pg_temp.consistent(nb uuid) returns boolean
language sql as $$
  select
    not exists (
      (select a.page_id from public.page_alerts a join public.pages p on p.id = a.page_id where p.notebook_id = nb and a.kind = 'date_incoherent')
      except
      (select page_id from private.date_alerts_notebook(nb))
    )
    and not exists (
      (select page_id from private.date_alerts_notebook(nb))
      except
      (select a.page_id from public.page_alerts a join public.pages p on p.id = a.page_id where p.notebook_id = nb and a.kind = 'date_incoherent')
    );
$$;

select is(pg_temp.pair('Jour 15 28/02/2026'), '15:' || pg_temp.day(date '2026-02-28'), 'a header with a day number and a date is a pair');
select is(pg_temp.pair('JOUR 3 16.02.26'), '3:' || pg_temp.day(date '2026-02-16'), 'the case is free, the separator may be a dot and the year may have two digits');
select is(pg_temp.pair('jour 42 5 - 3 - 2026'), '42:' || pg_temp.day(date '2026-03-05'), 'spaces around the separators are tolerated');
select is(pg_temp.pair('Jour: 7 01-03-2026'), '7:' || pg_temp.day(date '2026-03-01'), 'a colon may follow the word');
select is(pg_temp.pair('Jours 7 01/03/2026'), '7:' || pg_temp.day(date '2026-03-01'), 'the plural is read too');
select is(pg_temp.pair(E'\n  \nJour 9 10/03/2026\nJour 10 11/03/2026'), '9:' || pg_temp.day(date '2026-03-10'), 'the header is the first line that is not empty');
select is(pg_temp.pair(E'\r\nJour 9 10/03/2026\r\nJour 10 11/03/2026'), '9:' || pg_temp.day(date '2026-03-10'), 'carriage returns do not matter');
select is(pg_temp.pair(E'Jour 9 10/03/2026'), '9:' || pg_temp.day(date '2026-03-10'), 'a no-break space is a space');
select is(pg_temp.pair(E'Chapitre\nJour 9 10/03/2026'), 'none', 'a pair in the body is not a pair of the header');
select is(pg_temp.pair('Jour 9'), 'none', 'a number alone is no pair');
select is(pg_temp.pair('10/03/2026'), 'none', 'a date alone is no pair');
select is(pg_temp.pair('Jour 9 20/04/202 10/03/2026'), '9:' || pg_temp.day(date '2026-03-10'), 'a date of three digits for the year is skipped, the next valid one counts');
select is(pg_temp.pair('Jour 9 20/04/202'), 'none', 'a date of three digits for the year is no date');
select is(pg_temp.pair('Jour 9 31/02/2026'), 'none', 'a day that does not exist is no date');
select is(pg_temp.pair('Jour 9 10/13/2026'), 'none', 'a month that does not exist is no date');
select is(pg_temp.pair('Jour 9 00/01/2026'), 'none', 'day zero is no date');
select is(pg_temp.pair('Jour 9 110/03/2026'), 'none', 'a date glued to a longer number is no date');
select is(pg_temp.pair('Jour 9 10/03/20266'), 'none', 'a date glued to a longer year is no date');
select is(pg_temp.pair('Toujours 5 10/03/2026'), 'none', 'a word that only ends in jours is no day number');
select is(pg_temp.pair('Jour 1234 10/03/2026'), 'none', 'a day number has one to three digits');
select is(pg_temp.pair('éJour 9 10/03/2026'), 'none', 'a letter outside ASCII glued before the word keeps it from being a day number');
select is(pg_temp.pair('Jour 9é 10/03/2026'), 'none', 'a letter outside ASCII glued after the number keeps it from being a day number');
select is(pg_temp.pair('(Jour 9) 10/03/2026'), '9:' || pg_temp.day(date '2026-03-10'), 'an ASCII sign before the word and after the number is a separator');
select is(pg_temp.pair(''), 'none', 'an empty text has no pair');

select is(private.date_flags('{0,0,0,0,0,0}'), '{f,f,f,f,f,f}'::boolean[], 'offsets that agree raise nothing');
select is(private.date_flags('{0,0,0,0,0,5}'), '{f,f,f,f,f,t}'::boolean[], 'an offset far from the others is flagged');
select is(private.date_flags('{0,0,0,0,0,2}'), '{f,f,f,f,f,f}'::boolean[], 'two days of gap are tolerated');
select is(private.date_flags('{0,0,0,0,0,3}'), '{f,f,f,f,f,t}'::boolean[], 'three days of gap raise the alert');
select is(private.date_flags('{0,0,9}'), '{f,f,f}'::boolean[], 'fewer than four pairs raise nothing');
select is(private.date_flags('{0,0,0,9}'), '{f,f,f,t}'::boolean[], 'three agreeing pairs are enough to flag the fourth');
select is(private.date_flags('{0,0,0,0,40,41}'), '{f,f,f,f,t,t}'::boolean[], 'two wrong pairs do not hide each other');
select is(private.date_flags('{1,0,-1,0,0,3,-3}'), '{f,f,f,f,f,t,t}'::boolean[], 'the reference of a page leaves out the pages it flags itself');
select is(
  private.date_flags('{-365,1,1,0,2,2,1,-1,2,2,-2,-2,1,-1}'),
  '{t,f,f,f,f,f,f,f,f,f,t,t,f,f}'::boolean[],
  'a year typo and the pairs that sit two days off the cleaned median are flagged'
);
select is(private.date_flags('{5,5,5,5,0}'), '{f,f,f,f,t}'::boolean[], 'the median, not the first value, is the reference');
select is(private.date_flags('{}'), '{}'::boolean[], 'no pair, no flag');

select pg_temp.make_user('f1000000-0000-0000-0000-000000000001');
select pg_temp.make_user('f1000000-0000-0000-0000-000000000002');

insert into public.consents (user_id, kind, version, granted_by) values
  ('f1000000-0000-0000-0000-000000000001', 'training', 'training-1', 'user');

insert into public.htr_models (id, user_id, name, version, status, storage_path, cer) values
  ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'personal', 1, 'active',
   'f1000000-0000-0000-0000-000000000001/1.safetensors', 0.1);

insert into public.notebooks (id, user_id, name) values
  ('f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'Diary'),
  ('f3000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 'Second diary'),
  ('f3000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001', 'Course'),
  ('f3000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000002', 'Other');

update public.notebooks set correction_level = 'journal'
where id in ('f3000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000002');

set constraints all immediate;

select pg_temp.add_page(1, 'f3000000-0000-0000-0000-000000000001', pg_temp.header(1));
select pg_temp.add_page(2, 'f3000000-0000-0000-0000-000000000001', pg_temp.header(2));
select pg_temp.add_page(3, 'f3000000-0000-0000-0000-000000000001', pg_temp.header(3));
select pg_temp.add_page(4, 'f3000000-0000-0000-0000-000000000001', pg_temp.header(4));
select pg_temp.add_page(5, 'f3000000-0000-0000-0000-000000000001', pg_temp.header(5));
select pg_temp.add_page(6, 'f3000000-0000-0000-0000-000000000001', pg_temp.header(6, 5));

select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '6', 'a page whose date does not follow the notebook gets the alert');
select is(
  (select details from public.page_alerts where page_id = pg_temp.page_id(6) and kind = 'date_incoherent'),
  '{}'::jsonb,
  'the alert carries no value'
);
select is(
  (select text from public.page_texts where page_id = pg_temp.page_id(6)),
  pg_temp.header(6, 5),
  'the alert writes nothing in the text'
);

update public.page_texts set text = pg_temp.header(6) where page_id = pg_temp.page_id(6);
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '', 'correcting the header clears the alert');

update public.page_texts set text = pg_temp.header(3, -10) where page_id = pg_temp.page_id(3);
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '3', 'a changed text raises it');

update public.pages set language = 'en' where id = pg_temp.page_id(3);
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '', 'a page that is not in French is left out');
update public.pages set language = 'fr' where id = pg_temp.page_id(3);
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '3', 'and comes back with its language');

update public.pages set status = 'processing' where id = pg_temp.page_id(3);
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '', 'a page being read again is left out');
update public.pages set status = 'read' where id = pg_temp.page_id(3);

update public.pages set page_type = 'math' where id = pg_temp.page_id(3);
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '', 'a math page is left out');
update public.pages set page_type = 'text' where id = pg_temp.page_id(3);
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '3', 'and comes back as text');

update public.pages set notebook_id = 'f3000000-0000-0000-0000-000000000002' where id = pg_temp.page_id(3);
select is(
  pg_temp.flagged('f3000000-0000-0000-0000-000000000001') || '|' || pg_temp.flagged('f3000000-0000-0000-0000-000000000002'),
  '|',
  'a moved page loses its alert, and the notebook that receives it has too few pairs to judge it'
);
update public.pages set notebook_id = 'f3000000-0000-0000-0000-000000000001' where id = pg_temp.page_id(3);
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '3', 'moved back, it is judged again');

delete from public.pages where id = pg_temp.page_id(1);
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '3', 'deleting a page recalculates the notebook');
delete from public.pages where id = pg_temp.page_id(2);
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '3', 'four pairs are enough to judge');
delete from public.pages where id = pg_temp.page_id(4);
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '', 'a notebook left with three pairs judges none');

select pg_temp.add_page(7, 'f3000000-0000-0000-0000-000000000001', pg_temp.header(7));
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '3', 'a new page brings the pairs back to four');

update public.notebooks set correction_level = 'course' where id = 'f3000000-0000-0000-0000-000000000001';
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '', 'a notebook that leaves the journal level loses its alerts');
update public.notebooks set correction_level = 'journal' where id = 'f3000000-0000-0000-0000-000000000001';
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '3', 'and finds them again when it comes back');

select pg_temp.add_page(8, 'f3000000-0000-0000-0000-000000000003', pg_temp.header(8));
select pg_temp.add_page(9, 'f3000000-0000-0000-0000-000000000003', pg_temp.header(9));
select pg_temp.add_page(10, 'f3000000-0000-0000-0000-000000000003', pg_temp.header(10));
select pg_temp.add_page(11, 'f3000000-0000-0000-0000-000000000003', pg_temp.header(11));
select pg_temp.add_page(12, 'f3000000-0000-0000-0000-000000000003', pg_temp.header(12, 9));
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000003'), '', 'a notebook at the course level never gets an alert');

update public.htr_models set cer = 0.2 where id = 'f2000000-0000-0000-0000-000000000001';
select is(
  (select correction_level from public.notebooks where id = 'f3000000-0000-0000-0000-000000000001'),
  'course',
  'a model that leaves service puts the notebook back at the course level'
);
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000001'), '', 'and its alerts go with it');
select ok(
  pg_temp.consistent('f3000000-0000-0000-0000-000000000001') and pg_temp.consistent('f3000000-0000-0000-0000-000000000002') and pg_temp.consistent('f3000000-0000-0000-0000-000000000003'),
  'the alerts of every notebook equal a full recalculation'
);

select pg_temp.make_user('f1000000-0000-0000-0000-000000000003');
insert into public.notebooks (id, user_id, name) values ('f3000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000003', 'Large');
insert into public.consents (user_id, kind, version, granted_by) values ('f1000000-0000-0000-0000-000000000003', 'training', 'training-1', 'user');
insert into public.htr_models (id, user_id, name, version, status, storage_path, cer) values
  ('f2000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000003', 'personal', 1, 'active', 'f1000000-0000-0000-0000-000000000003/1.safetensors', 0.1);
update public.notebooks set correction_level = 'journal' where id = 'f3000000-0000-0000-0000-000000000005';

set constraints all deferred;
select pg_temp.add_page(n, 'f3000000-0000-0000-0000-000000000005', pg_temp.header(n, case when n = 400 then 9 else 0 end))
from generate_series(100, 599) as n;
set constraints all immediate;
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000005'), '400', 'a notebook of 500 pairs is judged');

select pg_temp.add_page(600, 'f3000000-0000-0000-0000-000000000005', pg_temp.header(600));
select is(pg_temp.flagged('f3000000-0000-0000-0000-000000000005'), '', 'a notebook of more than 500 pairs is not judged, and its alerts are cleared');

select pg_temp.add_page(13, 'f3000000-0000-0000-0000-000000000004', pg_temp.header(13));

select ok(
  has_function_privilege('authenticated', 'private.date_flags(integer[])', 'execute') is not true
  and has_function_privilege('anon', 'private.refresh_dates(uuid)', 'execute') is not true,
  'the functions of the check are not reachable by the client'
);

update public.htr_models set cer = 0.1 where id = 'f2000000-0000-0000-0000-000000000001';
update public.notebooks set correction_level = 'journal' where id = 'f3000000-0000-0000-0000-000000000001';
select pg_temp.login('f1000000-0000-0000-0000-000000000001');
select is(
  (select array_agg(ltrim(right(page_id::text, 12), '0') order by page_id) from public.page_alerts where kind = 'date_incoherent'),
  array['3'],
  'a user reads the date alerts of their own pages'
);
select pg_temp.login('f1000000-0000-0000-0000-000000000002');
select is((select count(*) from public.page_alerts), 0::bigint, 'and no one else reads them');

select * from finish();
rollback;
