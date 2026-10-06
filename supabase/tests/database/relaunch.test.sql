begin;

select plan(57);

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

create function pg_temp.queued_for(p_page uuid) returns bigint
language sql as $$
  select count(*) from net.http_request_queue q where convert_from(q.body, 'utf8')::jsonb ->> 'page_id' = p_page::text;
$$;

create function pg_temp.state(p_page uuid) returns text
language sql as $$
  select p.status || '/' || coalesce(p.queue_reason, '-') || '/' || p.retry_count
  from public.pages p where p.id = p_page;
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
  ('a0000003-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('a0000004-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('a0000005-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('a0000006-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('a0000007-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('a0000008-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('a0000009-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('b0000001-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222'),
  ('b0000002-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');

select public.charge_page(id) from public.pages;

create temp table charges_before as select count(*) as total from public.page_charges;

-- a0000001: due (read_error, tried 16 minutes ago)
update public.pages set status = 'queued', queue_reason = 'read_error', attempted_at = now() - interval '16 minutes'
where id = 'a0000001-0000-0000-0000-000000000000';
-- a0000002: tried 14 minutes ago, not due
update public.pages set status = 'queued', queue_reason = 'read_error', attempted_at = now() - interval '14 minutes'
where id = 'a0000002-0000-0000-0000-000000000000';
-- a0000003: queued without a cause
update public.pages set attempted_at = now() - interval '2 hours' where id = 'a0000003-0000-0000-0000-000000000000';
-- a0000004: queued offline
update public.pages set queue_reason = 'offline', attempted_at = now() - interval '2 hours' where id = 'a0000004-0000-0000-0000-000000000000';
-- a0000005: processing for 9 minutes
update public.pages set status = 'processing' where id = 'a0000005-0000-0000-0000-000000000000';
update public.pages set attempted_at = now() - interval '9 minutes' where id = 'a0000005-0000-0000-0000-000000000000';
-- a0000006: read
update public.pages set status = 'processing' where id = 'a0000006-0000-0000-0000-000000000000';
update public.pages set status = 'read', read_at = now(), attempted_at = now() - interval '2 hours' where id = 'a0000006-0000-0000-0000-000000000000';
-- a0000007: failed for good
update public.pages set status = 'processing' where id = 'a0000007-0000-0000-0000-000000000000';
update public.pages set status = 'failed', retry_count = 3, attempted_at = now() - interval '2 hours' where id = 'a0000007-0000-0000-0000-000000000000';
-- a0000008: processing for 11 minutes, first reading
update public.pages set status = 'processing' where id = 'a0000008-0000-0000-0000-000000000000';
update public.pages set attempted_at = now() - interval '11 minutes' where id = 'a0000008-0000-0000-0000-000000000000';
-- a0000009: processing for 11 minutes, second relaunch
update public.pages set status = 'processing', retry_count = 2 where id = 'a0000009-0000-0000-0000-000000000000';
update public.pages set attempted_at = now() - interval '11 minutes' where id = 'a0000009-0000-0000-0000-000000000000';
-- b0000001: another user, queued for read_error, tried a minute ago
update public.pages set status = 'queued', queue_reason = 'read_error', attempted_at = now() - interval '1 minute'
where id = 'b0000001-0000-0000-0000-000000000000';
-- b0000002: another user, processing for 12 minutes, never stamped
update public.pages set status = 'processing' where id = 'b0000002-0000-0000-0000-000000000000';
update public.pages set attempted_at = null, retry_count = 1 where id = 'b0000002-0000-0000-0000-000000000000';

create temp table before_run as
select id, status, queue_reason, retry_count, attempted_at, manual_relaunched_at from public.pages;

select is(
  (select count(*) from pg_extension where extname in ('pg_cron', 'pg_net', 'supabase_vault')),
  3::bigint,
  'pg_cron, pg_net and the vault are installed'
);

select is(
  (select count(*) from cron.job where jobname = 'relaunch-pages' and schedule = '*/15 * * * *' and active),
  1::bigint,
  'the relaunch task runs every 15 minutes'
);

select is(
  (select command from cron.job where jobname = 'relaunch-pages'),
  'select private.relaunch_due_pages()',
  'the task command holds no secret and no address'
);

select throws_ok(
  $$ select private.relaunch_due_pages() $$,
  'P0001',
  'relaunch settings missing',
  'the task fails loudly when the vault holds no settings'
);

select is(
  (select count(*) from public.pages p join before_run b on b.id = p.id
   where (p.status, p.queue_reason, p.retry_count, p.attempted_at) is distinct from (b.status, b.queue_reason, b.retry_count, b.attempted_at)),
  0::bigint,
  'a task without settings changes no page'
);

select vault.create_secret(repeat('relaunch-', 5), 'relaunch_secret');
select vault.create_secret('http://kong.test:8000/functions/v1/relaunch-page', 'relaunch_url');

create temp table queue_before as select id from net.http_request_queue;

create temp table first_run as select private.relaunch_due_pages() as sent;

select is((select sent from first_run), 2, 'the first run sends two pages: the one tried 16 minutes ago and the one never stamped');

select is(pg_temp.queued_for('a0000001-0000-0000-0000-000000000000'), 1::bigint, 'a page queued for read_error and tried 16 minutes ago is sent');
select is(pg_temp.queued_for('b0000002-0000-0000-0000-000000000000'), 1::bigint, 'a stale page that was never stamped is taken back and sent');

select is(
  (select count(*) from net.http_request_queue where id not in (select id from queue_before)),
  2::bigint,
  'only those two requests were queued'
);

select is(
  (select count(*) from net.http_request_queue q
   where q.id not in (select id from queue_before)
     and convert_from(q.body, 'utf8')::jsonb ->> 'page_id' in (
       'a0000002-0000-0000-0000-000000000000', 'a0000003-0000-0000-0000-000000000000', 'a0000004-0000-0000-0000-000000000000',
       'a0000005-0000-0000-0000-000000000000', 'a0000006-0000-0000-0000-000000000000', 'a0000007-0000-0000-0000-000000000000',
       'a0000008-0000-0000-0000-000000000000', 'a0000009-0000-0000-0000-000000000000', 'b0000001-0000-0000-0000-000000000000')),
  0::bigint,
  'a page tried 14 minutes ago, queued without a cause or offline, processing, read, failed or just recovered is not sent'
);

select is(
  (select convert_from(q.body, 'utf8')::jsonb from net.http_request_queue q
   where convert_from(q.body, 'utf8')::jsonb ->> 'page_id' = 'a0000001-0000-0000-0000-000000000000'),
  '{"page_id": "a0000001-0000-0000-0000-000000000000"}'::jsonb,
  'the body holds the page id alone, never a user id or any text'
);

select is(
  (select q.url from net.http_request_queue q where convert_from(q.body, 'utf8')::jsonb ->> 'page_id' = 'a0000001-0000-0000-0000-000000000000'),
  'http://kong.test:8000/functions/v1/relaunch-page',
  'the request goes to the address kept in the vault'
);

select is(
  (select q.headers from net.http_request_queue q where convert_from(q.body, 'utf8')::jsonb ->> 'page_id' = 'a0000001-0000-0000-0000-000000000000'),
  jsonb_build_object('content-type', 'application/json', 'x-relaunch-secret', repeat('relaunch-', 5)),
  'the request carries the secret of the vault in its own header'
);

select is(
  (select q.timeout_milliseconds from net.http_request_queue q where convert_from(q.body, 'utf8')::jsonb ->> 'page_id' = 'a0000001-0000-0000-0000-000000000000'),
  150000,
  'the request may take as long as an Edge Function may run'
);

select is(
  (select count(*) from public.pages where id in ('a0000001-0000-0000-0000-000000000000', 'b0000002-0000-0000-0000-000000000000') and attempted_at = now()),
  2::bigint,
  'sending a page stamps the moment of its attempt'
);

select is(pg_temp.state('a0000001-0000-0000-0000-000000000000'), 'queued/read_error/0', 'the task does not count a relaunch it sends');
select is(pg_temp.state('b0000002-0000-0000-0000-000000000000'), 'queued/read_error/2', 'a stale page is queued again and counts as one failed attempt');
select is(pg_temp.state('a0000008-0000-0000-0000-000000000000'), 'queued/read_error/1', 'a stale first reading is queued again, counted once');
select is(pg_temp.state('a0000009-0000-0000-0000-000000000000'), 'failed/-/3', 'a stale page that already failed twice fails for good, at 3 and never 4');
select is(pg_temp.state('a0000005-0000-0000-0000-000000000000'), 'processing/-/0', 'a page processing for only 9 minutes is left alone');

select is(
  (select count(*) from public.pages p join before_run b on b.id = p.id
   where p.id in (
       'a0000002-0000-0000-0000-000000000000', 'a0000003-0000-0000-0000-000000000000', 'a0000004-0000-0000-0000-000000000000',
       'a0000005-0000-0000-0000-000000000000', 'a0000006-0000-0000-0000-000000000000', 'a0000007-0000-0000-0000-000000000000',
       'b0000001-0000-0000-0000-000000000000')
     and (p.status, p.queue_reason, p.retry_count, p.attempted_at, p.manual_relaunched_at)
       is distinct from (b.status, b.queue_reason, b.retry_count, b.attempted_at, b.manual_relaunched_at)),
  0::bigint,
  'pages that are not due, of this user or of another, are not touched'
);

select is(
  (select count(*) from public.page_charges),
  (select total from charges_before),
  'no relaunch and no recovery counts a page a second time'
);

select is(
  (select allowed and reason = 'already_charged' from public.charge_page('a0000001-0000-0000-0000-000000000000')),
  true,
  'a page the task sent is already charged and is never refused for a limit'
);

create temp table second_run as select private.relaunch_due_pages() as sent;

select is((select sent from second_run), 0, 'a second run right after the first sends nothing: a page is not relaunched twice in 15 minutes');

select is(
  (select count(*) from net.http_request_queue where id not in (select id from queue_before)),
  2::bigint,
  'the second run queued no request'
);

update public.pages set attempted_at = now() - interval '14 minutes 59 seconds' where id = 'a0000001-0000-0000-0000-000000000000';
select is((select private.relaunch_due_pages()), 0, 'a page tried 14 minutes 59 seconds ago is not sent');

update public.pages set attempted_at = now() - interval '15 minutes' where id = 'a0000001-0000-0000-0000-000000000000';
select is((select private.relaunch_due_pages()), 1, 'a page tried exactly 15 minutes ago is sent');
select is(pg_temp.queued_for('a0000001-0000-0000-0000-000000000000'), 2::bigint, 'and only that page is sent again');

insert into public.pages (id, user_id, notebook_id, status, queue_reason, attempted_at)
select ('c' || lpad(n::text, 7, '0') || '-0000-0000-0000-000000000000')::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       '11111111-1111-1111-1111-111111111111', 'queued', 'read_error', now() - interval '1 hour'
from generate_series(1, 7) n;

select is((select private.relaunch_due_pages()), 5, 'a run sends five pages at most');
select is((select private.relaunch_due_pages()), 2, 'the next run sends the two that were left');
select is((select private.relaunch_due_pages()), 0, 'and then there is nothing left to send');

create temp table lifecycle_page as
select 'd0000001-0000-0000-0000-000000000000'::uuid as id;

insert into public.pages (id, user_id, notebook_id) select id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111' from lifecycle_page;

create function pg_temp.crash(p_page uuid) returns text
language plpgsql as $$
begin
  update public.pages set status = 'processing', queue_reason = null where id = p_page and status = 'queued';
  update public.pages set attempted_at = now() - interval '11 minutes' where id = p_page and status = 'processing';
  perform private.relaunch_due_pages();
  return pg_temp.state(p_page);
end;
$$;

select is(pg_temp.crash('d0000001-0000-0000-0000-000000000000'), 'queued/read_error/1', 'a page whose reading keeps crashing is queued again after its first crash');
select is(pg_temp.crash('d0000001-0000-0000-0000-000000000000'), 'queued/read_error/2', 'and after its second');
select is(pg_temp.crash('d0000001-0000-0000-0000-000000000000'), 'failed/-/3', 'and fails for good at the third');
select is(pg_temp.crash('d0000001-0000-0000-0000-000000000000'), 'failed/-/3', 'a failed page is never taken again by the task, and the count never goes past 3');

select public.charge_page('d0000001-0000-0000-0000-000000000000');
update public.pages set status = 'processing' where id = 'd0000001-0000-0000-0000-000000000000';
update public.pages set attempted_at = now() - interval '11 minutes' where id = 'd0000001-0000-0000-0000-000000000000';
select private.relaunch_due_pages();
select is(pg_temp.state('d0000001-0000-0000-0000-000000000000'), 'failed/-/3', 'a failed page relaunched by its owner and left processing goes back to failed, at 3');

select is(
  (select count(*) from public.page_charges where page_id = 'd0000001-0000-0000-0000-000000000000'),
  1::bigint,
  'a page that crashed three times and was relaunched is charged once'
);

create temp table stamp_pages as
select * from (values
  ('e0000001-0000-0000-0000-000000000000'::uuid),
  ('e0000002-0000-0000-0000-000000000000'::uuid)
) v(id);

insert into public.pages (id, user_id, notebook_id)
select id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111' from stamp_pages;

select is(
  (select attempted_at is null and manual_relaunched_at is null from public.pages where id = 'e0000001-0000-0000-0000-000000000000'),
  true,
  'a new page has no attempt and no relaunch'
);

update public.pages set retry_count = 1 where id = 'e0000001-0000-0000-0000-000000000000';
select is(
  (select attempted_at is null and manual_relaunched_at is null from public.pages where id = 'e0000001-0000-0000-0000-000000000000'),
  true,
  'a change that is not a change of status stamps nothing'
);

update public.pages set status = 'processing' where id = 'e0000001-0000-0000-0000-000000000000';
select is(
  (select attempted_at = now() and manual_relaunched_at is null from public.pages where id = 'e0000001-0000-0000-0000-000000000000'),
  true,
  'a page that goes to processing gets the moment of its attempt and no relaunch mark'
);

update public.pages set attempted_at = now() - interval '1 hour' where id = 'e0000001-0000-0000-0000-000000000000';
update public.pages set status = 'read', read_at = now() where id = 'e0000001-0000-0000-0000-000000000000';
select is(
  (select attempted_at = now() - interval '1 hour' and manual_relaunched_at is null from public.pages where id = 'e0000001-0000-0000-0000-000000000000'),
  true,
  'a page that leaves processing keeps the moment of its attempt'
);

update public.pages set status = 'processing' where id = 'e0000002-0000-0000-0000-000000000000';
update public.pages set status = 'failed', retry_count = 3, attempted_at = now() - interval '2 days' where id = 'e0000002-0000-0000-0000-000000000000';
update public.pages set status = 'processing' where id = 'e0000002-0000-0000-0000-000000000000';
select is(
  (select attempted_at = now() and manual_relaunched_at = now() from public.pages where id = 'e0000002-0000-0000-0000-000000000000'),
  true,
  'a failed page that goes back to processing is marked as relaunched by its owner'
);

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is(
  has_column_privilege('authenticated', 'public.pages', 'attempted_at', 'update')
    or has_column_privilege('authenticated', 'public.pages', 'attempted_at', 'insert')
    or has_column_privilege('authenticated', 'public.pages', 'manual_relaunched_at', 'update')
    or has_column_privilege('authenticated', 'public.pages', 'manual_relaunched_at', 'insert'),
  false,
  'a user can write neither the moment of an attempt nor the relaunch mark'
);

select throws_ok(
  $$ update public.pages set attempted_at = null where id = 'a0000002-0000-0000-0000-000000000000' $$,
  '42501',
  null,
  'a user cannot reset the moment of an attempt to make a page due'
);

select throws_ok(
  $$ update public.pages set manual_relaunched_at = null where id = 'e0000002-0000-0000-0000-000000000000' $$,
  '42501',
  null,
  'a user cannot clear the relaunch mark to relaunch more than once a day'
);

select throws_ok($$ select private.relaunch_due_pages() $$, '42501', null, 'a user cannot run the task');
select throws_ok($$ select * from cron.job $$, '42501', null, 'a user cannot read the scheduled tasks');
select throws_ok($$ select * from cron.job_run_details $$, '42501', null, 'a user cannot read what the tasks did');
select throws_ok($$ select * from vault.decrypted_secrets $$, '42501', null, 'a user cannot read the vault');
select throws_ok($$ select * from vault.secrets $$, '42501', null, 'a user cannot read the encrypted secrets either');

select pg_temp.as_anon();

select throws_ok($$ select private.relaunch_due_pages() $$, '42501', null, 'a visitor cannot run the task');
select throws_ok($$ select * from vault.decrypted_secrets $$, '42501', null, 'a visitor cannot read the vault');
select throws_ok($$ select * from cron.job $$, '42501', null, 'a visitor cannot read the scheduled tasks');

select pg_temp.as_server();

select throws_ok($$ select private.relaunch_due_pages() $$, '42501', null, 'not even the server key can run the task');

reset role;

select is(
  (select count(*) from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('relaunch_due_pages', 'stamp_page_attempt')
     and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint,
  'no client role can execute the task or its trigger function'
);

select is(
  (select count(*) from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname = 'relaunch_due_pages'
     and p.prosecdef
     and p.proconfig = array['search_path=""']),
  1::bigint,
  'the task runs with the rights of its owner and an empty search path'
);

select is(
  (select count(*) from pg_trigger t where t.tgrelid = 'public.pages'::regclass and t.tgname = 'pages_stamp_attempt' and not t.tgisinternal),
  1::bigint,
  'the pages carry the trigger that stamps attempts'
);

select * from finish();

rollback;
