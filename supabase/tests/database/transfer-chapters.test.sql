begin;

select plan(6);

create function pg_temp.make_user(uid uuid, anon boolean default false) returns void
language sql as $$
  insert into auth.users (id, email, is_anonymous)
  values (uid, case when anon then null else uid::text || '@example.test' end, anon);
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'History'),
  ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', E'History  ');

insert into public.chapters (id, user_id, notebook_id, name) values
  ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000001', 'Intro'),
  ('a2000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000001', 'Only mine'),
  ('b2000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1000000-0000-0000-0000-000000000001', E'Intro ');

insert into public.pages (id, user_id, notebook_id, chapter_id) values
  ('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002'),
  ('a3000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000001', null),
  ('b3000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001');

set local role service_role;

select lives_ok(
  $$select * from public.transfer_account_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'a transfer into a notebook that has a chapter of the same name goes through'
);

select is(
  (select count(*) from public.chapters where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and notebook_id = 'b1000000-0000-0000-0000-000000000001'),
  2::bigint,
  'chapters of the same name are merged and the others are kept'
);

select is(
  (select count(*) from public.pages where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and chapter_id = 'b2000000-0000-0000-0000-000000000001'),
  2::bigint,
  'the pages of the merged chapter are in the chapter that was already there'
);

select is(
  (select chapter_id from public.pages where id = 'a3000000-0000-0000-0000-000000000002'),
  'a2000000-0000-0000-0000-000000000002'::uuid,
  'the pages of a chapter with no twin keep their chapter'
);

select is(
  (select count(*) from public.pages where id = 'a3000000-0000-0000-0000-000000000003' and chapter_id is null and user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  1::bigint,
  'a page out of any chapter stays out of any chapter'
);

select is(
  (select count(*) from public.chapters where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'the giving account keeps no chapter'
);

select * from finish();

rollback;
