lock table public.render_daily_counts in access exclusive mode;

update public.render_daily_counts set renders = least(renders, 5) where renders > 5;

alter table public.render_daily_counts drop constraint render_daily_counts_renders_check;
alter table public.render_daily_counts add constraint render_daily_counts_renders_check check (renders between 0 and 5);

create or replace function public.charge_render(p_user_id uuid)
returns table (allowed boolean, used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day constant date := (now() at time zone 'Europe/Paris')::date;
  v_used integer;
begin
  if p_user_id is null then
    raise exception 'account_not_found';
  end if;

  delete from public.render_daily_counts c where c.user_id = p_user_id and c.day < v_day;

  insert into public.render_daily_counts as d (user_id, day, renders)
  values (p_user_id, v_day, 1)
  on conflict (user_id, day) do update set renders = d.renders + 1 where d.renders < 5
  returning d.renders into v_used;

  if found then
    return query select true, v_used;
  else
    return query select false, 5;
  end if;
end;
$$;

revoke all on function public.charge_render(uuid) from public, anon, authenticated, service_role;
grant execute on function public.charge_render(uuid) to service_role;

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

  perform 1 from public.notebooks n where n.user_id = p_from order by n.id for no key update;
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
  update public.page_renderings r set user_id = p_to where r.user_id = p_from;
  insert into public.render_daily_counts as d (user_id, day, renders)
  select p_to, c.day, c.renders from public.render_daily_counts c where c.user_id = p_from
  on conflict (user_id, day) do update set renders = least(5, d.renders + excluded.renders);
  delete from public.render_daily_counts c where c.user_id = p_from;
  perform pg_advisory_xact_lock(hashtextextended('lexicon:' || m.id::text, 0))
  from (
    select n.id
    from public.notebooks n
    where n.user_id = p_to
      and exists (select 1 from public.lexicon_entries e where e.notebook_id = n.id and e.user_id = p_from)
    order by n.id
  ) m;
  update public.lexicon_entries e
  set user_id = p_to
  from public.notebooks n
  where e.user_id = p_from and n.id = e.notebook_id and n.user_id = p_to;

  delete from public.notebooks n where n.user_id = p_from;

  set constraints all immediate;

  return query select v_pages, v_merged;
end;
$$;
