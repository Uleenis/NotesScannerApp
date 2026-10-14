alter table public.pages
  add column page_type text not null default 'text' check (page_type in ('text', 'math', 'unsupported_script')),
  add column language text check (language ~ '^[a-z]{2}$');

alter table public.readings
  alter column prompt_version drop not null,
  alter column thinking_budget drop not null,
  alter column input_tokens drop not null,
  alter column output_tokens drop not null,
  add column alto_path text unique,
  add constraint readings_settings_by_label check (
    case when label = 'A' then
      prompt_version is null and thinking_budget is null and input_tokens is null and output_tokens is null and alto_path is not null
    else
      prompt_version is not null and thinking_budget is not null and input_tokens is not null and output_tokens is not null and alto_path is null
    end
  ),
  add constraint readings_alto_path_in_page_folder check (
    alto_path is null or alto_path ~ ('^' || user_id::text || '/' || page_id::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]*$')
  );

create unique index readings_one_a_per_page on public.readings (page_id) where label = 'A';

create table public.htr_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  version integer not null check (version >= 1),
  status text not null check (status in ('training', 'candidate', 'active', 'retired')),
  storage_path text unique,
  cer numeric check (cer >= 0),
  alphabet_size integer check (alphabet_size > 0),
  sample_count integer check (sample_count >= 0),
  created_at timestamptz not null default now(),
  constraint htr_models_file check (
    case when user_id is null then storage_path is null
    else storage_path is not null and storage_path like (user_id::text || '/%') end
  ),
  constraint htr_models_user_version_key unique nulls not distinct (user_id, version)
);

create unique index htr_models_one_active on public.htr_models (user_id) nulls not distinct where status = 'active';

revoke all on public.htr_models from anon, authenticated;
grant select on public.htr_models to authenticated;
grant select, insert, update, delete on public.htr_models to service_role;

alter table public.htr_models enable row level security;

create policy htr_models_select on public.htr_models
  for select to authenticated
  using (user_id = (select auth.uid()));

insert into public.htr_models (user_id, name, version, status) values (null, 'medium', 1, 'active');

alter table public.notebooks
  add column correction_level text not null default 'course' check (correction_level in ('course', 'journal', 'grammar'));

create function private.check_correction_level() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.correction_level <> 'course' and not exists (
    select 1 from public.htr_models m where m.user_id = new.user_id and m.status = 'active'
  ) then
    raise exception 'correction_level_requires_personal_model' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.check_correction_level() from public, anon, authenticated, service_role;

create trigger notebooks_check_correction_level
  before insert or update of correction_level, user_id on public.notebooks
  for each row execute function private.check_correction_level();

create table public.page_tokens (
  page_id uuid not null,
  token_index integer not null check (token_index >= 0),
  user_id uuid not null references auth.users (id) on delete cascade,
  line_index integer not null check (line_index >= 0),
  text text not null,
  rule smallint check (rule between 1 and 10),
  channel text check (channel in ('none', 'layer', 'queue')),
  reading_a text check (reading_a <> ''),
  reading_b1 text not null check (reading_b1 <> ''),
  anchor_kind text check (anchor_kind in ('word', 'line')),
  anchor integer[],
  primary key (page_id, token_index),
  constraint page_tokens_rule_with_channel check ((rule is null) = (channel is null)),
  constraint page_tokens_anchor_with_kind check ((anchor_kind is null) = (anchor is null)),
  constraint page_tokens_anchor_box check (
    anchor is null or (
      array_ndims(anchor) = 1
      and cardinality(anchor) = 4
      and array_position(anchor, null) is null
      and anchor[1] >= 0
      and anchor[2] >= 0
      and anchor[1] < anchor[3]
      and anchor[2] < anchor[4]
    )
  ),
  foreign key (page_id, user_id) references public.pages (id, user_id)
    on delete cascade deferrable initially immediate
);

create index page_tokens_user_page_idx on public.page_tokens (user_id, page_id);

revoke all on public.page_tokens from anon, authenticated;
grant select on public.page_tokens to authenticated;
grant select, insert, update, delete on public.page_tokens to service_role;

alter table public.page_tokens enable row level security;

create policy page_tokens_select on public.page_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

create function private.check_page_type() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.page_type <> 'text' and (
    exists (select 1 from public.readings r where r.page_id = new.id and r.label = 'A')
    or exists (select 1 from public.page_tokens k where k.page_id = new.id)
  ) then
    raise exception 'page_has_reading_a' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.check_page_type() from public, anon, authenticated, service_role;

create trigger pages_check_page_type
  before update of page_type on public.pages
  for each row execute function private.check_page_type();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('alto', 'alto', false, 5242880, array['application/xml']),
  ('models', 'models', false, null, null);

