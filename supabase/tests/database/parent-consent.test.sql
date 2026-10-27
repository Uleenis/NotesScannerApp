begin;

select plan(71);

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

create temp table kept (user_id uuid primary key, request_id uuid not null, code text not null);

create function pg_temp.ask(uid uuid, address text) returns text
language plpgsql as $$
declare
  r record;
begin
  select * into r from public.request_parent_consent(uid, address);
  if r.outcome = 'requested' then
    delete from kept where user_id = uid;
    insert into kept values (uid, r.request_id, r.code);
  end if;
  return r.outcome;
end;
$$;

create function pg_temp.code(uid uuid) returns text
language sql as $$
  select code from kept where user_id = uid;
$$;

create function pg_temp.wrong(uid uuid) returns text
language sql as $$
  select case when code = '000000' then '000001' else '000000' end from kept where user_id = uid;
$$;

create function pg_temp.confirm(uid uuid, given text) returns text
language sql as $$
  select row(outcome, attempts_left)::text from public.confirm_parent_consent(uid, given);
$$;

create function pg_temp.requests(uid uuid) returns integer
language sql as $$
  select count(*)::integer from private.parent_consent_requests where user_id = uid;
$$;

create function pg_temp.sends(uid uuid) returns integer
language sql as $$
  select count(*)::integer from private.parent_consent_sends where user_id = uid;
$$;

select pg_temp.make_user('c6c6c6c6-0000-0000-0000-000000000001', 14, 'FR');
select pg_temp.make_user('c6c6c6c6-0000-0000-0000-000000000002', 30, 'GB');
select pg_temp.make_user('c6c6c6c6-0000-0000-0000-000000000003', null, null);
insert into auth.users (id, is_anonymous) values ('c6c6c6c6-0000-0000-0000-000000000004', true);
insert into auth.users (id, email) values ('c6c6c6c6-0000-0000-0000-000000000005', 'c6c6c6c6-5@example.test');
select pg_temp.make_user('c6c6c6c6-0000-0000-0000-000000000006', 14, 'FR');
insert into public.consents (user_id, kind, version, granted_by, parent_email)
values ('c6c6c6c6-0000-0000-0000-000000000006', 'training', 'training-1', 'parent', 'parent@example.test');
select pg_temp.make_user('c6c6c6c6-0000-0000-0000-000000000007', 14, 'FR');
select pg_temp.make_user('c6c6c6c6-0000-0000-0000-000000000008', 14, 'FR');
select pg_temp.make_user('c6c6c6c6-0000-0000-0000-000000000009', 14, 'FR');
select pg_temp.make_user('c6c6c6c6-0000-0000-0000-000000000010', 16, 'XX');
select pg_temp.make_user('c6c6c6c6-0000-0000-0000-000000000011', 14, 'FR');

select has_table('private', 'parent_consent_requests', 'the pending requests live in the private schema');
select has_table('private', 'parent_consent_sends', 'the sends of the last day live in the private schema');

select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000004', 'parent@example.test'), 'account_not_registered', 'an anonymous account cannot ask a parent');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000005', 'parent@example.test'), 'account_not_registered', 'an account whose address is not confirmed cannot ask a parent');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000003', 'parent@example.test'), 'age_missing', 'an account without a birth year cannot ask a parent');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000002', 'parent@example.test'), 'not_under_age', 'an account at or above the age of its country does not need a parent');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000006', 'other@example.test'), 'consent_already_active', 'an account with an active consent cannot ask again');

select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000001', 'not-an-address'), 'invalid_email', 'an address without @ is refused');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000001', 'parent@localhost'), 'invalid_email', 'an address without a dotted domain is refused');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000001', 'par ent@example.test'), 'invalid_email', 'an address with a space is refused');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000001', E'parent@example.test\nbcc: x@example.test'), 'invalid_email', 'an address with a line break is refused');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000001', '<parent@example.test>'), 'invalid_email', 'an address with a sign outside the allowed ones is refused');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000001', ''), 'invalid_email', 'an empty address is refused');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000001', null), 'invalid_email', 'no address is refused');
select is(
  pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000001', 'p@' || repeat('a', 63) || '.' || repeat('b', 63) || '.' || repeat('c', 63) || '.' || repeat('d', 56) || '.test'),
  'invalid_email',
  'an address of 255 characters is refused'
);
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000001', 'C6C6C6C6-0000-0000-0000-000000000001@Example.TEST'), 'same_email', 'the address of the account itself is refused, whatever its case');

select is(
  (select count(*)::integer from private.parent_consent_requests r where r.user_id::text like 'c6c6c6c6-%'),
  0,
  'no refused request leaves a pending request'
);
select is(
  (select count(*)::integer from private.parent_consent_sends s where s.user_id::text like 'c6c6c6c6-%'),
  0,
  'no refused request counts as a send'
);

