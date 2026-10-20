begin;

select plan(9);

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

delete from cron.job_run_details;

insert into cron.job_run_details (jobid, runid, command, status, start_time, end_time) values
  (1, 900001, 'select 1', 'succeeded', now() - interval '31 days', now() - interval '31 days'),
  (1, 900002, 'select 1', 'failed', now() - interval '40 days', now() - interval '40 days'),
  (1, 900003, 'select 1', 'succeeded', now() - interval '29 days', now() - interval '29 days'),
  (1, 900004, 'select 1', 'running', now() - interval '31 days', null),
  (1, 900005, 'select 1', 'succeeded', now() - interval '1 hour', now() - interval '1 hour');

select is(
  (select count(*) from cron.job where jobname = 'purge-cron-history' and schedule = '45 2 * * *' and active),
  1::bigint,
  'the history is purged every night at 02:45'
);

select is(
  (select command from cron.job where jobname = 'purge-cron-history'),
  'select private.purge_cron_history()',
  'the purge command calls the server function alone'
);

select is(private.purge_cron_history(), 2::bigint, 'one run erases the two runs that ended more than 30 days ago');

select is(
  (select array_agg(runid order by runid) from cron.job_run_details),
  array[900003::bigint, 900004::bigint, 900005::bigint],
  'a run that ended 29 days ago, a run still going and a recent run are kept'
);

select is(private.purge_cron_history(), 0::bigint, 'a second run erases nothing more');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select throws_ok($$ select private.purge_cron_history() $$, '42501', null, 'a user cannot purge the history');

select pg_temp.as_anon();
select throws_ok($$ select private.purge_cron_history() $$, '42501', null, 'a visitor cannot purge the history');

select pg_temp.as_server();
select throws_ok($$ select private.purge_cron_history() $$, '42501', null, 'not even the server key can purge the history');

reset role;

select is(
  (select count(*) from cron.job_run_details),
  3::bigint,
  'the refused calls erased nothing'
);

select * from finish();

rollback;
