begin;

select plan(57);

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

create function pg_temp.add_page(pid uuid, uid uuid, nb uuid, shown text, kind text default 'text') returns void
language plpgsql as $$
begin
  insert into public.pages (id, user_id, notebook_id, status, page_type, captured_at, uploaded_at)
  values (pid, uid, nb, 'read', kind, '2026-01-01 12:00:00+00', '2026-01-01 12:00:00+00');
  insert into public.page_texts (user_id, page_id, text, pipeline_version) values (uid, pid, shown, 'b1-raw');
end;
$$;

create function pg_temp.entries(nb uuid) returns text
language sql as $$
  select coalesce(string_agg(e.form || ':' || e.occurrences || ':' || case when e.confirmed then 'y' else 'n' end, ',' order by e.form_key), '')
  from public.lexicon_entries e
  where e.notebook_id = nb;
$$;

create function pg_temp.consistent(nb uuid) returns boolean
language sql as $$
  select
    not exists (
      (select form_key, form, occurrences, confirmed from public.lexicon_entries where notebook_id = nb)
      except
      (select form_key, form, occurrences, confirmed from private.lexicon_notebook(nb))
    )
    and not exists (
      (select form_key, form, occurrences, confirmed from private.lexicon_notebook(nb))
      except
      (select form_key, form, occurrences, confirmed from public.lexicon_entries where notebook_id = nb)
    );
$$;

create function pg_temp.suggestions(q text, nb uuid default null) returns text
language sql as $$
  select coalesce(string_agg(s.word || '>' || s.suggestion, ',' order by s.word), '')
  from public.suggest_words(q, nb) s;
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Third'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Second');

set constraints all immediate;

select ok(
  (select count(*) > 400000 from private.dictionary_words),
  'the dictionary holds the French and English word lists'
);

select ok(
  exists (select 1 from private.dictionary_words where word = 'maison')
  and exists (select 1 from private.dictionary_words where word = 'house')
  and not exists (select 1 from private.dictionary_words where word = 'zorblax'),
  'the dictionary knows common words of both languages and no invented one'
);

select pg_temp.add_page('c0000001-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Le zorblax est la clé.');

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), '', 'a form carried by a single page is not in the lexicon');

select pg_temp.add_page('c0000002-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Un autre zorblax, un zorblax encore.');

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'zorblax:2:n',
  'a form absent from the dictionary enters from two pages, and a word repeated on one page counts once');

select pg_temp.add_page('c0000003-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'ZORBLAX et Zorblax.');

select pg_temp.add_page('c0000004-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Soit un Zorblax ici.');

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'zorblax:4:n',
  'forms that differ by the case are one entry, kept as the pages write it most often');

select pg_temp.add_page('c0000005-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  E'Soit un Zörblax là.');

select is((select occurrences from public.lexicon_entries where notebook_id = '11111111-1111-1111-1111-111111111111' and form_key = 'zorblax'), 5,
  'forms that differ by the accents are one entry');

select ok(pg_temp.consistent('11111111-1111-1111-1111-111111111111'), 'the lexicon equals a full recomputation');

delete from public.pages where id in ('c0000003-0000-0000-0000-000000000000', 'c0000004-0000-0000-0000-000000000000', 'c0000005-0000-0000-0000-000000000000');

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'zorblax:2:n', 'deleting pages lowers the counts and the lexicon is recomputed');

update public.page_texts set text = 'Plus rien ici.' where page_id = 'c0000002-0000-0000-0000-000000000000';

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), '', 'changing the text of a page removes its forms');

update public.page_texts set text = 'Un zorblax revient.' where page_id = 'c0000002-0000-0000-0000-000000000000';

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'zorblax:2:n', 'changing the text of a page adds its forms');

delete from public.page_texts where page_id = 'c0000002-0000-0000-0000-000000000000';

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), '', 'a page whose text is erased carries no form');

insert into public.page_texts (user_id, page_id, text, pipeline_version)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000002-0000-0000-0000-000000000000', 'Un zorblax revient.', 'b1-raw');

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'zorblax:2:n', 'a page read again is counted again');

select pg_temp.add_page('c0000010-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
  E'La couleur Rouge domine. Rouge est belle.\nRouge aussi.');
select pg_temp.add_page('c0000011-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
  E'Il dit: Bleu est calme. Un jour, Bleu revient.');
select pg_temp.add_page('c0000012-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
  'La couleur Rouge est chaude.');
select pg_temp.add_page('c0000013-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
  E'Rouge est belle. Rouge aussi.\nRouge encore.');
select pg_temp.add_page('c0000014-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
  E'Rouge est belle. Rouge aussi.\nRouge encore.');

