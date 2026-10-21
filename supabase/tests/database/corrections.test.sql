begin;

select plan(69);

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

create function pg_temp.as_server() returns void
language sql as $$
  select set_config('role', 'service_role', true);
$$;

create function pg_temp.as_anon() returns void
language sql as $$
  select set_config('role', 'anon', true);
$$;

create function pg_temp.shown(page uuid) returns text
language sql as $$
  select text from public.page_texts where page_id = page;
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Second');

insert into public.pages (id, user_id, notebook_id, status, page_type) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text'),
  ('55555555-5555-5555-5555-555555555555', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'read', 'text'),
  ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text');

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'B1', E'Bonjour Paul,\nje suis a Paris.', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'B1', 'Autre mot', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'B1', 'Ancien mot', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500);

insert into public.page_texts (user_id, page_id, text, pipeline_version) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', E'Bonjour Paul,\nje suis a Paris.', 'b1-raw'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'Autre mot', 'b1-raw'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'Ancien mot', 'b1-raw');

insert into public.page_tokens (user_id, page_id, token_index, line_index, text, rule, channel, review_status, reading_a, reading_b1, reading_b2, b1_start, b1_end) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 0, 0, 'Bonjour', null, null, null, 'Bonjonr', 'Bonjour', 'Bonjour', 0, 7),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 1, 0, 'Paul', null, null, null, null, 'Paul', 'Paul', 8, 12),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 2, 1, 'je', null, null, null, 'je', 'je', null, 14, 16),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 3, 1, 'suis', 2, 'queue', 'pending', 'suit', 'suis', 'suis', 17, 21),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 4, 1, E'à', 4, 'layer', null, E'à', 'a', 'a', 22, 23),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 5, 1, 'Paris', 2, 'queue', null, 'Paris', 'Paris', 'Paris', 24, 29),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 0, 0, 'Autre', null, null, null, 'Autre', 'Autre', 'Autre', 0, 5),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 0, 0, 'Ancien', null, null, null, 'Ancien', 'Ancien', null, null, null);

insert into public.pages (id, user_id, notebook_id, status, page_type) values
  ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text');

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777', 'B1', string_agg('ab', ' '), 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500
from generate_series(0, 24);

insert into public.page_texts (user_id, page_id, text, pipeline_version)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777', string_agg('ab', ' '), 'b1-raw'
from generate_series(0, 24);

insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, b1_start, b1_end)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777', g, 0, 'ab', 'ab', g * 3, g * 3 + 2
from generate_series(0, 24) g;

insert into public.pages (id, user_id, notebook_id, status, page_type) values
  ('88888888-8888-8888-8888-888888888888', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text');

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '88888888-8888-8888-8888-888888888888', 'B1', E'\n  caf' || chr(233) || ' ' || chr(128512) || ' ok', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500);

insert into public.page_texts (user_id, page_id, text, pipeline_version) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '88888888-8888-8888-8888-888888888888', E'\n  caf' || chr(233) || ' ' || chr(128512) || ' ok', 'b1-raw');

insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, b1_start, b1_end) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '88888888-8888-8888-8888-888888888888', 0, 1, 'caf' || chr(233), 'caf' || chr(233), 3, 7),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '88888888-8888-8888-8888-888888888888', 1, 1, chr(128512), chr(128512), 8, 9),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '88888888-8888-8888-8888-888888888888', 2, 1, 'ok', 'ok', 10, 12);

select is(
  (select review_status from public.page_tokens where page_id = '44444444-4444-4444-4444-444444444444' and token_index = 5),
  'pending',
  'a position decided for the queue starts pending, without the server naming a status'
);

select is(
  (select count(*) from public.page_tokens where page_id = '44444444-4444-4444-4444-444444444444' and channel is distinct from 'queue' and review_status is not null),
  0::bigint,
  'only the positions of the queue carry a status'
);

select throws_ok(
  $$update public.page_tokens set channel = 'layer' where page_id = '44444444-4444-4444-4444-444444444444' and token_index = 3$$,
  '23514', null, 'a position cannot leave the queue and keep its status'
);

select throws_ok(
  $$update public.page_tokens set review_status = 'done' where page_id = '44444444-4444-4444-4444-444444444444' and token_index = 3$$,
  '23514', null, 'a status that does not exist is refused'
);

select throws_ok(
  $$update public.page_tokens set review_status = 'confirmed' where page_id = '44444444-4444-4444-4444-444444444444' and token_index = 4$$,
  '23514', null, 'a position outside the queue cannot take a status'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, reading_b2)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', '')$$,
  '23514', null, 'a reading of B2 that is empty is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, b1_start)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', 3)$$,
  '23514', null, 'a place with a start and no end is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, b1_start, b1_end)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', 3, 3)$$,
  '23514', null, 'an empty place is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, b1_start, b1_end)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', -1, 3)$$,
  '23514', null, 'a place before the start of B1 is refused'
);

select private.recompute_page_text('44444444-4444-4444-4444-444444444444');

