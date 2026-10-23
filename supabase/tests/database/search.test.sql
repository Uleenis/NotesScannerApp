begin;

select plan(58);

create function pg_temp.make_user(uid uuid) returns void
language sql as $$
  insert into auth.users (id, email) values (uid, uid::text || '@example.test');
$$;

create function pg_temp.login(uid uuid) returns void
language sql as $$
  select
    set_config('role', 'authenticated', true),
    set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.as_anon() returns void
language sql as $$
  select set_config('role', 'anon', true);
$$;

create function pg_temp.hits(q text, nb uuid default null) returns text
language sql as $$
  select coalesce(string_agg(substr(s.page_id::text, 1, 8) || ':' || s.rank, ',' order by s.rank, s.page_id), '')
  from public.search_pages(q, nb) s;
$$;

create function pg_temp.add_page(
  pid uuid, uid uuid, nb uuid, shown text, b1 text, b2 text default null, kind text default 'text',
  captured timestamptz default '2026-01-01 12:00:00+00', uploaded boolean default true
) returns void
language plpgsql as $$
begin
  insert into public.pages (id, user_id, notebook_id, status, page_type, captured_at, uploaded_at)
  values (pid, uid, nb, 'read', kind, captured, case when uploaded then captured end);
  insert into public.page_texts (user_id, page_id, text, pipeline_version) values (uid, pid, shown, 'b1-raw');
  if b1 is not null then
    insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
    values (uid, pid, 'B1', b1, 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500);
  end if;
  if b2 is not null then
    insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
    values (uid, pid, 'B2', b2, 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500);
  end if;
end;
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Third'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Second');

select pg_temp.add_page('c0000001-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  E'Magellan a traversé\nle détroit', E'Magellan a traversé\nle détroit');

select pg_temp.add_page('c0000002-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Magelan est parti', 'Magelan est parti', 'Magellan est parti');
insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_a, reading_b1, reading_b2, b1_start, b1_end, anchor_kind, anchor) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000002-0000-0000-0000-000000000000', 0, 0, 'Magelan', 'Magelan', 'Magelan', 'Magellan', 0, 7, 'word', array[10, 20, 90, 60]),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000002-0000-0000-0000-000000000000', 1, 0, 'est', 'est', 'est', 'est', 8, 11, 'word', array[100, 20, 140, 60]),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000002-0000-0000-0000-000000000000', 2, 0, 'parti', 'parti', 'parti', 'parti', 12, 17, 'word', array[150, 20, 220, 60]);

select pg_temp.add_page('c0000003-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Magelan seul', 'Magelan seul', E'Autre ligne\nMagellan seul');

select pg_temp.add_page('c0000004-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  '<u>mot</u> simple', '<u>mot</u> simple');

select pg_temp.add_page('c0000005-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Paul Magelan', 'Paul Magelan');
insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, reading_b2, b1_start, b1_end) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000005-0000-0000-0000-000000000000', 0, 0, 'Paul', 'Paul', 'Paul', 0, 4),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000005-0000-0000-0000-000000000000', 1, 0, 'Magelan', 'Magelan', 'Magellan', 5, 12);

select pg_temp.add_page('c0000006-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Paul Magellan', 'Paul Magellan');

select pg_temp.add_page('c0000007-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Soit $\frac{x}{y}$ quartz', 'Soit $\frac{x}{y}$ quartz', null, 'math');
select pg_temp.add_page('c0000008-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  '$x$', '$x$', 'lambda', 'math');

select pg_temp.add_page('c0000009-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Magellan jamais envoyé', 'Magellan jamais envoyé', null, 'text', '2026-01-01 12:00:00+00', false);

select pg_temp.add_page('c000000a-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
  'Magellan ailleurs', 'Magellan ailleurs');

select pg_temp.add_page('c000000b-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Je vais a Pans', 'Je vais a Pans', 'Je vais a Pans');
insert into public.page_tokens (user_id, page_id, token_index, line_index, text, rule, channel, reading_a, reading_b1, reading_b2, b1_start, b1_end) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c000000b-0000-0000-0000-000000000000', 0, 0, 'Je', null, null, 'Je', 'Je', 'Je', 0, 2),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c000000b-0000-0000-0000-000000000000', 1, 0, 'vais', null, null, 'vais', 'vais', 'vais', 3, 7),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c000000b-0000-0000-0000-000000000000', 2, 0, E'à', 4, 'layer', E'à', 'a', 'a', 8, 9),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c000000b-0000-0000-0000-000000000000', 3, 0, 'Paris', 3, 'layer', 'Paris', 'Pans', 'Pans', 10, 14);
update public.page_texts set text = E'Je vais à Paris' where page_id = 'c000000b-0000-0000-0000-000000000000';

select pg_temp.add_page('c000000c-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  E'ligne un\nextra\nMagelan deux', E'ligne un\nMagelan deux');
insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, reading_b2, b1_start, b1_end) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c000000c-0000-0000-0000-000000000000', 0, 0, 'ligne', 'ligne', 'ligne', 0, 5),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c000000c-0000-0000-0000-000000000000', 1, 0, 'un', 'un', 'un', 6, 8),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c000000c-0000-0000-0000-000000000000', 2, 1, 'Magelan', 'Magelan', 'Magellan', 9, 16),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c000000c-0000-0000-0000-000000000000', 3, 1, 'deux', 'deux', 'deux', 17, 21);

