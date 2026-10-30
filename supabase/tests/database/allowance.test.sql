begin;

select plan(25);

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

insert into auth.users (id, email, is_anonymous) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.test', false),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c@example.test', false),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'd@example.test', false),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', null, true),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', null, true);

update public.profiles set tier = 'subscriber' where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'N'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'N'),
  ('33333333-3333-3333-3333-333333333333', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'N'),
  ('44444444-4444-4444-4444-444444444444', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'N');

insert into public.pages (id, user_id, notebook_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('b1111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222'),
  ('b2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222'),
  ('b3333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222'),
  ('d1111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '33333333-3333-3333-3333-333333333333'),
  ('e1111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '44444444-4444-4444-4444-444444444444'),
  ('e2222222-2222-2222-2222-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '44444444-4444-4444-4444-444444444444'),
  ('e3333333-3333-3333-3333-333333333333', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '44444444-4444-4444-4444-444444444444');

select public.charge_page('a1111111-1111-1111-1111-111111111111', '2031-01-01 12:00:00+00');
select public.charge_page('d1111111-1111-1111-1111-111111111111');
select public.charge_page('e1111111-1111-1111-1111-111111111111', '2031-01-01 12:00:00+00');
select public.charge_page('e2222222-2222-2222-2222-222222222222', '2031-01-01 12:00:00+00');
select public.charge_page('e3333333-3333-3333-3333-333333333333', '2031-01-01 12:00:00+00');
select public.charge_page('b1111111-1111-1111-1111-111111111111');
select public.charge_page('b2222222-2222-2222-2222-222222222222');

insert into public.anonymous_daily_counts (day, pages)
values ((now() at time zone 'Europe/Paris')::date, 300)
on conflict (day) do update set pages = 300;

insert into public.page_charges (user_id) select 'cccccccc-cccc-cccc-cccc-cccccccccccc' from generate_series(1, 15);

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is(
  (select max * 100 + remaining from public.my_page_allowance()),
  302,
  'an anonymous user sees two of their three pages left'
);

select is(
  (select is_anonymous from public.my_page_allowance()),
  true,
  'the allowance says the user is anonymous'
);

select is(
  (select count(*) from public.my_page_allowance()),
  1::bigint,
  'the allowance is a single row about the caller'
);

reset role;
select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select used * 100 + remaining from public.my_page_allowance()),
  213,
  'a registered user sees only their own two pages read and thirteen left'
);

select ok(
  (select resets_at > now() and blocked_reason is null from public.my_page_allowance()),
  'a registered user below the limit has a reset date and is not blocked'
);

reset role;
select pg_temp.login('cccccccc-cccc-cccc-cccc-cccccccccccc');

select is(
  (select blocked_reason from public.my_page_allowance()),
  'monthly_limit',
  'a registered user at the monthly limit is told why'
);

reset role;
select pg_temp.login('dddddddd-dddd-dddd-dddd-dddddddddddd');

select ok(
  (select max = 200 and remaining = 199 from public.my_page_allowance()),
  'a subscriber sees a limit of 200 pages and 199 left after one'
);

reset role;
select pg_temp.login('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

select is(
  (select blocked_reason from public.my_page_allowance()),
  'anonymous_limit',
  'an anonymous user with three pages read is told why'
);

reset role;
select pg_temp.login('ffffffff-ffff-ffff-ffff-ffffffffffff');

select is(
  (select blocked_reason from public.my_page_allowance()),
  'anonymous_daily_cap',
  'an anonymous user is told when the daily cap of anonymous accounts is reached'
);

select pg_temp.as_anon();

select throws_ok(
  $$select * from public.my_page_allowance()$$,
  '42501', null, 'a visitor without an account cannot read an allowance'
);

reset role;
select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select throws_ok(
  $$select * from public.charge_page('b3333333-3333-3333-3333-333333333333')$$,
  '42501', null, 'a user cannot charge a page'
);

select throws_ok(
  $$select * from public.page_allowance('cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  '42501', null, 'a user cannot read the allowance of another account'
);

select throws_ok(
  $$select * from public.anonymous_daily_counts$$,
  '42501', null, 'a user cannot read the daily counter of anonymous accounts'
);

select throws_ok(
  $$select * from public.email_monthly_counts$$,
  '42501', null, 'a user cannot read the pages kept for deleted accounts'
);

select throws_ok(
  $$select * from public.email_hash('b@example.test')$$,
  '42501', null, 'a user cannot hash an address with the server secret'
);

select throws_ok(
  $$update public.anonymous_daily_counts set pages = 0$$,
  '42501', null, 'a user cannot reset the daily counter of anonymous accounts'
);

select throws_ok(
  $$insert into public.page_charges (user_id) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  '42501', null, 'a user cannot write a charge'
);

reset role;
select pg_temp.as_server();

select lives_ok(
  $$select * from public.charge_page('b3333333-3333-3333-3333-333333333333')$$,
  'the server can charge a page'
);

select lives_ok(
  $$select * from public.page_allowance('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'the server can read the allowance of any account'
);

reset role;

select is_empty(
  $$
    select p.oid::regprocedure::text
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('anon', p.oid, 'execute')
  $$,
  'a visitor without an account can run no function in public'
);

select set_eq(
  $$
    select p.proname::text
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('authenticated', p.oid, 'execute')
  $$,
  $$ values ('my_page_allowance'), ('search_pages'), ('suggest_words'), ('training_stage') $$,
  'a user can run only the functions that read their own allowance, search, suggest and the stage of the training'
);

select is_empty(
  $$
    select p.proname::text
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])
  $$,
  'every function in public runs with the rights of its owner and an empty search path'
);

select is(
  has_table_privilege('service_role', 'public.anonymous_daily_counts', 'select')
    and has_table_privilege('service_role', 'public.anonymous_daily_counts', 'insert')
    and has_table_privilege('service_role', 'public.anonymous_daily_counts', 'update'),
  true,
  'the server keeps its rights on the daily counter'
);

select is(
  has_schema_privilege('anon', 'private', 'usage') or has_schema_privilege('authenticated', 'private', 'usage'),
  false,
  'neither visitors nor users can reach the private schema'
);

select is(
  (select count(*) from private.email_pepper),
  1::bigint,
  'the server secret for addresses exists exactly once'
);

select * from finish();

rollback;
