begin;

select plan(23);

create function pg_temp.make_user(uid uuid) returns void
language sql as $$
  insert into auth.users (id, email) values (uid, uid::text || '@example.test');
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

create function pg_temp.as_anon() returns void
language sql as $$
  select set_config('role', 'anon', true);
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Second');

insert into public.pages (id, user_id, notebook_id, status) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read'),
  ('55555555-5555-5555-5555-555555555555', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'read');

insert into public.page_alerts (user_id, page_id, kind, details) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'missing_line', '{"line": 3}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'math_incomplete', '{"statements": ["x = 1"]}');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is(
  (select array_agg(kind) from public.page_alerts),
  array['missing_line'],
  'a user reads the alerts of their own pages only'
);

select is(
  (select details from public.page_alerts),
  '{"line": 3}'::jsonb,
  'an alert keeps its details'
);

select throws_ok(
  $$insert into public.page_alerts (page_id, kind) values ('44444444-4444-4444-4444-444444444444', 'math_incomplete')$$,
  '42501', null, 'a user cannot write an alert, even on their own page'
);

select throws_ok(
  $$update public.page_alerts set kind = 'math_incomplete'$$,
  '42501', null, 'a user cannot change an alert'
);

select throws_ok(
  $$delete from public.page_alerts$$,
  '42501', null, 'a user cannot dismiss an alert'
);

reset role;

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select array_agg(kind) from public.page_alerts),
  array['math_incomplete'],
  'another user reads only the alerts of their own page'
);

reset role;

select pg_temp.as_anon();

select throws_ok('select count(*) from public.page_alerts', '42501', null, 'a visitor without an account cannot read the alerts');

reset role;

select is(
  (select count(*) from public.page_alerts),
  2::bigint,
  'those attempts changed nothing'
);

select throws_ok(
  $$insert into public.page_alerts (user_id, page_id, kind) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444', 'math_incomplete')$$,
  '23503', null, 'an alert cannot be attached to the page of another user'
);

select throws_ok(
  $$insert into public.page_alerts (user_id, page_id, kind) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'missing_line')$$,
  '23505', null, 'a page has one alert of each kind'
);

select throws_ok(
  $$insert into public.page_alerts (user_id, page_id, kind) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'spelling')$$,
  '23514', null, 'a kind of alert that does not exist is refused'
);

select throws_ok(
  $$insert into public.page_alerts (user_id, page_id, kind, details) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'math_incomplete', '[1]')$$,
  '23514', null, 'the details of an alert are an object'
);

select throws_ok(
  $$insert into public.page_alerts (user_id, page_id, kind, details) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'math_incomplete', jsonb_build_object('statements', repeat('x', 20000)))$$,
  '23514', null, 'the details of an alert are bounded in size'
);

select pg_temp.as_server();

select lives_ok(
  $$insert into public.page_alerts (user_id, page_id, kind) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'math_incomplete')$$,
  'the server writes an alert without details'
);

select is(
  (select details from public.page_alerts where kind = 'math_incomplete' and page_id = '44444444-4444-4444-4444-444444444444'),
  '{}'::jsonb,
  'an alert without details holds an empty object'
);

select lives_ok(
  $$update public.page_alerts set details = '{"line": 4}' where kind = 'missing_line' and page_id = '44444444-4444-4444-4444-444444444444'$$,
  'the server changes the details of an alert'
);

select lives_ok(
  $$delete from public.page_alerts where kind = 'math_incomplete' and page_id = '44444444-4444-4444-4444-444444444444'$$,
  'the server erases an alert'
);

reset role;

select is(has_table_privilege('authenticated', 'public.page_alerts', 'select'), true, 'a user can read alerts');
select is(has_table_privilege('authenticated', 'public.page_alerts', 'insert'), false, 'a user has no right to insert an alert');
select is(has_table_privilege('authenticated', 'public.page_alerts', 'update'), false, 'a user has no right to change an alert');

delete from public.pages where id = '44444444-4444-4444-4444-444444444444';

select is(
  (select count(*) from public.page_alerts where page_id = '44444444-4444-4444-4444-444444444444'),
  0::bigint,
  'deleting a page deletes its alerts'
);

delete from auth.users where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select is(
  (select count(*) from public.page_alerts where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0::bigint,
  'deleting an account deletes its alerts'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'page_alerts' and c.relrowsecurity),
  1::bigint,
  'alerts have row level security'
);

select * from finish();

rollback;
