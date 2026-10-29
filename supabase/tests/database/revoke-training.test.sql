begin;

select plan(25);

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

select pg_temp.make_user('a7a7a7a7-0000-0000-0000-000000000001', 30, 'FR');
select pg_temp.make_user('a7a7a7a7-0000-0000-0000-000000000002', 30, 'FR');
select pg_temp.make_user('a7a7a7a7-0000-0000-0000-000000000003', 14, 'FR');
select pg_temp.make_user('a7a7a7a7-0000-0000-0000-000000000004', 14, 'FR');

insert into public.consents (user_id, kind, version, granted_by) values
  ('a7a7a7a7-0000-0000-0000-000000000001', 'training', 'training-1', 'user'),
  ('a7a7a7a7-0000-0000-0000-000000000002', 'training', 'training-1', 'user');

insert into public.htr_models (id, user_id, name, version, status, storage_path) values
  ('b7b7b7b7-0000-0000-0000-000000000001', 'a7a7a7a7-0000-0000-0000-000000000001', 'personal', 1, 'retired', 'a7a7a7a7-0000-0000-0000-000000000001/b7b7b7b7-0000-0000-0000-000000000001.safetensors'),
  ('b7b7b7b7-0000-0000-0000-000000000002', 'a7a7a7a7-0000-0000-0000-000000000001', 'personal', 2, 'active', 'a7a7a7a7-0000-0000-0000-000000000001/b7b7b7b7-0000-0000-0000-000000000002.safetensors'),
  ('b7b7b7b7-0000-0000-0000-000000000003', 'a7a7a7a7-0000-0000-0000-000000000002', 'personal', 1, 'active', 'a7a7a7a7-0000-0000-0000-000000000002/b7b7b7b7-0000-0000-0000-000000000003.safetensors');

insert into public.notebooks (id, user_id, name, correction_level) values
  ('c7c7c7c7-0000-0000-0000-000000000001', 'a7a7a7a7-0000-0000-0000-000000000001', 'Journal', 'journal'),
  ('c7c7c7c7-0000-0000-0000-000000000002', 'a7a7a7a7-0000-0000-0000-000000000001', 'Grammar', 'grammar'),
  ('c7c7c7c7-0000-0000-0000-000000000003', 'a7a7a7a7-0000-0000-0000-000000000001', 'Course', 'course'),
  ('c7c7c7c7-0000-0000-0000-000000000004', 'a7a7a7a7-0000-0000-0000-000000000002', 'Journal', 'journal');

select public.request_parent_consent('a7a7a7a7-0000-0000-0000-000000000003', 'a7-parent@example.test');
select public.request_parent_consent('a7a7a7a7-0000-0000-0000-000000000004', 'a7-other@example.test');

select has_function('public', 'revoke_training', array['uuid'], 'the withdrawal is a function');
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.revoke_training(uuid)'::regprocedure),
  true,
  'the withdrawal runs with the rights of its owner'
);
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.revoke_training(uuid)'::regprocedure),
  array['search_path=""'],
  'the withdrawal has an empty search path'
);
select is(has_function_privilege('anon', 'public.revoke_training(uuid)', 'execute'), false, 'anon cannot withdraw');
select is(has_function_privilege('authenticated', 'public.revoke_training(uuid)', 'execute'), false, 'a signed-in user cannot call the withdrawal directly');
select is(has_function_privilege('service_role', 'public.revoke_training(uuid)', 'execute'), true, 'the server can withdraw');

select throws_ok(
  $$select public.revoke_training(null)$$,
  'P0001', 'account_not_found', 'a withdrawal needs an account'
);

select is(
  (select count(*)::integer from private.parent_consent_requests where user_id = 'a7a7a7a7-0000-0000-0000-000000000003'),
  1,
  'the child has a request in progress before the withdrawal'
);

select is(public.revoke_training('a7a7a7a7-0000-0000-0000-000000000001'), true, 'a withdrawal of an active consent answers true');
select isnt(
  (select revoked_at from public.consents where user_id = 'a7a7a7a7-0000-0000-0000-000000000001'),
  null,
  'the consent is dated as withdrawn'
);
select is(
  (select count(*)::integer from public.consents where user_id = 'a7a7a7a7-0000-0000-0000-000000000001'),
  1,
  'the consent row stays as history'
);
select is(
  (select count(*)::integer from public.htr_models where user_id = 'a7a7a7a7-0000-0000-0000-000000000001'),
  0,
  'the personal models of the user are deleted, the active one and the older ones'
);
select is(
  (select array_agg(name order by name) from public.notebooks where user_id = 'a7a7a7a7-0000-0000-0000-000000000001' and correction_level = 'course'),
  array['Course', 'Grammar', 'Journal'],
  'every notebook of the user is back at the course level'
);
select is(
  (select count(*)::integer from public.htr_models where user_id is null and name = 'medium'),
  1,
  'the generic model stays'
);

select is(
  (select correction_level from public.notebooks where id = 'c7c7c7c7-0000-0000-0000-000000000004'),
  'journal',
  'the notebook of another user keeps its level'
);
select is(
  (select count(*)::integer from public.htr_models where user_id = 'a7a7a7a7-0000-0000-0000-000000000002'),
  1,
  'the model of another user stays'
);
select is(
  (select revoked_at from public.consents where user_id = 'a7a7a7a7-0000-0000-0000-000000000002'),
  null,
  'the consent of another user stays active'
);

select is(public.revoke_training('a7a7a7a7-0000-0000-0000-000000000001'), false, 'a second withdrawal answers false and changes nothing');
select is(
  (select count(*)::integer from public.consents where user_id = 'a7a7a7a7-0000-0000-0000-000000000001' and revoked_at is not null),
  1,
  'a second withdrawal does not date the consent again'
);

select is(public.revoke_training('a7a7a7a7-0000-0000-0000-000000000003'), false, 'a withdrawal without a consent answers false');
select is(
  (select count(*)::integer from private.parent_consent_requests where user_id = 'a7a7a7a7-0000-0000-0000-000000000003'),
  0,
  'the request to a parent in progress is deleted'
);
select is(
  (select count(*)::integer from private.parent_consent_requests where user_id = 'a7a7a7a7-0000-0000-0000-000000000004'),
  1,
  'the request of another child stays'
);

select pg_temp.login('a7a7a7a7-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.consents (kind, version) values ('training', 'training-1')$$,
  'the user can consent again after a withdrawal'
);
select is(
  (select count(*)::integer from public.consents where user_id = 'a7a7a7a7-0000-0000-0000-000000000001'),
  2,
  'the history now holds the withdrawn consent and the new one'
);
reset role;

select is(
  (select count(*)::integer from public.consents where user_id = 'a7a7a7a7-0000-0000-0000-000000000001' and revoked_at is null),
  1,
  'one consent is active again'
);

select * from finish();

rollback;
