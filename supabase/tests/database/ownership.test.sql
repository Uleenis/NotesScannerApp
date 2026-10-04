begin;

select plan(20);

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

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name, position) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Private', 0);

insert into public.chapters (id, user_id, notebook_id, name, position) values
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Private', 0);

insert into public.pages (id, user_id, notebook_id, position) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 0);

insert into public.page_images (user_id, page_id, kind, storage_path) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'original',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/44444444-4444-4444-4444-444444444444/original.jpg');

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'B1', 'Private', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500);

insert into public.page_texts (user_id, page_id, text, pipeline_version) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'Private', '1');

insert into public.page_charges (user_id, page_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444');

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint, 'profiles: another user''s row is not readable');
select is((select count(*) from public.notebooks), 0::bigint, 'notebooks: another user''s rows are not readable');
select is((select count(*) from public.chapters), 0::bigint, 'chapters: another user''s rows are not readable');
select is((select count(*) from public.pages), 0::bigint, 'pages: another user''s rows are not readable');
select is((select count(*) from public.page_images), 0::bigint, 'page_images: another user''s rows are not readable');
select is((select count(*) from public.readings), 0::bigint, 'readings: another user''s rows are not readable');
select is((select count(*) from public.page_texts), 0::bigint, 'page_texts: another user''s rows are not readable');
select is((select count(*) from public.page_charges), 0::bigint, 'page_charges: another user''s rows are not readable');

select lives_ok(
  $$update public.profiles set interface_language = 'fr'$$,
  'profiles: another user can try to change a row'
);

select lives_ok(
  $$update public.notebooks set name = 'Hacked'$$,
  'notebooks: another user can try to change a row'
);

select lives_ok(
  $$update public.chapters set name = 'Hacked'$$,
  'chapters: another user can try to change a row'
);

select lives_ok(
  $$update public.pages set position = 9$$,
  'pages: another user can try to change a row'
);

reset role;

select is(
  (select interface_language from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'en',
  'profiles: the row was not modified'
);

select is(
  (select name from public.notebooks where id = '11111111-1111-1111-1111-111111111111'),
  'Private',
  'notebooks: the row was not modified'
);

select is(
  (select name from public.chapters where id = '33333333-3333-3333-3333-333333333333'),
  'Private',
  'chapters: the row was not modified'
);

select is(
  (select position from public.pages where id = '44444444-4444-4444-4444-444444444444'),
  0,
  'pages: the row was not modified'
);

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select throws_ok($$update public.page_images set kind = 'prepared'$$, '42501', null, 'page_images: another user cannot modify');
select throws_ok($$update public.readings set raw_text = 'Hacked'$$, '42501', null, 'readings: another user cannot modify');
select throws_ok($$update public.page_texts set text = 'Hacked'$$, '42501', null, 'page_texts: another user cannot modify');
select throws_ok($$update public.page_charges set page_id = null$$, '42501', null, 'page_charges: another user cannot modify');

select * from finish();

rollback;
