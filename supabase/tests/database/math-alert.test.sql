begin;

select plan(29);

create function pg_temp.make_user(uid uuid) returns void
language sql as $$
  insert into auth.users (id, email) values (uid, uid::text || '@example.test');
$$;

create function pg_temp.as_server() returns void
language sql as $$
  select set_config('role', 'service_role', true);
$$;

create function pg_temp.login(uid uuid) returns void
language sql as $$
  select
    set_config('role', 'authenticated', true),
    set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.inputs(page uuid, owner uuid) returns text
language sql as $$
  select coalesce(string_agg(row(r.b1, r.b2)::text, ';'), 'none') from public.math_check_readings(page, owner) r;
$$;

create function pg_temp.alert(page uuid, owner uuid, only_b1 integer, only_b2 integer) returns text
language sql as $$
  select public.record_math_alert(page, owner, only_b1, only_b2);
$$;

create function pg_temp.text(page uuid, owner uuid) returns text
language sql as $$
  select row(r.outcome, r.b1)::text from public.set_page_text(page, owner, false) r;
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First');

insert into public.pages (id, user_id, notebook_id, status, page_type) values
  ('a6000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'math'),
  ('a6000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text'),
  ('a6000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'math'),
  ('a6000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'math'),
  ('a6000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'math');

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', p.id, l.label, l.raw_text, 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500
from (values
  ('a6000000-0000-0000-0000-000000000001'::uuid, 'B1', 'Soit $x^2 = 4$'),
  ('a6000000-0000-0000-0000-000000000001'::uuid, 'B2', 'Soit $x^2 = 9$'),
  ('a6000000-0000-0000-0000-000000000002'::uuid, 'B1', 'Bonjour'),
  ('a6000000-0000-0000-0000-000000000002'::uuid, 'B2', 'Bonsoir'),
  ('a6000000-0000-0000-0000-000000000003'::uuid, 'B1', 'Soit $y = 1$'),
  ('a6000000-0000-0000-0000-000000000004'::uuid, 'B1', 'Soit $z = 1$'),
  ('a6000000-0000-0000-0000-000000000004'::uuid, 'B2', 'Soit $z = 2$')
) as l (page, label, raw_text)
join public.pages p on p.id = l.page;

insert into public.page_alerts (user_id, page_id, kind, details) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a6000000-0000-0000-0000-000000000004', 'math_incomplete', '{"only_b1": 5, "only_b2": 5}'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a6000000-0000-0000-0000-000000000004', 'missing_line', '{"absent_from_b2": [0], "absent_from_b1": []}');

select is(has_function_privilege('anon', 'public.math_check_readings(uuid, uuid)', 'execute'), false, 'a visitor cannot read what the check compares');
select is(has_function_privilege('authenticated', 'public.math_check_readings(uuid, uuid)', 'execute'), false, 'a signed-in user cannot read what the check compares');
select is(has_function_privilege('service_role', 'public.math_check_readings(uuid, uuid)', 'execute'), true, 'the server can read what the check compares');
select is(has_function_privilege('anon', 'public.record_math_alert(uuid, uuid, integer, integer)', 'execute'), false, 'a visitor cannot write the alert');
select is(has_function_privilege('authenticated', 'public.record_math_alert(uuid, uuid, integer, integer)', 'execute'), false, 'a signed-in user cannot write the alert');
select is(has_function_privilege('service_role', 'public.record_math_alert(uuid, uuid, integer, integer)', 'execute'), true, 'the server can write the alert');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('math_check_readings', 'record_math_alert') and p.prosecdef),
  2::bigint,
  'both run with the rights of their owner'
);

select pg_temp.as_server();

select is(pg_temp.inputs('a6000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '("Soit $x^2 = 4$","Soit $x^2 = 9$")', 'a page of math gives B1 and B2');
select is(pg_temp.inputs('a6000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 'none', 'the page of another gives nothing');
select is(pg_temp.inputs('a6000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'none', 'a page of text gives nothing');
select is(pg_temp.inputs('a6000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'none', 'a page of math with no B2 gives nothing');
select is(pg_temp.inputs('a6000000-0000-0000-0000-00000000000f', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'none', 'a page that does not exist gives nothing');

select is(pg_temp.alert('a6000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 1), 'page_not_found', 'the page of another gets no alert');
select is(pg_temp.alert('a6000000-0000-0000-0000-00000000000f', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 1), 'page_not_found', 'a page that does not exist gets no alert');
select is(pg_temp.alert('a6000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 1), 'not_math', 'a page of text gets no alert');
select is(pg_temp.alert('a6000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 0), 'no_readings', 'a page without both passes gets no alert');
select throws_ok($$select pg_temp.alert('a6000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0, 0)$$, '23514', null, 'an alert that counts nothing is refused');
select throws_ok($$select pg_temp.alert('a6000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', -1, 2)$$, '23514', null, 'a negative count is refused');
select throws_ok($$select pg_temp.alert('a6000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 2)$$, '23514', null, 'a missing count is refused');

select is(pg_temp.alert('a6000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 2), 'recorded', 'the server writes the alert of a page of math');
select is(pg_temp.alert('a6000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 1), 'recorded', 'a page that has the alert already is answered the same way');

reset role;

select is(
  (select row(user_id, kind, details)::text from public.page_alerts where page_id = 'a6000000-0000-0000-0000-000000000001'),
  '(aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,math_incomplete,"{""only_b1"": 1, ""only_b2"": 2}")',
  'the alert belongs to the owner and holds two counts and no text'
);
select is(
  (select details::text from public.page_alerts where page_id = 'a6000000-0000-0000-0000-000000000004' and kind = 'math_incomplete'),
  '{"only_b1": 5, "only_b2": 5}',
  'an alert already there is kept as it was'
);
select is(
  (select count(*) from public.page_alerts where page_id in ('a6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000003')),
  0::bigint,
  'the refused calls left no alert'
);

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select is((select count(*) from public.page_alerts), 0::bigint, 'another user reads none of these alerts');
reset role;

select pg_temp.as_server();
select is(pg_temp.text('a6000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '(switched,)', 'the page goes back to text');
reset role;

select is(
  (select array_agg(kind order by kind) from public.page_alerts where page_id = 'a6000000-0000-0000-0000-000000000004'),
  array['missing_line'],
  'the switch to text erases the alert of math and keeps the others'
);

select pg_temp.as_server();
select is(pg_temp.alert('a6000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 1), 'not_math', 'a check that ends after the switch to text writes nothing');
reset role;

select is(
  (select count(*) from public.page_alerts where page_id = 'a6000000-0000-0000-0000-000000000004' and kind = 'math_incomplete'),
  0::bigint,
  'the page of text is left with no alert of math'
);

select * from finish();

rollback;
