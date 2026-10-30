create function private.date_pair(p_text text)
returns table (num integer, day integer)
language sql
immutable
parallel safe
set search_path = ''
as $$
  with head as (
    select left(
      (regexp_match(
        translate(
          normalize(left(coalesce(p_text, ''), 4000), nfc),
          chr(13) || chr(11) || chr(12) || chr(133) || chr(8232) || chr(8233) || chr(160),
          E'\n\n\n\n\n\n '
        ),
        '^[\x09-\x0d\x20]*([^' || chr(10) || ']*)'
      ))[1],
      200
    ) as line
  ),
  number as (
    select (
      regexp_match(
        h.line,
        '(?:^|(?<=[\x01-\x2f\x3a-\x40\x5b-\x5e\x60\x7b-\x7f]))jours?[\x09\x0b\x0c\x20]*[.:]?[\x09\x0b\x0c\x20]*([0-9]{1,3})(?:$|(?=[\x01-\x2f\x3a-\x40\x5b-\x5e\x60\x7b-\x7f]))',
        'i'
      )
    )[1]::integer as num
    from head h
  ),
  found as (
    select
      x.g[1]::integer as d,
      x.g[2]::integer as mo,
      case when x.g[3]::integer < 100 then x.g[3]::integer + 2000 else x.g[3]::integer end as y,
      length(x.g[3]) as ylen,
      x.n
    from head h
    cross join lateral regexp_matches(
      h.line,
      '(?<![0-9/.-])([0-9]{1,2})[\x09\x0b\x0c\x20]*[/.-][\x09\x0b\x0c\x20]*([0-9]{1,2})[\x09\x0b\x0c\x20]*[/.-][\x09\x0b\x0c\x20]*([0-9]{2,4})(?![0-9/.-])',
      'g'
    ) with ordinality as x(g, n)
  ),
  valid as (
    select
      f.n,
      f.d,
      f.mo,
      f.y
    from found f
    where f.ylen <> 3
      and f.mo between 1 and 12
      and f.d between 1 and (
        case f.mo
          when 2 then 28 + ((f.y % 4 = 0 and f.y % 100 <> 0) or f.y % 400 = 0)::integer
          when 4 then 30
          when 6 then 30
          when 9 then 30
          when 11 then 30
          else 31
        end
      )
  )
  select u.num, (make_date(v.y, v.mo, v.d) - date '2000-01-01')
  from number u
  cross join (select * from valid order by n limit 1) v
  where u.num is not null;
$$;

revoke all on function private.date_pair(text) from public, anon, authenticated, service_role;

create function private.date_flags(p_offsets integer[])
returns boolean[]
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_count integer := coalesce(cardinality(p_offsets), 0);
  v_flags boolean[];
begin
  if v_count > 500 or array_position(p_offsets, null) is not null then
    raise exception 'invalid_offsets';
  end if;
  if v_count < 4 then
    return array_fill(false, array[v_count]);
  end if;

  with o as (
    select u.v, u.i from unnest(p_offsets) with ordinality as u(v, i)
  ),
  ranked as (
    select x.i, x.v, row_number() over (order by x.v, x.i)::integer as r from o x
  ),
  sorted as (
    select array_agg(x.v order by x.r) as a from ranked x
  ),
  pairs as (
    select
      t.i as ti,
      q.v as qv,
      least(t.r, q.r) as lo,
      greatest(t.r, q.r) as hi,
      s.a
    from ranked t
    cross join ranked q
    cross join sorted s
    where t.i <> q.i
  ),
  medians as (
    select
      p.ti,
      p.qv,
      (
        p.a[k.k1 + (k.k1 >= p.lo)::integer + ((k.k1 + (k.k1 >= p.lo)::integer) >= p.hi)::integer]
        + p.a[k.k2 + (k.k2 >= p.lo)::integer + ((k.k2 + (k.k2 >= p.lo)::integer) >= p.hi)::integer]
      )::numeric / 2 as m
    from pairs p
    cross join lateral (select (v_count - 1) / 2 as k1, (v_count - 2) / 2 + 1 as k2) k
  ),
  refs as (
    select
      m.ti,
      count(*) filter (where abs(m.qv - m.m) <= 2) as kept,
      percentile_cont(0.5) within group (order by m.qv) filter (where abs(m.qv - m.m) <= 2) as med
    from medians m
    group by m.ti
  )
  select array_agg(coalesce(r.kept >= 3 and abs(x.v - r.med) > 2, false) order by x.i)
  into v_flags
  from o x
  left join refs r on r.ti = x.i;

  return v_flags;
end;
$$;

revoke all on function private.date_flags(integer[]) from public, anon, authenticated, service_role;

