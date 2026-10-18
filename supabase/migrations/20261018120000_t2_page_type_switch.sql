alter table public.pages
  add column a_relaunches integer not null default 0 check (a_relaunches between 0 and 3),
  add column a_relaunched_at timestamptz;

create function public.set_page_math(p_page_id uuid, p_user_id uuid)
returns table (outcome text, alto_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
  v_type text;
  v_alto text;
begin
  select p.user_id, p.status, p.page_type into v_owner, v_status, v_type from public.pages p where p.id = p_page_id for update;
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
  if v_type = 'math' then
    return query select 'unchanged'::text, null::text;
    return;
  end if;

  delete from public.page_tokens k where k.page_id = p_page_id;
  delete from public.readings r where r.page_id = p_page_id and r.label = 'A' returning r.alto_path into v_alto;
  update public.pages p set page_type = 'math', language = null where p.id = p_page_id;

  return query select 'switched'::text, v_alto;
end;
$$;

revoke all on function public.set_page_math(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_page_math(uuid, uuid) to service_role;

create function public.set_page_text(p_page_id uuid, p_user_id uuid, p_read_again boolean)
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

revoke all on function public.set_page_text(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_page_text(uuid, uuid, boolean) to service_role;
