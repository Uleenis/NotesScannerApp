begin;

select plan(10);

create function pg_temp.make_user(uid uuid) returns void
language sql as $$
  insert into auth.users (id, email) values (uid, uid::text || '@example.test');
$$;

create function pg_temp.as_server() returns void
language sql as $$
  select set_config('role', 'service_role', true);
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Moving');

insert into public.chapters (id, user_id, notebook_id, name) values
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Chapter');

insert into public.pages (id, user_id, notebook_id, chapter_id) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');

insert into public.page_images (user_id, page_id, kind, storage_path) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'original',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/44444444-4444-4444-4444-444444444444/original.jpg');

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'B1', 'Bonjour', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500);

insert into public.page_texts (user_id, page_id, text, pipeline_version) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'Bonjour', '1');

insert into public.page_charges (user_id, page_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444');

select pg_temp.as_server();

select throws_ok(
  $$update public.pages set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = '44444444-4444-4444-4444-444444444444'$$,
  '23503', null, 'a page cannot change owner while its readings still point to the old one'
);

select lives_ok($$set constraints all deferred$$, 'the server can defer the links between tables inside a transaction');

select lives_ok(
  $$
    update public.notebooks set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = '11111111-1111-1111-1111-111111111111';
    update public.chapters set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = '33333333-3333-3333-3333-333333333333';
    update public.pages set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = '44444444-4444-4444-4444-444444444444';
    update public.page_images
      set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          storage_path = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/44444444-4444-4444-4444-444444444444/original.jpg'
      where page_id = '44444444-4444-4444-4444-444444444444';
    update public.readings set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where page_id = '44444444-4444-4444-4444-444444444444';
    update public.page_texts set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where page_id = '44444444-4444-4444-4444-444444444444';
    update public.page_charges set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where page_id = '44444444-4444-4444-4444-444444444444';
  $$,
  'the server can move all the rows of an account to another account'
);

select lives_ok($$set constraints all immediate$$, 'the links between tables are consistent once the move is done');

reset role;

select is((select count(*) from public.notebooks where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 1::bigint, 'the notebook moved');
select is((select count(*) from public.chapters where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 1::bigint, 'the chapter moved');
select is((select count(*) from public.pages where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and chapter_id is not null), 1::bigint, 'the page moved and kept its chapter');
select is((select count(*) from public.page_images where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 1::bigint, 'the image row moved');
select is(
  (select count(*) from public.readings where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
    + (select count(*) from public.page_texts where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
    + (select count(*) from public.page_charges where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  3::bigint,
  'the reading, the text and the charge moved'
);

delete from auth.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (select count(*) from public.pages where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  1::bigint,
  'deleting the old account leaves the moved rows in place'
);

select * from finish();

rollback;
