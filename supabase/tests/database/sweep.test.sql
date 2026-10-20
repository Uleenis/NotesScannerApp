begin;

select plan(27);

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

insert into auth.users (id, email, is_anonymous) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.test', false),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.test', false);

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'N'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'N');

insert into public.pages (id, user_id, notebook_id) values
  ('a0000001-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('a0000002-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('b0000001-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, duration_ms, alto_path) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000002-0000-0000-0000-000000000000', 'A', '', 'medium', '1', 1,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000002-0000-0000-0000-000000000000/a-named.xml'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b0000001-0000-0000-0000-000000000000', 'A', '', 'medium', '1', 1,
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/b0000001-0000-0000-0000-000000000000/a-moved.xml');

insert into storage.objects (bucket_id, name, created_at, updated_at) values
  ('alto', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000001-0000-0000-0000-000000000000/a-old.xml', now() - interval '25 hours', now() - interval '25 hours'),
  ('alto', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000002-0000-0000-0000-000000000000/a-named.xml', now() - interval '30 days', now() - interval '30 days'),
  ('alto', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000001-0000-0000-0000-000000000000/a-recent.xml', now() - interval '23 hours', now() - interval '23 hours'),
  ('alto', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000001-0000-0000-0000-000000000000/a-touched.xml', now() - interval '25 hours', now() - interval '1 hour'),
  ('alto', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/b0000001-0000-0000-0000-000000000000/a-moved.xml', now() - interval '30 days', now() - interval '30 days'),
  ('alto', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/notes.txt', now() - interval '30 days', now() - interval '30 days'),
  ('alto', 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA/a0000001-0000-0000-0000-000000000000/a-upper.xml', now() - interval '30 days', now() - interval '30 days'),
  ('alto', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/b0000002-0000-0000-0000-000000000000/a-gone.xml', now() - interval '26 hours', now() - interval '26 hours'),
  ('photos', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000001-0000-0000-0000-000000000000/original.jpg', now() - interval '30 days', now() - interval '30 days'),
  ('photos', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000009-0000-0000-0000-000000000000/a-orphan.xml', now() - interval '30 days', now() - interval '30 days');

create temp table objects_before as select bucket_id, name from storage.objects;

select pg_temp.as_server();

select is(
  (select array_agg(name) from public.alto_orphans(100)),
  array[
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/b0000002-0000-0000-0000-000000000000/a-gone.xml',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000001-0000-0000-0000-000000000000/a-old.xml'
  ],
  'the orphans are the ALTO files older than 24 hours that no reading names, of every user, oldest first'
);

select ok(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000001-0000-0000-0000-000000000000/a-old.xml' in (select name from public.alto_orphans(100)),
  'an ALTO file no reading names, uploaded 25 hours ago, is an orphan'
);

select ok(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000002-0000-0000-0000-000000000000/a-named.xml' not in (select name from public.alto_orphans(100)),
  'an ALTO file a reading names is kept, however old'
);

select ok(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000001-0000-0000-0000-000000000000/a-recent.xml' not in (select name from public.alto_orphans(100)),
  'an orphan uploaded 23 hours ago is kept'
);

select ok(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000001-0000-0000-0000-000000000000/a-touched.xml' not in (select name from public.alto_orphans(100)),
  'an orphan written again within 24 hours is kept'
);

select ok(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/b0000001-0000-0000-0000-000000000000/a-moved.xml' not in (select name from public.alto_orphans(100)),
  'the old copy of a file a transfer has renamed in its reading but not yet copied is kept'
);

select ok(
  not exists (select 1 from public.alto_orphans(100) o where o.name like '%notes.txt' or o.name like 'AAAAAAAA%'),
  'a file whose name is not the shape of an ALTO path of a page is never an orphan'
);

select ok(
  not exists (select 1 from public.alto_orphans(1000) o where o.name like '%original.jpg' or o.name like '%a-orphan.xml'),
  'no photo is ever an orphan, not even a file of the photos bucket shaped like an ALTO'
);

select is(
  (select array_agg(name) from public.alto_orphans(1)),
  array['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/b0000002-0000-0000-0000-000000000000/a-gone.xml'],
  'the limit is kept, oldest first'
);

select is((select count(*) from public.alto_orphans(0)), 1::bigint, 'a limit under one gives one name');
select is((select count(*) from public.alto_orphans(null)), 1::bigint, 'no limit gives one name');

reset role;

select is(
  (select count(*) from storage.objects o where (o.bucket_id, o.name) not in (select bucket_id, name from objects_before))
  + (select count(*) from objects_before b where (b.bucket_id, b.name) not in (select bucket_id, name from storage.objects)),
  0::bigint,
  'finding the orphans erases nothing'
);

insert into storage.objects (bucket_id, name, created_at, updated_at)
select 'alto', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a0000001-0000-0000-0000-000000000000/a-' || g || '.xml', now() - interval '2 days', now() - interval '2 days'
from generate_series(1, 1001) g;

select pg_temp.as_server();
select is((select count(*) from public.alto_orphans(5000)), 1000::bigint, 'one call gives at most 1,000 names');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select throws_ok($$ select * from public.alto_orphans(100) $$, '42501', null, 'a user cannot list the orphans');

select pg_temp.as_anon();
select throws_ok($$ select * from public.alto_orphans(100) $$, '42501', null, 'a visitor cannot list the orphans');

reset role;

select is(
  (select count(*) from cron.job where jobname = 'sweep-alto' and schedule = '30 2 * * *' and active),
  1::bigint,
  'the sweep runs every night at 02:30'
);

select is(
  (select command from cron.job where jobname = 'sweep-alto'),
  'select private.sweep_alto()',
  'the sweep command holds no secret and no address'
);

create temp table queue_before as select id from net.http_request_queue;

select throws_ok(
  $$ select private.sweep_alto() $$,
  'P0001',
  'sweep settings missing',
  'the sweep fails loudly when the vault holds no settings'
);

select is(
  (select count(*) from net.http_request_queue where id not in (select id from queue_before)),
  0::bigint,
  'a sweep without settings sends nothing'
);

select vault.create_secret(repeat('relaunch-', 5), 'relaunch_secret');
select vault.create_secret('http://kong.test:8000/functions/v1/relaunch-page', 'relaunch_url');

select throws_ok(
  $$ select private.sweep_alto() $$,
  'P0001',
  'sweep settings missing',
  'the sweep never borrows the secret of the relaunch task'
);

select vault.create_secret(repeat('sweep-', 7), 'sweep_secret');
select vault.create_secret('http://kong.test:8000/functions/v1/sweep-alto', 'sweep_url');

select private.sweep_alto();

select is(
  (select count(*) from net.http_request_queue where id not in (select id from queue_before)),
  1::bigint,
  'one run sends one request'
);

select is(
  (select q.url from net.http_request_queue q where q.id not in (select id from queue_before)),
  'http://kong.test:8000/functions/v1/sweep-alto',
  'the request goes to the address kept in the vault'
);

select is(
  (select q.headers from net.http_request_queue q where q.id not in (select id from queue_before)),
  jsonb_build_object('content-type', 'application/json', 'x-sweep-secret', repeat('sweep-', 7)),
  'the request carries the secret of the sweep in its own header'
);

select is(
  (select convert_from(q.body, 'utf8')::jsonb from net.http_request_queue q where q.id not in (select id from queue_before)),
  '{}'::jsonb,
  'the body is empty: no user, no page, no path'
);

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select throws_ok($$ select private.sweep_alto() $$, '42501', null, 'a user cannot run the sweep');

select pg_temp.as_anon();
select throws_ok($$ select private.sweep_alto() $$, '42501', null, 'a visitor cannot run the sweep');

select pg_temp.as_server();
select throws_ok($$ select private.sweep_alto() $$, '42501', null, 'not even the server key can run the sweep');

reset role;

select * from finish();

rollback;
