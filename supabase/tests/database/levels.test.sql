begin;

select plan(40);

create function pg_temp.make_user(uid uuid, born_before integer) returns void
language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at) values (uid, uid::text || '@example.test', now());
  update public.profiles
  set birth_year = extract(year from now() at time zone 'Europe/Paris')::integer - born_before, country = 'FR'
  where id = uid;
end;
$$;

create function pg_temp.login(uid uuid) returns void
language sql as $$
  select
    set_config('role', 'authenticated', true),
    set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.as_anon() returns void
language sql as $$
  select set_config('role', 'anon', true);
$$;

create function pg_temp.as_server() returns void
language sql as $$
  select set_config('role', 'service_role', true);
$$;

select pg_temp.make_user('d8000000-0000-0000-0000-000000000001', 30);
select pg_temp.make_user('d8000000-0000-0000-0000-000000000002', 30);
select pg_temp.make_user('d8000000-0000-0000-0000-000000000003', 30);
select pg_temp.make_user('d8000000-0000-0000-0000-000000000004', 30);
select pg_temp.make_user('d8000000-0000-0000-0000-000000000005', 14);
select pg_temp.make_user('d8000000-0000-0000-0000-000000000006', 30);
select pg_temp.make_user('d8000000-0000-0000-0000-000000000007', 30);

insert into public.consents (user_id, kind, version, granted_by) values
  ('d8000000-0000-0000-0000-000000000001', 'training', 'training-1', 'user'),
  ('d8000000-0000-0000-0000-000000000002', 'training', 'training-1', 'user'),
  ('d8000000-0000-0000-0000-000000000003', 'training', 'training-1', 'user'),
  ('d8000000-0000-0000-0000-000000000004', 'training', 'training-1', 'user'),
  ('d8000000-0000-0000-0000-000000000007', 'training', 'training-1', 'user');

insert into public.htr_models (id, user_id, name, version, status, storage_path, cer) values
  ('d9000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001', 'personal', 1, 'active',
   'd8000000-0000-0000-0000-000000000001/1.safetensors', 0.129),
  ('d9000000-0000-0000-0000-000000000002', 'd8000000-0000-0000-0000-000000000002', 'personal', 1, 'active',
   'd8000000-0000-0000-0000-000000000002/1.safetensors', 0.13),
  ('d9000000-0000-0000-0000-000000000003', 'd8000000-0000-0000-0000-000000000003', 'personal', 1, 'candidate',
   'd8000000-0000-0000-0000-000000000003/1.safetensors', 0.05),
  ('d9000000-0000-0000-0000-000000000004', 'd8000000-0000-0000-0000-000000000004', 'personal', 1, 'active',
   'd8000000-0000-0000-0000-000000000004/1.safetensors', null);

insert into public.writing_tests (id, user_id, template, status, training_lines, validation_lines) values
  ('da000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000003', 'fr', 'accepted', 30, 10),
  ('da000000-0000-0000-0000-000000000002', 'd8000000-0000-0000-0000-000000000007', 'fr', 'rejected', 10, 2);

insert into public.notebooks (id, user_id, name) values
  ('db000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001', 'In service'),
  ('db000000-0000-0000-0000-000000000002', 'd8000000-0000-0000-0000-000000000002', 'Too imprecise'),
  ('db000000-0000-0000-0000-000000000003', 'd8000000-0000-0000-0000-000000000003', 'Only a candidate'),
  ('db000000-0000-0000-0000-000000000004', 'd8000000-0000-0000-0000-000000000004', 'No measure');

select pg_temp.as_server();

select throws_ok(
  $$update public.notebooks set correction_level = 'journal' where id = 'db000000-0000-0000-0000-000000000002'$$,
  '23514', 'correction_level_requires_personal_model', 'a model above 12.9 % does not open the journal level'
);

select throws_ok(
  $$update public.notebooks set correction_level = 'grammar' where id = 'db000000-0000-0000-0000-000000000004'$$,
  '23514', 'correction_level_requires_personal_model', 'an active model without a measure does not open the grammar level'
);

select lives_ok(
  $$update public.notebooks set correction_level = 'journal' where id = 'db000000-0000-0000-0000-000000000001'$$,
  'a model at exactly 12.9 % opens the journal level'
);

select throws_ok(
  $$insert into public.notebooks (user_id, name, correction_level) values ('d8000000-0000-0000-0000-000000000002', 'New', 'grammar')$$,
  '23514', 'correction_level_requires_personal_model', 'a notebook cannot be born above the course level without a model in service'
);

