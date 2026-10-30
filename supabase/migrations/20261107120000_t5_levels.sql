create function private.has_model_in_service(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.htr_models m
    where m.user_id = p_user_id and private.model_in_service(m.id, m.user_id)
  );
$$;

revoke all on function private.has_model_in_service(uuid) from public, anon, authenticated, service_role;

create or replace function private.check_correction_level() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.correction_level <> 'course' and not private.has_model_in_service(new.user_id) then
    raise exception 'correction_level_requires_personal_model' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.set_correction_level(p_user_id uuid, p_notebook_id uuid, p_level text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'account_not_found';
  end if;
  if p_notebook_id is null or p_level is null or p_level not in ('course', 'journal', 'grammar') then
    raise exception 'invalid_level';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if not exists (select 1 from public.notebooks n where n.id = p_notebook_id and n.user_id = p_user_id) then
    return 'notebook_not_found';
  end if;
  if p_level <> 'course' and not private.has_model_in_service(p_user_id) then
    return 'requires_model';
  end if;
  update public.notebooks
  set correction_level = p_level
  where id = p_notebook_id and user_id = p_user_id and correction_level <> p_level;
  return 'set';
end;
$$;

revoke all on function public.set_correction_level(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_correction_level(uuid, uuid, text) to service_role;

create function public.training_stage()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_model uuid;
begin
  if v_user is null then
    return 'not_started';
  end if;
  if not exists (
    select 1 from public.consents c where c.user_id = v_user and c.kind = 'training' and c.revoked_at is null
  ) then
    if exists (select 1 from private.parent_consent_requests r where r.user_id = v_user and r.expires_at > now()) then
      return 'parent_pending';
    end if;
    return 'not_started';
  end if;
  select m.id into v_model from public.htr_models m where m.user_id = v_user and m.status = 'active';
  if v_model is not null then
    return case when private.model_in_service(v_model, v_user) then 'in_service' else 'not_precise' end;
  end if;
  if exists (select 1 from public.writing_tests t where t.user_id = v_user and t.status = 'accepted') then
    return 'training';
  end if;
  return 'test_needed';
end;
$$;

revoke all on function public.training_stage() from public, anon, authenticated, service_role;
grant execute on function public.training_stage() to authenticated;