select pg_temp.add_page('d0000001-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222',
  'Magellan secret', 'Magellan secret', 'Magellan tresor');
insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, reading_b2, b1_start, b1_end) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'd0000001-0000-0000-0000-000000000000', 0, 0, 'Magellan', 'Magellan', 'Magellan', 0, 8),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'd0000001-0000-0000-0000-000000000000', 1, 0, 'secret', 'secret', 'tresor', 9, 15);

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is(pg_temp.hits('magellan', '11111111-1111-1111-1111-111111111111'),
  'c0000001:1,c0000006:1,c0000002:2,c0000003:2,c0000005:2,c000000c:2',
  'a word of the shown text finds the page at rank 1, a word read only by another reading at rank 2, and never both');

select is(pg_temp.hits('MAGELLAN', '11111111-1111-1111-1111-111111111111'), pg_temp.hits('magellan', '11111111-1111-1111-1111-111111111111'),
  'the case of the query is ignored');

select is(pg_temp.hits(E'DÉTROIT'), 'c0000001:1', 'the accents of the query are ignored');
select is(pg_temp.hits('detroit'), 'c0000001:1', 'the accents of the text are ignored');
select is(pg_temp.hits('Magel'), '', 'a word is found whole, never by its beginning');
select is(pg_temp.hits('mot'), 'c0000004:1', 'a word between underline tags is found');
select is(pg_temp.hits('u'), '', 'the tags of the text are not words');
select is(pg_temp.hits('paul magellan'), 'c0000006:1,c0000005:2', 'several words find only the pages that carry them all, each at its own rank');
select is(pg_temp.hits('magellan paul detroit'), '', 'a page missing one word is not found');
select is(pg_temp.hits('Paul-Magellan'), 'c0000006:1,c0000005:2', 'a hyphenated query finds the pages that carry its parts');

select is(pg_temp.hits('quartz'), 'c0000007:1', 'a page of math is found by its text, formulas included');
select is(pg_temp.hits('frac'), 'c0000007:1', 'the LaTeX of a page of math is searched');
select is(pg_temp.hits('lambda'), '', 'a page of math is never found by another reading');

select is(pg_temp.hits('jamais'), '', 'a page that is not uploaded is never found');

select is(pg_temp.hits('magellan', '33333333-3333-3333-3333-333333333333'), 'c000000a:1', 'the filter keeps the pages of one notebook');
select is(pg_temp.hits('magellan', '22222222-2222-2222-2222-222222222222'), '', 'the notebook of another user finds nothing');
select is(pg_temp.hits('magellan', '99999999-9999-9999-9999-999999999999'), '', 'a notebook that does not exist finds nothing');
select is(pg_temp.hits('secret'), '', 'a user never finds the page of another user by its text');
select is(pg_temp.hits('tresor'), '', 'a user never finds the page of another user by another reading');

select is((select count(*) from public.search_pages('')), 0::bigint, 'an empty query finds nothing');
select is((select count(*) from public.search_pages('   ')), 0::bigint, 'a query of spaces finds nothing');
select is((select count(*) from public.search_pages('?!')), 0::bigint, 'a query with no word finds nothing');
select is((select count(*) from public.search_pages(null)), 0::bigint, 'no query finds nothing');

select throws_ok($$select * from public.search_pages(repeat('a', 101))$$, '22023', 'query_too_long', 'a query over 100 characters is refused');
select lives_ok($$select * from public.search_pages(repeat('a', 100))$$, 'a query of 100 characters is searched');
select throws_ok($$select * from public.search_pages('un deux trois quatre cinq six sept huit neuf')$$, '22023', 'query_too_many_words', 'a query of more than 8 words is refused');
select lives_ok($$select * from public.search_pages('un deux trois quatre cinq six sept huit')$$, 'a query of 8 words is searched');
select lives_ok($$select * from public.search_pages('un un un un un un un un un un')$$, 'a repeated word counts once');

select is((select excerpt from public.search_pages('magellan', '11111111-1111-1111-1111-111111111111') where page_id = 'c0000001-0000-0000-0000-000000000000'),
  E'Magellan a traversé', 'the excerpt of rank 1 is the line of the shown text that carries the word');
select is((select array[match_start, match_end] from public.search_pages('magellan', '11111111-1111-1111-1111-111111111111') where page_id = 'c0000001-0000-0000-0000-000000000000'),
  array[0, 8], 'the word is marked by its place in the excerpt');
select is((select excerpt || '|' || match_start || '|' || match_end from public.search_pages('detroit')),
  E'le détroit|3|10', 'the mark covers the word as written, accents included');
select is((select token_index from public.search_pages('detroit')), null, 'a page without positions has no position to frame');
select is((select also_read from public.search_pages('detroit')), null, 'rank 1 has no other reading');

