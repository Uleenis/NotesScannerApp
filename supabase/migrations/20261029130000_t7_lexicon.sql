create extension if not exists pg_trgm with schema extensions;

create table public.lexicon_entries (
  notebook_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  form_key text not null check (char_length(form_key) between 1 and 100),
  form text not null check (char_length(form) between 1 and 100),
  occurrences integer not null check (occurrences >= 1),
  confirmed boolean not null default false,
  primary key (notebook_id, form_key),
  constraint lexicon_entries_enters check (occurrences >= 2 or confirmed),
  foreign key (notebook_id, user_id) references public.notebooks (id, user_id)
    on delete cascade deferrable initially immediate
);

create index lexicon_entries_notebook_user_idx on public.lexicon_entries (notebook_id, user_id);
create index lexicon_entries_user_notebook_idx on public.lexicon_entries (user_id, notebook_id);
create index lexicon_entries_key_trgm_idx on public.lexicon_entries using gin (form_key extensions.gin_trgm_ops);

revoke all on public.lexicon_entries from anon, authenticated;
grant select on public.lexicon_entries to authenticated;
grant select, insert, update, delete on public.lexicon_entries to service_role;

alter table public.lexicon_entries enable row level security;

create policy lexicon_entries_select on public.lexicon_entries
  for select to authenticated
  using (user_id = (select auth.uid()));

