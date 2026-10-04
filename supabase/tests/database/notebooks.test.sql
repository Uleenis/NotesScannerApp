begin;

select plan(16);

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

insert into public.notebooks (id, user_id, name)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Seed');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select lives_ok(
  $$insert into public.notebooks (name, position) values ('Math', 0)$$,
  'a user can create a notebook'
);

select is(
  (select user_id from public.notebooks where name = 'Math'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'the owner is filled in from the session'
);

select lives_ok(
  $$insert into public.notebooks (name) values ('math')$$,
  'a name that differs only by case is a different notebook'
);

select throws_ok(
  $$insert into public.notebooks (name) values ('Math')$$,
  '23505',
  null,
  'the same name twice is refused'
);

select throws_ok(
  $$insert into public.notebooks (name) values ('Math ')$$,
  '23505',
  null,
  'a trailing space does not make a new name'
);

select throws_ok(
  $$insert into public.notebooks (name) values (' Math')$$,
  '23505',
  null,
  'a leading space does not make a new name'
);

select throws_ok(
  $$insert into public.notebooks (name) values ('')$$,
  '23514',
  null,
  'an empty name is refused'
);

select throws_ok(
  $$insert into public.notebooks (name) values ('   ')$$,
  '23514',
  null,
  'a name made of spaces is refused'
);

select throws_ok(
  $$update public.notebooks set name = 'math' where name = 'Math'$$,
  '23505',
  null,
  'renaming to a name already taken is refused'
);

select throws_ok(
  $$insert into public.notebooks (name, user_id) values ('Owned', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  '42501',
  null,
  'a user cannot write a notebook for another user'
);

select throws_ok(
  $$delete from public.notebooks where name = 'Math'$$,
  '42501',
  null,
  'a user cannot delete a notebook'
);

reset role;
select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select lives_ok(
  $$insert into public.notebooks (name) values ('Math')$$,
  'two users can have a notebook with the same name'
);

select is(
  (select count(*) from public.notebooks),
  1::bigint,
  'a user only sees their own notebooks'
);

select throws_ok(
  $$insert into public.chapters (notebook_id, name) values ('11111111-1111-1111-1111-111111111111', 'Intrus')$$,
  '23503',
  null,
  'a chapter cannot be put in the notebook of another user'
);

select lives_ok(
  $$insert into public.chapters (notebook_id, name, position)
    values ((select id from public.notebooks where name = 'Math'), 'Algebra', 0)$$,
  'a user can create a chapter in their own notebook'
);

select throws_ok(
  $$insert into public.chapters (notebook_id, name)
    values ((select id from public.notebooks where name = 'Math'), '  ')$$,
  '23514',
  null,
  'a chapter name made of spaces is refused'
);

select * from finish();

rollback;
