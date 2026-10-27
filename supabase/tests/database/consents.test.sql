begin;

select plan(56);

create function pg_temp.make_user(uid uuid, born_before integer, land text) returns void
language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at) values (uid, uid::text || '@example.test', now());
  if born_before is not null then
    update public.profiles
    set birth_year = extract(year from now() at time zone 'Europe/Paris')::integer - born_before, country = land
    where id = uid;
  end if;
end;
$$;

create function pg_temp.login(uid uuid) returns void
language sql as $$
  select
    set_config('role', 'authenticated', true),
    set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.consent() returns text
language sql as $$
  select $q$insert into public.consents (kind, version) values ('training', 'training-1')$q$;
$$;

select pg_temp.make_user('c5c5c5c5-0000-0000-0000-000000000001', 16, 'FR');
select pg_temp.make_user('c5c5c5c5-0000-0000-0000-000000000002', 16, 'DE');
select pg_temp.make_user('c5c5c5c5-0000-0000-0000-000000000003', 16, '');
select pg_temp.make_user('c5c5c5c5-0000-0000-0000-000000000004', 17, '');
select pg_temp.make_user('c5c5c5c5-0000-0000-0000-000000000005', 16, 'US');
select pg_temp.make_user('c5c5c5c5-0000-0000-0000-000000000006', 14, 'BE');
select pg_temp.make_user('c5c5c5c5-0000-0000-0000-000000000007', 13, 'BE');
select pg_temp.make_user('c5c5c5c5-0000-0000-0000-000000000008', 15, 'FR');
select pg_temp.make_user('c5c5c5c5-0000-0000-0000-000000000009', null, null);
insert into auth.users (id, is_anonymous) values ('c5c5c5c5-0000-0000-0000-000000000010', true);
insert into auth.users (id, email) values ('c5c5c5c5-0000-0000-0000-000000000011', 'c5c5c5c5-11@example.test');
select pg_temp.make_user('c5c5c5c5-0000-0000-0000-000000000012', 30, 'GB');
select pg_temp.make_user('c5c5c5c5-0000-0000-0000-000000000013', 15, 'AT');
select pg_temp.make_user('c5c5c5c5-0000-0000-0000-000000000014', 14, 'AT');

select set_eq(
  $$select country, age::integer from private.digital_consent_ages$$,
  $$values
    ('BE', 13), ('DK', 13), ('EE', 13), ('FI', 13), ('GB', 13), ('LV', 13), ('MT', 13), ('PT', 13), ('SE', 13),
    ('AT', 14), ('BG', 14), ('CY', 14), ('ES', 14), ('IT', 14), ('LT', 14),
    ('CZ', 15), ('FR', 15), ('GR', 15),
    ('DE', 16), ('HR', 16), ('HU', 16), ('IE', 16), ('LU', 16), ('NL', 16), ('PL', 16), ('RO', 16), ('SI', 16), ('SK', 16)$$,
  'the table of ages holds exactly the countries and ages of the source'
);

select is(
  (select count(*)::integer from private.digital_consent_ages),
  28,
  'the table of ages names 28 countries'
);

select results_eq(
  $$select age::integer, count(*)::integer from private.digital_consent_ages group by age order by age$$,
  $$values (13, 9), (14, 6), (15, 3), (16, 10)$$,
  'the table of ages has 9 countries at 13, 6 at 14, 3 at 15 and 10 at 16'
);

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000001');

select lives_ok(pg_temp.consent(), 'a user of France whose youngest age is 15 consents');

select results_eq(
  $$select user_id, kind, version, granted_by, parent_email, revoked_at from public.consents$$,
  $$values ('c5c5c5c5-0000-0000-0000-000000000001'::uuid, 'training', 'training-1', 'user', null::text, null::timestamptz)$$,
  'the consent is the user''s own, of the current version, active'
);

select is(
  (select granted_at = now() from public.consents),
  true,
  'the consent is dated by the database'
);

select throws_ok(pg_temp.consent(), '23505', 'consent_already_active', 'a second active consent is refused');

select throws_ok(
  $$insert into public.consents (kind, version) values ('training', 'training-0')$$,
  '23514',
  'consent_version_outdated',
  'a consent to another version is refused'
);

select throws_ok(
  $$insert into public.consents (kind, version) values ('marketing', 'training-1')$$,
  '23514',
  null,
  'a consent of another kind is refused'
);

select throws_ok(
  $$insert into public.consents (kind, version, granted_by) values ('training', 'training-1', 'parent')$$,
  '42501',
  null,
  'the client cannot write a parent''s consent'
);

select throws_ok(
  $$insert into public.consents (kind, version, parent_email) values ('training', 'training-1', 'parent@example.test')$$,
  '42501',
  null,
  'the client cannot write a parent''s address'
);

