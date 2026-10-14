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

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First');

insert into public.pages (id, user_id, notebook_id, status) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read'),
  ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'queued');

select is(
  (select page_type from public.pages where id = '44444444-4444-4444-4444-444444444444'),
  'text',
  'a page is a page of text unless the server says otherwise'
);

select is(
  (select language from public.pages where id = '44444444-4444-4444-4444-444444444444'),
  null,
  'a page has no language until the server finds one'
);

select col_not_null('public', 'pages', 'page_type', 'every page has a type');

select throws_ok(
  $$update public.pages set page_type = 'drawing' where id = '44444444-4444-4444-4444-444444444444'$$,
  '23514', null, 'a page type that does not exist is refused'
);

select throws_ok(
  $$update public.pages set language = 'french' where id = '44444444-4444-4444-4444-444444444444'$$,
  '23514', null, 'a language that is not a two-letter code is refused'
);

select throws_ok(
  $$update public.pages set language = 'FR' where id = '44444444-4444-4444-4444-444444444444'$$,
  '23514', null, 'a language code in capitals is refused'
);

select pg_temp.as_server();

select lives_ok(
  $$update public.pages set page_type = 'unsupported_script', language = 'el' where id = '44444444-4444-4444-4444-444444444444'$$,
  'the server sets the type and the language of a page'
);

select lives_ok(
  $$update public.pages set page_type = 'math', language = null where id = '44444444-4444-4444-4444-444444444444'$$,
  'the server can turn a page to math and forget its language'
);

reset role;

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select throws_ok(
  $$update public.pages set page_type = 'text' where id = '44444444-4444-4444-4444-444444444444'$$,
  '42501', null, 'a user cannot write the type of their own page'
);

select throws_ok(
  $$update public.pages set page_type = 'unsupported_script' where id = '44444444-4444-4444-4444-444444444444'$$,
  '42501', null, 'a user cannot mark their page as written in an unsupported script'
);

select throws_ok(
  $$update public.pages set language = 'en' where id = '44444444-4444-4444-4444-444444444444'$$,
  '42501', null, 'a user cannot write the language of their own page'
);

select throws_ok(
  $$insert into public.pages (notebook_id, page_type) values ('11111111-1111-1111-1111-111111111111', 'math')$$,
  '42501', null, 'a user cannot create a page with a type'
);

select throws_ok(
  $$insert into public.pages (notebook_id, language) values ('11111111-1111-1111-1111-111111111111', 'fr')$$,
  '42501', null, 'a user cannot create a page with a language'
);

select is(
  (select page_type from public.pages where id = '44444444-4444-4444-4444-444444444444'),
  'math',
  'a user reads the type of their page'
);

reset role;

select is(
  (select row(page_type, language)::text from public.pages where id = '44444444-4444-4444-4444-444444444444'),
  '(math,)',
  'those attempts changed nothing'
);

select public.record_reading_a(
  '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mot', 'medium', 'version', 1,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/55555555-5555-5555-5555-555555555555/a.xml', 'fr',
  '[{"token_index": 0, "line_index": 0, "text": "mot", "reading_a": "mot", "reading_b1": "mot", "anchor_kind": null, "anchor": null}]'::jsonb
);

select pg_temp.as_server();

select throws_ok(
  $$update public.pages set page_type = 'math' where id = '55555555-5555-5555-5555-555555555555'$$,
  '23514', 'page_has_reading_a', 'a page that has A cannot become a page of math'
);

select throws_ok(
  $$update public.pages set page_type = 'unsupported_script' where id = '55555555-5555-5555-5555-555555555555'$$,
  '23514', 'page_has_reading_a', 'a page that has A cannot become a page in an unsupported script'
);

delete from public.readings where page_id = '55555555-5555-5555-5555-555555555555' and label = 'A';

select throws_ok(
  $$update public.pages set page_type = 'math' where id = '55555555-5555-5555-5555-555555555555'$$,
  '23514', 'page_has_reading_a', 'a page that still has positions cannot become a page of math'
);

delete from public.page_tokens where page_id = '55555555-5555-5555-5555-555555555555';

select lives_ok(
  $$update public.pages set page_type = 'math' where id = '55555555-5555-5555-5555-555555555555'$$,
  'once A and its positions are erased, the page can become a page of math'
);

reset role;

select col_default_is('public', 'notebooks', 'correction_level', 'course'::text, 'a notebook corrects at the course level by default');

select col_not_null('public', 'notebooks', 'correction_level', 'every notebook has a correction level');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select throws_ok(
  $$update public.notebooks set correction_level = 'course'$$,
  '42501', null, 'a user cannot write the correction level of a notebook, even its default'
);

select throws_ok(
  $$insert into public.notebooks (name, correction_level) values ('Second', 'course')$$,
  '42501', null, 'a user cannot create a notebook with a correction level'
);

reset role;

select * from finish();

rollback;
