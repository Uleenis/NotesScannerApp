create unique index chapters_notebook_name_key on public.chapters (
  notebook_id,
  btrim(name, E' \t\r\n            ​  ⁠　﻿')
);

create index chapters_notebook_user_idx on public.chapters (notebook_id, user_id);
create index pages_notebook_user_idx on public.pages (notebook_id, user_id);
create index page_images_page_user_idx on public.page_images (page_id, user_id);
create index readings_page_user_idx on public.readings (page_id, user_id);
create index page_texts_page_user_idx on public.page_texts (page_id, user_id);
create index page_charges_page_user_idx on public.page_charges (page_id, user_id);
create index page_tokens_page_user_idx on public.page_tokens (page_id, user_id);

revoke update (chapter_id) on public.pages from authenticated;

create function public.move_page(p_page_id uuid, p_user_id uuid, p_notebook_id uuid, p_chapter_id uuid)
returns table (outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
  v_notebook uuid;
  v_chapter uuid;
begin
  if p_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  end if;

  if p_user_id is null or not exists (select 1 from public.pages p where p.id = p_page_id and p.user_id = p_user_id) then
    return query select 'page_not_found'::text;
    return;
  end if;

  perform 1 from public.notebooks n where n.id = p_notebook_id and n.user_id = p_user_id for share;
  if not found then
    return query select 'notebook_not_found'::text;
    return;
  end if;

  if p_chapter_id is not null then
    perform 1 from public.chapters c where c.id = p_chapter_id and c.notebook_id = p_notebook_id and c.user_id = p_user_id for share;
    if not found then
      return query select 'chapter_not_found'::text;
      return;
    end if;
  end if;

  select p.user_id, p.status, p.notebook_id, p.chapter_id into v_owner, v_status, v_notebook, v_chapter
  from public.pages p where p.id = p_page_id for update;
  if not found or v_owner <> p_user_id then
    return query select 'page_not_found'::text;
    return;
  end if;
  if v_status = 'processing' then
    return query select 'page_processing'::text;
    return;
  end if;
  if v_notebook = p_notebook_id and v_chapter is not distinct from p_chapter_id then
    return query select 'unchanged'::text;
    return;
  end if;

  update public.pages p set notebook_id = p_notebook_id, chapter_id = p_chapter_id where p.id = p_page_id;

  return query select 'moved'::text;
end;
$$;

create function public.delete_page(p_page_id uuid, p_user_id uuid)
returns table (outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  end if;

  select p.status into v_status from public.pages p
  where p.id = p_page_id and p_user_id is not null and p.user_id = p_user_id
  for update;
  if not found then
    return query select 'page_not_found'::text;
    return;
  end if;
  if v_status = 'processing' then
    return query select 'page_processing'::text;
    return;
  end if;

  delete from public.pages p where p.id = p_page_id;

  return query select 'deleted'::text;
end;
$$;

create function public.delete_chapter(p_chapter_id uuid, p_user_id uuid)
returns table (outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notebook uuid;
begin
  if p_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  end if;

  select c.notebook_id into v_notebook from public.chapters c
  where c.id = p_chapter_id and p_user_id is not null and c.user_id = p_user_id;
  if not found then
    return query select 'chapter_not_found'::text;
    return;
  end if;

  perform 1 from public.notebooks n where n.id = v_notebook and n.user_id = p_user_id for share;
  if not found then
    return query select 'chapter_not_found'::text;
    return;
  end if;

  perform 1 from public.chapters c
  where c.id = p_chapter_id and c.user_id = p_user_id and c.notebook_id = v_notebook
  for update;
  if not found then
    return query select 'chapter_not_found'::text;
    return;
  end if;

  delete from public.chapters c where c.id = p_chapter_id;

  return query select 'deleted'::text;
end;
$$;

create function public.delete_notebook(p_notebook_id uuid, p_user_id uuid)
returns table (outcome text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  end if;

  perform 1 from public.notebooks n
  where n.id = p_notebook_id and p_user_id is not null and n.user_id = p_user_id
  for update;
  if not found then
    return query select 'notebook_not_found'::text;
    return;
  end if;

  perform 1 from public.pages p where p.notebook_id = p_notebook_id order by p.id for update;
  if exists (select 1 from public.pages p where p.notebook_id = p_notebook_id and p.status = 'processing') then
    return query select 'page_processing'::text;
    return;
  end if;

  delete from public.notebooks n where n.id = p_notebook_id;

  return query select 'deleted'::text;
end;
$$;

revoke all on function public.move_page(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_page(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_chapter(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_notebook(uuid, uuid) from public, anon, authenticated;
grant execute on function public.move_page(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.delete_page(uuid, uuid) to service_role;
grant execute on function public.delete_chapter(uuid, uuid) to service_role;
grant execute on function public.delete_notebook(uuid, uuid) to service_role;

create or replace function public.transfer_account_rows(p_from uuid, p_to uuid)
returns table (pages integer, notebooks_merged integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blank constant text := E' \t\r\n            ​  ⁠　﻿';
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

  delete from public.notebooks n where n.user_id = p_from;

  set constraints all immediate;

  return query select v_pages, v_merged;
end;
$$;
