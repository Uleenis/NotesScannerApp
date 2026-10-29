begin;

select plan(49);

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

select pg_temp.make_user('d1d1d1d1-0000-0000-0000-000000000001');
select pg_temp.make_user('d1d1d1d1-0000-0000-0000-000000000002');
select pg_temp.make_user('d1d1d1d1-0000-0000-0000-000000000003');

insert into public.consents (user_id, kind, version, granted_by) values
  ('d1d1d1d1-0000-0000-0000-000000000001', 'training', 'training-1', 'user'),
  ('d1d1d1d1-0000-0000-0000-000000000002', 'training', 'training-1', 'user');

select has_table('public', 'writing_tests', 'the writing tests have a table');
select is(
  (select relrowsecurity from pg_class where oid = 'public.writing_tests'::regclass),
  true,
  'row level security is on for the writing tests'
);

select has_function('public', 'begin_writing_test', array['uuid', 'text'], 'a test is started by a function');
select has_function('public', 'finish_writing_test', array['uuid', 'uuid', 'integer', 'integer', 'integer'], 'a test is finished by a function');
select has_function('public', 'fail_writing_test', array['uuid', 'uuid'], 'a test is failed by a function');

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('begin_writing_test', 'finish_writing_test', 'fail_writing_test')
     and p.prosecdef and p.proconfig = array['search_path=""']),
  array['begin_writing_test', 'fail_writing_test', 'finish_writing_test'],
  'the three functions run with the rights of their owner and an empty search path'
);

select is(
  (select bool_or(has_function_privilege(role, p.oid, 'execute'))
   from pg_proc p cross join (values ('anon'), ('authenticated')) as r(role)
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('begin_writing_test', 'finish_writing_test', 'fail_writing_test')),
  false,
  'neither anon nor a signed-in user can call them'
);
select is(
  (select bool_and(has_function_privilege('service_role', p.oid, 'execute'))
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('begin_writing_test', 'finish_writing_test', 'fail_writing_test')),
  true,
  'the server can call them'
);

select throws_ok(
  $$select * from public.begin_writing_test(null, 'fr')$$,
  'P0001', 'account_not_found', 'a test needs an account'
);

select is(
  (select outcome from public.begin_writing_test('d1d1d1d1-0000-0000-0000-000000000003', 'fr')),
  'consent_required',
  'a test needs an active consent'
);
select is(
  (select count(*)::integer from public.writing_tests where user_id = 'd1d1d1d1-0000-0000-0000-000000000003'),
  0,
  'nothing is written without a consent'
);

select throws_ok(
  $$select * from public.begin_writing_test('d1d1d1d1-0000-0000-0000-000000000001', 'de')$$,
  '23514', null, 'a template other than French or English is refused'
);

create temp table started as
select * from public.begin_writing_test('d1d1d1d1-0000-0000-0000-000000000001', 'fr');

select is((select outcome from started), 'started', 'a test starts with a consent');
select isnt((select test_id from started), null, 'it has an id');
select is((select expired from started), '{}'::uuid[], 'no earlier test has expired');
select is(
  (select status from public.writing_tests where id = (select test_id from started)),
  'pending',
  'a test starts pending'
);

select is(
  (select outcome from public.begin_writing_test('d1d1d1d1-0000-0000-0000-000000000001', 'fr')),
  'test_in_progress',
  'one test at a time'
);

select pg_temp.login('d1d1d1d1-0000-0000-0000-000000000001');

select is(
  (select count(*)::integer from public.writing_tests),
  1,
  'the owner reads their test'
);
select throws_ok(
  $$insert into public.writing_tests (user_id, template) values ('d1d1d1d1-0000-0000-0000-000000000001', 'fr')$$,
  '42501', null, 'a user cannot write a test'
);
select throws_ok(
  $$update public.writing_tests set status = 'accepted'$$,
  '42501', null, 'a user cannot change a test'
);
select throws_ok(
  $$delete from public.writing_tests$$,
  '42501', null, 'a user cannot erase a test'
);

select pg_temp.login('d1d1d1d1-0000-0000-0000-000000000002');
select is(
  (select count(*)::integer from public.writing_tests),
  0,
  'another user reads nothing'
);

reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select outcome from public.finish_writing_test('d1d1d1d1-0000-0000-0000-000000000002', (select test_id from started), 20, 10, 10)),
  'test_not_found',
  'a test of someone else cannot be finished'
);

select throws_ok(
  format($$select * from public.finish_writing_test('d1d1d1d1-0000-0000-0000-000000000001', %L, 21, 10, 10)$$, (select test_id from started)),
  'P0001', 'invalid_counts', 'a count above the lines of a sheet is refused'
);
select throws_ok(
  format($$select * from public.finish_writing_test('d1d1d1d1-0000-0000-0000-000000000001', %L, -1, 0, 0)$$, (select test_id from started)),
  'P0001', 'invalid_counts', 'a negative count is refused'
);

create temp table rejected as
select * from public.finish_writing_test('d1d1d1d1-0000-0000-0000-000000000001', (select test_id from started), 15, 8, 8);

