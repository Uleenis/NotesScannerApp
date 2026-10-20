create function private.purge_cron_history() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_keep constant interval := interval '30 days';
  v_deleted bigint;
begin
  delete from cron.job_run_details d
  where d.end_time is not null
    and d.end_time < now() - c_keep;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function private.purge_cron_history() from public, anon, authenticated, service_role;

select cron.schedule('purge-cron-history', '45 2 * * *', 'select private.purge_cron_history()');
