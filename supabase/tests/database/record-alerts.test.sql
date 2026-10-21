begin;

select plan(17);

create function pg_temp.make_user(uid uuid) returns void
language sql as $$
  insert into auth.users (id, email) values (uid, uid::text || '@example.test');
$$;

create function pg_temp.as_server() returns void
language sql as $$
  select set_config('role', 'service_role', true);
$$;

create function pg_temp.record(page uuid, owner uuid, alerts jsonb) returns text
language sql as $$
  select row(r.recorded, r.reason)::text
  from public.record_reading_a(
    page,
    owner,
    E'Jour 27\nLe chat',
    'medium',
    'zenodo-21788410',
    28000,
    owner::text || '/' || page::text || '/a.xml',
    'fr',
    '[
      {"token_index": 0, "line_index": 0, "text": "Jour", "reading_a": "Jour", "reading_b1": "Jour", "reading_b2": null, "anchor_kind": null, "anchor": null}
    ]'::jsonb,
    alerts
  ) r;
$$;

create function pg_temp.record_without(page uuid, owner uuid) returns text
language sql as $$
  select row(r.recorded, r.reason)::text
  from public.record_reading_a(
    page,
    owner,
    E'Jour 27\nLe chat',
    'medium',
    'zenodo-21788410',
    28000,
    owner::text || '/' || page::text || '/a.xml',
    'fr',
    '[]'::jsonb
  ) r;
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First');

insert into public.pages (id, user_id, notebook_id, status, page_type) values
  ('a5000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text'),
  ('a5000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text'),
  ('a5000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text'),
  ('a5000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text'),
  ('a5000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'math'),
  ('a5000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text'),
  ('a5000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text');

insert into public.page_alerts (user_id, page_id, kind, details) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a5000000-0000-0000-0000-000000000007', 'missing_line', '{"absent_from_b2": [9], "absent_from_b1": []}');

select is(has_function_privilege('anon', 'public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb, jsonb)', 'execute'), false, 'a visitor cannot write A');
select is(has_function_privilege('authenticated', 'public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb, jsonb)', 'execute'), false, 'a signed-in user cannot write A');
select is(has_function_privilege('service_role', 'public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb, jsonb)', 'execute'), true, 'the server can write A');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'record_reading_a'),
  1::bigint,
  'one function writes A, so a call is never ambiguous'
);

select pg_temp.as_server();

select is(
  pg_temp.record('a5000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '[
    {"kind": "missing_line", "details": {"absent_from_b2": [0], "absent_from_b1": []}}
  ]'::jsonb),
  '(t,recorded)',
  'the server writes A with the alerts of the page'
);

reset role;

select is(
  (select row(user_id, kind, details)::text from public.page_alerts where page_id = 'a5000000-0000-0000-0000-000000000001'),
  '(aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,missing_line,"{""absent_from_b1"": [], ""absent_from_b2"": [0]}")',
  'the alert belongs to the owner of the page and keeps its details'
);

select pg_temp.as_server();

select is(
  pg_temp.record('a5000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '[
    {"kind": "missing_line", "details": {"absent_from_b2": [0], "absent_from_b1": []}},
    {"kind": "missing_line", "details": {"absent_from_b2": [1], "absent_from_b1": []}}
  ]'::jsonb),
  '(t,recorded)',
  'two alerts of one kind are accepted'
);

select is(
  pg_temp.record_without('a5000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '(t,recorded)',
  'a call with no alerts at all still writes A'
);

reset role;

select is(
  (select count(*) from public.page_alerts where page_id = 'a5000000-0000-0000-0000-000000000002'),
  1::bigint,
  'a page has one alert of each kind'
);

select is(
  (select count(*) from public.page_alerts where page_id = 'a5000000-0000-0000-0000-000000000003'),
  0::bigint,
  'a page read without alerts has none'
);

select pg_temp.as_server();

select throws_ok(
  $$select pg_temp.record('a5000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '[{"kind": "date_incoherent", "details": {}}]'::jsonb)$$,
  '23514', null, 'the arbitration writes no alert but a missing line'
);

select throws_ok(
  $$select pg_temp.record('a5000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '[{"kind": "missing_line", "details": [1]}]'::jsonb)$$,
  '23514', null, 'the details of an alert are an object'
);

reset role;

select is(
  (select count(*) from public.readings where page_id = 'a5000000-0000-0000-0000-000000000004' and label = 'A')
    + (select count(*) from public.page_tokens where page_id = 'a5000000-0000-0000-0000-000000000004')
    + (select count(*) from public.page_alerts where page_id = 'a5000000-0000-0000-0000-000000000004'),
  0::bigint,
  'a refused alert leaves neither A, nor positions, nor alerts behind'
);

select pg_temp.as_server();

select is(
  pg_temp.record('a5000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '[{"kind": "missing_line", "details": {}}]'::jsonb),
  '(f,not_text)',
  'a page of math is refused'
);

select is(
  pg_temp.record('a5000000-0000-0000-0000-000000000006', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '[{"kind": "missing_line", "details": {}}]'::jsonb),
  '(f,page_not_found)',
  'a page of another owner is refused'
);

select is(
  pg_temp.record('a5000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '[{"kind": "missing_line", "details": {"absent_from_b2": [1], "absent_from_b1": []}}]'::jsonb),
  '(t,recorded)',
  'an alert the page already has does not stop A from being written'
);

reset role;

select is(
  (select count(*) from public.page_alerts where page_id in ('a5000000-0000-0000-0000-000000000005', 'a5000000-0000-0000-0000-000000000006'))
    + (select count(*) from public.page_alerts where page_id = 'a5000000-0000-0000-0000-000000000007' and details = '{"absent_from_b2": [9], "absent_from_b1": []}'::jsonb),
  1::bigint,
  'a refused write leaves no alert, and an alert already there is kept as it was'
);

select * from finish();

rollback;
