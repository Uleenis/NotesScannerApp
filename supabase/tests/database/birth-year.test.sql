begin;

select plan(25);

create function pg_temp.make_user(uid uuid) returns void
language sql as $$
  insert into auth.users (id, email, email_confirmed_at) values (uid, uid::text || '@example.test', now());
$$;

create function pg_temp.login(uid uuid) returns void
language sql as $$
  select
    set_config('role', 'authenticated', true),
    set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.year_now() returns integer
language sql as $$
  select extract(year from now() at time zone 'Europe/Paris')::integer;
$$;

select pg_temp.make_user('b1b1b1b1-0000-0000-0000-000000000001');
select pg_temp.make_user('b1b1b1b1-0000-0000-0000-000000000002');
select pg_temp.make_user('b1b1b1b1-0000-0000-0000-000000000003');
select pg_temp.make_user('b1b1b1b1-0000-0000-0000-000000000004');
insert into auth.users (id, is_anonymous) values ('b1b1b1b1-0000-0000-0000-000000000005', true);
insert into auth.users (id, email) values ('b1b1b1b1-0000-0000-0000-000000000006', 'b1b1b1b1-6@example.test');

select pg_temp.login('b1b1b1b1-0000-0000-0000-000000000001');

select lives_ok(
  $$update public.profiles set birth_year = 2008, country = 'FR' where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$,
  'a registered user writes their birth year and country together'
);

select results_eq(
  $$select birth_year::integer, country from public.profiles where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$,
  $$values (2008, 'FR')$$,
  'the birth year and country are saved'
);

select throws_ok(
  $$update public.profiles set birth_year = 1990, country = 'FR' where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$,
  '23514',
  'age_already_set',
  'a second write of the birth year is refused'
);

select throws_ok(
  $$update public.profiles set birth_year = 2008, country = 'FR' where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$,
  '23514',
  'age_already_set',
  'a second write of the same values is refused'
);

select throws_ok(
  $$update public.profiles set country = 'DE' where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$,
  '23514',
  'age_already_set',
  'a second write of the country alone is refused'
);

select throws_ok(
  $$update public.profiles set birth_year = null, country = null where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$,
  '23514',
  'age_already_set',
  'the birth year cannot be erased'
);

select lives_ok(
  $$update public.profiles set interface_language = 'fr' where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$,
  'the interface language still changes once the birth year is written'
);

select pg_temp.login('b1b1b1b1-0000-0000-0000-000000000002');

select throws_ok(
  $$update public.profiles set birth_year = 2000 where id = 'b1b1b1b1-0000-0000-0000-000000000002'$$,
  '23514',
  null,
  'a birth year without a country is refused'
);

select throws_ok(
  $$update public.profiles set country = 'FR' where id = 'b1b1b1b1-0000-0000-0000-000000000002'$$,
  '23514',
  null,
  'a country without a birth year is refused'
);

select throws_ok(
  $$update public.profiles set birth_year = 1899, country = 'FR' where id = 'b1b1b1b1-0000-0000-0000-000000000002'$$,
  '23514',
  null,
  'a birth year before 1900 is refused'
);

select throws_ok(
  format($$update public.profiles set birth_year = %s, country = 'FR' where id = 'b1b1b1b1-0000-0000-0000-000000000002'$$, pg_temp.year_now() + 1),
  '23514',
  'birth_year_out_of_range',
  'a birth year after the current year in Paris is refused'
);

select throws_ok(
  $$update public.profiles set birth_year = 2000, country = 'fr' where id = 'b1b1b1b1-0000-0000-0000-000000000002'$$,
  '23514',
  null,
  'a country in lower case is refused'
);

select throws_ok(
  $$update public.profiles set birth_year = 2000, country = 'FRA' where id = 'b1b1b1b1-0000-0000-0000-000000000002'$$,
  '23514',
  null,
  'a country of three letters is refused'
);

select throws_ok(
  $$update public.profiles set birth_year = 2000, country = ' F' where id = 'b1b1b1b1-0000-0000-0000-000000000002'$$,
  '23514',
  null,
  'a country that is not two capital letters is refused'
);

select is(
  (select birth_year from public.profiles where id = 'b1b1b1b1-0000-0000-0000-000000000002'),
  null,
  'the refused writes left no birth year'
);

select lives_ok(
  format($$update public.profiles set birth_year = %s, country = '' where id = 'b1b1b1b1-0000-0000-0000-000000000002'$$, pg_temp.year_now()),
  'the current year and an empty country are accepted'
);

select pg_temp.login('b1b1b1b1-0000-0000-0000-000000000003');

select lives_ok(
  $$update public.profiles set birth_year = 1900, country = 'DE' where id = 'b1b1b1b1-0000-0000-0000-000000000003'$$,
  'the year 1900 is accepted'
);

select pg_temp.login('b1b1b1b1-0000-0000-0000-000000000004');

select is_empty(
  $$select birth_year, country from public.profiles where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$,
  'another user reads neither the birth year nor the country'
);

update public.profiles set birth_year = 1990, country = 'GB' where id = 'b1b1b1b1-0000-0000-0000-000000000001';

reset role;

select results_eq(
  $$select birth_year::integer, country from public.profiles where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$,
  $$values (2008, 'FR')$$,
  'another user cannot change the birth year or the country'
);

select pg_temp.login('b1b1b1b1-0000-0000-0000-000000000005');

select throws_ok(
  $$update public.profiles set birth_year = 2000, country = 'FR' where id = 'b1b1b1b1-0000-0000-0000-000000000005'$$,
  '23514',
  'account_not_registered',
  'an anonymous account cannot write a birth year'
);

select pg_temp.login('b1b1b1b1-0000-0000-0000-000000000006');

select throws_ok(
  $$update public.profiles set birth_year = 2000, country = 'FR' where id = 'b1b1b1b1-0000-0000-0000-000000000006'$$,
  '23514',
  'account_not_registered',
  'an account whose address is not confirmed cannot write a birth year'
);

select throws_ok(
  $$select age from private.digital_consent_ages$$,
  '42501',
  null,
  'a user cannot read the table of ages directly'
);

reset role;

update public.profiles set birth_year = 2000, country = 'FR' where id = 'b1b1b1b1-0000-0000-0000-000000000004';

select throws_ok(
  $$update public.profiles set birth_year = 2001, country = 'FR' where id = 'b1b1b1b1-0000-0000-0000-000000000004'$$,
  '23514',
  'age_already_set',
  'the server cannot write the birth year a second time either'
);

select is(
  (select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'private.check_profile_age()'::regprocedure),
  true,
  'the rule of the birth year runs with the rights of its owner and an empty search path'
);

select is(
  has_function_privilege('authenticated', 'private.check_profile_age()', 'execute')
    or has_function_privilege('anon', 'private.check_profile_age()', 'execute'),
  false,
  'a client cannot call the rule of the birth year'
);

select * from finish();

rollback;
