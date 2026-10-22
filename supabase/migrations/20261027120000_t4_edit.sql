create table public.page_gaps (
  page_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  gap_index integer not null check (gap_index >= 0),
  text text not null check (char_length(text) <= 100000),
  primary key (page_id, gap_index),
  foreign key (page_id, user_id) references public.pages (id, user_id)
    on delete cascade deferrable initially immediate
);

create index page_gaps_page_user_idx on public.page_gaps (page_id, user_id);
create index page_gaps_user_page_idx on public.page_gaps (user_id, page_id);

revoke all on public.page_gaps from anon, authenticated;
grant select on public.page_gaps to authenticated;
grant select, insert, update, delete on public.page_gaps to service_role;

alter table public.page_gaps enable row level security;

create policy page_gaps_select on public.page_gaps
  for select to authenticated
  using (user_id = (select auth.uid()));

alter table public.corrections drop constraint corrections_word_length;
alter table public.corrections add constraint corrections_word_length check (char_length(corrected_text) between 0 and 100);

create or replace function private.recompute_page_text(p_page_id uuid) returns void
language plpgsql
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_base text;
  v_count bigint;
  v_type text;
  v_places bigint;
  v_text text;
begin
  select p.page_type into v_type from public.pages p where p.id = p_page_id;
  if not found then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  select count(*) into v_places from public.page_tokens k where k.page_id = p_page_id and k.b1_start is not null;
  if v_places = 0 and v_type <> 'math' then
    return;
  end if;

  select count(*), min(r.raw_text) into v_count, v_base
  from public.readings r where r.page_id = p_page_id and r.label = 'B1';
  if v_count <> 1 then
    raise exception 'no_reading_b1' using errcode = '23514';
  end if;
  if exists (select 1 from public.page_tokens k where k.page_id = p_page_id and k.b1_end > char_length(v_base)) then
    raise exception 'invalid_places' using errcode = '23514';
  end if;

  with latest as materialized (
    select distinct on (x.token_index) x.token_index, x.corrected_text
    from public.corrections x
    where x.page_id = p_page_id
    order by x.token_index, x.revision desc
  ),
  numbered as (
    select
      k.b1_start,
      k.b1_end,
      row_number() over (order by k.b1_start) - 1 as gap_index,
      coalesce(l.corrected_text, case when k.text is distinct from k.reading_b1 then k.text end) as changed
    from public.page_tokens k
    left join latest l on l.token_index = k.token_index
    where k.page_id = p_page_id
      and k.b1_start is not null
  ),
  gapped as (
    select n.*, coalesce(lag(n.b1_end) over (order by n.b1_start), 0) as previous_end
    from numbered n
  ),
  assembled as (
    select
      coalesce(
        string_agg(
          coalesce(ge.text, substr(v_base, g.previous_end + 1, g.b1_start - g.previous_end))
            || coalesce(g.changed, substr(v_base, g.b1_start + 1, g.b1_end - g.b1_start)),
          '' order by g.b1_start
        ),
        ''
      ) as head,
      coalesce(max(g.b1_end), 0) as last_end,
      count(*) as places
    from gapped g
    left join public.page_gaps ge on ge.page_id = p_page_id and ge.gap_index = g.gap_index
  )
  select a.head || coalesce(tail.text, substr(v_base, a.last_end + 1))
  into v_text
  from assembled a
  left join public.page_gaps tail on tail.page_id = p_page_id and tail.gap_index = a.places;

  update public.page_texts t set text = v_text where t.page_id = p_page_id and t.text is distinct from v_text;
end;
$$;

create or replace function private.prepare_correction() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.page_tokens%rowtype;
  v_revision integer;
  v_last text;
  v_reading text;
begin
  if new.corrected_text = '' and auth.uid() is not null then
    raise exception 'invalid_word' using errcode = '23514';
  end if;

  perform 1 from public.pages p where p.id = new.page_id and p.user_id = new.user_id for update;
  if not found then
    raise exception 'page_not_found' using errcode = '23503';
  end if;

  select k.* into v_token from public.page_tokens k where k.page_id = new.page_id and k.token_index = new.token_index;
  if not found then
    raise exception 'position_not_found' using errcode = '23503';
  end if;
  if v_token.b1_start is null then
    raise exception 'position_without_place' using errcode = '23514';
  end if;

  select c.revision, c.corrected_text into v_revision, v_last
  from public.corrections c
  where c.page_id = new.page_id and c.token_index = new.token_index
  order by c.revision desc
  limit 1;

  if (select count(*) from public.corrections c where c.page_id = new.page_id) >= 2000 then
    raise exception 'too_many_corrections' using errcode = '23514';
  end if;

  new.from_queue := new.from_queue and coalesce(v_token.review_status = 'pending', false);

  new.revision := coalesce(v_revision, 0) + 1;
  new.previous_text := coalesce(v_last, v_token.text);

  v_reading := case new.chosen_from
    when 'A' then v_token.reading_a
    when 'B1' then v_token.reading_b1
    when 'B2' then v_token.reading_b2
    else new.corrected_text
  end;
  if v_reading is distinct from new.corrected_text then
    raise exception 'reading_mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.apply_correction() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.page_tokens k
  set review_status = case when new.corrected_text = new.previous_text then 'confirmed' else 'corrected' end
  where k.page_id = new.page_id and k.token_index = new.token_index and k.review_status = 'pending';

  if current_setting('private.rebuild_later', true) is distinct from 'on' then
    perform private.recompute_page_text(new.page_id);
  end if;
  return null;
