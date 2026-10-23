create extension if not exists unaccent with schema extensions;

create text search configuration public.search_simple (copy = pg_catalog.simple);

alter text search configuration public.search_simple
  alter mapping for asciiword, word, numword, hword_asciipart, hword_part, hword_numpart
  with extensions.unaccent, pg_catalog.simple;

alter text search configuration public.search_simple
  drop mapping for asciihword, hword, numhword;

create index page_texts_search_idx on public.page_texts
  using gin (to_tsvector('public.search_simple'::regconfig, text));

create index page_tokens_search_idx on public.page_tokens
  using gin (to_tsvector('public.search_simple'::regconfig, coalesce(reading_a, '') || ' ' || reading_b1 || ' ' || coalesce(reading_b2, '')));

create index readings_search_idx on public.readings
  using gin (to_tsvector('public.search_simple'::regconfig, raw_text))
  where label in ('B1', 'B2');

create function public.search_pages(p_query text, p_notebook_id uuid default null)
returns table (
  page_id uuid,
  notebook_id uuid,
  rank smallint,
  token_index integer,
  excerpt text,
  match_start integer,
  match_end integer,
  also_read text
)
language plpgsql
stable
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

  return query execute $sql$
    with words as (
      select
        w.ord,
        w.lexeme,
        (
          '''' || replace(replace(w.lexeme, '\', '\\'), '''', '''''') || ''''
        )::tsquery as q
      from unnest($1) with ordinality as w(lexeme, ord)
    ),
    hits as (
      select w.ord, t.page_id, true as in_text
      from words w
      join public.page_texts t
        on t.user_id = $2
       and to_tsvector('public.search_simple'::regconfig, t.text) @@ w.q
      union all
      select w.ord, k.page_id, false
      from words w
      join public.page_tokens k
        on k.user_id = $2
       and to_tsvector(
             'public.search_simple'::regconfig,
             coalesce(k.reading_a, '') || ' ' || k.reading_b1 || ' ' || coalesce(k.reading_b2, '')
           ) @@ w.q
      union all
      select w.ord, r.page_id, false
      from words w
      join public.readings r
        on r.user_id = $2
       and r.label in ('B1', 'B2')
       and to_tsvector('public.search_simple'::regconfig, r.raw_text) @@ w.q
    ),
    counted as (
      select
        h.page_id,
        count(distinct h.ord) as n_all,
        count(distinct h.ord) filter (where h.in_text) as n_text
      from hits h
      group by h.page_id
    ),
    found as (
      select
        p.id as page_id,
        p.notebook_id,
        p.captured_at,
        (case when c.n_text = $3 then 1 else 2 end)::smallint as rank,
        t.text as shown
      from counted c
      join public.pages p on p.id = c.page_id and p.user_id = $2
      join public.page_texts t on t.page_id = p.id and t.user_id = $2
      where p.uploaded_at is not null
        and ($4::uuid is null or p.notebook_id = $4::uuid)
        and (c.n_text = $3 or (c.n_all = $3 and p.page_type <> 'math'))
      order by 4, p.captured_at desc, p.id desc
      limit 50
    ),
    located as (
      select
        f.page_id,
        f.notebook_id,
        f.captured_at,
        f.rank,
        f.shown,
        tg.q,
        pos.token_index,
        pos.line_index,
        pos.b1_start,
        pos.form,
        b.raw_text as b1
      from found f
      left join lateral (
        select w.q
        from words w
        where f.rank = 1
           or not (to_tsvector('public.search_simple'::regconfig, f.shown) @@ w.q)
        order by w.ord
        limit 1
      ) tg on true
      left join lateral (
        select k.token_index, k.line_index, k.b1_start,
          case
            when to_tsvector('public.search_simple'::regconfig, coalesce(k.reading_a, '')) @@ tg.q then k.reading_a
            when to_tsvector('public.search_simple'::regconfig, k.reading_b1) @@ tg.q then k.reading_b1
            else k.reading_b2
          end as form
        from public.page_tokens k
        left join lateral (
          select x.corrected_text
          from public.corrections x
          where x.page_id = k.page_id and x.user_id = $2 and x.token_index = k.token_index
          order by x.revision desc
          limit 1
        ) c on true
        where k.page_id = f.page_id
          and k.user_id = $2
          and case
                when f.rank = 1 then
                  to_tsvector('public.search_simple'::regconfig, coalesce(c.corrected_text, k.text)) @@ tg.q
                else
                  to_tsvector(
                    'public.search_simple'::regconfig,
                    coalesce(k.reading_a, '') || ' ' || k.reading_b1 || ' ' || coalesce(k.reading_b2, '')
                  ) @@ tg.q
              end
        order by k.token_index
        limit 1
      ) pos on true
      left join lateral (
        select r.raw_text
        from public.readings r
        where r.page_id = f.page_id and r.user_id = $2 and r.label = 'B1'
        limit 1
      ) b on true
    ),
    lined as (
      select
        l.*,
        case
          when l.rank = 1 then
            (
              select s.line
              from regexp_split_to_table(l.shown, E'\n') with ordinality as s(line, n)
              where to_tsvector('public.search_simple'::regconfig, s.line) @@ l.q
              order by s.n
              limit 1
            )
          when l.token_index is null then
            (
              select s.line
              from public.readings r
              cross join lateral regexp_split_to_table(r.raw_text, E'\n') with ordinality as s(line, n)
              where r.page_id = l.page_id
                and r.user_id = $2
                and r.label in ('B1', 'B2')
                and to_tsvector('public.search_simple'::regconfig, s.line) @@ l.q
              order by r.label, s.n
              limit 1
            )
        end as marked,
        case
          when l.rank = 2 and l.token_index is not null then
            case
              when l.b1 is not null and l.b1_start is not null then
                (
                  select
                    case
                      when char_length(l.shown) - char_length(replace(l.shown, E'\n', ''))
                         = char_length(l.b1) - char_length(replace(l.b1, E'\n', ''))
                      then nullif(split_part(l.shown, E'\n', n.lines + 1), '')
                    end
                  from (
                    select char_length(left(l.b1, l.b1_start)) - char_length(replace(left(l.b1, l.b1_start), E'\n', '')) as lines
                  ) n
                )
            end
        end as shown_line,
        case
          when l.rank = 2 and l.token_index is not null and l.b1 is not null then
            nullif(
              split_part(
                l.b1,
                E'\n',
                case
                  when l.b1_start is not null
                    then char_length(left(l.b1, l.b1_start)) - char_length(replace(left(l.b1, l.b1_start), E'\n', '')) + 1
                  else l.line_index + 1
                end
              ),
              ''
            )
        end as reading_line
      from located l
    )
    select
      d.page_id,
      d.notebook_id,
      d.rank,
      d.token_index,
      left(coalesce(d.marked, d.shown_line, d.reading_line, d.form), 4000) as excerpt,
      case when d.headline is not null and position(chr(1) in d.headline) > 0
        then position(chr(1) in d.headline) - 1 end as match_start,
      case when d.headline is not null and position(chr(1) in d.headline) > 0
        then position(chr(2) in d.headline) - 2 end as match_end,
      case
        when d.rank = 1 then null
        when d.token_index is not null then d.form
        when d.headline is not null and position(chr(1) in d.headline) > 0
          then substr(
            d.headline,
            position(chr(1) in d.headline) + 1,
            position(chr(2) in d.headline) - position(chr(1) in d.headline) - 1
          )
      end as also_read
    from (
      select
        n.*,
        case when n.marked is not null then
          ts_headline(
            'public.search_simple'::regconfig,
            translate(left(n.marked, 4000), chr(1) || chr(2), '  '),
            n.q,
            'StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', HighlightAll=TRUE'
          )
        end as headline
      from lined n
    ) d
    order by d.rank, d.captured_at desc, d.page_id desc
  $sql$
  using v_words, v_user, cardinality(v_words), p_notebook_id;
end;
$$;

revoke all on function public.search_pages(text, uuid) from public, anon, authenticated;
grant execute on function public.search_pages(text, uuid) to authenticated;
