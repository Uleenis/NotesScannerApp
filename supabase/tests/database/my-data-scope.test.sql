begin;

select plan(15);

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

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Second');

insert into public.chapters (id, user_id, notebook_id, name) values
  ('33333333-3333-3333-3333-333333333331', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Chapter A'),
  ('33333333-3333-3333-3333-333333333332', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Chapter B');

insert into public.pages (id, user_id, notebook_id, status) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read'),
  ('55555555-5555-5555-5555-555555555555', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'read');

insert into public.lexicon_entries (notebook_id, user_id, form_key, form, occurrences, confirmed) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'magellan', 'Magellan', 2, false),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'autre', 'Autre', 2, false);

insert into public.page_charges (user_id, page_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555');

insert into public.page_images (user_id, page_id, kind, storage_path) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'original', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/44444444-4444-4444-4444-444444444444/original.jpg'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'original', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/55555555-5555-5555-5555-555555555555/original.jpg');

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'B1', 'Bonjour', 'gemini', '3.6', 'V0', 0, 1, 1, 1),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'B1', 'Secret', 'gemini', '3.6', 'V0', 0, 1, 1, 1);

insert into public.page_texts (user_id, page_id, text, pipeline_version) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'Bonjour', 'p1'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'Secret', 'p1');

insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_a, reading_b1, anchor_kind, anchor, b1_start, b1_end) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 0, 0, 'Bonjour', 'Bonjonr', 'Bonjour', 'word', array[10, 20, 90, 60], 0, 7),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 0, 0, 'Secret', null, 'Secret', 'word', array[10, 20, 90, 60], 0, 6);

insert into public.corrections (user_id, page_id, token_index, revision, previous_text, corrected_text, chosen_from) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 0, 1, 'Bonjonr', 'Bonjour', 'keyboard'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 0, 1, 'Secrte', 'Secret', 'keyboard');

insert into public.page_gaps (user_id, page_id, gap_index, text) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 0, 'ajout'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 0, 'secret');

insert into public.page_alerts (user_id, page_id, kind, details) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'missing_line', '{"line": 3}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'math_incomplete', '{"statements": []}');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is((select count(*) from (select id, interface_language, tier from public.profiles) q), 1::bigint, 'the export reads one profile, the account''s own');
select is((select count(*) from (select id, name, position, correction_level from public.notebooks) q), 1::bigint, 'the export reads only the notebooks of the account');
select is((select count(*) from (select id, notebook_id, name, position from public.chapters) q), 1::bigint, 'the export reads only the chapters of the account');
select is((select count(*) from (select notebook_id, form_key, form, occurrences, confirmed from public.lexicon_entries) q), 1::bigint, 'the export reads only the lexicon of the account');
select is((select count(*) from (select id, page_id, charged_at from public.page_charges) q), 1::bigint, 'the export reads only the charges of the account');
select is(
  (select count(*) from (select id, notebook_id, chapter_id, position, source, status, queue_reason, retry_count, captured_at, uploaded_at, read_at, page_type, language from public.pages) q),
  1::bigint,
  'the export reads only the pages of the account'
);
select is((select count(*) from (select id, page_id, kind, storage_path from public.page_images) q), 1::bigint, 'the export reads only the photo rows of the account');
select is(
  (select count(*) from (select id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms from public.readings) q),
  1::bigint,
  'the export reads only the readings of the account'
);
select is((select count(*) from (select page_id, text, pipeline_version from public.page_texts) q), 1::bigint, 'the export reads only the texts of the account');
select is(
  (select count(*) from (select page_id, token_index, line_index, text, rule, channel, reading_a, reading_b1, reading_b2, review_status, anchor_kind, anchor, b1_start, b1_end from public.page_tokens) q),
  1::bigint,
  'the export reads only the positions of the account'
);
select is(
  (select count(*) from (select id, page_id, token_index, revision, previous_text, corrected_text, chosen_from, from_queue, created_at from public.corrections) q),
  1::bigint,
  'the export reads only the corrections of the account'
);
select is((select count(*) from (select page_id, gap_index, text from public.page_gaps) q), 1::bigint, 'the export reads only the edited text of the account');
select is((select count(*) from (select id, page_id, kind, details, created_at from public.page_alerts) q), 1::bigint, 'the export reads only the alerts of the account');

select is(
  (select count(*) from public.readings where page_id = '55555555-5555-5555-5555-555555555555'),
  0::bigint,
  'asking for the page of another account by its identifier returns nothing'
);

reset role;

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select array_agg(raw_text) from public.readings where page_id = any (array['44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555']::uuid[])),
  array['Secret'],
  'asking for several pages at once returns only the pages of the account'
);

select * from finish();

rollback;