select is(
  pg_temp.shown('44444444-4444-4444-4444-444444444444'),
  E'Bonjour Paul,\nje suis à Paris.',
  'the shown text is B1 with the word a rule rewrote, and nothing else'
);

select is(
  pg_temp.shown('66666666-6666-6666-6666-666666666666'),
  'Ancien mot',
  'a page whose positions carry no place keeps its text as it was'
);

select is(has_table_privilege('authenticated', 'public.corrections', 'select'), true, 'a user can read corrections');
select is(has_column_privilege('authenticated', 'public.corrections', 'corrected_text', 'insert'), true, 'a user can write the corrected word');
select is(has_column_privilege('authenticated', 'public.corrections', 'previous_text', 'insert'), false, 'a user cannot write the word shown before');
select is(has_column_privilege('authenticated', 'public.corrections', 'revision', 'insert'), false, 'a user cannot write the order of corrections');
select is(has_column_privilege('authenticated', 'public.corrections', 'user_id', 'insert'), false, 'a user cannot name the owner of a correction');
select is(has_table_privilege('authenticated', 'public.corrections', 'update'), false, 'a user cannot change a correction');
select is(has_table_privilege('authenticated', 'public.corrections', 'delete'), false, 'a user cannot erase a correction');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select lives_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 1, 'Pavel', 'keyboard')$$,
  'a user corrects a word of their page from the keyboard'
);

select is(
  pg_temp.shown('44444444-4444-4444-4444-444444444444'),
  E'Bonjour Pavel,\nje suis à Paris.',
  'the shown text changes at the corrected word only, the line break included'
);

select is(
  (select row(previous_text, revision, from_queue, user_id)::text from public.corrections where token_index = 1),
  '(Paul,1,f,aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)',
  'the correction keeps the word shown before, its rank and its owner'
);

select lives_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 1, 'Paul', 'B1')$$,
  'a user undoes a correction by correcting back to the previous reading'
);

select is(
  pg_temp.shown('44444444-4444-4444-4444-444444444444'),
  E'Bonjour Paul,\nje suis à Paris.',
  'the shown text gives the previous word back'
);

select is(
  (select array_agg(row(previous_text, corrected_text, revision)::text order by revision) from public.corrections where token_index = 1),
  array['(Paul,Pavel,1)', '(Pavel,Paul,2)'],
  'both corrections are kept: a correction only adds'
);

select is(
  (select count(*) from public.readings where page_id = '44444444-4444-4444-4444-444444444444'),
  1::bigint,
  'no reading was written or erased by a correction'
);

select is(
  (select raw_text from public.readings where page_id = '44444444-4444-4444-4444-444444444444'),
  E'Bonjour Paul,\nje suis a Paris.',
  'the reading of B1 is never rewritten'
);

select is(
  (select row(text, reading_a, reading_b1, reading_b2)::text from public.page_tokens where page_id = '44444444-4444-4444-4444-444444444444' and token_index = 1),
  '(Paul,,Paul,Paul)',
  'the readings of a position are never rewritten'
);

select lives_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 0, 'Bonjonr', 'A')$$,
  'a user takes the reading of A as a suggestion'
);

select lives_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 4, 'a', 'B2')$$,
  'a user takes the reading of B2 as a suggestion, against the word a rule had written'
);

select is(
  pg_temp.shown('44444444-4444-4444-4444-444444444444'),
  E'Bonjonr Paul,\nje suis a Paris.',
  'the last correction of each position shows, whatever the rules wrote'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 1, 'Pablo', 'A')$$,
  '23514', null, 'a position A did not read cannot be corrected with a reading of A'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 2, 'jeu', 'B2')$$,
  '23514', null, 'a position B2 did not read cannot be corrected with a reading of B2'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 0, 'Bonsoir', 'B1')$$,
  '23514', null, 'a word that is not the reading it claims to come from is refused'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 0, 'Bonsoir', 'google')$$,
  '23514', null, 'a source that does not exist is refused'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 0, '', 'keyboard')$$,
  '23514', null, 'an empty word is refused'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 0, 'two words', 'keyboard')$$,
  '23514', null, 'a correction is one word: a space is refused'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 0, E'one\nline', 'keyboard')$$,
  '23514', null, 'a correction cannot add a line break'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 0, E'no break', 'keyboard')$$,
  '23514', null, 'a no-break space is refused as a space'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 0, repeat('m', 101), 'keyboard')$$,
  '23514', null, 'a word of more than 100 characters is refused'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 99, 'Bonsoir', 'keyboard')$$,
  '23503', null, 'a position that does not exist cannot be corrected'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('66666666-6666-6666-6666-666666666666', 0, 'Nouveau', 'keyboard')$$,
  '23514', null, 'a position with no place in B1 cannot be corrected, as its correction could not be shown'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('55555555-5555-5555-5555-555555555555', 0, 'Pirate', 'keyboard')$$,
  '23503', null, 'a user cannot correct the page of another user'
);