create function private.lexicon_words(p_text text)
returns table (form text, form_key text, retained boolean)
language sql
stable
set search_path = ''
as $$
  with runs as (
    select x.n, x.g[1] as lead, x.g[2] as word
    from regexp_matches(
      regexp_replace(normalize(p_text, nfc), '<[^<>]*>', ' ', 'g'),
      '([^[:alnum:]]*)([[:alnum:]]+(?:[''’-][[:alnum:]]+)*)',
      'g'
    ) with ordinality as x(g, n)
    where char_length(x.g[2]) <= 40
  ),
  context as (
    select
      r.n,
      r.word,
      lead(r.lead) over (order by r.n) as next_lead,
      lead(r.word) over (order by r.n) as next_word,
      (r.n = 1 or r.lead like E'%\n%') as line_start,
      (regexp_replace(r.lead, '[][:space:]"«»“”‘’''()*_#>[-]+$', '') ~ '[.!?…]$') as after_stop
    from runs r
  ),
  parts as (
    select
      c.*,
      s.part,
      s.k,
      count(*) over (partition by c.n) as part_count
    from context c
    cross join lateral regexp_split_to_table(c.word, '[''’-]') with ordinality as s(part, k)
  ),
  judged as (
    select
      p.*,
      exists (
        select 1 from private.dictionary_words d where d.word = replace(lower(p.word), '’', '''')
      ) as whole_known,
      (
        exists (select 1 from private.dictionary_words d where d.word = lower(p.part))
        or lower(p.part) in ('qu', 'jusqu', 'lorsqu', 'puisqu', 'quoiqu', 'presqu')
      ) as part_known
    from parts p
  )
  select
    j.part,
    lower(extensions.unaccent(j.part)),
    (
      not j.part_known
      or (j.part ~ '^[[:upper:]]' and not (j.k = 1 and (j.line_start or j.after_stop)))
      or (j.part ~ '[[:alpha:]]' and j.part ~ '[[:digit:]]')
      or (j.k = j.part_count and coalesce(j.next_lead ~ E'^\\.[ \\t]*$' and j.next_word ~ '^[[:lower:][:digit:]]', false))
    )
  from judged j
  where char_length(j.part) between 2 and 40
    and char_length(lower(extensions.unaccent(j.part))) <= 40
    and j.part ~ '[[:alpha:]]'
    and lower(j.part) !~ '^[0-9]+(er|ere|ère|re|e|eme|ème|es|nd|rd|th|st)$'
    and not (j.part_count > 1 and j.whole_known);
$$;

create function private.lexicon_notebook(p_notebook_id uuid)
returns table (form_key text, form text, occurrences integer, confirmed boolean)
language sql
stable
set search_path = ''
as $$
  with shown as (
    select t.page_id, t.text
    from public.pages p
    join public.page_texts t on t.page_id = p.id
    where p.notebook_id = p_notebook_id and p.page_type <> 'math'
  ),
  seen as (
    select s.page_id, w.form, w.form_key
    from shown s
    cross join lateral private.lexicon_words(s.text) w
    where w.retained
  ),
  counted as (
    select z.form_key, count(distinct z.page_id)::integer as occurrences
    from seen z
    group by z.form_key
  ),
  spelling as (
    select distinct on (v.form_key) v.form_key, v.form
    from (select z.form_key, z.form, count(*) as n from seen z group by z.form_key, z.form) v
    order by v.form_key, v.n desc, v.form
  ),
  latest as (
    select distinct on (x.page_id, x.token_index) x.corrected_text as text
    from public.corrections x
    join shown s on s.page_id = x.page_id
    order by x.page_id, x.token_index, x.revision desc
  ),
  written as (
    select w.form_key from latest l cross join lateral private.lexicon_words(l.text) w
    union
    select w.form_key
    from public.page_gaps g
    join shown s on s.page_id = g.page_id
    cross join lateral private.lexicon_words(g.text) w
  )
  select c.form_key, sp.form, c.occurrences, (w.form_key is not null)
  from counted c
  join spelling sp on sp.form_key = c.form_key
  left join written w on w.form_key = c.form_key
  where c.occurrences >= 2 or w.form_key is not null
  order by (w.form_key is not null) desc, c.occurrences desc, c.form_key
  limit 5000;
$$;

create table private.lexicon_pending (
  notebook_id uuid not null
);

create index lexicon_pending_notebook_idx on private.lexicon_pending (notebook_id);

revoke all on private.lexicon_pending from public, anon, authenticated;

alter table private.lexicon_pending enable row level security;

create function private.queue_lexicon(p_notebook_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.lexicon_pending (notebook_id)
  select p_notebook_id
  where p_notebook_id is not null
    and not exists (select 1 from private.lexicon_pending q where q.notebook_id = p_notebook_id);
$$;

create function private.refresh_lexicon(p_notebook_id uuid) returns void
language plpgsql
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_user uuid;
  v_changed bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('lexicon:' || p_notebook_id::text, 0));

  select n.user_id into v_user from public.notebooks n where n.id = p_notebook_id;
  if not found then
    return;
  end if;

  with fresh as materialized (
    select f.form_key, f.form, f.occurrences, f.confirmed from private.lexicon_notebook(p_notebook_id) f
  ),
  removed as (
    delete from public.lexicon_entries e
    where e.notebook_id = p_notebook_id
      and not exists (select 1 from fresh f where f.form_key = e.form_key)
    returning 1
  ),
  written as (
    insert into public.lexicon_entries as e (notebook_id, user_id, form_key, form, occurrences, confirmed)
    select p_notebook_id, v_user, f.form_key, f.form, f.occurrences, f.confirmed from fresh f
    on conflict (notebook_id, form_key) do update
      set user_id = excluded.user_id, form = excluded.form, occurrences = excluded.occurrences, confirmed = excluded.confirmed
      where (e.user_id, e.form, e.occurrences, e.confirmed)
        is distinct from (excluded.user_id, excluded.form, excluded.occurrences, excluded.confirmed)
    returning 1
  )
  select (select count(*) from removed) + (select count(*) from written) into v_changed;
end;
$$;

create function private.flush_lexicon() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  delete from private.lexicon_pending q where q.notebook_id = new.notebook_id;
  get diagnostics v_removed = row_count;
  if v_removed > 0 then
    perform private.refresh_lexicon(new.notebook_id);
  end if;
  return null;
end;
$$;

create constraint trigger lexicon_pending_flush
  after insert on private.lexicon_pending
  deferrable initially deferred
  for each row execute function private.flush_lexicon();

create function private.lexicon_page_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page uuid;
begin
  v_page := case when tg_op = 'DELETE' then old.page_id else new.page_id end;
  perform private.queue_lexicon(p.notebook_id) from public.pages p where p.id = v_page;
  return null;
end;
$$;

create function private.lexicon_pages_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.queue_lexicon(old.notebook_id);
  if tg_op = 'UPDATE' then
    perform private.queue_lexicon(new.notebook_id);
  end if;
  return null;
end;
$$;

create trigger page_texts_queue_lexicon
  after insert or update of text or delete on public.page_texts
  for each row execute function private.lexicon_page_changed();

create trigger corrections_queue_lexicon
  after insert or delete on public.corrections
  for each row execute function private.lexicon_page_changed();

create trigger page_gaps_queue_lexicon
  after insert or update or delete on public.page_gaps
  for each row execute function private.lexicon_page_changed();

create trigger pages_queue_lexicon_moved
  after update of notebook_id, page_type on public.pages
  for each row execute function private.lexicon_pages_changed();

create trigger pages_queue_lexicon_deleted
  after delete on public.pages
  for each row execute function private.lexicon_pages_changed();

create function public.suggest_words(p_query text, p_notebook_id uuid default null)
returns table (word text, suggestion text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_words text[];
begin
  if v_user is null or p_query is null then
    return;
  end if;
  if char_length(p_query) > 100 then
    raise exception 'query_too_long' using errcode = '22023';
  end if;

  select array_agg(u.lexeme order by u.positions[1], u.lexeme)
  into v_words
  from unnest(to_tsvector('public.search_simple'::regconfig, p_query)) u;

  if v_words is null then
    return;
  end if;
  if cardinality(v_words) > 8 then
    raise exception 'query_too_many_words' using errcode = '22023';
  end if;

  perform set_config('pg_trgm.similarity_threshold', '0.5', true);

  return query
  select w.lexeme, best.form
  from unnest(v_words) as w(lexeme)
  cross join lateral (
    select e.form
    from public.lexicon_entries e
    where e.user_id = v_user
      and (p_notebook_id is null or e.notebook_id = p_notebook_id)
      and char_length(w.lexeme) >= 4
      and e.form_key operator(extensions.%) w.lexeme
      and e.form_key <> w.lexeme
    order by extensions.similarity(e.form_key, w.lexeme) desc, e.confirmed desc, e.occurrences desc, e.form_key
    limit 1
  ) best
  where not exists (
    select 1
    from public.page_texts t
    join public.pages p on p.id = t.page_id and p.user_id = v_user
    where t.user_id = v_user
      and p.uploaded_at is not null
      and (p_notebook_id is null or p.notebook_id = p_notebook_id)
      and to_tsvector('public.search_simple'::regconfig, t.text)
        @@ ('''' || replace(replace(w.lexeme, '\', '\\'), '''', '''''') || '''')::tsquery
  )
  order by w.lexeme;
end;
$$;

revoke all on function public.suggest_words(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.suggest_words(text, uuid) to authenticated;

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

insert into private.lexicon_pending (notebook_id)
select distinct p.notebook_id
from public.pages p
join public.page_texts t on t.page_id = p.id;

drop function public.delete_notebook(uuid, uuid);

create function public.delete_notebook(p_notebook_id uuid, p_user_id uuid)
returns table (outcome text, page_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if p_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  end if;

  perform 1 from public.notebooks n
  where n.id = p_notebook_id and p_user_id is not null and n.user_id = p_user_id
  for no key update;
  if not found then
    return query select 'notebook_not_found'::text, '{}'::uuid[];
    return;
  end if;

  perform 1 from public.pages p where p.notebook_id = p_notebook_id order by p.id for update;
  if exists (select 1 from public.pages p where p.notebook_id = p_notebook_id and p.status = 'processing') then
    return query select 'page_processing'::text, '{}'::uuid[];
    return;
  end if;

  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[]) into v_ids
  from public.pages p where p.notebook_id = p_notebook_id;

  delete from public.notebooks n where n.id = p_notebook_id;

  return query select 'deleted'::text, v_ids;
end;
$$;

revoke all on function public.delete_notebook(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_notebook(uuid, uuid) to service_role;
