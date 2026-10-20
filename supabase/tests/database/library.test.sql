begin;

select plan(53);

create function pg_temp.make_user(uid uuid) returns void
language sql as $$
  insert into auth.users (id, email) values (uid, uid::text || '@example.test');
$$;

create function pg_temp.fill_page(uid uuid, nb uuid, ch uuid, pg uuid, tag text, st text default 'read') returns void
language plpgsql as $$
begin
  insert into public.pages (id, user_id, notebook_id, chapter_id, status) values (pg, uid, nb, ch, st);
  insert into public.page_images (user_id, page_id, kind, storage_path)
    values (uid, pg, 'original', uid::text || '/' || pg::text || '/original.jpg');
  insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
    values (uid, pg, 'B1', 'text ' || tag, 'model', 'version', 'V0', 0, 1, 1, 1);
  insert into public.page_texts (user_id, page_id, text, pipeline_version) values (uid, pg, 'text ' || tag, '1');
  insert into public.page_charges (user_id, page_id) values (uid, pg);
  perform public.record_reading_a(pg, uid, 'text ' || tag, 'medium', 'version', 1, uid::text || '/' || pg::text || '/a.xml', 'en',
    jsonb_build_array(jsonb_build_object('token_index', 0, 'line_index', 0, 'text', 'text', 'reading_a', 'text', 'reading_b1', 'text', 'anchor_kind', 'word', 'anchor', jsonb_build_array(0, 0, 10, 10))));
end;
$$;

