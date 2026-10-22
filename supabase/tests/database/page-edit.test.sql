begin;

select plan(68);

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

create function pg_temp.make_page(page uuid, uid uuid, kind text, state text, with_places boolean) returns void
language plpgsql as $$
declare
  v_raw text := case when kind = 'math' then '$x = 1$' else E'Bonjour Paul,\nje suis a Paris.' end;
begin
  insert into public.pages (id, user_id, notebook_id, status, page_type)
  values (page, uid, '11111111-1111-1111-1111-111111111111', state, kind);
  insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
  values (uid, page, 'B1', v_raw, 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500);
  insert into public.page_texts (user_id, page_id, text, pipeline_version) values (uid, page, v_raw, 'b1-raw');
  if kind = 'text' then
    insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_a, reading_b1, reading_b2, b1_start, b1_end)
    select uid, page, w.i, w.line, w.word, w.word, w.word, w.word,
      case when with_places then w.s end, case when with_places then w.e end
    from (values
      (0, 0, 'Bonjour', 0, 7),
      (1, 0, 'Paul', 8, 12),
      (2, 1, 'je', 14, 16),
      (3, 1, 'suis', 17, 21),
      (4, 1, 'a', 22, 23),
      (5, 1, 'Paris', 24, 29)
    ) as w (i, line, word, s, e);
  end if;
end;
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Second');

