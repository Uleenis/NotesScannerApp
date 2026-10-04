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
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First');

insert into public.pages (id, user_id, notebook_id, position) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 0),
  ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 1);

insert into public.page_images (user_id, page_id, kind, storage_path) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'original',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/44444444-4444-4444-4444-444444444444/original.jpg');

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'B1', 'Bonjour', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500);

insert into public.page_texts (user_id, page_id, text, pipeline_version) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'Bonjour', '1');

insert into public.page_charges (user_id, page_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is((select count(*) from public.page_images), 1::bigint, 'a user reads the images of their pages');
select is((select count(*) from public.readings), 1::bigint, 'a user reads the readings of their pages');
select is((select count(*) from public.page_texts), 1::bigint, 'a user reads the displayed texts of their pages');
select is((select count(*) from public.page_charges), 1::bigint, 'a user reads the charges of their pages');

select throws_ok(
  $$insert into public.page_images (page_id, kind, storage_path)
    values ('55555555-5555-5555-5555-555555555555', 'original', 'x')$$,
  '42501', null, 'a user cannot write an image row'
);

select throws_ok(
  $$insert into public.readings (page_id, label, raw_text)
    values ('55555555-5555-5555-5555-555555555555', 'B1', 'Invented')$$,
  '42501', null, 'a user cannot write a reading'
);

select throws_ok(
  $$insert into public.page_texts (page_id, text, pipeline_version)
    values ('55555555-5555-5555-5555-555555555555', 'Invented', '1')$$,
  '42501', null, 'a user cannot write a displayed text'
);

select throws_ok(
  $$insert into public.page_charges (page_id) values ('55555555-5555-5555-5555-555555555555')$$,
  '42501', null, 'a user cannot write a charge'
);

select throws_ok(
  $$update public.readings set raw_text = 'Changed'$$,
  '42501', null, 'a user cannot change a reading'
);

select throws_ok(
  $$update public.page_texts set text = 'Changed'$$,
  '42501', null, 'a user cannot change a displayed text'
);

select throws_ok(
  $$update public.page_charges set charged_at = now() + interval '1 year'$$,
  '42501', null, 'a user cannot change the date of a charge'
);

select throws_ok(
  $$update public.page_images set kind = 'prepared'$$,
  '42501', null, 'a user cannot change an image row'
);

reset role;

select throws_ok(
  $$insert into public.page_images (user_id, page_id, kind, storage_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'original', 'elsewhere/original.jpg')$$,
  '23514', null, 'an image outside the folder of its page is refused'
);

select throws_ok(
  $$insert into public.page_images (user_id, page_id, kind, storage_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'other',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/55555555-5555-5555-5555-555555555555/x.jpg')$$,
  '23514', null, 'an image kind that does not exist is refused'
);

select throws_ok(
  $$insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'Z', 'x', 'm', 'mv', 'V0', 0, 1, 1, 1)$$,
  '23514', null, 'a reading label that does not exist is refused'
);

select throws_ok(
  $$insert into public.page_texts (user_id, page_id, text, pipeline_version)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'x', '1')$$,
  '23503', null, 'a text cannot be attached to the page of another user'
);

select pg_temp.as_server();

select lives_ok(
  $$insert into public.page_images (user_id, page_id, kind, storage_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'original',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/55555555-5555-5555-5555-555555555555/original.jpg')$$,
  'the server can write an image row'
);

select lives_ok(
  $$insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'B1', 'Salut', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 900)$$,
  'the server can write a reading'
);

select lives_ok(
  $$insert into public.page_texts (user_id, page_id, text, pipeline_version)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'Bonjour a tous', '2')
    on conflict (page_id) do update set text = excluded.text, pipeline_version = excluded.pipeline_version$$,
  'the server can recompute the displayed text of a page'
);

select lives_ok(
  $$insert into public.page_charges (user_id, page_id)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555')$$,
  'the server can write a charge'
);

reset role;

delete from public.pages where id = '44444444-4444-4444-4444-444444444444';

select is(
  (select count(*) from public.page_charges where page_id is null and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint,
  'deleting a page keeps its charge, without the page'
);

select is(
  (select count(*) from public.readings where page_id = '44444444-4444-4444-4444-444444444444')
    + (select count(*) from public.page_texts where page_id = '44444444-4444-4444-4444-444444444444')
    + (select count(*) from public.page_images where page_id = '44444444-4444-4444-4444-444444444444'),
  0::bigint,
  'deleting a page deletes its readings, text and images'
);

delete from auth.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    + (select count(*) from public.notebooks where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    + (select count(*) from public.pages where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    + (select count(*) from public.page_images where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    + (select count(*) from public.readings where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    + (select count(*) from public.page_texts where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    + (select count(*) from public.page_charges where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'deleting an account deletes all its rows'
);

select * from finish();

rollback;
