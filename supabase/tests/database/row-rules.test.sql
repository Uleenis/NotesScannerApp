begin;

select plan(8);

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
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Mine'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Theirs');

insert into public.chapters (id, user_id, notebook_id, name) values
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Mine'),
  ('55555555-5555-5555-5555-555555555555', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Theirs');

insert into public.pages (id, user_id, notebook_id) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

grant insert (user_id) on public.notebooks, public.chapters, public.pages to authenticated;
grant update (user_id) on public.notebooks, public.chapters, public.pages to authenticated;
grant update (id) on public.profiles to authenticated;

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select throws_ok(
  $$insert into public.notebooks (user_id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Planted')$$,
  '42501', null, 'the access rule alone refuses a notebook written for another user'
);

select throws_ok(
  $$insert into public.chapters (user_id, notebook_id, name)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Planted')$$,
  '42501', null, 'the access rule alone refuses a chapter written for another user'
);

select throws_ok(
  $$insert into public.pages (user_id, notebook_id)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222')$$,
  '42501', null, 'the access rule alone refuses a page written for another user'
);

select throws_ok(
  $$update public.notebooks set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'the access rule alone refuses to give a notebook away'
);

select throws_ok(
  $$update public.chapters set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = '33333333-3333-3333-3333-333333333333'$$,
  '42501', null, 'the access rule alone refuses to give a chapter away'
);

select throws_ok(
  $$update public.pages set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = '44444444-4444-4444-4444-444444444444'$$,
  '42501', null, 'the access rule alone refuses to give a page away'
);

select throws_ok(
  $$update public.profiles set id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501', null, 'the access rule alone refuses to hand a profile to another account'
);

select is(
  (select count(*) from public.notebooks where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0::bigint,
  'no notebook of another user is visible to this user'
);

select * from finish();

rollback;
