create function public.math_check_readings(p_page_id uuid, p_user_id uuid)
returns table (b1 text, b2 text)
language sql
stable
security definer
set search_path = ''
as $$
  select first.raw_text, second.raw_text
  from public.pages p
  join public.readings first on first.page_id = p.id and first.user_id = p.user_id and first.label = 'B1'
  join public.readings second on second.page_id = p.id and second.user_id = p.user_id and second.label = 'B2'
  where p.id = p_page_id
    and p.user_id = p_user_id
    and p.page_type = 'math'
    and (select count(*) from public.readings r where r.page_id = p.id and r.label = 'B1') = 1;
$$;

revoke all on function public.math_check_readings(uuid, uuid) from public, anon, authenticated;
grant execute on function public.math_check_readings(uuid, uuid) to service_role;

create function public.record_math_alert(p_page_id uuid, p_user_id uuid, p_only_b1 integer, p_only_b2 integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_type text;
begin
  select p.user_id, p.page_type into v_owner, v_type from public.pages p where p.id = p_page_id for update;
  if not found or p_user_id is null or v_owner <> p_user_id then
    return 'page_not_found';
  end if;
  if v_type <> 'math' then
    return 'not_math';
  end if;
  if (select count(*) from public.readings r where r.page_id = p_page_id and r.label = 'B1') <> 1
    or (select count(*) from public.readings r where r.page_id = p_page_id and r.label = 'B2') <> 1 then
    return 'no_readings';
  end if;
  if p_only_b1 is null or p_only_b2 is null or p_only_b1 < 0 or p_only_b2 < 0 or p_only_b1 + p_only_b2 = 0 then
    raise exception 'invalid_alert' using errcode = '23514';
  end if;

  insert into public.page_alerts (user_id, page_id, kind, details)
  values (p_user_id, p_page_id, 'math_incomplete', jsonb_build_object('only_b1', p_only_b1, 'only_b2', p_only_b2))
  on conflict (page_id, kind) do nothing;

  return 'recorded';
end;
$$;

revoke all on function public.record_math_alert(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.record_math_alert(uuid, uuid, integer, integer) to service_role;

create or replace function public.set_page_text(p_page_id uuid, p_user_id uuid, p_read_again boolean)
returns table (outcome text, b1 text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
  v_type text;
  v_b1 text;
  v_count bigint;
  v_relaunches integer;
  v_relaunched_at timestamptz;
begin
  select p.user_id, p.status, p.page_type, p.a_relaunches, p.a_relaunched_at
  into v_owner, v_status, v_type, v_relaunches, v_relaunched_at
  from public.pages p where p.id = p_page_id for update;
  if not found or p_user_id is null or v_owner <> p_user_id then
    return query select 'page_not_found'::text, null::text;
    return;
  end if;
  if v_status <> 'read' then
    return query select 'page_not_read'::text, null::text;
    return;
  end if;
  if v_type = 'unsupported_script' then
    return query select 'unsupported_script'::text, null::text;
    return;
  end if;
  if v_type = 'text' then
    return query select 'unchanged'::text, null::text;
    return;
  end if;

  select count(*), min(r.raw_text) into v_count, v_b1 from public.readings r where r.page_id = p_page_id and r.label = 'B1';
  if v_count <> 1 then
    return query select 'no_reading'::text, null::text;
    return;
  end if;

  delete from public.page_alerts a where a.page_id = p_page_id and a.kind = 'math_incomplete';

  if not coalesce(p_read_again, false) or v_relaunches >= 3 or (v_relaunched_at is not null and v_relaunched_at > now() - interval '10 minutes') then
    update public.pages p set page_type = 'text' where p.id = p_page_id;
    return query select 'switched'::text, null::text;
    return;
  end if;

  update public.pages p
  set page_type = 'text', a_relaunches = v_relaunches + 1, a_relaunched_at = now()
  where p.id = p_page_id;

  return query select 'switched'::text, v_b1;
end;
$$;