select is(
  pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000001', 'p@' || repeat('a', 63) || '.' || repeat('b', 63) || '.' || repeat('c', 63) || '.' || repeat('d', 55) || '.test'),
  'requested',
  'an address of 254 characters is accepted'
);
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000001', 'Parent.Name+kid@Example.TEST'), 'requested', 'a user under the age of its country asks a parent');
select matches(pg_temp.code('c6c6c6c6-0000-0000-0000-000000000001'), '^[0-9]{6}$', 'the code has six digits');
select is(pg_temp.requests('c6c6c6c6-0000-0000-0000-000000000001'), 1, 'a new request replaces the one in progress');
select is(
  (select parent_email from private.parent_consent_requests where user_id = 'c6c6c6c6-0000-0000-0000-000000000001'),
  'parent.name+kid@example.test',
  'the address is kept in lower case'
);
select is(
  (select request_id from kept where user_id = 'c6c6c6c6-0000-0000-0000-000000000001'),
  (select id from private.parent_consent_requests where user_id = 'c6c6c6c6-0000-0000-0000-000000000001'),
  'the request answered is the one kept'
);
select is(
  (select position(k.code in r.code_hash) = 0 and r.code_hash like '$2a$08$%'
   from private.parent_consent_requests r join kept k on k.user_id = r.user_id
   where r.user_id = 'c6c6c6c6-0000-0000-0000-000000000001'),
  true,
  'the code is kept hashed with bcrypt, never in clear'
);
select is(
  (select extensions.crypt(k.code, r.code_hash) = r.code_hash
   from private.parent_consent_requests r join kept k on k.user_id = r.user_id
   where r.user_id = 'c6c6c6c6-0000-0000-0000-000000000001'),
  true,
  'the hash is the hash of the code sent'
);
select is(
  (select row(created_at = now(), expires_at = now() + interval '7 days', attempts)::text
   from private.parent_consent_requests where user_id = 'c6c6c6c6-0000-0000-0000-000000000001'),
  '(t,t,0)',
  'the code is valid seven days and starts with no attempt'
);
select is(pg_temp.sends('c6c6c6c6-0000-0000-0000-000000000001'), 2, 'each request counts as a send');

select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000002', '123456'), '(no_request,)', 'a confirmation without a request is refused');
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000001', '12345'), '(invalid_code,)', 'a code of five digits is refused');
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000001', '1234567'), '(invalid_code,)', 'a code of seven digits is refused');
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000001', '12a456'), '(invalid_code,)', 'a code with a letter is refused');
select is(
  (select attempts from private.parent_consent_requests where user_id = 'c6c6c6c6-0000-0000-0000-000000000001'),
  0::smallint,
  'a malformed code does not count as an attempt'
);

select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000001', pg_temp.wrong('c6c6c6c6-0000-0000-0000-000000000001')), '(wrong_code,4)', 'a wrong code counts an attempt');
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000001', pg_temp.wrong('c6c6c6c6-0000-0000-0000-000000000001')), '(wrong_code,3)', 'a second wrong code counts a second attempt');
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000001', pg_temp.wrong('c6c6c6c6-0000-0000-0000-000000000001')), '(wrong_code,2)', 'a third wrong code counts a third attempt');
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000001', pg_temp.wrong('c6c6c6c6-0000-0000-0000-000000000001')), '(wrong_code,1)', 'a fourth wrong code counts a fourth attempt');
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000001', pg_temp.wrong('c6c6c6c6-0000-0000-0000-000000000001')), '(wrong_code,0)', 'a fifth wrong code uses the last attempt');
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000001', pg_temp.code('c6c6c6c6-0000-0000-0000-000000000001')), '(too_many_attempts,)', 'after five attempts even the right code is refused');
select is(
  (select count(*)::integer from public.consents where user_id = 'c6c6c6c6-0000-0000-0000-000000000001'),
  0,
  'no consent is written after five wrong attempts'
);

select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000008', 'parent@example.test'), 'requested', 'another child asks a parent');
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000008', pg_temp.wrong('c6c6c6c6-0000-0000-0000-000000000008')), '(wrong_code,4)', 'a wrong code first');
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000008', pg_temp.code('c6c6c6c6-0000-0000-0000-000000000008')), '(confirmed,)', 'the right code within its attempts confirms');
select results_eq(
  $$select kind, version, granted_by, parent_email, granted_at = now(), revoked_at from public.consents where user_id = 'c6c6c6c6-0000-0000-0000-000000000008'$$,
  $$values ('training', 'training-1', 'parent', 'parent@example.test', true, null::timestamptz)$$,
  'the right code writes the parent consent with the address of the parent'
);
select is(pg_temp.requests('c6c6c6c6-0000-0000-0000-000000000008'), 0, 'the request is gone once confirmed');
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000008', pg_temp.code('c6c6c6c6-0000-0000-0000-000000000008')), '(no_request,)', 'a code confirms once');