create function private.date_alerts_notebook(p_notebook_id uuid)
returns table (page_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_offsets integer[];
  v_flags boolean[];
begin
  if not exists (
    select 1 from public.notebooks n where n.id = p_notebook_id and n.correction_level = 'journal'
  ) then
    return;
  end if;

  select array_agg(x.id order by x.id), array_agg(x.day - x.num order by x.id)
  into v_ids, v_offsets
  from (
    select p.id, d.num, d.day
    from public.pages p
    join public.page_texts t on t.page_id = p.id
    cross join lateral private.date_pair(t.text) d
    where p.notebook_id = p_notebook_id
      and p.status = 'read'
      and p.page_type = 'text'
      and p.language = 'fr'
  ) x;

  if v_ids is null or cardinality(v_ids) > 500 then
    return;
  end if;

  v_flags := private.date_flags(v_offsets);
  return query select v_ids[g.i] from generate_series(1, cardinality(v_ids)) as g(i) where v_flags[g.i];
end;
$$;

revoke all on function private.date_alerts_notebook(uuid) from public, anon, authenticated, service_role;

create table private.dates_pending (
  notebook_id uuid not null
);

create index dates_pending_notebook_idx on private.dates_pending (notebook_id);

revoke all on private.dates_pending from public, anon, authenticated;

alter table private.dates_pending enable row level security;

create function private.queue_dates(p_notebook_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.dates_pending (notebook_id)
  select p_notebook_id
  where p_notebook_id is not null
    and not exists (select 1 from private.dates_pending q where q.notebook_id = p_notebook_id);
$$;

revoke all on function private.queue_dates(uuid) from public, anon, authenticated, service_role;

create function private.refresh_dates(p_notebook_id uuid) returns void
language plpgsql
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('lexicon:' || p_notebook_id::text, 0));

  if not exists (select 1 from public.notebooks n where n.id = p_notebook_id) then
    return;
  end if;

  with fresh as materialized (
    select f.page_id from private.date_alerts_notebook(p_notebook_id) f
  ),
  removed as (
    delete from public.page_alerts a
    using public.pages p
    where a.kind = 'date_incoherent'
      and p.id = a.page_id
      and p.notebook_id = p_notebook_id
      and not exists (select 1 from fresh f where f.page_id = a.page_id)
    returning 1
  ),
  missing as (
    select p.id, p.user_id
    from public.pages p
    where p.id in (select f.page_id from fresh f)
      and not exists (
        select 1 from public.page_alerts a where a.page_id = p.id and a.kind = 'date_incoherent'
      )
    for key share of p skip locked
  )
  insert into public.page_alerts (user_id, page_id, kind, details)
  select o.user_id, o.id, 'date_incoherent', '{}'::jsonb from missing o
  on conflict (page_id, kind) do nothing;
end;
$$;

revoke all on function private.refresh_dates(uuid) from public, anon, authenticated, service_role;

create function private.flush_dates() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  delete from private.dates_pending q where q.notebook_id = new.notebook_id;
  get diagnostics v_removed = row_count;
  if v_removed > 0 then
    perform private.refresh_dates(new.notebook_id);
  end if;
  return null;
end;
$$;

revoke all on function private.flush_dates() from public, anon, authenticated, service_role;

create constraint trigger dates_pending_flush
  after insert on private.dates_pending
  deferrable initially deferred
  for each row execute function private.flush_dates();

create function private.dates_page_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page uuid;
begin
  v_page := case when tg_op = 'DELETE' then old.page_id else new.page_id end;
  perform private.queue_dates(p.notebook_id) from public.pages p where p.id = v_page;
  return null;
end;
$$;

revoke all on function private.dates_page_changed() from public, anon, authenticated, service_role;

create function private.dates_pages_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.queue_dates(old.notebook_id);
  if tg_op = 'UPDATE' then
    perform private.queue_dates(new.notebook_id);
  end if;
  return null;
end;
$$;

revoke all on function private.dates_pages_changed() from public, anon, authenticated, service_role;

create function private.dates_notebook_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.queue_dates(new.id);
  return null;
end;
$$;

revoke all on function private.dates_notebook_changed() from public, anon, authenticated, service_role;

create trigger page_texts_queue_dates
  after insert or update of text or delete on public.page_texts
  for each row execute function private.dates_page_changed();

create trigger pages_queue_dates_changed
  after update of notebook_id, page_type, language, status on public.pages
  for each row execute function private.dates_pages_changed();

create trigger pages_queue_dates_deleted
  after delete on public.pages
  for each row execute function private.dates_pages_changed();

create trigger notebooks_queue_dates
  after update of correction_level on public.notebooks
  for each row
  when (old.correction_level is distinct from new.correction_level)
  execute function private.dates_notebook_changed();