select is(pg_temp.entries('33333333-3333-3333-3333-333333333333'), 'Rouge:2:n',
  'a capitalised word of the dictionary enters when it stands inside a sentence, never at the start of a line or after a full stop');

select pg_temp.add_page('c0000015-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
  'Voir art. de la loi et H2O.');
select pg_temp.add_page('c0000016-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
  'Voir art. de la loi et H2O et 1789 et 1er mai.');

select is(pg_temp.entries('33333333-3333-3333-3333-333333333333'), 'art:2:n,H2O:2:n,Rouge:2:n',
  'an abbreviation with a full stop inside a sentence and a word with a digit enter, a number and an ordinal do not');

select pg_temp.add_page('c0000017-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
  E'Il voit Jean-Pierre aujourd\'hui avec l\'ami d\'Artagnan.');
select pg_temp.add_page('c0000018-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
  E'Elle voit Jean-Pierre aujourd\'hui avec d\'Artagnan.');

select is(pg_temp.entries('33333333-3333-3333-3333-333333333333'), 'art:2:n,Artagnan:2:n,H2O:2:n,Jean:2:n,Pierre:2:n,Rouge:2:n',
  'a compound enters by its parts, elisions are cut, and a compound of the dictionary enters not');

select pg_temp.add_page('c0000019-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
  'On parle du Kelmarn ici.', 'math');
select pg_temp.add_page('c000001a-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
  'On parle du Kelmarn là.', 'math');

select ok(pg_temp.entries('33333333-3333-3333-3333-333333333333') not like '%Kelmarn%', 'pages of math carry no form');

update public.pages set page_type = 'text' where id in ('c0000019-0000-0000-0000-000000000000', 'c000001a-0000-0000-0000-000000000000');

select ok(pg_temp.entries('33333333-3333-3333-3333-333333333333') like '%Kelmarn:2:n%', 'a page switched from math to text brings its forms');

update public.pages set page_type = 'math' where id in ('c0000019-0000-0000-0000-000000000000', 'c000001a-0000-0000-0000-000000000000');

select ok(pg_temp.entries('33333333-3333-3333-3333-333333333333') not like '%Kelmarn%', 'a page switched to math takes its forms away');

select ok(pg_temp.consistent('33333333-3333-3333-3333-333333333333'), 'the lexicon of the third notebook equals a full recomputation');

update public.pages set notebook_id = '11111111-1111-1111-1111-111111111111' where id = 'c0000015-0000-0000-0000-000000000000';

select ok(
  pg_temp.entries('33333333-3333-3333-3333-333333333333') not like '%H2O%'
  and pg_temp.consistent('33333333-3333-3333-3333-333333333333')
  and pg_temp.consistent('11111111-1111-1111-1111-111111111111'),
  'moving a page recomputes the lexicon of both notebooks'
);

update public.pages set notebook_id = '33333333-3333-3333-3333-333333333333' where id = 'c0000015-0000-0000-0000-000000000000';

select pg_temp.add_page('c0000021-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Un kelmarn seul.');

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'zorblax:2:n', 'a form of a single page is still not in the lexicon');

insert into public.page_gaps (page_id, user_id, gap_index, text)
values ('c0000021-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0, 'kelmarn');

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'kelmarn:1:y,zorblax:2:n',
  'a form the user wrote in the edit mode enters from a single page');

delete from public.page_gaps where page_id = 'c0000021-0000-0000-0000-000000000000';

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'zorblax:2:n', 'a form leaves the lexicon with the text the user wrote');

insert into public.pages (id, user_id, notebook_id, status, page_type)
values ('c0000022-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text');
insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000022-0000-0000-0000-000000000000', 'B1', 'le quodrix', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500);
insert into public.page_texts (user_id, page_id, text, pipeline_version)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000022-0000-0000-0000-000000000000', 'le quodrix', 'b1-raw');
insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, b1_start, b1_end) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000022-0000-0000-0000-000000000000', 0, 0, 'le', 'le', 0, 2),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000022-0000-0000-0000-000000000000', 1, 0, 'quodrix', 'quodrix', 3, 10);

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'zorblax:2:n', 'a form read by a single page and not yet confirmed stays out');

insert into public.corrections (user_id, page_id, token_index, corrected_text, chosen_from)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000022-0000-0000-0000-000000000000', 0, 'le', 'B1');

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'zorblax:2:n', 'confirming a word of the dictionary adds nothing');

insert into public.corrections (user_id, page_id, token_index, corrected_text, chosen_from)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c0000022-0000-0000-0000-000000000000', 1, 'quodrix', 'B1');

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'quodrix:1:y,zorblax:2:n', 'a form confirmed by a correction enters from a single page');