select is((select outcome from rejected), 'rejected', '23 training lines are not enough');
select is((select redo from rejected), array[1]::smallint[], 'the first sheet is the one to redo');
select is(
  (select status || ' ' || training_lines || ' ' || validation_lines from public.writing_tests where id = (select test_id from started)),
  'rejected 23 8',
  'the test keeps the lines kept by part'
);
select is(
  (select outcome from public.finish_writing_test('d1d1d1d1-0000-0000-0000-000000000001', (select test_id from started), 20, 10, 10)),
  'test_not_found',
  'a test is finished once'
);

select is(
  (select redo from public.finish_writing_test('d1d1d1d1-0000-0000-0000-000000000001', (select test_id from public.begin_writing_test('d1d1d1d1-0000-0000-0000-000000000001', 'fr')), 16, 7, 8)),
  array[2]::smallint[],
  '23 training lines with a first sheet kept: the second sheet is to redo'
);
select is(
  (select redo from public.finish_writing_test('d1d1d1d1-0000-0000-0000-000000000001', (select test_id from public.begin_writing_test('d1d1d1d1-0000-0000-0000-000000000001', 'fr')), 16, 8, 7)),
  array[2]::smallint[],
  '7 validation lines: the second sheet is to redo'
);

select is(
  (select outcome from public.begin_writing_test('d1d1d1d1-0000-0000-0000-000000000001', 'fr')),
  'test_limit',
  'three tests in 24 hours at most'
);

update public.writing_tests set created_at = now() - interval '25 hours' where user_id = 'd1d1d1d1-0000-0000-0000-000000000001';

create temp table second_try as
select * from public.begin_writing_test('d1d1d1d1-0000-0000-0000-000000000001', 'en');
select is((select outcome from second_try), 'started', 'tests older than 24 hours do not count');

create temp table accepted as
select * from public.finish_writing_test('d1d1d1d1-0000-0000-0000-000000000001', (select test_id from second_try), 16, 8, 8);
select is((select outcome from accepted), 'accepted', '24 training lines and 8 validation lines are enough');
select is((select redo from accepted), '{}'::smallint[], 'nothing is left to redo');
select is((select replaced from accepted), '{}'::uuid[], 'no earlier test is replaced');
select is(
  (select template || ' ' || status from public.writing_tests where id = (select test_id from second_try)),
  'en accepted',
  'the test is accepted'
);

update public.writing_tests set created_at = now() - interval '30 hours' where id = (select test_id from second_try);

create temp table third_try as
select * from public.begin_writing_test('d1d1d1d1-0000-0000-0000-000000000001', 'fr');
create temp table replaced as
select * from public.finish_writing_test('d1d1d1d1-0000-0000-0000-000000000001', (select test_id from third_try), 20, 10, 10);
select is((select replaced from replaced), array[(select test_id from second_try)], 'an accepted test replaces the earlier accepted one');
select is(
  (select status from public.writing_tests where id = (select test_id from second_try)),
  'replaced',
  'the earlier test is marked replaced'
);
select is(
  (select count(*)::integer from public.writing_tests where user_id = 'd1d1d1d1-0000-0000-0000-000000000001' and status = 'accepted'),
  1,
  'one accepted test at most'
);

update public.writing_tests set created_at = now() - interval '3 days'
where user_id = 'd1d1d1d1-0000-0000-0000-000000000001' and status in ('rejected', 'replaced', 'failed');
create temp table fourth_try as
select * from public.begin_writing_test('d1d1d1d1-0000-0000-0000-000000000001', 'fr');
select is(
  (select count(*)::integer from public.writing_tests where user_id = 'd1d1d1d1-0000-0000-0000-000000000001' and status in ('rejected', 'replaced')),
  0,
  'tests that are not accepted are forgotten after two days'
);
select is(
  (select count(*)::integer from public.writing_tests where user_id = 'd1d1d1d1-0000-0000-0000-000000000001' and status = 'accepted'),
  1,
  'the accepted test stays'
);

select is((select public.fail_writing_test('d1d1d1d1-0000-0000-0000-000000000001', (select test_id from fourth_try))), true, 'a test whose check failed is marked failed');
select is((select public.fail_writing_test('d1d1d1d1-0000-0000-0000-000000000001', (select test_id from fourth_try))), false, 'it is failed once');

update public.writing_tests set created_at = now() - interval '25 hours' where id = (select test_id from fourth_try);

create temp table stale as
select * from public.begin_writing_test('d1d1d1d1-0000-0000-0000-000000000001', 'fr');
update public.writing_tests set created_at = now() - interval '31 minutes' where id = (select test_id from stale);
create temp table after_stale as
select * from public.begin_writing_test('d1d1d1d1-0000-0000-0000-000000000001', 'fr');
select is((select expired from after_stale), array[(select test_id from stale)], 'a test pending for more than 30 minutes has expired, its files are to be erased');
select is((select outcome from after_stale), 'started', 'and a new test can start');

select is(public.revoke_training('d1d1d1d1-0000-0000-0000-000000000001'), true, 'the consent is withdrawn');
select is(
  (select count(*)::integer from public.writing_tests where user_id = 'd1d1d1d1-0000-0000-0000-000000000001'),
  0,
  'the withdrawal erases the tests'
);
select is(
  (select outcome from public.finish_writing_test('d1d1d1d1-0000-0000-0000-000000000001', (select test_id from after_stale), 20, 10, 10)),
  'test_not_found',
  'a check that ends after the withdrawal finds nothing'
);

select * from finish();

rollback;
