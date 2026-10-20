create function public.alto_orphans(p_limit integer)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'alto'
    and o.created_at <= now() - interval '24 hours'
    and o.updated_at <= now() - interval '24 hours'
    and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]*$'
    and not exists (
      select 1
      from public.readings r
      where r.alto_path is not null
        and substr(r.alto_path, 38) = substr(o.name, 38)
    )
  order by o.created_at, o.name
  limit greatest(1, least(coalesce(p_limit, 1), 1000));
$$;

revoke all on function public.alto_orphans(integer) from public, anon, authenticated;
grant execute on function public.alto_orphans(integer) to service_role;

create function private.sweep_alto() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_timeout constant integer := 150000;
  v_secret text;
  v_url text;
begin
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'sweep_secret';
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'sweep_url';
  if v_secret is null or v_url is null then
    raise exception 'sweep settings missing';
  end if;
  if v_url !~ '^(https://[A-Za-z0-9.-]+(:[0-9]+)?|http://(localhost|127\.0\.0\.1|host\.docker\.internal|[A-Za-z0-9_-]+)(:[0-9]+)?)/functions/v1/sweep-alto$' then
    raise exception 'sweep address not allowed';
  end if;

  return net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-sweep-secret', v_secret),
    timeout_milliseconds := c_timeout
  );
end;
$$;

revoke all on function private.sweep_alto() from public, anon, authenticated, service_role;

select cron.schedule('sweep-alto', '30 2 * * *', 'select private.sweep_alto()');
