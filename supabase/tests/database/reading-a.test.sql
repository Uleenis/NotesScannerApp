begin;

select plan(41);

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

create function pg_temp.tokens() returns jsonb
language sql as $$
  select '[
    {"token_index": 0, "line_index": 0, "text": "Bonjour", "reading_a": "Bonjonr", "reading_b1": "Bonjour", "anchor_kind": "word", "anchor": [10, 20, 90, 60]},
    {"token_index": 1, "line_index": 0, "text": "Paul", "reading_a": null, "reading_b1": "Paul", "anchor_kind": "line", "anchor": [0, 18, 1700, 64]},
    {"token_index": 2, "line_index": 1, "text": "fin", "reading_a": null, "reading_b1": "fin", "anchor_kind": null, "anchor": null}
  ]'::jsonb;
$$;

create function pg_temp.record(page uuid, owner uuid, tokens jsonb default pg_temp.tokens(), alto text default null) returns text
language sql as $$
  select row(r.recorded, r.reason)::text
  from public.record_reading_a(
    page,
    owner,
    E'Bonjonr\nfin',
    'medium',
    'zenodo-21788410',
    28000,
    coalesce(alto, owner::text || '/' || page::text || '/a.xml'),
    'fr',
    tokens
  ) r;
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First');

insert into public.pages (id, user_id, notebook_id, status, page_type) values
  ('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text'),
  ('a3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'math'),
  ('a3000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'unsupported_script'),
  ('a3000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text'),
  ('a3000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text');

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000001', 'B1', E'Bonjour Paul\nfin', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'record_reading_a' and p.prosecdef),
  1::bigint,
  'the function that writes A runs with the rights of its owner'
);
select is(has_function_privilege('anon', 'public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb)', 'execute'), false, 'a visitor cannot write A');
select is(has_function_privilege('authenticated', 'public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb)', 'execute'), false, 'a signed-in user cannot write A');
select is(has_function_privilege('service_role', 'public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb)', 'execute'), true, 'the server can write A');

select pg_temp.as_server();

select is(
  pg_temp.record('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '(t,recorded)',
  'the server writes A for a page of text of its owner'
);

reset role;

select is(
  (select row(label, raw_text, model, model_version, duration_ms, alto_path, prompt_version, thinking_budget, input_tokens, output_tokens)::text
   from public.readings where page_id = 'a3000000-0000-0000-0000-000000000001' and label = 'A'),
  '(A,"Bonjonr' || E'\n' || 'fin",medium,zenodo-21788410,28000,aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000001/a.xml,,,,)',
  'A is stored as the service read it, with its ALTO and none of the settings of a call to Gemini'
);

select is(
  (select count(*) from public.page_tokens where page_id = 'a3000000-0000-0000-0000-000000000001'),
  3::bigint,
  'one position is written per word of B1'
);

select is(
  (select array_agg(row(token_index, line_index, text, reading_a, reading_b1, anchor_kind, anchor, rule, channel)::text order by token_index)
   from public.page_tokens where page_id = 'a3000000-0000-0000-0000-000000000001'),
  array[
    '(0,0,Bonjour,Bonjonr,Bonjour,word,"{10,20,90,60}",,)',
    '(1,0,Paul,,Paul,line,"{0,18,1700,64}",,)',
    '(2,1,fin,,fin,,,,)'
  ],
  'each position keeps its rank, its line, its word, the readings of A and B1 and its anchor, with no rule and no channel'
);

select is(
  (select language from public.pages where id = 'a3000000-0000-0000-0000-000000000001'),
  'fr',
  'the language of the page is written with A'
);

select is(
  (select count(*) from public.page_tokens where page_id = 'a3000000-0000-0000-0000-000000000001' and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  3::bigint,
  'the positions belong to the owner of the page'
);

select pg_temp.as_server();

select is(
  pg_temp.record('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '[]'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000001/b.xml'),
  '(f,already_read)',
  'a page that already has A is refused'
);

select is(
  pg_temp.record('a3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '(f,not_text)',
  'a page of math is refused'
);

select is(
  pg_temp.record('a3000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '(f,not_text)',
  'a page in an unsupported script is refused'
);

select is(
  pg_temp.record('a3000000-0000-0000-0000-000000000004', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  '(f,page_not_found)',
  'a page given with another owner is refused'
);

select is(
  pg_temp.record('99999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '(f,page_not_found)',
  'a page that does not exist is refused'
);

select is(
  pg_temp.record(null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '(f,page_not_found)',
  'a missing page is refused'
);

select is(
  pg_temp.record('a3000000-0000-0000-0000-000000000004', null),
  '(f,page_not_found)',
  'a missing owner is refused'
);

insert into public.pages (id, user_id, notebook_id, status, page_type) values
  ('a3000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text');

select is((select outcome from public.delete_page('a3000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')), 'deleted', 'a page is deleted while its A is still running');

select is(
  pg_temp.record('a3000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '(f,page_not_found)',
  'the A that ends after the deletion of its page is refused, and the service erases its ALTO file'
);

reset role;

select is(
  (select count(*) from public.readings where label = 'A'),
  1::bigint,
  'the refusals wrote no reading'
);

select is(
  (select count(*) from public.page_tokens where page_id <> 'a3000000-0000-0000-0000-000000000001'),
  0::bigint,
  'the refusals wrote no position'
);

select is(
  (select count(*) from public.pages where language is not null),
  1::bigint,
  'the refusals wrote no language'
);

select pg_temp.as_server();

select throws_ok(
  $$select pg_temp.record('a3000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '[{"token_index": 0, "line_index": 0, "text": "ok", "reading_b1": "ok"}, {"token_index": 1, "line_index": 0, "text": "bad", "reading_b1": "bad", "anchor_kind": "word", "anchor": [5, 5, 1, 1]}]'::jsonb)$$,
  '23514', null, 'a position that breaks a rule fails the whole write'
);

select throws_ok(
  $$select pg_temp.record('a3000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '[]'::jsonb,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/a3000000-0000-0000-0000-000000000004/a.xml')$$,
  '23514', null, 'an ALTO outside the folder of the page fails the whole write'
);

select throws_ok(
  $$select * from public.record_reading_a('a3000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'x', 'medium', 'v', 1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000004/a.xml', 'french', '[]'::jsonb)$$,
  '23514', null, 'a language that is not a two-letter code fails the whole write'
);

select throws_ok(
  $$select pg_temp.record('a3000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"token_index": 0}'::jsonb)$$,
  null, null, 'positions that are not a list fail the whole write'
);

reset role;

select is(
  (select count(*) from public.readings where page_id = 'a3000000-0000-0000-0000-000000000004')
    + (select count(*) from public.page_tokens where page_id = 'a3000000-0000-0000-0000-000000000004')
    + (select count(*) from public.pages where id = 'a3000000-0000-0000-0000-000000000004' and language is not null),
  0::bigint,
  'a write that failed left no reading, no position and no language'
);

select pg_temp.as_server();

select is(
  pg_temp.record('a3000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '[]'::jsonb),
  '(t,recorded)',
  'a page whose B1 has no word gets A and no position'
);

select is(
  (select row(r.recorded, r.reason)::text from public.record_reading_a(
    'a3000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '', 'medium', 'v', 1,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000005/a.xml', null, null) r),
  '(t,recorded)',
  'an empty A, with no language and no position, is written too'
);

reset role;

select is(
  (select language from public.pages where id = 'a3000000-0000-0000-0000-000000000005'),
  null,
  'a page whose language could not be found keeps none'
);

select throws_ok(
  $$insert into public.readings (user_id, page_id, label, raw_text, model, model_version, duration_ms, alto_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000005', 'A', 'x', 'medium', 'v', 1,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000005/again.xml')$$,
  '23505', null, 'a page has one A at most, even written around the function'
);

select throws_ok(
  $$insert into public.readings (user_id, page_id, label, raw_text, model, model_version, duration_ms)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000002', 'A', 'x', 'medium', 'v', 1)$$,
  '23514', null, 'A without its ALTO is refused'
);

select throws_ok(
  $$insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms, alto_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000002', 'A', 'x', 'medium', 'v', 'V0', 0, 1, 1, 1,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000002/a.xml')$$,
  '23514', null, 'A with the settings of a call to Gemini is refused'
);

select throws_ok(
  $$insert into public.readings (user_id, page_id, label, raw_text, model, model_version, duration_ms)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000002', 'B1', 'x', 'gemini-3.6-flash', 'v', 1)$$,
  '23514', null, 'B1 without the settings of its call is refused'
);

select throws_ok(
  $$insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms, alto_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000002', 'B1', 'x', 'gemini-3.6-flash', 'v', 'V0', 0, 1, 1, 1,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000002/b1.xml')$$,
  '23514', null, 'B1 with an ALTO is refused'
);

select throws_ok(
  $$insert into public.readings (user_id, page_id, label, raw_text, model, model_version, duration_ms, alto_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000002', 'A', 'x', 'medium', 'v', 1,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000001/other.xml')$$,
  '23514', null, 'an ALTO in the folder of another page is refused'
);

select throws_ok(
  $$insert into public.readings (user_id, page_id, label, raw_text, model, model_version, duration_ms, alto_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000002', 'A', 'x', 'medium', 'v', 1,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000002/../../bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/a.xml')$$,
  '23514', null, 'an ALTO path that climbs out of the folder of its page is refused'
);

select throws_ok(
  $$insert into public.readings (user_id, page_id, label, raw_text, model, model_version, duration_ms, alto_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000002', 'A', 'x', 'medium', 'v', 1,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000002/inner/a.xml')$$,
  '23514', null, 'an ALTO file sits directly in the folder of its page'
);

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is(
  (select count(*) from public.readings where label = 'A'),
  3::bigint,
  'a user reads the A of their pages'
);

select throws_ok(
  $$select * from public.record_reading_a('a3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'x', 'medium', 'v', 1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000002/a.xml', 'fr', '[]'::jsonb)$$,
  '42501', null, 'a user who calls the function directly is refused'
);

select throws_ok(
  $$insert into public.readings (page_id, label, raw_text, model, model_version, duration_ms, alto_path)
    values ('a3000000-0000-0000-0000-000000000002', 'A', 'x', 'medium', 'v', 1,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000002/a.xml')$$,
  '42501', null, 'a user cannot write A'
);

reset role;

select * from finish();

rollback;
