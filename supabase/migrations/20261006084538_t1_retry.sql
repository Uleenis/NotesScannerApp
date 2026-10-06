create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

alter table public.pages
  add column attempted_at timestamptz,
  add column manual_relaunched_at timestamptz;

create function private.stamp_page_attempt() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'processing' and old.status <> 'processing' then
    new.attempted_at := now();
    if old.status = 'failed' then
      new.manual_relaunched_at := now();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_page_attempt() from public, anon, authenticated, service_role;

create trigger pages_stamp_attempt
  before update of status on public.pages
  for each row execute function private.stamp_page_attempt();

create function private.relaunch_due_pages() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_stale constant interval := interval '10 minutes';
  c_cadence constant interval := interval '15 minutes';
  c_batch constant integer := 5;
  c_max_relaunches constant integer := 3;
  c_timeout constant integer := 150000;
  v_secret text;
  v_url text;
  v_sent integer := 0;
  v_page record;
begin
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'relaunch_secret';
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'relaunch_url';
  if v_secret is null or v_url is null then
    raise exception 'relaunch settings missing';
  end if;

  update public.pages p
  set status = case when p.retry_count + 1 >= c_max_relaunches then 'failed' else 'queued' end,
      queue_reason = case when p.retry_count + 1 >= c_max_relaunches then null else 'read_error' end,
      retry_count = least(p.retry_count + 1, c_max_relaunches)
  where p.status = 'processing'
    and (p.attempted_at is null or p.attempted_at <= now() - c_stale);

  for v_page in
    select p.id
    from public.pages p
    where p.status = 'queued'
      and p.queue_reason = 'read_error'
      and (p.attempted_at is null or p.attempted_at <= now() - c_cadence)
    order by p.attempted_at nulls first, p.id
    limit c_batch
    for update skip locked
  loop
    update public.pages p set attempted_at = now() where p.id = v_page.id;
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('page_id', v_page.id),
      headers := jsonb_build_object('content-type', 'application/json', 'x-relaunch-secret', v_secret),
      timeout_milliseconds := c_timeout
    );
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

revoke all on function private.relaunch_due_pages() from public, anon, authenticated, service_role;

select cron.schedule('relaunch-pages', '*/15 * * * *', 'select private.relaunch_due_pages()');
