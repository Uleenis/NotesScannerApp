begin;

select plan(30);

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

create function pg_temp.as_server() returns void
language sql as $$
  select set_config('role', 'service_role', true);
$$;

create function pg_temp.as_anon() returns void
language sql as $$
  select set_config('role', 'anon', true);
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select row(user_id, name, version, status, storage_path)::text from public.htr_models where user_id is null),
  '(,medium,1,active,)',
  'the generic model is there, active, owned by no one, its file in the image of the service'
);

insert into public.htr_models (id, user_id, name, version, status, storage_path, cer, alphabet_size, sample_count) values
  ('a7000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'personal', 1, 'candidate',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/1.safetensors', 0.12, 120, 800),
  ('b7000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'personal', 1, 'active',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/1.safetensors', 0.10, 110, 900);

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Course'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Journal');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is(
  (select array_agg(id) from public.htr_models),
  array['a7000000-0000-0000-0000-000000000001'::uuid],
  'a user reads their own model only, not the one of another user nor the generic one'
);

select throws_ok(
  $$insert into public.htr_models (user_id, name, version, status, storage_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mine', 2, 'active', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/2.safetensors')$$,
  '42501', null, 'a user cannot declare a model'
);

select throws_ok(
  $$update public.htr_models set status = 'active'$$,
  '42501', null, 'a user cannot activate their model'
);

select throws_ok(
  $$update public.htr_models set cer = 0$$,
  '42501', null, 'a user cannot change the measure of their model'
);

select throws_ok(
  $$delete from public.htr_models$$,
  '42501', null, 'a user cannot delete a model row'
);

reset role;

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select array_agg(id) from public.htr_models),
  array['b7000000-0000-0000-0000-000000000001'::uuid],
  'another user reads their own model only'
);

select throws_ok(
  $$update public.notebooks set correction_level = 'journal'$$,
  '42501', null, 'a user with an active model still cannot write the correction level'
);

reset role;

select pg_temp.as_anon();

select throws_ok('select count(*) from public.htr_models', '42501', null, 'a visitor without an account cannot read the models');

reset role;

select is(
  (select row(status, cer)::text from public.htr_models where id = 'a7000000-0000-0000-0000-000000000001'),
  '(candidate,0.12)',
  'those attempts changed nothing'
);

select throws_ok(
  $$insert into public.htr_models (user_id, name, version, status, storage_path)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'personal', 2, 'active', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/2.safetensors')$$,
  '23505', null, 'a user has one active model at most'
);

select throws_ok(
  $$insert into public.htr_models (user_id, name, version, status) values (null, 'other', 2, 'active')$$,
  '23505', null, 'there is one active generic model at most'
);

select throws_ok(
  $$insert into public.htr_models (user_id, name, version, status, storage_path)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'personal', 1, 'retired', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/1b.safetensors')$$,
  '23505', null, 'a user has one model per version number'
);

select throws_ok(
  $$insert into public.htr_models (user_id, name, version, status, storage_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'personal', 3, 'candidate', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/3.safetensors')$$,
  '23514', null, 'a personal model file lives under the folder of its owner'
);

select throws_ok(
  $$insert into public.htr_models (user_id, name, version, status)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'personal', 3, 'candidate')$$,
  '23514', null, 'a personal model has a file'
);

select throws_ok(
  $$insert into public.htr_models (user_id, name, version, status, storage_path) values (null, 'other', 2, 'retired', 'models/other.safetensors')$$,
  '23514', null, 'a generic model has no file in the bucket of personal models'
);

select throws_ok(
  $$insert into public.htr_models (user_id, name, version, status, storage_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'personal', 3, 'ready', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/3.safetensors')$$,
  '23514', null, 'a model status that does not exist is refused'
);

select throws_ok(
  $$insert into public.htr_models (user_id, name, version, status, storage_path, cer)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'personal', 3, 'candidate', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/3.safetensors', -0.1)$$,
  '23514', null, 'a negative error rate is refused'
);

select pg_temp.as_server();

select throws_ok(
  $$update public.notebooks set correction_level = 'journal' where id = '11111111-1111-1111-1111-111111111111'$$,
  '23514', 'correction_level_requires_personal_model', 'a notebook of a user whose model is only a candidate stays at the course level'
);

select throws_ok(
  $$insert into public.notebooks (user_id, name, correction_level) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Grammar', 'grammar')$$,
  '23514', 'correction_level_requires_personal_model', 'a notebook cannot be created above the course level without an active personal model'
);

select lives_ok(
  $$update public.notebooks set correction_level = 'journal' where id = '22222222-2222-2222-2222-222222222222'$$,
  'a notebook of a user who has an active personal model can go to the journal level'
);

select lives_ok(
  $$insert into public.notebooks (user_id, name, correction_level) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Grammar', 'grammar')$$,
  'a notebook of a user who has an active personal model can be created at the grammar level'
);

select throws_ok(
  $$update public.notebooks set correction_level = 'strict' where id = '22222222-2222-2222-2222-222222222222'$$,
  '23514', null, 'a correction level that does not exist is refused'
);

select lives_ok(
  $$update public.notebooks set correction_level = 'course' where id = '11111111-1111-1111-1111-111111111111'$$,
  'any notebook can be at the course level'
);

select throws_ok(
  $$update public.notebooks set user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id = '22222222-2222-2222-2222-222222222222'$$,
  '23514', 'correction_level_requires_personal_model', 'a journal notebook cannot move to a user without an active personal model'
);

select lives_ok(
  $$insert into public.htr_models (user_id, name, version, status, storage_path)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'personal', 2, 'active', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/2.safetensors')$$,
  'the server activates a personal model'
);

select lives_ok(
  $$update public.notebooks set correction_level = 'journal' where id = '11111111-1111-1111-1111-111111111111'$$,
  'once that model is active, the notebook can go to the journal level'
);

reset role;

select is(
  (select count(*) from public.htr_models where user_id is null),
  1::bigint,
  'the generic model is still the only model owned by no one'
);

delete from auth.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (select count(*) from public.htr_models where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'deleting an account deletes its models'
);

select is(
  (select count(*) from public.htr_models where user_id is null or user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  2::bigint,
  'deleting an account keeps the generic model and the models of other users'
);

select * from finish();

rollback;