create function pg_temp.rows_of_page(pg uuid) returns bigint
language sql as $$
  select (select count(*) from public.pages where id = pg)
    + (select count(*) from public.page_images where page_id = pg)
    + (select count(*) from public.readings where page_id = pg)
    + (select count(*) from public.page_texts where page_id = pg)
    + (select count(*) from public.page_tokens where page_id = pg);
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First'),
  ('12121212-1212-1212-1212-121212121212', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Second'),
  ('13131313-1313-1313-1313-131313131313', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Third'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Other');

insert into public.chapters (id, user_id, notebook_id, name) values
  ('31313131-3131-3131-3131-313131313131', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'In first'),
  ('32323232-3232-3232-3232-323232323232', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12121212-1212-1212-1212-121212121212', 'In second'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12121212-1212-1212-1212-121212121212', 'Also in second'),
  ('34343434-3434-3434-3434-343434343434', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '13131313-1313-1313-1313-131313131313', 'In third'),
  ('44444444-4444-4444-4444-444444444444', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Of the other');

select pg_temp.fill_page('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '31313131-3131-3131-3131-313131313131', 'a1000000-0000-0000-0000-000000000001', 'one');
select pg_temp.fill_page('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', null, 'a1000000-0000-0000-0000-000000000002', 'two');
select pg_temp.fill_page('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', null, 'a1000000-0000-0000-0000-000000000003', 'three', 'processing');
select pg_temp.fill_page('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12121212-1212-1212-1212-121212121212', '32323232-3232-3232-3232-323232323232', 'a2000000-0000-0000-0000-000000000001', 'four');
select pg_temp.fill_page('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12121212-1212-1212-1212-121212121212', null, 'a2000000-0000-0000-0000-000000000002', 'five', 'processing');
select pg_temp.fill_page('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '13131313-1313-1313-1313-131313131313', '34343434-3434-3434-3434-343434343434', 'a3000000-0000-0000-0000-000000000001', 'six');
select pg_temp.fill_page('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '13131313-1313-1313-1313-131313131313', null, 'a3000000-0000-0000-0000-000000000002', 'seven');
select pg_temp.fill_page('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444', 'b1000000-0000-0000-0000-000000000001', 'other');

select is_empty(
  $$
    select p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('move_page', 'delete_page', 'delete_chapter', 'delete_notebook')
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
        or not has_function_privilege('service_role', p.oid, 'execute')
      )
  $$,
  'only the server can run the move and the deletions'
);

select is(
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('move_page', 'delete_page', 'delete_chapter', 'delete_notebook')),
  4::bigint,
  'the move and the three deletions exist'
);

select is_empty(
  $$
    select c.conrelid::regclass::text || ' ' || c.conname
    from pg_constraint c
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and i.indpred is null
          and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey::int2[]
      )
  $$,
  'every foreign key in public has an index that starts with its columns'
);

set local role service_role;

select is(
  (select outcome from public.move_page('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12121212-1212-1212-1212-121212121212', '33333333-3333-3333-3333-333333333333')),
  'moved',
  'a page moves to another notebook and chapter'
);

select results_eq(
  $$select notebook_id, chapter_id from public.pages where id = 'a1000000-0000-0000-0000-000000000001'$$,
  $$values ('12121212-1212-1212-1212-121212121212'::uuid, '33333333-3333-3333-3333-333333333333'::uuid)$$,
  'the page is in its new notebook and chapter'
);

select is(
  pg_temp.rows_of_page('a1000000-0000-0000-0000-000000000001'),
  6::bigint,
  'a moved page keeps its photo, its readings, its text and its positions'
);

select is(
  (select text from public.page_texts where page_id = 'a1000000-0000-0000-0000-000000000001'),
  'text one',
  'the text of a moved page does not change'
);

select is(
  (select count(*) from public.page_charges where page_id = 'a1000000-0000-0000-0000-000000000001'),
  1::bigint,
  'a moved page keeps its charge'
);

select is(
  (select outcome from public.move_page('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12121212-1212-1212-1212-121212121212', '33333333-3333-3333-3333-333333333333')),
  'unchanged',
  'a move to where the page already is changes nothing'
);

select is(
  (select outcome from public.move_page('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12121212-1212-1212-1212-121212121212', '32323232-3232-3232-3232-323232323232')),
  'moved',
  'a page moves to another chapter of its notebook'
);

select is(
  (select outcome from public.move_page('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', null)),
  'moved',
  'a page moves to a notebook without a chapter'
);

select results_eq(
  $$select notebook_id, chapter_id from public.pages where id = 'a1000000-0000-0000-0000-000000000001'$$,
  $$values ('11111111-1111-1111-1111-111111111111'::uuid, null::uuid)$$,
  'the page is out of any chapter'
);

select is(
  (select outcome from public.move_page('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '13131313-1313-1313-1313-131313131313', '32323232-3232-3232-3232-323232323232')),
  'chapter_not_found',
  'a chapter of another notebook than the target is refused'
);

select results_eq(
  $$select notebook_id, chapter_id from public.pages where id = 'a1000000-0000-0000-0000-000000000001'$$,
  $$values ('11111111-1111-1111-1111-111111111111'::uuid, null::uuid)$$,
  'a refused move leaves the page where it was'
);

select is(
  (select outcome from public.move_page('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444')),
  'chapter_not_found',
  'a chapter of someone else is refused'
);

select is(
  (select outcome from public.move_page('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', gen_random_uuid())),
  'chapter_not_found',
  'a chapter that does not exist is refused'
);

select is(
  (select outcome from public.move_page('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', null)),
  'notebook_not_found',
  'a notebook of someone else is refused'
);

select is(
  (select outcome from public.move_page('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', gen_random_uuid(), null)),
  'notebook_not_found',
  'a notebook that does not exist is refused'
);

select is(
  (select outcome from public.move_page('b1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', null)),
  'page_not_found',
  'the page of someone else is not moved'
);

select is(
  (select outcome from public.move_page('a1000000-0000-0000-0000-000000000001', null, '12121212-1212-1212-1212-121212121212', null)),
  'page_not_found',
  'a move without an owner is refused'
);

select is(
  (select outcome from public.move_page(gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12121212-1212-1212-1212-121212121212', null)),
  'page_not_found',
  'a page that does not exist is not moved'
);

select is(
  (select outcome from public.move_page('a1000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12121212-1212-1212-1212-121212121212', null)),
  'page_processing',
  'a page being read is not moved'
);

select is(
  (select notebook_id from public.pages where id = 'a1000000-0000-0000-0000-000000000003'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'a page being read stays where it is'
);

select is(
  (select notebook_id from public.pages where id = 'b1000000-0000-0000-0000-000000000001'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'the page of someone else stays where it is'
);

select is(
  (select outcome from public.delete_page('a1000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'page_processing',
  'a page being read is not deleted'
);

select is(
  pg_temp.rows_of_page('a1000000-0000-0000-0000-000000000003'),
  6::bigint,
  'a page being read keeps all its rows'
);

select is(
  (select outcome from public.delete_page('b1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'page_not_found',
  'the page of someone else is not deleted'
);

select is(
  (select outcome from public.delete_page('a1000000-0000-0000-0000-000000000002', null)),
  'page_not_found',
  'a deletion without an owner is refused'
);

select is(
  pg_temp.rows_of_page('b1000000-0000-0000-0000-000000000001') + pg_temp.rows_of_page('a1000000-0000-0000-0000-000000000002'),
  12::bigint,
  'refused deletions leave every row in place'
);

select is(
  (select outcome from public.delete_page(gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'page_not_found',
  'a page that does not exist is not deleted'
);

select is(
  (select outcome from public.delete_page('a1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'deleted',
  'a page is deleted'
);

select is(
  pg_temp.rows_of_page('a1000000-0000-0000-0000-000000000002'),
  0::bigint,
  'a deleted page leaves no row: no photo, no reading, no text, no position'
);

select is(
  (select count(*) from public.page_charges where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and page_id is null),
  1::bigint,
  'the charge of a deleted page stays, without its page'
);

select is(
  pg_temp.rows_of_page('a1000000-0000-0000-0000-000000000001'),
  6::bigint,
  'the other pages of the notebook are not touched'
);

select is(
  (select outcome from public.delete_chapter('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'chapter_not_found',
  'the chapter of someone else is not deleted'
);

select is(
  (select outcome from public.delete_chapter('32323232-3232-3232-3232-323232323232', null)),
  'chapter_not_found',
  'a chapter deletion without an owner is refused'
);

select is(
  (select outcome from public.delete_chapter(gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'chapter_not_found',
  'a chapter that does not exist is not deleted'
);

select is(
  (select count(*) from public.chapters),
  5::bigint,
  'refused chapter deletions leave every chapter'
);

select is(
  (select outcome from public.delete_chapter('32323232-3232-3232-3232-323232323232', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'deleted',
  'a chapter is deleted'
);

select results_eq(
  $$select notebook_id, chapter_id from public.pages where id = 'a2000000-0000-0000-0000-000000000001'$$,
  $$values ('12121212-1212-1212-1212-121212121212'::uuid, null::uuid)$$,
  'the pages of a deleted chapter stay in the notebook, out of any chapter'
);

select is(
  pg_temp.rows_of_page('a2000000-0000-0000-0000-000000000001'),
  6::bigint,
  'the pages of a deleted chapter keep all their rows'
);

select is(
  (select count(*) from public.chapters where notebook_id = '12121212-1212-1212-1212-121212121212'),
  1::bigint,
  'the other chapters of the notebook stay'
);

select is(
  (select outcome from public.delete_notebook('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'notebook_not_found',
  'the notebook of someone else is not deleted'
);

select is(
  (select outcome from public.delete_notebook('13131313-1313-1313-1313-131313131313', null)),
  'notebook_not_found',
  'a notebook deletion without an owner is refused'
);

select is(
  (select outcome from public.delete_notebook(gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'notebook_not_found',
  'a notebook that does not exist is not deleted'
);

select is(
  (select outcome from public.delete_notebook('12121212-1212-1212-1212-121212121212', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'page_processing',
  'a notebook with a page being read is not deleted'
);

select is(
  (select count(*) from public.notebooks) + (select count(*) from public.chapters) + (select count(*) from public.pages),
  15::bigint,
  'a refused notebook deletion leaves everything in place'
);

select is(
  (select outcome from public.delete_notebook('13131313-1313-1313-1313-131313131313', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'deleted',
  'a notebook is deleted'
);

select is(
  pg_temp.rows_of_page('a3000000-0000-0000-0000-000000000001') + pg_temp.rows_of_page('a3000000-0000-0000-0000-000000000002'),
  0::bigint,
  'a deleted notebook takes its pages and everything they hold'
);

select is(
  (select count(*) from public.chapters where notebook_id = '13131313-1313-1313-1313-131313131313'),
  0::bigint,
  'a deleted notebook takes its chapters'
);

select is(
  (select count(*) from public.page_charges where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and page_id is null),
  3::bigint,
  'the charges of a deleted notebook stay, without their pages'
);

select is(
  (select count(*) from public.notebooks where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2::bigint,
  'the other notebooks of the user stay'
);

select is(
  pg_temp.rows_of_page('b1000000-0000-0000-0000-000000000001'),
  6::bigint,
  'the pages of another user are untouched'
);

select * from finish();

rollback;