select has_function('public', 'set_correction_level', array['uuid', 'uuid', 'text'], 'the level is changed by a function');
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.set_correction_level(uuid, uuid, text)'::regprocedure),
  true,
  'it is a security definer function'
);

select is(
  public.set_correction_level('d8000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'grammar'),
  'set',
  'the owner of a model in service moves a notebook to the grammar level'
);
select is(
  (select correction_level from public.notebooks where id = 'db000000-0000-0000-0000-000000000001'),
  'grammar',
  'the level is written'
);

select is(
  public.set_correction_level('d8000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'course'),
  'set',
  'a notebook goes back to the course level'
);

select is(
  public.set_correction_level('d8000000-0000-0000-0000-000000000002', 'db000000-0000-0000-0000-000000000002', 'journal'),
  'requires_model',
  'a model above 12.9 % is refused with its own answer'
);
select is(
  public.set_correction_level('d8000000-0000-0000-0000-000000000003', 'db000000-0000-0000-0000-000000000003', 'journal'),
  'requires_model',
  'a candidate model is refused'
);
select is(
  public.set_correction_level('d8000000-0000-0000-0000-000000000004', 'db000000-0000-0000-0000-000000000004', 'grammar'),
  'requires_model',
  'a model without a measure is refused'
);
select is(
  public.set_correction_level('d8000000-0000-0000-0000-000000000002', 'db000000-0000-0000-0000-000000000002', 'course'),
  'set',
  'the course level needs no model'
);
select is(
  (select count(*) from public.notebooks where id::text like 'db000000%' and correction_level <> 'course'),
  0::bigint,
  'no refused request changed a notebook'
);

select is(
  public.set_correction_level('d8000000-0000-0000-0000-000000000002', 'db000000-0000-0000-0000-000000000001', 'course'),
  'notebook_not_found',
  'a notebook of another account is not found, not even at the course level'
);
select is(
  public.set_correction_level('d8000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000002', 'journal'),
  'notebook_not_found',
  'the model of one account never opens the notebook of another'
);
select is(
  public.set_correction_level('d8000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-0000000000ff', 'journal'),
  'notebook_not_found',
  'a notebook that does not exist is not found'
);
select throws_ok(
  $$select public.set_correction_level('d8000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'strict')$$,
  'P0001', 'invalid_level', 'a level that does not exist is refused'
);
select throws_ok(
  $$select public.set_correction_level(null, 'db000000-0000-0000-0000-000000000001', 'course')$$,
  'P0001', 'account_not_found', 'a call without an account is refused'
);

select pg_temp.login('d8000000-0000-0000-0000-000000000001');

select throws_ok(
  $$select public.set_correction_level('d8000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'journal')$$,
  '42501', null, 'a signed-in user cannot call the function that sets the level'
);

select throws_ok(
  $$update public.notebooks set correction_level = 'journal'$$,
  '42501', null, 'a signed-in user still cannot write the level of a notebook'
);

reset role;

select pg_temp.as_anon();

select throws_ok(
  $$select public.set_correction_level('d8000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'journal')$$,
  '42501', null, 'a visitor cannot call the function that sets the level'
);
select throws_ok('select public.training_stage()', '42501', null, 'a visitor cannot ask for the stage of the training');

reset role;

select has_function('public', 'training_stage', array[]::text[], 'the stage of the training is a function');

select pg_temp.login('d8000000-0000-0000-0000-000000000006');
select is(public.training_stage(), 'not_started', 'no consent and no request: not started');
reset role;

select public.request_parent_consent('d8000000-0000-0000-0000-000000000005', 'd8-parent@example.test');
select pg_temp.login('d8000000-0000-0000-0000-000000000005');
select is(public.training_stage(), 'parent_pending', 'a request to a parent in progress: the agreement of the parent is awaited');
reset role;

update private.parent_consent_requests
set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
where user_id = 'd8000000-0000-0000-0000-000000000005';
select pg_temp.login('d8000000-0000-0000-0000-000000000005');
select is(public.training_stage(), 'not_started', 'an expired request is not awaited any more');
reset role;

select pg_temp.login('d8000000-0000-0000-0000-000000000007');
select is(public.training_stage(), 'test_needed', 'a consent and no accepted test: the test is to do');
reset role;

select pg_temp.login('d8000000-0000-0000-0000-000000000003');
select is(public.training_stage(), 'training', 'an accepted test and no active model: the training is in progress');
reset role;

select pg_temp.login('d8000000-0000-0000-0000-000000000001');
select is(public.training_stage(), 'in_service', 'an active model at 12.9 % or less is in service');
reset role;

select pg_temp.login('d8000000-0000-0000-0000-000000000002');
select is(public.training_stage(), 'not_precise', 'an active model above 12.9 % is not precise enough yet');
reset role;

select pg_temp.login('d8000000-0000-0000-0000-000000000004');
select is(public.training_stage(), 'not_precise', 'an active model without a measure is not precise enough yet');
reset role;

select pg_temp.as_server();
select public.revoke_training('d8000000-0000-0000-0000-000000000001');
reset role;

select pg_temp.login('d8000000-0000-0000-0000-000000000001');
select is(public.training_stage(), 'not_started', 'after the withdrawal, the stage is back to not started');
reset role;

select pg_temp.as_anon();
select throws_ok('select public.training_stage()', '42501', null, 'a visitor still cannot ask for the stage after a withdrawal');
reset role;

select is(
  (select count(*) from information_schema.role_routine_grants
   where routine_schema = 'public' and routine_name = 'training_stage' and grantee in ('anon', 'public', 'PUBLIC')),
  0::bigint,
  'nobody but signed-in users holds the right to ask for the stage'
);


select pg_temp.make_user('d8000000-0000-0000-0000-000000000008', 30);
select pg_temp.make_user('d8000000-0000-0000-0000-000000000009', 30);

insert into public.consents (user_id, kind, version, granted_by) values
  ('d8000000-0000-0000-0000-000000000008', 'training', 'training-1', 'user'),
  ('d8000000-0000-0000-0000-000000000009', 'training', 'training-1', 'user');

insert into public.htr_models (id, user_id, name, version, status, storage_path, cer) values
  ('d9000000-0000-0000-0000-000000000008', 'd8000000-0000-0000-0000-000000000008', 'personal', 1, 'active',
   'd8000000-0000-0000-0000-000000000008/1.safetensors', 0.1),
  ('d9000000-0000-0000-0000-000000000009', 'd8000000-0000-0000-0000-000000000009', 'personal', 1, 'active',
   'd8000000-0000-0000-0000-000000000009/1.safetensors', 0.1);

insert into public.notebooks (id, user_id, name, correction_level) values
  ('db000000-0000-0000-0000-000000000008', 'd8000000-0000-0000-0000-000000000008', 'Replaced by a worse one', 'journal'),
  ('db000000-0000-0000-0000-000000000009', 'd8000000-0000-0000-0000-000000000009', 'Replaced by a better one', 'grammar');

select pg_temp.as_server();

update public.htr_models set status = 'retired' where id = 'd9000000-0000-0000-0000-000000000008';
select is(
  (select correction_level from public.notebooks where id = 'db000000-0000-0000-0000-000000000008'),
  'journal',
  'retiring the active model alone does not reset the levels, its replacement is about to come'
);
insert into public.htr_models (id, user_id, name, version, status, storage_path, cer) values
  ('d9000000-0000-0000-0000-000000000010', 'd8000000-0000-0000-0000-000000000008', 'personal', 2, 'active',
   'd8000000-0000-0000-0000-000000000008/2.safetensors', 0.135);
select is(
  (select correction_level from public.notebooks where id = 'db000000-0000-0000-0000-000000000008'),
  'course',
  'a replacement above 12.9 % puts the notebooks of the user back at the course level'
);

update public.htr_models set status = 'retired' where id = 'd9000000-0000-0000-0000-000000000009';
insert into public.htr_models (id, user_id, name, version, status, storage_path, cer) values
  ('d9000000-0000-0000-0000-000000000011', 'd8000000-0000-0000-0000-000000000009', 'personal', 2, 'active',
   'd8000000-0000-0000-0000-000000000009/2.safetensors', 0.12);
select is(
  (select correction_level from public.notebooks where id = 'db000000-0000-0000-0000-000000000009'),
  'grammar',
  'a replacement in service leaves the levels as they are'
);

update public.htr_models set cer = 0.2 where id = 'd9000000-0000-0000-0000-000000000011';
select is(
  (select correction_level from public.notebooks where id = 'db000000-0000-0000-0000-000000000009'),
  'course',
  'a measure of the active model that rises above 12.9 % puts the notebooks back at the course level'
);

reset role;
select is(
  (select count(*) from public.notebooks where user_id = 'd8000000-0000-0000-0000-000000000001' and correction_level <> 'course'),
  0::bigint,
  'the levels of another user are never touched'
);

select * from finish();

rollback;