select throws_ok(
  $$insert into public.consents (user_id, kind, version) values ('c5c5c5c5-0000-0000-0000-000000000012', 'training', 'training-1')$$,
  '42501',
  null,
  'the client cannot consent for another user'
);

select throws_ok(
  $$insert into public.consents (kind, version, granted_at) values ('training', 'training-1', now() - interval '1 year')$$,
  '42501',
  null,
  'the client cannot date its consent'
);

select throws_ok(
  $$insert into public.consents (kind, version, revoked_at) values ('training', 'training-1', now())$$,
  '42501',
  null,
  'the client cannot write a withdrawal'
);

select throws_ok(
  $$update public.consents set revoked_at = now()$$,
  '42501',
  null,
  'the client cannot change a consent'
);

select throws_ok(
  $$delete from public.consents$$,
  '42501',
  null,
  'the client cannot delete a consent'
);

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000002');

select throws_ok(pg_temp.consent(), '23514', 'under_age', 'a user of Germany whose youngest age is 15 is under 16');

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000003');

select throws_ok(pg_temp.consent(), '23514', 'under_age', 'without a country, a user whose youngest age is 15 is under 16');

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000004');

select lives_ok(pg_temp.consent(), 'without a country, a user whose youngest age is 16 consents');

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000005');

select throws_ok(pg_temp.consent(), '23514', 'under_age', 'a country outside the table counts at 16');

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000006');

select lives_ok(pg_temp.consent(), 'a user of Belgium whose youngest age is 13 consents');

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000007');

select throws_ok(pg_temp.consent(), '23514', 'under_age', 'a user of Belgium whose youngest age is 12 is under 13');

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000008');

select throws_ok(
  pg_temp.consent(),
  '23514',
  'under_age',
  'a user of France born 15 years ago counts as 14, the youngest age possible'
);

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000013');

select lives_ok(pg_temp.consent(), 'a user of Austria whose youngest age is 14 consents');

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000014');

select throws_ok(pg_temp.consent(), '23514', 'under_age', 'a user of Austria whose youngest age is 13 is under 14');

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000009');

select throws_ok(pg_temp.consent(), '23514', 'age_missing', 'a user without a birth year cannot consent');

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000010');

select throws_ok(pg_temp.consent(), '23514', 'account_not_registered', 'an anonymous account cannot consent');

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000011');

select throws_ok(
  pg_temp.consent(),
  '23514',
  'account_not_registered',
  'an account whose address is not confirmed cannot consent'
);

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000012');

select is_empty($$select id from public.consents$$, 'another user reads none of the consents');

select throws_ok(
  $$update public.consents set revoked_at = now() where user_id = 'c5c5c5c5-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'another user cannot withdraw a consent'
);

reset role;

select is(
  (select revoked_at from public.consents where user_id = 'c5c5c5c5-0000-0000-0000-000000000001'),
  null,
  'the consent is still active'
);

select is(
  (select count(*)::integer from public.consents where user_id::text like 'c5c5c5c5%'),
  4,
  'only the accepted consents were written'
);

select lives_ok(
  $$insert into public.consents (user_id, kind, version, granted_by, parent_email)
    values ('c5c5c5c5-0000-0000-0000-000000000002', 'training', 'training-1', 'parent', 'parent@example.test')$$,
  'the server writes a parent''s consent for a user under the age'
);

select throws_ok(
  $$insert into public.consents (user_id, kind, version, granted_by, parent_email)
    values ('c5c5c5c5-0000-0000-0000-000000000012', 'training', 'training-1', 'parent', 'parent@example.test')$$,
  '23514',
  'not_under_age',
  'the server cannot write a parent''s consent for a user of the age'
);

select throws_ok(
  $$insert into public.consents (user_id, kind, version, granted_by)
    values ('c5c5c5c5-0000-0000-0000-000000000003', 'training', 'training-1', 'parent')$$,
  '23514',
  null,
  'a parent''s consent without the parent''s address is refused'
);

select throws_ok(
  $$insert into public.consents (user_id, kind, version, parent_email)
    values ('c5c5c5c5-0000-0000-0000-000000000012', 'training', 'training-1', 'parent@example.test')$$,
  '23514',
  null,
  'a user''s consent with a parent''s address is refused'
);

select throws_ok(
  format(
    $$insert into public.consents (user_id, kind, version, granted_by, parent_email)
      values ('c5c5c5c5-0000-0000-0000-000000000003', 'training', 'training-1', 'parent', '%s')$$,
    repeat('a', 243) || '@example.test'
  ),
  '23514',
  null,
  'a parent''s address of more than 254 characters is refused'
);