select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000009', 'parent@example.test'), 'requested', 'a third child asks a parent');
update private.parent_consent_requests set created_at = now() - interval '7 days 1 second', expires_at = now() - interval '1 second' where user_id = 'c6c6c6c6-0000-0000-0000-000000000009';
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000009', pg_temp.code('c6c6c6c6-0000-0000-0000-000000000009')), '(code_expired,)', 'a code past its seven days is refused');
select is(
  (select count(*)::integer from public.consents where user_id = 'c6c6c6c6-0000-0000-0000-000000000009'),
  0,
  'an expired code writes no consent'
);

select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000010', 'parent@example.test'), 'requested', 'a child of a country outside the table asks a parent');
insert into private.digital_consent_ages (country, age) values ('XX', 13);
select is(pg_temp.confirm('c6c6c6c6-0000-0000-0000-000000000010', pg_temp.code('c6c6c6c6-0000-0000-0000-000000000010')), '(not_under_age,)', 'a code is refused once the child no longer needs a parent');
select is(pg_temp.requests('c6c6c6c6-0000-0000-0000-000000000010'), 0, 'a request that can no longer be confirmed is removed');

select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000007', 'parent@example.test'), 'requested', 'a first send of the day');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000007', 'parent@example.test'), 'requested', 'a second send of the day');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000007', 'parent@example.test'), 'requested', 'a third send of the day');
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000007', 'parent@example.test'), 'send_limit', 'a fourth send within 24 hours is refused');
select is(
  (select id from private.parent_consent_requests where user_id = 'c6c6c6c6-0000-0000-0000-000000000007'),
  (select request_id from kept where user_id = 'c6c6c6c6-0000-0000-0000-000000000007'),
  'a refused send leaves the request in progress as it was'
);
update private.parent_consent_sends set sent_at = now() - interval '24 hours 1 second'
where ctid = (select ctid from private.parent_consent_sends where user_id = 'c6c6c6c6-0000-0000-0000-000000000007' limit 1);
select is(pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000007', 'parent@example.test'), 'requested', 'a send older than 24 hours no longer counts');

select lives_ok(
  $$select public.withdraw_parent_request('c6c6c6c6-0000-0000-0000-000000000007', 'c6c6c6c6-ffff-ffff-ffff-ffffffffffff')$$,
  'withdrawing another request does nothing'
);
select is(pg_temp.requests('c6c6c6c6-0000-0000-0000-000000000007'), 1, 'the request in progress stays when another is withdrawn');
select public.withdraw_parent_request('c6c6c6c6-0000-0000-0000-000000000007', (select request_id from kept where user_id = 'c6c6c6c6-0000-0000-0000-000000000007'));
select is(
  row(pg_temp.requests('c6c6c6c6-0000-0000-0000-000000000007'), pg_temp.sends('c6c6c6c6-0000-0000-0000-000000000007'))::text,
  '(0,3)',
  'withdrawing a request removes it and keeps it counted as a send'
);

select throws_ok(
  $$select * from public.request_parent_consent(null, 'parent@example.test')$$,
  'P0001',
  'account_not_found',
  'a request without an account is an error'
);

select pg_temp.ask('c6c6c6c6-0000-0000-0000-000000000011', 'parent@example.test');
delete from auth.users where id = 'c6c6c6c6-0000-0000-0000-000000000011';
select is(
  row(pg_temp.requests('c6c6c6c6-0000-0000-0000-000000000011'), pg_temp.sends('c6c6c6c6-0000-0000-0000-000000000011'))::text,
  '(0,0)',
  'deleting the account deletes its request and its sends'
);

select pg_temp.login('c6c6c6c6-0000-0000-0000-000000000009');
select throws_ok($$select * from public.request_parent_consent('c6c6c6c6-0000-0000-0000-000000000009', 'parent@example.test')$$, '42501', null, 'a user cannot ask a parent without the server');
select throws_ok($$select * from public.confirm_parent_consent('c6c6c6c6-0000-0000-0000-000000000009', '123456')$$, '42501', null, 'a user cannot confirm without the server');
select throws_ok($$select public.withdraw_parent_request('c6c6c6c6-0000-0000-0000-000000000009', gen_random_uuid())$$, '42501', null, 'a user cannot withdraw a request');
select throws_ok($$select * from private.parent_consent_requests$$, '42501', null, 'a user cannot read the requests');
select throws_ok($$select * from private.parent_consent_sends$$, '42501', null, 'a user cannot read the sends');
reset role;

select set_config('role', 'anon', true);
select throws_ok($$select * from public.request_parent_consent('c6c6c6c6-0000-0000-0000-000000000009', 'parent@example.test')$$, '42501', null, 'a visitor cannot ask a parent');
select throws_ok($$select * from public.confirm_parent_consent('c6c6c6c6-0000-0000-0000-000000000009', '123456')$$, '42501', null, 'a visitor cannot confirm');
reset role;

select set_config('role', 'service_role', true);
select is(
  (select outcome from public.confirm_parent_consent('c6c6c6c6-0000-0000-0000-000000000002', '123456')),
  'no_request',
  'the server confirms through the function'
);
reset role;

select * from finish();

rollback;
