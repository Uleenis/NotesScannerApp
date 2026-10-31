begin;

select plan(38);

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
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First'),
  ('12121212-1212-1212-1212-121212121212', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Second'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Other');

insert into public.chapters (id, user_id, notebook_id, name) values
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Chapter'),
  ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12121212-1212-1212-1212-121212121212', 'Other chapter');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select lives_ok(
  $$insert into public.pages (notebook_id, position, source) values ('11111111-1111-1111-1111-111111111111', 0, 'camera')$$,
  'a user can create a page in their notebook'
);

select is(
  (select status from public.pages where position = 0),
  'queued',
  'a new page is queued'
);

select is(
  (select user_id from public.pages where position = 0),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'the owner of a page is filled in from the session'
);

select is(
  (select retry_count from public.pages where position = 0),
  0,
  'a new page has no retry'
);

select lives_ok(
  $$insert into public.pages (notebook_id, chapter_id, position, source, captured_at)
    values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 1, 'camera', now())$$,
  'a user can create a page in a chapter of their notebook'
);

select lives_ok(
  $$update public.pages set position = 2, uploaded_at = now() where position = 1$$,
  'a user can move a page and record its upload'
);

select throws_ok(
  $$update public.pages set chapter_id = null where position = 2$$,
  '42501', null, 'a user cannot change the chapter of a page: a move goes through the server'
);

select throws_ok(
  $$insert into public.pages (notebook_id, status) values ('11111111-1111-1111-1111-111111111111', 'read')$$,
  '42501', null, 'a user cannot create a page with a status'
);

select throws_ok(
  $$insert into public.pages (notebook_id, retry_count) values ('11111111-1111-1111-1111-111111111111', 1)$$,
  '42501', null, 'a user cannot create a page with a retry count'
);

select throws_ok(
  $$insert into public.pages (notebook_id, queue_reason) values ('11111111-1111-1111-1111-111111111111', 'offline')$$,
  '42501', null, 'a user cannot create a page with a queue reason'
);

select throws_ok(
  $$insert into public.pages (notebook_id, read_at) values ('11111111-1111-1111-1111-111111111111', now())$$,
  '42501', null, 'a user cannot create a page with a reading date'
);

select throws_ok(
  $$update public.pages set status = 'read' where position = 2$$,
  '42501', null, 'a user cannot change the status of a page'
);

select throws_ok(
  $$update public.pages set retry_count = 0 where position = 2$$,
  '42501', null, 'a user cannot change the retry count of a page'
);

select throws_ok(
  $$update public.pages set queue_reason = 'offline' where position = 2$$,
  '42501', null, 'a user cannot change the queue reason of a page'
);

select throws_ok(
  $$update public.pages set read_at = now() where position = 2$$,
  '42501', null, 'a user cannot change the reading date of a page'
);

select throws_ok(
  $$update public.pages set notebook_id = '12121212-1212-1212-1212-121212121212' where position = 2$$,
  '42501', null, 'a user cannot move a page to another notebook'
);

select throws_ok(
  $$update public.pages set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where position = 2$$,
  '42501', null, 'a user cannot give a page away'
);

select lives_ok(
  $$insert into public.pages (notebook_id, position, source, captured_at) values ('11111111-1111-1111-1111-111111111111', 7, 'import', now())$$,
  'a user can create a page imported from the gallery'
);

select is(
  (select source from public.pages where position = 7),
  'import',
  'an imported page keeps its source'
);

select throws_ok(
  $$insert into public.pages (notebook_id, source) values ('11111111-1111-1111-1111-111111111111', 'gallery')$$,
  '23514', null, 'a source that does not exist is refused'
);

select throws_ok(
  $$insert into public.pages (notebook_id, source) values ('11111111-1111-1111-1111-111111111111', 'IMPORT')$$,
  '23514', null, 'a source is matched exactly'
);

select throws_ok(
  $$update public.pages set source = 'import' where position = 0$$,
  '42501', null, 'a user cannot change the source of a page afterwards'
);

select throws_ok(
  $$insert into public.pages (notebook_id) values ('22222222-2222-2222-2222-222222222222')$$,
  '23503', null, 'a page cannot be put in the notebook of another user'
);

select throws_ok(
  $$insert into public.pages (notebook_id, chapter_id)
    values ('12121212-1212-1212-1212-121212121212', '33333333-3333-3333-3333-333333333333')$$,
  '23503', null, 'a page cannot be put in a chapter of another notebook'
);

select throws_ok(
  $$delete from public.pages where position = 0$$,
  '42501', null, 'a user cannot delete a page'
);

reset role;

select throws_ok(
  $$update public.pages set status = 'done' where position = 0 and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '23514', null, 'a status outside the four known ones is refused'
);

select throws_ok(
  $$update public.pages set retry_count = 4 where position = 0 and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '23514', null, 'more than three retries are refused'
);

select throws_ok(
  $$update public.pages set status = 'read', queue_reason = 'read_error' where position = 0 and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '23514', null, 'a queue reason on a page that is not queued is refused'
);

select throws_ok(
  $$update public.pages set queue_reason = 'unknown' where position = 0 and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '23514', null, 'an unknown queue reason is refused'
);

select lives_ok(
  $$update public.pages set queue_reason = 'read_error', retry_count = 3 where position = 0 and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'a queued page can carry a read error'
);

select pg_temp.as_server();

select lives_ok(
  $$update public.pages set status = 'processing', queue_reason = null where position = 0 and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'the server can change the status of a page and clear its queue reason'
);

select lives_ok(
  $$update public.pages set status = 'read', read_at = now() where position = 0 and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'the server can mark a page as read'
);

reset role;

select is(
  (select status from public.pages where position = 0 and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'read',
  'the server change is saved'
);

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select count(*) from public.pages),
  0::bigint,
  'another user sees none of these pages'
);

select lives_ok(
  $$update public.pages set position = 9 where position = 0 and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'another user can run an update that targets the page of someone else'
);

reset role;

select is(
  (select count(*) from public.pages where position = 9 and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'that update changed nothing'
);

update public.pages set chapter_id = '33333333-3333-3333-3333-333333333333' where position = 2 and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

delete from public.chapters where id = '33333333-3333-3333-3333-333333333333';

select is(
  (select count(*) from public.pages where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and position = 2 and chapter_id is null),
  1::bigint,
  'deleting a chapter keeps its pages, without the chapter'
);

delete from public.notebooks where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*) from public.pages where notebook_id = '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'deleting a notebook deletes its pages'
);

select * from finish();

rollback;