select throws_ok(
  $$insert into public.consents (user_id, kind, version, granted_by, parent_email)
    values ('c5c5c5c5-0000-0000-0000-000000000003', 'training', 'training-1', 'parent', 'no address')$$,
  '23514',
  null,
  'a parent''s address without an at sign is refused'
);

select throws_ok(
  $$insert into public.consents (user_id, kind, version, granted_by, parent_email)
    values ('c5c5c5c5-0000-0000-0000-000000000010', 'training', 'training-1', 'parent', 'parent@example.test')$$,
  '23514',
  'account_not_registered',
  'the server cannot write a parent''s consent for an anonymous account'
);

select throws_ok(
  $$insert into public.consents (user_id, kind, version, revoked_at)
    values ('c5c5c5c5-0000-0000-0000-000000000012', 'training', 'training-1', now())$$,
  '23514',
  'consent_revoked_on_insert',
  'a consent cannot be born withdrawn'
);

select lives_ok(
  $$update public.consents set revoked_at = now() + interval '1 year' where user_id = 'c5c5c5c5-0000-0000-0000-000000000001'$$,
  'the server withdraws a consent'
);

select is(
  (select revoked_at from public.consents where user_id = 'c5c5c5c5-0000-0000-0000-000000000001'),
  now(),
  'the withdrawal is dated by the database, whatever date the writer gives'
);

select throws_ok(
  $$update public.consents set revoked_at = now() + interval '1 day' where user_id = 'c5c5c5c5-0000-0000-0000-000000000001'$$,
  '23514',
  'consent_immutable',
  'a withdrawal cannot be moved'
);

select throws_ok(
  $$update public.consents set revoked_at = null where user_id = 'c5c5c5c5-0000-0000-0000-000000000001'$$,
  '23514',
  'consent_immutable',
  'a withdrawal cannot be undone'
);

select throws_ok(
  $$update public.consents set version = 'training-2' where user_id = 'c5c5c5c5-0000-0000-0000-000000000004'$$,
  '23514',
  'consent_immutable',
  'the version of a consent cannot change'
);

select throws_ok(
  $$update public.consents set kind = 'training', version = 'training-1', granted_by = 'parent', parent_email = 'parent@example.test' where user_id = 'c5c5c5c5-0000-0000-0000-000000000004'$$,
  '23514',
  'consent_immutable',
  'a user''s consent cannot become a parent''s'
);

select throws_ok(
  $$update public.consents set parent_email = 'other@example.test' where granted_by = 'parent' and user_id = 'c5c5c5c5-0000-0000-0000-000000000002'$$,
  '23514',
  'consent_immutable',
  'the parent''s address cannot change'
);

select throws_ok(
  $$update public.consents set user_id = 'c5c5c5c5-0000-0000-0000-000000000012' where user_id = 'c5c5c5c5-0000-0000-0000-000000000004'$$,
  '23514',
  'consent_immutable',
  'a consent cannot move to another user'
);

select throws_ok(
  $$update public.consents set granted_at = granted_at - interval '1 day' where user_id = 'c5c5c5c5-0000-0000-0000-000000000004'$$,
  '23514',
  'consent_immutable',
  'the date of a consent cannot change'
);

select throws_ok(
  $$update public.consents set id = gen_random_uuid() where user_id = 'c5c5c5c5-0000-0000-0000-000000000004'$$,
  '23514',
  'consent_immutable',
  'the identifier of a consent cannot change'
);

select pg_temp.login('c5c5c5c5-0000-0000-0000-000000000001');

select lives_ok(pg_temp.consent(), 'after a withdrawal, the user consents again');

select is(
  (select count(*)::integer from public.consents),
  2,
  'the user reads the withdrawn consent and the new one'
);

reset role;

delete from auth.users where id = 'c5c5c5c5-0000-0000-0000-000000000001';

select is(
  (select count(*)::integer from public.consents where user_id = 'c5c5c5c5-0000-0000-0000-000000000001'),
  0,
  'deleting the account deletes its consents'
);

select is(
  (select bool_and(prosecdef and proconfig = array['search_path=""'])
   from pg_proc
   where oid in ('private.check_consent()'::regprocedure, 'private.keep_consent()'::regprocedure)),
  true,
  'the rules of consents run with the rights of their owner and an empty search path'
);

select is(
  (select bool_or(has_function_privilege(r, f, 'execute'))
   from unnest(array['anon', 'authenticated']) r
   cross join unnest(array['private.check_consent()', 'private.keep_consent()']) f),
  false,
  'a client cannot call the rules of consents'
);

select is(
  has_table_privilege('authenticated', 'private.digital_consent_ages', 'select')
    or has_table_privilege('anon', 'private.digital_consent_ages', 'select'),
  false,
  'a client has no right on the table of ages'
);

select * from finish();

rollback;
