begin;

select plan(24);

create function pg_temp.make_user(uid uuid) returns void
language sql as $$
  insert into auth.users (id, email) values (uid, uid::text || '@example.test');
$$;

create function pg_temp.as_server() returns void
language sql as $$
  select set_config('role', 'service_role', true);
$$;

create function pg_temp.math(page uuid, owner uuid) returns text
language sql as $$
  select row(r.outcome, r.alto_path)::text from public.set_page_math(page, owner) r;
$$;

create function pg_temp.text(page uuid, owner uuid) returns text
language sql as $$
  select row(r.outcome, r.b1)::text from public.set_page_text(page, owner) r;
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First');

insert into public.pages (id, user_id, notebook_id, status, page_type, language) values
  ('a4000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text', 'fr'),
  ('a4000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'math', null),
  ('a4000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'unsupported_script', null),
  ('a4000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'processing', 'text', null),
  ('a4000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text', null),
  ('a4000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'math', null);

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a4000000-0000-0000-0000-000000000001', 'B1', E'Bonjour Paul\nfin', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a4000000-0000-0000-0000-000000000002', 'B1', 'Soit $x^2$', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500);

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, duration_ms, alto_path) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a4000000-0000-0000-0000-000000000001', 'A', E'Bonjonr\nfin', 'medium', '1', 28000, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a4000000-0000-0000-0000-000000000001/a-0123456789abcdef0123456789abcdef.xml');

insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_a, reading_b1) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a4000000-0000-0000-0000-000000000001', 0, 0, 'Bonjour', 'Bonjonr', 'Bonjour'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a4000000-0000-0000-0000-000000000001', 1, 0, 'Paul', null, 'Paul');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('set_page_math', 'set_page_text') and p.prosecdef),
  2::bigint,
  'both switches run with the rights of their owner'
);
select is(has_function_privilege('anon', 'public.set_page_math(uuid, uuid)', 'execute'), false, 'a visitor cannot switch a page to math');
select is(has_function_privilege('authenticated', 'public.set_page_math(uuid, uuid)', 'execute'), false, 'a signed-in user cannot call the switch to math directly');
select is(has_function_privilege('service_role', 'public.set_page_math(uuid, uuid)', 'execute'), true, 'the server can switch a page to math');
select is(has_function_privilege('anon', 'public.set_page_text(uuid, uuid)', 'execute'), false, 'a visitor cannot switch a page to text');
select is(has_function_privilege('authenticated', 'public.set_page_text(uuid, uuid)', 'execute'), false, 'a signed-in user cannot call the switch to text directly');
select is(has_function_privilege('service_role', 'public.set_page_text(uuid, uuid)', 'execute'), true, 'the server can switch a page to text');

select pg_temp.as_server();

select is(pg_temp.math('a4000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), '(page_not_found,)', 'the page of another is not switched to math');
select is(pg_temp.text('a4000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), '(page_not_found,)', 'the page of another is not switched to text');
select is(pg_temp.math('a4000000-0000-0000-0000-00000000000f', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '(page_not_found,)', 'a page that does not exist is not found');
select is(pg_temp.math('a4000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '(unsupported_script,)', 'a page in an unsupported script never becomes math');
select is(pg_temp.text('a4000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '(unsupported_script,)', 'a page in an unsupported script never becomes text');
select is(pg_temp.math('a4000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '(page_not_read,)', 'a page not read yet is not switched');
select is(pg_temp.text('a4000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '(no_reading,)', 'a page of math without B1 is not switched to text');
select is(pg_temp.math('a4000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '(unchanged,)', 'a page already of math stays as it is');
select is(pg_temp.text('a4000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '(unchanged,)', 'a page already of text stays as it is');

select is(
  pg_temp.math('a4000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '(switched,aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a4000000-0000-0000-0000-000000000001/a-0123456789abcdef0123456789abcdef.xml)',
  'the switch to math answers the ALTO file of A to erase'
);

reset role;

select is((select count(*) from public.readings where page_id = 'a4000000-0000-0000-0000-000000000001' and label = 'A'), 0::bigint, 'the switch to math erases A');
select is((select count(*) from public.page_tokens where page_id = 'a4000000-0000-0000-0000-000000000001'), 0::bigint, 'the switch to math erases the positions');
select is((select row(page_type, language)::text from public.pages where id = 'a4000000-0000-0000-0000-000000000001'), '(math,)', 'the page becomes math and loses its language');
select is((select count(*) from public.readings where page_id = 'a4000000-0000-0000-0000-000000000001' and label = 'B1'), 1::bigint, 'B1 stays');

select pg_temp.as_server();

select is(
  pg_temp.text('a4000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '(switched,"Bonjour Paul' || E'\n' || 'fin")',
  'the switch to text answers B1, for A to be read again'
);

reset role;

select is((select page_type from public.pages where id = 'a4000000-0000-0000-0000-000000000001'), 'text', 'the page becomes text');
select is((select count(*) from public.readings where page_id = 'a4000000-0000-0000-0000-000000000001' and label = 'A'), 0::bigint, 'the switch to text writes no A by itself');

select * from finish();
rollback;
