begin;

select plan(24);

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

create function pg_temp.as_anon() returns void
language sql as $$
  select set_config('role', 'anon', true);
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select public from storage.buckets where id = 'photos'),
  false,
  'the photos bucket is private'
);

insert into storage.objects (bucket_id, name) values
  ('photos', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/page/original.jpg'),
  ('photos', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/page/original.jpg');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is(
  (select array_agg(name) from storage.objects where bucket_id = 'photos'),
  array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/page/original.jpg'],
  'a user reads only the files under their own folder'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('photos', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/page/new.jpg')$$,
  '42501', null, 'a user cannot upload a file, even in their own folder'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('photos', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/page/new.jpg')$$,
  '42501', null, 'a user cannot upload a file in the folder of another user'
);

select lives_ok(
  $$update storage.objects set name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/page/renamed.jpg' where bucket_id = 'photos'$$,
  'a user can run an update on files'
);

select throws_ok(
  $$delete from storage.objects where bucket_id = 'photos'$$,
  '42501', null, 'a user cannot delete files'
);

select set_config('storage.allow_delete_query', 'true', true);

select lives_ok(
  $$delete from storage.objects where bucket_id = 'photos'$$,
  'a user who gets past the guard of storage against direct deletes runs a delete on photos, which the next check shows removed nothing'
);

select set_config('storage.allow_delete_query', '', true);

reset role;

select is(
  (select count(*) from storage.objects
    where bucket_id = 'photos'
      and name in (
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/page/original.jpg',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/page/original.jpg'
      )),
  2::bigint,
  'those attempts changed nothing'
);

select is(
  (select count(*) from storage.objects where bucket_id = 'photos' and name like '%/page/renamed.jpg'),
  0::bigint,
  'no file was renamed'
);

select is_empty(
  $$
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename in ('objects', 'buckets')
      and cmd <> 'SELECT'
  $$,
  'no access rule lets a user write files or buckets'
);

select pg_temp.as_anon();

select is(
  (select count(*) from storage.objects where bucket_id = 'photos'),
  0::bigint,
  'a visitor without an account reads no file'
);

reset role;

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select array_agg(name) from storage.objects where bucket_id = 'photos'),
  array['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/page/original.jpg'],
  'another user reads only their own file'
);

reset role;

select is(
  (select file_size_limit from storage.buckets where id = 'photos'),
  10485760::bigint,
  'the photos bucket accepts files of 10 MB at most'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'photos'),
  array['image/jpeg'],
  'the photos bucket accepts JPEG files only'
);

select is(
  (select array_agg(id::text order by id) from storage.buckets where id in ('alto', 'models') and not public),
  array['alto', 'models'],
  'the alto and models buckets exist and are private'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'alto'),
  array['application/xml'],
  'the alto bucket accepts XML files only'
);

select is(
  (select file_size_limit from storage.buckets where id = 'alto'),
  5242880::bigint,
  'the alto bucket accepts files of 5 MB at most'
);

insert into storage.objects (bucket_id, name) values
  ('alto', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/page/a.xml'),
  ('alto', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/page/a.xml'),
  ('models', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/1.safetensors'),
  ('models', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/1.safetensors');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is(
  (select count(*) from storage.objects where bucket_id in ('alto', 'models')),
  0::bigint,
  'a user reads no ALTO file and no model file, not even their own'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('alto', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/page/b.xml')$$,
  '42501', null, 'a user cannot upload an ALTO file, even in their own folder'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('models', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/2.safetensors')$$,
  '42501', null, 'a user cannot upload a model file, even in their own folder'
);

select set_config('storage.allow_delete_query', 'true', true);

select lives_ok(
  $$delete from storage.objects where bucket_id in ('alto', 'models')$$,
  'a user who gets past the guard of storage against direct deletes runs a delete on ALTO and model files, which the next check shows removed nothing'
);

select set_config('storage.allow_delete_query', '', true);

select lives_ok(
  $$update storage.objects set name = name || '.moved' where bucket_id in ('alto', 'models')$$,
  'a user runs an update on ALTO and model files, which the next check shows changed nothing'
);

reset role;

select pg_temp.as_anon();

select is(
  (select count(*) from storage.objects where bucket_id in ('alto', 'models')),
  0::bigint,
  'a visitor without an account reads no ALTO file and no model file'
);

reset role;

select is(
  (select array_agg(bucket_id || ':' || name order by bucket_id, name) from storage.objects where bucket_id in ('alto', 'models')),
  array[
    'alto:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/page/a.xml',
    'alto:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/page/a.xml',
    'models:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/1.safetensors',
    'models:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/1.safetensors'
  ],
  'those attempts deleted, renamed and added no ALTO file and no model file'
);

select * from finish();

rollback;