select throws_ok(
  $$insert into public.corrections (user_id, page_id, token_index, corrected_text, chosen_from)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 0, 'Pirate', 'keyboard')$$,
  '42501', null, 'a user cannot name another owner for a correction'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from, previous_text)
    values ('44444444-4444-4444-4444-444444444444', 0, 'Bonsoir', 'keyboard', 'forged')$$,
  '42501', null, 'a user cannot write the word shown before'
);

select throws_ok(
  $$update public.corrections set corrected_text = 'Changed'$$,
  '42501', null, 'a user cannot change a correction'
);

select throws_ok(
  $$delete from public.corrections$$,
  '42501', null, 'a user cannot erase a correction'
);

select lives_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from, from_queue)
    values ('44444444-4444-4444-4444-444444444444', 3, 'suit', 'A', true)$$,
  'a user corrects a position of the queue'
);

select lives_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from, from_queue)
    values ('44444444-4444-4444-4444-444444444444', 5, 'Paris', 'B1', true)$$,
  'a user keeps the word of a position of the queue'
);

select is(
  (select array_agg(row(token_index, review_status)::text order by token_index) from public.page_tokens where channel = 'queue'),
  array['(3,corrected)', '(5,confirmed)'],
  'the status of a position of the queue follows the correction: changed or kept'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    select '44444444-4444-4444-4444-444444444444', 2, 'w' || g, 'keyboard' from generate_series(1, 101) g$$,
  '23514', null, 'a position takes 100 corrections at most'
);

select is(
  (select count(*) from public.corrections where token_index = 2),
  0::bigint,
  'the refused batch left no correction behind'
);

select lives_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('88888888-8888-8888-8888-888888888888', 2, 'OK', 'keyboard')$$,
  'a user corrects a word on a page with accents, an emoji and a leading line break'
);

select is(
  pg_temp.shown('88888888-8888-8888-8888-888888888888'),
  E'\n  caf' || chr(233) || ' ' || chr(128512) || ' OK',
  'places count characters, not bytes: only the corrected word changed'
);

select throws_ok(
  format($$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 0, %L, 'keyboard')$$, 'a' || chr(8205) || 'b'),
  '23514', null, 'a zero-width joiner inside a word is refused'
);

select throws_ok(
  format($$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 0, %L, 'keyboard')$$, 'a' || chr(8238) || 'b'),
  '23514', null, 'a right-to-left override inside a word is refused'
);

select throws_ok(
  format($$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 0, %L, 'keyboard')$$, 'a' || chr(173) || 'b'),
  '23514', null, 'a soft hyphen inside a word is refused'
);

select throws_ok(
  format($$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('44444444-4444-4444-4444-444444444444', 0, %L, 'keyboard')$$, chr(10240)),
  '23514', null, 'a braille blank taken for a word is refused'
);

select is(
  (select from_queue from public.corrections where page_id = '44444444-4444-4444-4444-444444444444' and token_index = 3),
  true,
  'a correction made from the queue on a pending position keeps its mark'
);

select lives_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from, from_queue)
    values ('44444444-4444-4444-4444-444444444444', 0, 'Bonjour', 'B1', true)$$,
  'a user can claim a queue origin for any correction'
);

select is(
  (select from_queue from public.corrections where page_id = '44444444-4444-4444-4444-444444444444' and token_index = 0 and corrected_text = 'Bonjour'),
  false,
  'the mark is dropped when the position is not waiting in the queue'
);

select lives_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    select '77777777-7777-7777-7777-777777777777', g % 25, 'x' || g, 'keyboard' from generate_series(1, 2000) g$$,
  'a page takes 2000 corrections'
);

select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('77777777-7777-7777-7777-777777777777', 0, 'one', 'keyboard')$$,
  '23514', null, 'the 2001st correction of a page is refused'
);

reset role;

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is((select count(*) from public.corrections), 0::bigint, 'another user reads none of the corrections of a user');

select lives_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
    values ('55555555-5555-5555-5555-555555555555', 0, 'Autres', 'keyboard')$$,
  'another user corrects their own page'
);

reset role;

select pg_temp.as_anon();

select throws_ok('select count(*) from public.corrections', '42501', null, 'a visitor without an account cannot read corrections');

reset role;

select pg_temp.as_server();

select lives_ok(
  $$update public.corrections set from_queue = from_queue where false$$,
  'the server can write corrections'
);

reset role;

delete from public.pages where id = '44444444-4444-4444-4444-444444444444';

select is(
  (select count(*) from public.corrections where page_id = '44444444-4444-4444-4444-444444444444'),
  0::bigint,
  'deleting a page deletes its corrections'
);

delete from public.notebooks where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*) from public.corrections where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'deleting a notebook deletes the corrections of its pages'
);

delete from auth.users where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select is(
  (select count(*) from public.corrections),
  0::bigint,
  'deleting an account deletes its corrections'
);

select * from finish();

rollback;