select is((select excerpt from public.search_pages('magellan') where page_id = 'c0000002-0000-0000-0000-000000000000'),
  'Magelan est parti', 'the excerpt of rank 2 is the shown line at the place of the position');
select is((select token_index from public.search_pages('magellan') where page_id = 'c0000002-0000-0000-0000-000000000000'),
  0, 'rank 2 gives the position that carries the other reading');
select is((select also_read from public.search_pages('magellan') where page_id = 'c0000002-0000-0000-0000-000000000000'),
  'Magellan', 'rank 2 gives the form the other reading found');
select is((select match_start from public.search_pages('magellan') where page_id = 'c0000002-0000-0000-0000-000000000000'),
  null, 'no word is marked in a shown line that does not carry the word');

select is((select excerpt || '|' || coalesce(token_index::text, '-') || '|' || also_read || '|' || match_start || '|' || match_end
  from public.search_pages('magellan') where page_id = 'c0000003-0000-0000-0000-000000000000'),
  'Magellan seul|-|Magellan|0|8', 'without a position, rank 2 shows the line of the other reading and marks the form');

select is((select excerpt from public.search_pages('magellan') where page_id = 'c000000c-0000-0000-0000-000000000000'),
  'Magelan deux', 'a page whose lines changed shows the line of B1 at the line of the position');

select is((select token_index from public.search_pages('paris')), 3, 'rank 1 gives the position whose shown word is the word found');
select is((select excerpt || '|' || match_start || '|' || match_end from public.search_pages('paris')),
  E'Je vais à Paris|10|15', 'the shown word of a position is the word a rule wrote');
select is((select token_index || '|' || rank || '|' || also_read from public.search_pages('pans')),
  '3|2|Pans', 'a reading replaced by a rule is found at rank 2');

select is((select count(*) from public.search_pages('pans')), 1::bigint, 'a page is listed once however many readings carry the word');

insert into public.corrections (page_id, token_index, corrected_text, chosen_from, from_queue)
values ('c000000b-0000-0000-0000-000000000000', 1, 'vois', 'keyboard', false);

select is((select token_index || '|' || rank from public.search_pages('vois')), '1|1', 'a corrected word is the shown word of its position');
select is((select token_index || '|' || rank || '|' || also_read || '|' || excerpt from public.search_pages('vais')),
  E'1|2|vais|Je vois à Paris', 'the word a correction replaced is found at rank 2 on the line that now shows the correction');

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(pg_temp.hits('magellan'), 'd0000001:1', 'another user finds only their own page');
select is(pg_temp.hits('tresor'), 'd0000001:2', 'another user finds their own other readings');

reset role;

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is((select count(*) from public.search_pages('Magellan', null) s where s.page_id in ('d0000001-0000-0000-0000-000000000000')), 0::bigint,
  'the page of another user never appears in a result');

reset role;

insert into public.pages (id, user_id, notebook_id, status, page_type, captured_at, uploaded_at)
select ('e0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'read', 'text',
  '2026-02-01 00:00:00+00'::timestamptz + g * interval '1 day', '2026-02-01 00:00:00+00'::timestamptz + g * interval '1 day'
from generate_series(1, 60) g;

insert into public.page_texts (user_id, page_id, text, pipeline_version)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ('e0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, case when g <= 40 then 'zebra' else 'rien' end, 'b1-raw'
from generate_series(1, 60) g;

insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, reading_b2)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ('e0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 0, 0, 'rien', 'rien', 'zebra'
from generate_series(41, 60) g;

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is((select count(*) from public.search_pages('zebra')), 50::bigint, 'an answer holds 50 pages at most');
select is((select count(*) from public.search_pages('zebra') where rank = 1), 40::bigint, 'the pages of rank 1 come first and are all kept');
select is((select count(*) from (select rank, row_number() over () as n from public.search_pages('zebra')) s where (n <= 40) <> (rank = 1)), 0::bigint,
  'the pages of rank 1 are listed before those of rank 2');
select is((select page_id from public.search_pages('zebra') limit 1), 'e0000000-0000-0000-0000-000000000040'::uuid, 'the most recent page of a rank comes first');
select is((select page_id from public.search_pages('zebra') where rank = 2 limit 1), 'e0000000-0000-0000-0000-000000000060'::uuid, 'the most recent page of rank 2 comes first in its rank');

reset role;

select is(has_function_privilege('anon', 'public.search_pages(text, uuid)', 'execute'), false, 'a visitor cannot search');
select is(has_function_privilege('authenticated', 'public.search_pages(text, uuid)', 'execute'), true, 'a signed-in user can search');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.search_pages(text, uuid)'::regprocedure), true,
  'the search runs with the rights of its owner and an empty search path, and keeps the pages of the caller by hand');

select pg_temp.as_anon();
select throws_ok($$select * from public.search_pages('magellan')$$, '42501', null, 'a visitor without an account is refused');
reset role;

select is(
  (select count(*) from pg_indexes where schemaname = 'public' and indexdef like '%USING gin%' and indexname in ('page_texts_search_idx', 'page_tokens_search_idx', 'readings_search_idx')),
  3::bigint, 'the shown text, the positions and the raw readings each have a full-text index'
);

select * from finish();

rollback;