end;
$$;

create function public.edit_page(p_page_id uuid, p_user_id uuid, p_text text, p_words jsonb, p_gaps jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
  v_type text;
  v_places integer;
  v_base text;
  v_count bigint;
  v_item jsonb;
  v_keys integer;
  v_state text;
  v_message text;
  v_word record;
begin
  select p.user_id, p.status, p.page_type into v_owner, v_status, v_type from public.pages p where p.id = p_page_id for update;
  if not found or p_user_id is null or v_owner <> p_user_id then
    return 'page_not_found';
  end if;
  if v_status <> 'read' then
    return 'page_not_read';
  end if;
  if v_type = 'unsupported_script' then
    return 'unsupported_script';
  end if;

  select count(*) into v_places from public.page_tokens k where k.page_id = p_page_id and k.b1_start is not null;
  if v_places = 0 and v_type = 'text' then
    return 'not_editable';
  end if;
  select count(*), min(r.raw_text) into v_count, v_base from public.readings r where r.page_id = p_page_id and r.label = 'B1';
  if v_count <> 1 then
    return 'not_editable';
  end if;

  if p_text is null or char_length(p_text) > 100000 then
    return 'invalid_edit';
  end if;
  if p_words is null or jsonb_typeof(p_words) <> 'array' or p_gaps is null or jsonb_typeof(p_gaps) <> 'array' then
    return 'invalid_edit';
  end if;
  if jsonb_array_length(p_words) > 2000 or jsonb_array_length(p_gaps) > v_places + 1 then
    return 'invalid_edit';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_words) e loop
    if jsonb_typeof(v_item) <> 'object' then
      return 'invalid_edit';
    end if;
    select count(*) into v_keys from jsonb_object_keys(v_item);
    if v_keys <> 2 or not (v_item ? 'token_index' and v_item ? 'text') then
      return 'invalid_edit';
    end if;
    if jsonb_typeof(v_item -> 'token_index') <> 'number' or jsonb_typeof(v_item -> 'text') <> 'string' then
      return 'invalid_edit';
    end if;
  end loop;
  for v_item in select e.value from jsonb_array_elements(p_gaps) e loop
    if jsonb_typeof(v_item) <> 'object' then
      return 'invalid_edit';
    end if;
    select count(*) into v_keys from jsonb_object_keys(v_item);
    if v_keys <> 2 or not (v_item ? 'gap_index' and v_item ? 'text') then
      return 'invalid_edit';
    end if;
    if jsonb_typeof(v_item -> 'gap_index') <> 'number' or jsonb_typeof(v_item -> 'text') <> 'string' then
      return 'invalid_edit';
    end if;
  end loop;

  begin
    if (select count(distinct w.token_index) <> count(*) from jsonb_to_recordset(p_words) as w (token_index integer, text text)) then
      return 'invalid_edit';
    end if;
    if (select count(distinct g.gap_index) <> count(*) or coalesce(min(g.gap_index) < 0, false) or coalesce(max(g.gap_index) > v_places, false)
        from jsonb_to_recordset(p_gaps) as g (gap_index integer, text text)) then
      return 'invalid_edit';
    end if;
    if (select coalesce(sum(char_length(g.text)), 0) from jsonb_to_recordset(p_gaps) as g (gap_index integer, text text)) > char_length(p_text) then
      return 'invalid_edit';
    end if;
    if exists (
      select 1 from jsonb_to_recordset(p_words) as w (token_index integer, text text)
      where not exists (
        select 1 from public.page_tokens k where k.page_id = p_page_id and k.token_index = w.token_index and k.b1_start is not null
      )
    ) then
      return 'invalid_edit';
    end if;

    perform set_config('private.rebuild_later', 'on', true);
    for v_word in select w.token_index, w.text from jsonb_to_recordset(p_words) as w (token_index integer, text text) order by w.token_index loop
      insert into public.corrections (user_id, page_id, token_index, corrected_text, chosen_from, from_queue)
      values (p_user_id, p_page_id, v_word.token_index, v_word.text, 'keyboard', false);
    end loop;
    perform set_config('private.rebuild_later', 'off', true);

    insert into public.page_gaps (page_id, user_id, gap_index, text)
    select p_page_id, p_user_id, g.gap_index, g.text
    from jsonb_to_recordset(p_gaps) as g (gap_index integer, text text)
    on conflict (page_id, gap_index) do update set text = excluded.text;

    with ordered as (
      select
        row_number() over (order by k.b1_start) - 1 as gap_index,
        k.b1_start,
        coalesce(lag(k.b1_end) over (order by k.b1_start), 0) as previous_end
      from public.page_tokens k
      where k.page_id = p_page_id and k.b1_start is not null
    ),
    raw as (
      select o.gap_index, substr(v_base, o.previous_end + 1, o.b1_start - o.previous_end) as text from ordered o
      union all
      select v_places, substr(v_base, coalesce((select max(k.b1_end) from public.page_tokens k where k.page_id = p_page_id and k.b1_start is not null), 0) + 1)
    )
    delete from public.page_gaps g
    using raw r
    where g.page_id = p_page_id and g.gap_index = r.gap_index and g.text = r.text;

    perform private.recompute_page_text(p_page_id);

    if (select t.text from public.page_texts t where t.page_id = p_page_id) is distinct from p_text then
      raise exception 'text_mismatch';
    end if;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_message = 'text_mismatch' then
      return 'text_mismatch';
    end if;
    if v_state in ('23514', '23503', '23505', '22P02', '22003', '22001') then
      return 'invalid_edit';
    end if;
    raise;
  end;

  return 'edited';