select pg_temp.make_page('e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'read', true);
select pg_temp.make_page('e1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'read', true);
select pg_temp.make_page('e1000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'read', true);
select pg_temp.make_page('e1000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'read', true);
select pg_temp.make_page('e1000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'read', true);
select pg_temp.make_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'read', true);
select pg_temp.make_page('e1000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'read', true);
select pg_temp.make_page('e1000000-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'read', true);
select pg_temp.make_page('e1000000-0000-0000-0000-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'read', false);
select pg_temp.make_page('e1000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'queued', true);
select pg_temp.make_page('e1000000-0000-0000-0000-00000000000b', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'unsupported_script', 'read', false);
select pg_temp.make_page('e1000000-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'math', 'read', false);
select pg_temp.make_page('e1000000-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'math', 'read', false);
select pg_temp.make_page('e1000000-0000-0000-0000-00000000000e', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'read', true);

select pg_temp.as_server();

select is(
  public.edit_page('e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', E'Bonjour Paul,\nje suis tres a Paris.', '[]', '[{"gap_index":4,"text":" tres "}]'),
  'edited',
  'an added word is edited'
);
select is(pg_temp.shown('e1000000-0000-0000-0000-000000000001'), E'Bonjour Paul,\nje suis tres a Paris.', 'the shown text has the added word');
select is((select count(*) from public.corrections where page_id = 'e1000000-0000-0000-0000-000000000001'), 0::bigint, 'an added word makes no correction');
select is((select text from public.page_gaps where page_id = 'e1000000-0000-0000-0000-000000000001' and gap_index = 4), ' tres ', 'the added word is kept as the text of the user');
select is(
  (select raw_text from public.readings where page_id = 'e1000000-0000-0000-0000-000000000001' and label = 'B1'),
  E'Bonjour Paul,\nje suis a Paris.',
  'the reading B1 is not overwritten'
);

select is(
  public.edit_page('e1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', E'Bonjour Pierre;\nje suis au Paris!', '[{"token_index":1,"text":"Pierre"},{"token_index":4,"text":"au"}]', '[{"gap_index":2,"text":";\n"},{"gap_index":6,"text":"!"}]'),
  'edited',
  'changed words, a changed punctuation and a line are edited'
);
select is(pg_temp.shown('e1000000-0000-0000-0000-000000000002'), E'Bonjour Pierre;\nje suis au Paris!', 'the shown text is the text of the user');
select is(
  (select array_agg(token_index || ':' || previous_text || '>' || corrected_text || ':' || chosen_from || ':' || user_id order by token_index) from public.corrections where page_id = 'e1000000-0000-0000-0000-000000000002'),
  array['1:Paul>Pierre:keyboard:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '4:a>au:keyboard:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
  'each changed word is a correction of its position, from the keyboard, for the owner'
);
select is((select count(*) from public.page_gaps where page_id = 'e1000000-0000-0000-0000-000000000002'), 2::bigint, 'the two changed gaps are kept');
select is(
  (select array_agg(reading_a || reading_b1 || reading_b2 order by token_index) from public.page_tokens where page_id = 'e1000000-0000-0000-0000-000000000002' and token_index in (1, 4)),
  array['PaulPaulPaul', 'aaa'],
  'no reading of a position is overwritten'
);

select is(
  public.edit_page('e1000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', E'Bonjour Paul,\n suis a Paris.', '[{"token_index":2,"text":""}]', '[]'),
  'edited',
  'a deleted word is edited'
);
select is(pg_temp.shown('e1000000-0000-0000-0000-000000000003'), E'Bonjour Paul,\n suis a Paris.', 'the shown text lacks the deleted word');
select is((select corrected_text from public.corrections where page_id = 'e1000000-0000-0000-0000-000000000003'), '', 'a deleted word is a correction with no text');

select is(
  public.edit_page('e1000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', E'Bonjour Pierre;\nje suis au Paris!', '[{"token_index":1,"text":"Pierre"},{"token_index":4,"text":"au"}]', '[{"gap_index":2,"text":";\n"},{"gap_index":6,"text":"!"}]'),
  'edited',
  'a page is edited before it is put back'
);
select is(
  public.edit_page('e1000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', E'Bonjour Paul,\nje suis a Paris.', '[{"token_index":1,"text":"Paul"},{"token_index":4,"text":"a"}]', '[{"gap_index":2,"text":",\n"},{"gap_index":6,"text":"."}]'),
  'edited',
  'the original text is put back'
);
select is(pg_temp.shown('e1000000-0000-0000-0000-000000000004'), E'Bonjour Paul,\nje suis a Paris.', 'the shown text is the original again');
select is((select count(*) from public.page_gaps where page_id = 'e1000000-0000-0000-0000-000000000004'), 0::bigint, 'a gap put back to the original text is no longer kept');
select is((select count(*) from public.corrections where page_id = 'e1000000-0000-0000-0000-000000000004'), 4::bigint, 'putting back adds corrections and removes none');

select is(
  public.edit_page('e1000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'something else', '[{"token_index":1,"text":"Pierre"}]', '[]'),
  'text_mismatch',
  'an edit that does not give the text asked for is refused'
);
select is(pg_temp.shown('e1000000-0000-0000-0000-000000000005'), E'Bonjour Paul,\nje suis a Paris.', 'a refused edit leaves the text');
select is(
  (select count(*) from public.corrections where page_id = 'e1000000-0000-0000-0000-000000000005')
    + (select count(*) from public.page_gaps where page_id = 'e1000000-0000-0000-0000-000000000005'),
  0::bigint,
  'a refused edit leaves no correction and no gap'
);

select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[]', '[{"gap_index":7,"text":"x"}]'), 'invalid_edit', 'a gap beyond the last is refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[]', '[{"gap_index":-1,"text":"x"}]'), 'invalid_edit', 'a negative gap is refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[{"token_index":1,"text":"a b"}]', '[]'), 'invalid_edit', 'a word with a space is refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[{"token_index":1,"text":"Pierre-Paul-Jean-Jacques-Marie-Joseph-Antoine-Louis-Charles-Henri-Francois-Philippe-Alexandre-Guillaume-X"}]', '[]'), 'invalid_edit', 'a word of more than 100 characters is refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[{"token_index":99,"text":"a"}]', '[]'), 'invalid_edit', 'a position that does not exist is refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[{"token_index":1,"text":"a"},{"token_index":1,"text":"b"}]', '[]'), 'invalid_edit', 'a position given twice is refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[]', '[{"gap_index":1,"text":"a"},{"gap_index":1,"text":"b"}]'), 'invalid_edit', 'a gap given twice is refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[{"token_index":1,"text":"a","extra":1}]', '[]'), 'invalid_edit', 'a word with another field is refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[]', '[{"gap_index":"1","text":"a"}]'), 'invalid_edit', 'a gap index that is a string is refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '{}', '[]'), 'invalid_edit', 'words that are not a list are refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[]', 'null'), 'invalid_edit', 'gaps that are not a list are refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, '[]', '[]'), 'invalid_edit', 'no text is refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', repeat('x', 100001), '[]', '[{"gap_index":0,"text":"x"}]'), 'invalid_edit', 'a text over 100,000 characters is refused');
select is(
  (select count(*) from public.corrections where page_id = 'e1000000-0000-0000-0000-000000000006')
    + (select count(*) from public.page_gaps where page_id = 'e1000000-0000-0000-0000-000000000006'),
  0::bigint,
  'a refused edit writes nothing'
);

select is(
  public.edit_page('e1000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', E'Bonjour Paul,\nje suis a\nParis.', '[]', '[{"gap_index":5,"text":"\n"}]'),
  'edited',
  'a line is cut'
);
select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select lives_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from) values ('e1000000-0000-0000-0000-000000000007', 3, 'es', 'keyboard')$$,
  'a word of an edited page is still corrected by its owner'
);
select pg_temp.as_server();
select is(pg_temp.shown('e1000000-0000-0000-0000-000000000007'), E'Bonjour Paul,\nje es a\nParis.', 'a correction after an edit keeps the text of the user');

select is(public.edit_page('e1000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'x', '[]', '[]'), 'page_not_found', 'a page of another owner is not found');
select is(public.edit_page('e1000000-0000-0000-0000-0000000000ff', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[]', '[]'), 'page_not_found', 'a page that does not exist is not found');
select is(public.edit_page('e1000000-0000-0000-0000-000000000001', null, 'x', '[]', '[]'), 'page_not_found', 'no owner is not found');
select is(public.edit_page('e1000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[]', '[]'), 'page_not_read', 'a page not read is refused');
select is(public.edit_page('e1000000-0000-0000-0000-00000000000b', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[]', '[]'), 'unsupported_script', 'a page in an unsupported script is refused');
select is(public.edit_page('e1000000-0000-0000-0000-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[]', '[{"gap_index":0,"text":"x"}]'), 'not_editable', 'a page of text with no place for its words is not edited');

select is(
  public.edit_page('e1000000-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '$x = 2$', '[]', '[{"gap_index":0,"text":"$x = 2$"}]'),
  'edited',
  'a page of math is edited as a whole'
);
select is(pg_temp.shown('e1000000-0000-0000-0000-00000000000c'), '$x = 2$', 'the shown text of the math page is the text of the user');
select is(
  public.edit_page('e1000000-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '$x = 1$', '[]', '[{"gap_index":0,"text":"$x = 1$"}]'),
  'edited',
  'the math page is put back'
);
select is((select count(*) from public.page_gaps where page_id = 'e1000000-0000-0000-0000-00000000000c'), 0::bigint, 'a math page put back keeps no gap');
select is(pg_temp.shown('e1000000-0000-0000-0000-00000000000c'), '$x = 1$', 'the math page shows its reading again');
select is(public.edit_page('e1000000-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[{"token_index":0,"text":"y"}]', '[]'), 'invalid_edit', 'a page of math has no word to correct');
select is(public.edit_page('e1000000-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[]', '[{"gap_index":1,"text":"x"}]'), 'invalid_edit', 'a page of math has one gap');

select public.edit_page('e1000000-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', E'Bonjour Paul,\nje suis tres a Paris.', '[]', '[{"gap_index":4,"text":" tres "}]');
select is((select outcome from public.set_page_math('e1000000-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')), 'switched', 'an edited page switches to math');
select is((select count(*) from public.page_gaps where page_id = 'e1000000-0000-0000-0000-000000000008'), 0::bigint, 'the switch to math erases the text of the user');
select is(pg_temp.shown('e1000000-0000-0000-0000-000000000008'), E'Bonjour Paul,\nje suis a Paris.', 'the switch to math shows the reading B1');

select public.edit_page('e1000000-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '$x = 2$', '[]', '[{"gap_index":0,"text":"$x = 2$"}]');
select is((select outcome from public.set_page_text('e1000000-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false)), 'switched', 'an edited page of math switches to text');
select is((select count(*) from public.page_gaps where page_id = 'e1000000-0000-0000-0000-00000000000d'), 0::bigint, 'the switch to text erases the text of the user');
select is(pg_temp.shown('e1000000-0000-0000-0000-00000000000d'), '$x = 1$', 'the switch to text shows the reading B1');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select is((select count(*) from public.page_gaps), 4::bigint, 'the owner reads the gaps of the pages');
select throws_ok(
  $$select public.edit_page('e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[]', '[]')$$,
  '42501', null, 'a user cannot call the edit'
);
select throws_ok(
  $$insert into public.page_gaps (page_id, gap_index, text) values ('e1000000-0000-0000-0000-00000000000e', 0, 'x')$$,
  '42501', null, 'a user cannot write a gap'
);
select throws_ok($$update public.page_gaps set text = 'x'$$, '42501', null, 'a user cannot change a gap');
select throws_ok($$delete from public.page_gaps$$, '42501', null, 'a user cannot delete a gap');
select throws_ok(
  $$insert into public.corrections (page_id, token_index, corrected_text, chosen_from) values ('e1000000-0000-0000-0000-00000000000e', 2, '', 'keyboard')$$,
  '23514', null, 'a user cannot delete a word through a correction'
);

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select is((select count(*) from public.page_gaps), 0::bigint, 'another user reads none of these gaps');

select pg_temp.as_anon();
select throws_ok('select count(*) from public.page_gaps', '42501', null, 'a visitor without an account cannot read the gaps');
select throws_ok(
  $$select public.edit_page('e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '[]', '[]')$$,
  '42501', null, 'a visitor cannot call the edit'
);

select pg_temp.as_server();
select is((select outcome from public.delete_page('e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')), 'deleted', 'an edited page is deleted');
select is((select count(*) from public.page_gaps where page_id = 'e1000000-0000-0000-0000-000000000001'), 0::bigint, 'deleting a page deletes its gaps');

select * from finish();

rollback;
