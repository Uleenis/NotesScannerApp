begin;

select plan(25);

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

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First'),
  ('12121212-1212-1212-1212-121212121212', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Second'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Other');

insert into public.chapters (id, user_id, notebook_id, name) values
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Algebra'),
  ('44444444-4444-4444-4444-444444444444', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Secret');

insert into public.pages (id, user_id, notebook_id, chapter_id) values
  ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select lives_ok(
  $$insert into public.chapters (notebook_id, name) values ('11111111-1111-1111-1111-111111111111', 'Geometry')$$,
  'a user can create a chapter in their notebook'
);

select is(
  (select user_id from public.chapters where name = 'Geometry'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'the owner of a chapter is filled in from the session'
);

select lives_ok(
  $$insert into public.chapters (notebook_id, name) values ('12121212-1212-1212-1212-121212121212', 'Algebra')$$,
  'two notebooks can each have a chapter with the same name'
);

select lives_ok(
  $$insert into public.chapters (notebook_id, name) values ('11111111-1111-1111-1111-111111111111', 'algebra')$$,
  'a name that differs only by case is a different chapter'
);

select throws_ok(
  $$insert into public.chapters (notebook_id, name) values ('11111111-1111-1111-1111-111111111111', 'Algebra')$$,
  '23505', null, 'the same chapter name twice in a notebook is refused'
);

select throws_ok(
  $$insert into public.chapters (notebook_id, name) values ('11111111-1111-1111-1111-111111111111', 'Algebra ')$$,
  '23505', null, 'a trailing space does not make a new chapter name'
);

select throws_ok(
  $$insert into public.chapters (notebook_id, name) values ('11111111-1111-1111-1111-111111111111', E'\u00a0Algebra')$$,
  '23505', null, 'a non-breaking space does not make a new chapter name'
);

select throws_ok(
  $$insert into public.chapters (notebook_id, name) values ('11111111-1111-1111-1111-111111111111', '')$$,
  '23514', null, 'an empty chapter name is refused'
);

select throws_ok(
  $$insert into public.chapters (notebook_id, name) values ('11111111-1111-1111-1111-111111111111', E'\u00a0\u3000\u200b')$$,
  '23514', null, 'a chapter name made of invisible spaces is refused'
);

select throws_ok(
  $$insert into public.chapters (notebook_id, name) values ('11111111-1111-1111-1111-111111111111', repeat('a', 201))$$,
  '23514', null, 'a chapter name of 201 characters is refused'
);

select lives_ok(
  $$insert into public.chapters (notebook_id, name) values ('11111111-1111-1111-1111-111111111111', repeat('b', 200))$$,
  'a chapter name of 200 characters is accepted'
);

select lives_ok(
  $$update public.chapters set name = 'Linear algebra' where id = '33333333-3333-3333-3333-333333333333'$$,
  'a user can rename a chapter'
);

select is(
  (select name from public.chapters where id = '33333333-3333-3333-3333-333333333333'),
  'Linear algebra',
  'the chapter has its new name'
);

select throws_ok(
  $$update public.chapters set name = 'Geometry ' where id = '33333333-3333-3333-3333-333333333333'$$,
  '23505', null, 'renaming a chapter to a name already taken in its notebook is refused'
);

select throws_ok(
  $$update public.chapters set name = '  ' where id = '33333333-3333-3333-3333-333333333333'$$,
  '23514', null, 'renaming a chapter to an empty name is refused'
);

select throws_ok(
  $$update public.chapters set name = repeat('a', 201) where id = '33333333-3333-3333-3333-333333333333'$$,
  '23514', null, 'renaming a chapter to 201 characters is refused'
);

select throws_ok(
  $$update public.chapters set notebook_id = '12121212-1212-1212-1212-121212121212' where id = '33333333-3333-3333-3333-333333333333'$$,
  '42501', null, 'a user cannot move a chapter to another notebook'
);

select throws_ok(
  $$insert into public.chapters (notebook_id, name) values ('22222222-2222-2222-2222-222222222222', 'Intruder')$$,
  '23503', null, 'a user cannot create a chapter in the notebook of someone else'
);

select throws_ok(
  $$delete from public.chapters where id = '33333333-3333-3333-3333-333333333333'$$,
  '42501', null, 'a user cannot delete a chapter'
);

select throws_ok(
  $$delete from public.pages where id = '55555555-5555-5555-5555-555555555555'$$,
  '42501', null, 'a user cannot delete a page'
);

select throws_ok(
  $$update public.pages set notebook_id = '12121212-1212-1212-1212-121212121212' where id = '55555555-5555-5555-5555-555555555555'$$,
  '42501', null, 'a user cannot change the notebook of a page'
);

select throws_ok(
  $$update public.pages set chapter_id = null where id = '55555555-5555-5555-5555-555555555555'$$,
  '42501', null, 'a user cannot change the chapter of a page: a move goes through the server'
);

reset role;
select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select count(*) from public.chapters),
  1::bigint,
  'another user sees only their own chapters'
);

select lives_ok(
  $$update public.chapters set name = 'Hacked' where id = '33333333-3333-3333-3333-333333333333'$$,
  'another user can run a rename that targets the chapter of someone else'
);

reset role;

select is(
  (select name from public.chapters where id = '33333333-3333-3333-3333-333333333333'),
  'Linear algebra',
  'that rename changed nothing'
);

select * from finish();

rollback;