end;
$$;

revoke all on function public.edit_page(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.edit_page(uuid, uuid, text, jsonb, jsonb) to service_role;

create or replace function public.set_page_math(p_page_id uuid, p_user_id uuid)
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
  delete from public.page_gaps g where g.page_id = p_page_id;
  delete from public.page_alerts a where a.page_id = p_page_id and a.kind = 'missing_line';
  delete from public.readings r where r.page_id = p_page_id and r.label = 'A' returning r.alto_path into v_alto;
  update public.page_texts t
  set text = b.raw_text
  from public.readings b
  where t.page_id = p_page_id
    and b.page_id = p_page_id
    and b.label = 'B1'
    and (select count(*) from public.readings r where r.page_id = p_page_id and r.label = 'B1') = 1;
  update public.pages p set page_type = 'math', language = null where p.id = p_page_id;

  return query select 'switched'::text, v_alto;
end;
$$;

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
  delete from public.page_gaps g where g.page_id = p_page_id;
  update public.page_texts t set text = v_b1 where t.page_id = p_page_id and t.text is distinct from v_b1;

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

  perform 1 from public.notebooks n where n.user_id = p_from order by n.id for update;
  perform 1 from public.chapters c where c.user_id = p_from order by c.id for update;
  perform 1 from public.pages p where p.user_id = p_from order by p.id for update;
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
  chapter_map as (
    select c.id as from_id, t.id as same_id, m.to_id as notebook_id
    from public.chapters c
    join map m on c.user_id = p_from and c.notebook_id = m.from_id
    left join public.chapters t
      on t.user_id = p_to and t.notebook_id = m.to_id and btrim(t.name, v_blank) = btrim(c.name, v_blank)
  ),
  moved_chapters as (
    update public.chapters c
    set notebook_id = cm.notebook_id, user_id = p_to
    from chapter_map cm
    where c.id = cm.from_id and cm.same_id is null
    returning c.id
  ),
  moved_pages as (
    update public.pages g
    set notebook_id = m.to_id,
        user_id = p_to,
        chapter_id = coalesce((select cm.same_id from chapter_map cm where cm.from_id = g.chapter_id), g.chapter_id)
    from map m
    where g.user_id = p_from and g.notebook_id = m.from_id
    returning g.id
  )
  select (select count(*) from moved_chapters) + (select count(*) from moved_pages) into v_moved;

  delete from public.chapters c
  where c.user_id = p_from
    and c.notebook_id in (
      select a.id
      from public.notebooks a
      join public.notebooks b on b.user_id = p_to and btrim(b.name, v_blank) = btrim(a.name, v_blank)
      where a.user_id = p_from
    );

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
  update public.corrections x set user_id = p_to where x.user_id = p_from;
  update public.page_alerts a set user_id = p_to where a.user_id = p_from;
  update public.page_gaps g set user_id = p_to where g.user_id = p_from;

  delete from public.notebooks n where n.user_id = p_from;

  set constraints all immediate;

  return query select v_pages, v_merged;
end;
$$;
