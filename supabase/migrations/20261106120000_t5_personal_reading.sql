alter table public.htr_models
  add constraint htr_models_id_user_key unique (id, user_id);

alter table public.readings
  add column htr_model_id uuid,
  add constraint readings_htr_model_fkey foreign key (htr_model_id, user_id)
    references public.htr_models (id, user_id) on delete set null (htr_model_id);

create index readings_htr_model_idx on public.readings (htr_model_id, user_id);

create function private.model_in_service(p_model_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_model_id is not null and exists (
    select 1 from public.htr_models m
    where m.id = p_model_id and m.user_id = p_user_id and m.status = 'active' and m.cer <= 0.129
  );
$$;

revoke all on function private.model_in_service(uuid, uuid) from public, anon, authenticated, service_role;

drop function public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb, jsonb);

create function public.record_reading_a(
  p_page_id uuid,
  p_user_id uuid,
  p_raw_text text,
  p_model text,
  p_model_version text,
  p_duration_ms integer,
  p_alto_path text,
  p_language text,
  p_tokens jsonb,
  p_alerts jsonb default '[]'::jsonb,
  p_model_id uuid default null
)
returns table (recorded boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_type text;
begin
  if (p_model_id is null) = (p_model is not distinct from 'personal') then
    raise exception 'invalid_model' using errcode = '23514';
  end if;

  select p.user_id, p.page_type into v_owner, v_type from public.pages p where p.id = p_page_id for update;
  if not found or p_user_id is null or v_owner <> p_user_id then
    return query select false, 'page_not_found'::text;
    return;
  end if;
  if v_type <> 'text' then
    return query select false, 'not_text'::text;
    return;
  end if;
  if exists (select 1 from public.readings r where r.page_id = p_page_id and r.label = 'A') then
    return query select false, 'already_read'::text;
    return;
  end if;
  if p_model_id is not null and not exists (
    select 1 from public.htr_models m where m.id = p_model_id and m.user_id = p_user_id
  ) then
    return query select false, 'model_not_found'::text;
    return;
  end if;

  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_tokens, '[]'::jsonb)) as t (rule smallint, channel text)
    where t.rule is not null or t.channel is not null
  ) and not private.model_in_service(p_model_id, p_user_id) then
    raise exception 'rules_without_model_in_service' using errcode = '23514';
  end if;

  insert into public.readings (user_id, page_id, label, raw_text, model, model_version, duration_ms, alto_path, htr_model_id)
  values (p_user_id, p_page_id, 'A', p_raw_text, p_model, p_model_version, p_duration_ms, p_alto_path, p_model_id);

  insert into public.page_tokens (user_id, page_id, token_index, line_index, text, rule, channel, reading_a, reading_b1, reading_b2, anchor_kind, anchor, b1_start, b1_end)
  select p_user_id, p_page_id, t.token_index, t.line_index, t.text, t.rule, t.channel, t.reading_a, t.reading_b1, t.reading_b2, t.anchor_kind, t.anchor, t.b1_start, t.b1_end
  from jsonb_to_recordset(coalesce(p_tokens, '[]'::jsonb)) as t (
    token_index integer,
    line_index integer,
    text text,
    rule smallint,
    channel text,
    reading_a text,
    reading_b1 text,
    reading_b2 text,
    anchor_kind text,
    anchor integer[],
    b1_start integer,
    b1_end integer
  );

  if exists (select 1 from public.page_tokens k where k.page_id = p_page_id and k.b1_start is not null)
    and exists (select 1 from public.page_tokens k where k.page_id = p_page_id and k.b1_start is null) then
    raise exception 'invalid_places' using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_alerts, '[]'::jsonb)) as a (kind text, details jsonb)
    where a.kind is distinct from 'missing_line'
  ) then
    raise exception 'invalid_alert' using errcode = '23514';
  end if;

  insert into public.page_alerts (user_id, page_id, kind, details)
  select p_user_id, p_page_id, a.kind, coalesce(a.details, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_alerts, '[]'::jsonb)) as a (kind text, details jsonb)
  on conflict (page_id, kind) do nothing;

  update public.pages p set language = p_language where p.id = p_page_id;

  perform private.recompute_page_text(p_page_id);

  return query select true, 'recorded'::text;
end;
$$;

revoke all on function public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb, jsonb, uuid) to service_role;
