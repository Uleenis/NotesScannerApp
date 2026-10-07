create function public.transfer_account_rows(p_from uuid, p_to uuid)
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
  update public.readings r set user_id = p_to where r.user_id = p_from;
  update public.page_texts t set user_id = p_to where t.user_id = p_from;
  update public.page_charges c set user_id = p_to where c.user_id = p_from;

  delete from public.notebooks n where n.user_id = p_from;

  set constraints all immediate;

  return query select v_pages, v_merged;
end;
$$;

revoke all on function public.transfer_account_rows(uuid, uuid) from public, anon, authenticated;
grant execute on function public.transfer_account_rows(uuid, uuid) to service_role;

create or replace function public.charge_page(p_page_id uuid, p_at timestamptz default now())
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_locked uuid;
  v_allowance record;
  v_counted integer;
begin
  p_at := coalesce(p_at, now());

  loop
    select p.user_id into v_user from public.pages p where p.id = p_page_id;
    if not found then
      return query select false, 'page_not_found'::text;
      return;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

    select p.user_id into v_locked from public.pages p where p.id = p_page_id;
    exit when v_locked = v_user;
  end loop;

  if exists (select 1 from public.page_charges c where c.page_id = p_page_id) then
    return query select true, 'already_charged'::text;
    return;
  end if;

  select a.* into v_allowance from public.page_allowance(v_user, p_at) a;

  if v_allowance.blocked_reason in ('anonymous_limit', 'monthly_limit') then
    return query select false, v_allowance.blocked_reason;
    return;
  end if;

  if v_allowance.is_anonymous then
    insert into public.anonymous_daily_counts as d (day, pages)
    values ((p_at at time zone 'Europe/Paris')::date, 1)
    on conflict (day) do update set pages = d.pages + 1 where d.pages < public.anonymous_daily_cap()
    returning d.pages into v_counted;
    if v_counted is null then
      return query select false, 'anonymous_daily_cap'::text;
      return;
    end if;
  end if;

  insert into public.page_charges (user_id, page_id, charged_at) values (v_user, p_page_id, p_at);
  return query select true, 'charged'::text;
end;
$$;
