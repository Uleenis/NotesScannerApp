begin;

select plan(11);

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

create temp table profile_count_before as select count(*) as n from public.profiles;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is(
  (select interface_language from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'en',
  'a new account gets a profile in English'
);

select is(
  (select tier from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'free',
  'a new account gets the free tier'
);

select is(
  (select count(*) from public.profiles) - (select n from profile_count_before),
  1::bigint,
  'creating one account creates exactly one profile'
);

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select lives_ok(
  $$update public.profiles set interface_language = 'fr' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'a user can change their interface language'
);

select is(
  (select interface_language from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'fr',
  'the new interface language is saved'
);

select throws_ok(
  $$update public.profiles set interface_language = 'de' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '23514',
  null,
  'an unsupported interface language is refused'
);

select throws_ok(
  $$update public.profiles set tier = 'subscriber' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501',
  null,
  'a user cannot change their own tier'
);

select throws_ok(
  $$insert into public.profiles (id) values (gen_random_uuid())$$,
  '42501',
  null,
  'a user cannot create a profile'
);

select throws_ok(
  $$delete from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501',
  null,
  'a user cannot delete a profile'
);

reset role;

select is(
  has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')
    or has_function_privilege('anon', 'public.handle_new_user()', 'execute'),
  false,
  'a client cannot call the function that creates profiles'
);

select is(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.handle_new_user()'::regprocedure),
  true,
  'the function that creates profiles runs with the rights of its owner and an empty search path'
);

select * from finish();

rollback;