select ok(pg_temp.consistent('11111111-1111-1111-1111-111111111111'), 'the lexicon of the first notebook equals a full recomputation after every operation');

set constraints all deferred;

select pg_temp.add_page('c0000023-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'Encore un zorblax.');
update public.page_texts set text = 'Encore un zorblax, un quodrix.' where page_id = 'c0000023-0000-0000-0000-000000000000';

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'quodrix:1:y,zorblax:2:n',
  'the lexicon is recomputed when the operation ends, not at each row');

set constraints all immediate;

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'quodrix:2:y,zorblax:3:n', 'the operation that ended recomputed the lexicon once');

select pg_temp.add_page('d0000001-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222',
  'Voici Quasimax.');
select pg_temp.add_page('d0000002-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222',
  'Voici encore Quasimax.');

select is(pg_temp.entries('22222222-2222-2222-2222-222222222222'), 'Quasimax:2:n', 'another account has its own lexicon');

select is(pg_temp.entries('11111111-1111-1111-1111-111111111111'), 'quodrix:2:y,zorblax:3:n', 'and it does not touch the lexicon of the first account');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is((select count(*) from public.lexicon_entries where user_id <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint,
  'a user never reads a form of another account');

select ok((select count(*) from public.lexicon_entries) > 0, 'a user reads the forms of their own notebooks');

select throws_ok(
  $$insert into public.lexicon_entries (notebook_id, user_id, form_key, form, occurrences, confirmed) values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'abc', 'abc', 2, false)$$,
  '42501', null, 'a user cannot write the lexicon'
);

select throws_ok($$update public.lexicon_entries set confirmed = true$$, '42501', null, 'a user cannot change the lexicon');
select throws_ok($$delete from public.lexicon_entries$$, '42501', null, 'a user cannot erase the lexicon');
select throws_ok($$select * from private.dictionary_words limit 1$$, '42501', null, 'a user cannot read the dictionary');
select throws_ok($$insert into private.dictionary_words (word) values ('abcdef')$$, '42501', null, 'a user cannot write the dictionary');
select throws_ok($$select * from private.lexicon_words('Magellan')$$, '42501', null, 'a user cannot run the extraction of forms');

select is(pg_temp.suggestions('Zorblaz'), 'zorblaz>zorblax', 'a word of no text close to a form of the lexicon gets the form');
select is(pg_temp.suggestions('zorblax'), '', 'a word that stands in a shown text gets no suggestion');
select is(pg_temp.suggestions('maison'), '', 'a word close to no form gets no suggestion');
select is(pg_temp.suggestions('Quodrx'), 'quodrx>quodrix', 'a form confirmed by the user is suggested');
select is(pg_temp.suggestions('zorblaz quodrx maison'), 'quodrx>quodrix,zorblaz>zorblax', 'each word of the query gets at most one suggestion');
select is(pg_temp.suggestions('rouges', '33333333-3333-3333-3333-333333333333'), 'rouges>Rouge', 'the search of one notebook uses the lexicon of that notebook');
select is(pg_temp.suggestions('rouges', '11111111-1111-1111-1111-111111111111'), '', 'and not the lexicon of another notebook');
select is(pg_temp.suggestions('quasimaz'), '', 'a form of another account is never suggested');
select is(pg_temp.suggestions('Magelan'), '', 'a form missing from the lexicon is never made up');

select throws_ok($$select * from public.suggest_words(repeat('a', 101))$$, '22023', 'query_too_long', 'a query over 100 characters is refused');
select throws_ok($$select * from public.suggest_words('a b c d e f g h i')$$, '22023', 'query_too_many_words', 'a query over 8 words is refused');

reset role;
select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(pg_temp.suggestions('quasimaz'), 'quasimaz>Quasimax', 'a user gets the forms of their own lexicon');
select is(pg_temp.suggestions('zorblaz'), '', 'and never those of another account');

reset role;
select pg_temp.as_anon();

select throws_ok($$select * from public.lexicon_entries$$, '42501', null, 'a visitor without an account cannot read the lexicon');
select throws_ok($$select * from public.suggest_words('zorblaz')$$, '42501', null, 'a visitor without an account cannot ask for a suggestion');

reset role;

delete from public.notebooks where id = '33333333-3333-3333-3333-333333333333';

select is((select count(*) from public.lexicon_entries where notebook_id = '33333333-3333-3333-3333-333333333333'), 0::bigint,
  'deleting a notebook erases its lexicon');

select lives_ok($$delete from auth.users where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$, 'an account with a lexicon can be deleted');

select is((select count(*) from public.lexicon_entries where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0::bigint,
  'deleting an account erases its lexicon');

select * from finish();

rollback;
