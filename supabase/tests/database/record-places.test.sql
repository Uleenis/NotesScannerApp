begin;

select plan(16);

create function pg_temp.make_user(uid uuid) returns void
language sql as $$
  insert into auth.users (id, email) values (uid, uid::text || '@example.test');
$$;

create function pg_temp.as_server() returns void
language sql as $$
  select set_config('role', 'service_role', true);
$$;

create function pg_temp.record(page uuid, tokens jsonb) returns text
language sql as $$
  select row(r.recorded, r.reason)::text
  from public.record_reading_a(
    page,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    E'Bonjour Paul',
    'medium',
    'zenodo-21788410',
    28000,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/' || page::text || '/a.xml',
    'fr',
    tokens
  ) r;
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First');

insert into public.pages (id, user_id, notebook_id, status, page_type) values
  ('a4000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text'),
  ('a4000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text'),
  ('a4000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text');

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', p.id, 'B1', 'Bonjour Paul', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500
from public.pages p where p.id in ('a4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002');

insert into public.page_texts (user_id, page_id, text, pipeline_version)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', p.id, 'Bonjour Paul', 'b1-raw'
from public.pages p where p.id in ('a4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000003');

select pg_temp.as_server();

select is(
  pg_temp.record('a4000000-0000-0000-0000-000000000001', '[
    {"token_index": 0, "line_index": 0, "text": "Bonsoir", "rule": 5, "channel": "layer", "reading_a": "Bonsoir", "reading_b1": "Bonjour", "reading_b2": "Bonsoir", "anchor_kind": "word", "anchor": [1, 2, 30, 40], "b1_start": 0, "b1_end": 7},
    {"token_index": 1, "line_index": 0, "text": "Paul", "rule": 2, "channel": "queue", "reading_a": "Pau1", "reading_b1": "Paul", "reading_b2": null, "anchor_kind": null, "anchor": null, "b1_start": 8, "b1_end": 12}
  ]'::jsonb),
  '(t,recorded)',
  'the server writes A with the readings of B2 and the place of each word in B1'
);

reset role;

select is(
  (select array_agg(row(token_index, reading_b2, b1_start, b1_end, review_status)::text order by token_index) from public.page_tokens where page_id = 'a4000000-0000-0000-0000-000000000001'),
  array['(0,Bonsoir,0,7,)', '(1,,8,12,pending)'],
  'the positions keep the reading of B2, their place and, for the queue, a pending status'
);

select is(
  (select text from public.page_texts where page_id = 'a4000000-0000-0000-0000-000000000001'),
  'Bonsoir Paul',
  'the shown text is recalculated when the positions are written'
);

select is(
  (select raw_text from public.readings where page_id = 'a4000000-0000-0000-0000-000000000001' and label = 'B1'),
  'Bonjour Paul',
  'the reading of B1 is left as it was'
);

select pg_temp.as_server();

select throws_ok(
  $$select pg_temp.record('a4000000-0000-0000-0000-000000000002', '[
    {"token_index": 0, "line_index": 0, "text": "Bonjour", "reading_b1": "Bonjour", "b1_start": 0, "b1_end": 8},
    {"token_index": 1, "line_index": 0, "text": "Paul", "reading_b1": "Paul", "b1_start": 7, "b1_end": 12}
  ]'::jsonb)$$,
  '23514', null, 'two words that overlap in B1 are refused'
);

select throws_ok(
  $$select pg_temp.record('a4000000-0000-0000-0000-000000000002', '[
    {"token_index": 0, "line_index": 0, "text": "Paul", "reading_b1": "Paul", "b1_start": 8, "b1_end": 12},
    {"token_index": 1, "line_index": 0, "text": "Bonjour", "reading_b1": "Bonjour", "b1_start": 0, "b1_end": 7}
  ]'::jsonb)$$,
  '23514', null, 'words whose places run against their rank are refused'
);

select throws_ok(
  $$select pg_temp.record('a4000000-0000-0000-0000-000000000002', '[
    {"token_index": 0, "line_index": 0, "text": "Bonjour", "reading_b1": "Bonjour", "b1_start": 0, "b1_end": 13}
  ]'::jsonb)$$,
  '23514', null, 'a place that runs past the end of B1 is refused'
);

select throws_ok(
  $$select pg_temp.record('a4000000-0000-0000-0000-000000000002', '[
    {"token_index": 0, "line_index": 0, "text": "Bonjour", "reading_b1": "Bonjour", "b1_start": 0, "b1_end": 7},
    {"token_index": 1, "line_index": 0, "text": "Paul", "reading_b1": "Paul"}
  ]'::jsonb)$$,
  '23514', null, 'a page where only some words have a place is refused'
);

select throws_ok(
  $$select pg_temp.record('a4000000-0000-0000-0000-000000000003', '[
    {"token_index": 0, "line_index": 0, "text": "Bonjour", "reading_b1": "Bonjour", "b1_start": 0, "b1_end": 7}
  ]'::jsonb)$$,
  '23514', null, 'places are refused on a page that has no reading of B1 to place them in'
);

reset role;

select is(
  (select count(*) from public.readings where page_id in ('a4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000003') and label = 'A')
    + (select count(*) from public.page_tokens where page_id in ('a4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000003')),
  0::bigint,
  'a refused write leaves neither A nor positions behind'
);

select is(
  (select text from public.page_texts where page_id in ('a4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000003') group by text),
  'Bonjour Paul',
  'a refused write leaves the shown text as it was'
);

select pg_temp.as_server();

select is(
  pg_temp.record('a4000000-0000-0000-0000-000000000002', '[
    {"token_index": 0, "line_index": 0, "text": "Bonjour", "reading_b1": "Bonjour"},
    {"token_index": 1, "line_index": 0, "text": "Paul", "reading_b1": "Paul"}
  ]'::jsonb),
  '(t,recorded)',
  'positions without places are still recorded, as in slice 2'
);

reset role;

select is(
  (select text from public.page_texts where page_id = 'a4000000-0000-0000-0000-000000000002'),
  'Bonjour Paul',
  'positions without places leave the shown text alone'
);

select is(
  (select count(*) from public.page_tokens where page_id = 'a4000000-0000-0000-0000-000000000002' and b1_start is null and b1_end is null and reading_b2 is null),
  2::bigint,
  'those positions hold no place and no reading of B2'
);

select throws_ok(
  $$update public.page_tokens set b1_start = 4, b1_end = 9 where page_id = 'a4000000-0000-0000-0000-000000000001' and token_index = 0$$,
  '23514', null, 'moving a place onto the next word is refused whatever writes it'
);

select throws_ok(
  $$select private.recompute_page_text('a4000000-0000-0000-0000-000000000099')$$,
  'P0002', null, 'the recalculation of a page that does not exist is refused'
);

select * from finish();

rollback;