create function public.record_reading_a(
  p_page_id uuid,
  p_user_id uuid,
  p_raw_text text,
  p_model text,
  p_model_version text,
  p_duration_ms integer,
  p_alto_path text,
  p_language text,
  p_tokens jsonb
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

  insert into public.readings (user_id, page_id, label, raw_text, model, model_version, duration_ms, alto_path)
  values (p_user_id, p_page_id, 'A', p_raw_text, p_model, p_model_version, p_duration_ms, p_alto_path);

  insert into public.page_tokens (user_id, page_id, token_index, line_index, text, rule, channel, reading_a, reading_b1, anchor_kind, anchor)
  select p_user_id, p_page_id, t.token_index, t.line_index, t.text, t.rule, t.channel, t.reading_a, t.reading_b1, t.anchor_kind, t.anchor
  from jsonb_to_recordset(coalesce(p_tokens, '[]'::jsonb)) as t (
    token_index integer,
    line_index integer,
    text text,
    rule smallint,
    channel text,
    reading_a text,
    reading_b1 text,
    anchor_kind text,
    anchor integer[]
  );

  update public.pages p set language = p_language where p.id = p_page_id;

  return query select true, 'recorded'::text;
end;
$$;

revoke all on function public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb) to service_role;

create or replace function public.transfer_account_rows(p_from uuid, p_to uuid)
returns table (pages integer, notebooks_merged integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blank constant text := E' \t\r\n\u00a0\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u202f\u205f\u2060\u3000\ufeff';
  v_from_anonymous boolean;
  v_to_anonymous boolean;
  v_pages integer;
  v_merged integer;
  v_moved integer;
begin
  if p_from is null or p_to is null then
    raise exception 'account_not_found';
  end if;
  if p_from = p_to then
    raise exception 'same_account';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(p_from, p_to)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(p_from, p_to)::text, 0));

  select u.is_anonymous into v_from_anonymous from auth.users u where u.id = p_from;
  if not found then
    raise exception 'account_not_found';
  end if;
  select u.is_anonymous into v_to_anonymous from auth.users u where u.id = p_to;
  if not found then
    raise exception 'account_not_found';
  end if;
  if not coalesce(v_from_anonymous, false) then
    raise exception 'not_anonymous';
  end if;
  if coalesce(v_to_anonymous, false) then
    raise exception 'target_anonymous';
  end if;

  perform 1 from public.pages p where p.user_id = p_from for update;
  if exists (select 1 from public.pages p where p.user_id = p_from and p.status = 'processing') then
    raise exception 'page_processing';
  end if;

  select count(*) into v_pages from public.pages p where p.user_id = p_from;
  select count(*) into v_merged
  from public.notebooks a
  join public.notebooks b on b.user_id = p_to and btrim(b.name, v_blank) = btrim(a.name, v_blank)
  where a.user_id = p_from;

  set constraints all deferred;

  with map as (
    select a.id as from_id, b.id as to_id
    from public.notebooks a
    join public.notebooks b on b.user_id = p_to and btrim(b.name, v_blank) = btrim(a.name, v_blank)
    where a.user_id = p_from
  ),
  moved_chapters as (
    update public.chapters c
    set notebook_id = m.to_id, user_id = p_to
    from map m
    where c.user_id = p_from and c.notebook_id = m.from_id
    returning c.id
  ),
  moved_pages as (
    update public.pages g
    set notebook_id = m.to_id, user_id = p_to
    from map m
    where g.user_id = p_from and g.notebook_id = m.from_id
    returning g.id
  )
  select (select count(*) from moved_chapters) + (select count(*) from moved_pages) into v_moved;

  update public.notebooks n
  set user_id = p_to
  where n.user_id = p_from
    and not exists (
      select 1 from public.notebooks b where b.user_id = p_to and btrim(b.name, v_blank) = btrim(n.name, v_blank)
    );

  update public.chapters c set user_id = p_to where c.user_id = p_from;
  update public.pages g set user_id = p_to where g.user_id = p_from;
  update public.page_images i
  set user_id = p_to, storage_path = p_to::text || substr(i.storage_path, length(p_from::text) + 1)
  where i.user_id = p_from;
  update public.readings r
  set user_id = p_to, alto_path = p_to::text || substr(r.alto_path, length(p_from::text) + 1)
  where r.user_id = p_from;
  update public.page_texts t set user_id = p_to where t.user_id = p_from;
  update public.page_charges c set user_id = p_to where c.user_id = p_from;
  update public.page_tokens k set user_id = p_to where k.user_id = p_from;

  delete from public.notebooks n where n.user_id = p_from;

  set constraints all immediate;

  return query select v_pages, v_merged;
end;
$$;
