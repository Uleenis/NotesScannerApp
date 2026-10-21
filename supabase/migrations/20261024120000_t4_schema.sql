alter table public.page_tokens
  add column reading_b2 text check (reading_b2 <> ''),
  add column review_status text check (review_status in ('pending', 'confirmed', 'corrected', 'skipped')),
  add column b1_start integer check (b1_start >= 0),
  add column b1_end integer;

update public.page_tokens set review_status = 'pending' where channel = 'queue';

alter table public.page_tokens
  add constraint page_tokens_place_pair check ((b1_start is null) = (b1_end is null)),
  add constraint page_tokens_place_not_empty check (b1_start is null or b1_start < b1_end),
  add constraint page_tokens_status_with_queue check (coalesce(channel = 'queue', false) = (review_status is not null));

create function private.fill_review_status() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.channel = 'queue' and new.review_status is null then
    new.review_status := 'pending';
  end if;
  return new;
end;
$$;

revoke all on function private.fill_review_status() from public, anon, authenticated, service_role;

create trigger page_tokens_fill_review_status
  before insert or update of channel, review_status on public.page_tokens
  for each row execute function private.fill_review_status();

create function private.check_token_places() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.b1_start is not null and exists (
    select 1 from public.page_tokens o
    where o.page_id = new.page_id
      and o.token_index <> new.token_index
      and o.b1_start is not null
      and (
        (o.token_index < new.token_index and o.b1_end > new.b1_start)
        or (o.token_index > new.token_index and o.b1_start < new.b1_end)
      )
  ) then
    raise exception 'invalid_places' using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function private.check_token_places() from public, anon, authenticated, service_role;

create trigger page_tokens_check_places
  after insert or update of token_index, b1_start, b1_end on public.page_tokens
  for each row execute function private.check_token_places();

create unique index readings_one_b2_per_page on public.readings (page_id) where label = 'B2';

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  page_id uuid not null,
  token_index integer not null check (token_index >= 0),
  revision integer not null check (revision between 1 and 100),
  previous_text text not null,
  corrected_text text not null,
  chosen_from text not null check (chosen_from in ('A', 'B1', 'B2', 'keyboard')),
  from_queue boolean not null default false,
  created_at timestamptz not null default now(),
  constraint corrections_word_length check (char_length(corrected_text) between 1 and 100),
  constraint corrections_one_word check (
    corrected_text !~ U&'[\0001-\0020\007f-\00a0\1680\2000-\200b\2028\2029\202f\205f\2060\3000\feff]'
  ),
  unique (page_id, token_index, revision),
  foreign key (page_id, user_id) references public.pages (id, user_id)
    on delete cascade deferrable initially immediate,
  foreign key (page_id, token_index) references public.page_tokens (page_id, token_index)
    on delete cascade
);

create index corrections_page_user_idx on public.corrections (page_id, user_id);
create index corrections_user_page_idx on public.corrections (user_id, page_id);

create table public.page_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid not null,
  kind text not null check (kind in ('date_incoherent', 'missing_line', 'math_incomplete')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint page_alerts_details_object check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 16384),
  unique (page_id, kind),
  foreign key (page_id, user_id) references public.pages (id, user_id)
    on delete cascade deferrable initially immediate
);

create index page_alerts_page_user_idx on public.page_alerts (page_id, user_id);
create index page_alerts_user_page_idx on public.page_alerts (user_id, page_id);

revoke all on public.corrections, public.page_alerts from anon, authenticated;
grant select on public.corrections, public.page_alerts to authenticated;
grant insert (page_id, token_index, corrected_text, chosen_from, from_queue) on public.corrections to authenticated;
grant select, insert, update, delete on public.corrections, public.page_alerts to service_role;

alter table public.corrections enable row level security;
alter table public.page_alerts enable row level security;

create policy corrections_select on public.corrections
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy corrections_insert on public.corrections
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy page_alerts_select on public.page_alerts
  for select to authenticated
  using (user_id = (select auth.uid()));

create function private.recompute_page_text(p_page_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_count bigint;
  v_text text;
begin
  perform 1 from public.pages p where p.id = p_page_id;
  if not found then
    raise exception 'page_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.page_tokens k where k.page_id = p_page_id and k.b1_start is not null) then
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

  with placed as (
    select
      k.b1_start,
      k.b1_end,
      case
        when c.corrected_text is not null then c.corrected_text
        when k.text is distinct from k.reading_b1 then k.text
        else substr(v_base, k.b1_start + 1, k.b1_end - k.b1_start)
      end as shown
    from public.page_tokens k
    left join lateral (
      select x.corrected_text
      from public.corrections x
      where x.page_id = k.page_id and x.token_index = k.token_index
      order by x.revision desc
      limit 1
    ) c on true
    where k.page_id = p_page_id and k.b1_start is not null
  ),
  gapped as (
    select p.b1_start, p.b1_end, p.shown, coalesce(lag(p.b1_end) over (order by p.b1_start), 0) as previous_end
    from placed p
  )
  select
    coalesce(string_agg(substr(v_base, g.previous_end + 1, g.b1_start - g.previous_end) || g.shown, '' order by g.b1_start), '')
    || substr(v_base, coalesce(max(g.b1_end), 0) + 1)
  into v_text
  from gapped g;

  update public.page_texts t set text = v_text where t.page_id = p_page_id and t.text is distinct from v_text;
end;
$$;

revoke all on function private.recompute_page_text(uuid) from public, anon, authenticated, service_role;

create function private.prepare_correction() returns trigger
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

create function private.apply_correction() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.page_tokens k
  set review_status = case when new.corrected_text = new.previous_text then 'confirmed' else 'corrected' end
  where k.page_id = new.page_id and k.token_index = new.token_index and k.review_status = 'pending';

  perform private.recompute_page_text(new.page_id);
  return null;
end;
$$;

revoke all on function private.prepare_correction() from public, anon, authenticated, service_role;
revoke all on function private.apply_correction() from public, anon, authenticated, service_role;

create trigger corrections_prepare
  before insert on public.corrections
  for each row execute function private.prepare_correction();

create trigger corrections_apply
  after insert on public.corrections
  for each row execute function private.apply_correction();

create or replace function public.record_reading_a(
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

  update public.pages p set language = p_language where p.id = p_page_id;

  perform private.recompute_page_text(p_page_id);

  return query select true, 'recorded'::text;
end;
$$;

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

  delete from public.notebooks n where n.user_id = p_from;

  set constraints all immediate;

  return query select v_pages, v_merged;
end;
$$;
