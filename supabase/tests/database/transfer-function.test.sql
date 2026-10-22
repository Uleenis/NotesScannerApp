begin;

select plan(41);

create function pg_temp.make_user(uid uuid, anon boolean default false) returns void
language sql as $$
  insert into auth.users (id, email, is_anonymous)
  values (uid, case when anon then null else uid::text || '@example.test' end, anon);
$$;

create function pg_temp.leftovers(uid uuid) returns bigint
language plpgsql as $$
declare
  t record;
  total bigint := 0;
  n bigint;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'user_id'
  loop
    execute format('select count(*) from public.%I where user_id = $1', t.table_name) into n using uid;
    total := total + n;
  end loop;
  return total;
end;
$$;

create function pg_temp.user_tables() returns bigint
language sql as $$
  select count(*)
  from information_schema.columns c
  join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.column_name = 'user_id';
$$;

create function pg_temp.rows_of(uid uuid) returns bigint
language sql as $$
  select pg_temp.leftovers(uid) + (select count(*) from public.profiles where id = uid);
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select pg_temp.make_user('cccccccc-cccc-cccc-cccc-cccccccccccc');
select pg_temp.make_user('dddddddd-dddd-dddd-dddd-dddddddddddd', true);

insert into public.notebooks (id, user_id, name) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'History'),
  ('a1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Physics'),
  ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', E'History \u00a0\t'),
  ('b1000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PHYSICS'),
  ('c1000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'History'),
  ('d1000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Reading');

insert into public.chapters (id, user_id, notebook_id, name) values
  ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000001', 'Intro');

insert into public.pages (id, user_id, notebook_id, chapter_id) values
  ('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000001', null),
  ('a3000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000002', null),
  ('b3000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1000000-0000-0000-0000-000000000001', null),
  ('c3000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1000000-0000-0000-0000-000000000001', null);

insert into public.pages (id, user_id, notebook_id, status) values
  ('d3000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'd1000000-0000-0000-0000-000000000001', 'processing');

insert into public.pages (user_id, notebook_id)
select 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1000000-0000-0000-0000-000000000002' from generate_series(1, 14);

insert into public.page_images (user_id, page_id, kind, storage_path)
select p.user_id, p.id, 'original', p.user_id::text || '/' || p.id::text || '/original.jpg'
from public.pages p where p.id::text like 'a3000000%';

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000001', 'B1', 'text more', 'model', 'version', 'V0', 0, 1, 1, 1);

insert into public.page_texts (user_id, page_id, text, pipeline_version) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000001', 'text more', '1');

select public.record_reading_a(
  'a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'medium', 'version', 1,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a3000000-0000-0000-0000-000000000001/a.xml', 'en',
  '[{"token_index": 0, "line_index": 0, "text": "text", "reading_a": "text", "reading_b1": "text", "anchor_kind": "word", "anchor": [0, 0, 10, 10], "b1_start": 0, "b1_end": 4},
    {"token_index": 1, "line_index": 0, "text": "more", "reading_a": null, "reading_b1": "more", "anchor_kind": null, "anchor": null, "b1_start": 5, "b1_end": 9}]'::jsonb
);

insert into public.corrections (user_id, page_id, token_index, corrected_text, chosen_from) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000001', 1, 'most', 'keyboard');

insert into public.page_alerts (user_id, page_id, kind) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000001', 'missing_line');

insert into public.page_gaps (user_id, page_id, gap_index, text) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000001', 1, E' ok
');

insert into public.page_charges (user_id, page_id, charged_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000001', now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000002', now() - interval '70 days'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3000000-0000-0000-0000-000000000003', now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, now());

insert into public.page_charges (user_id, page_id)
select p.user_id, p.id from public.pages p where p.user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and p.id::text not like 'b3000000%';

select is(
  (select used from public.page_allowance('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')),
  14,
  'the account that receives has used 14 of its 15 pages of the month before the transfer'
);

select throws_ok(
  $$select * from public.transfer_account_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'P0001', 'same_account', 'an account is never transferred to itself'
);

select throws_ok(
  $$select * from public.transfer_account_rows('cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'P0001', 'not_anonymous', 'the account that gives must be anonymous'
);

select throws_ok(
  $$select * from public.transfer_account_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd')$$,
  'P0001', 'target_anonymous', 'the account that receives must not be anonymous'
);

select throws_ok(
  $$select * from public.transfer_account_rows('99999999-9999-9999-9999-999999999999', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'P0001', 'account_not_found', 'the account that gives must exist'
);

select throws_ok(
  $$select * from public.transfer_account_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999999')$$,
  'P0001', 'account_not_found', 'the account that receives must exist'
);

select throws_ok(
  $$select * from public.transfer_account_rows(null, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'P0001', 'account_not_found', 'a missing identifier is refused'
);

select pg_temp.make_user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

select throws_ok(
  $$select * from public.transfer_account_rows('dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')$$,
  'P0001', 'page_processing', 'a page that is being read stops the transfer'
);

select is(pg_temp.leftovers('dddddddd-dddd-dddd-dddd-dddddddddddd'), 2::bigint, 'after that refusal the account still holds its notebook and page rows');
select is(pg_temp.leftovers('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 0::bigint, 'after that refusal the receiving account got nothing');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'transfer_account_rows' and p.prosecdef),
  1::bigint,
  'the transfer function runs with the rights of its owner'
);
select is(has_function_privilege('anon', 'public.transfer_account_rows(uuid, uuid)', 'execute'), false, 'a visitor cannot run the transfer');
select is(has_function_privilege('authenticated', 'public.transfer_account_rows(uuid, uuid)', 'execute'), false, 'a signed-in user cannot run the transfer');
select is(has_function_privilege('service_role', 'public.transfer_account_rows(uuid, uuid)', 'execute'), true, 'the server can run the transfer');

select ok(pg_temp.user_tables() >= 7, 'the check for leftover rows looks at every table that has a user_id');

select is(pg_temp.leftovers('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 21::bigint, 'the giving account holds 2 notebooks, 1 chapter, 3 pages, 3 images, 2 readings, 1 text, 4 charges, 2 positions, 1 correction, 1 alert and 1 text of the user before the transfer');

create temp table bystander_before as select pg_temp.rows_of('cccccccc-cccc-cccc-cccc-cccccccccccc') as n;

select is(
  (select row(pages, notebooks_merged)::text from public.transfer_account_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')),
  '(3,1)',
  'the transfer moves 3 pages and merges 1 notebook'
);

select is(pg_temp.leftovers('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint, 'no table keeps a row for the giving account');
select is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 1::bigint, 'the giving account itself is left for the server to delete');
select is(pg_temp.rows_of('cccccccc-cccc-cccc-cccc-cccccccccccc'), (select n from bystander_before), 'an account that took no part is untouched');

select is(
  (select count(*) from public.pages where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and id::text like 'a3000000%'),
  3::bigint,
  'the 3 pages now belong to the receiving account'
);

select is(
  (select count(*) from public.pages where id in ('a3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002') and notebook_id = 'b1000000-0000-0000-0000-000000000001'),
  2::bigint,
  'the pages of the notebook with the same name joined the existing notebook, spaces at the edges ignored'
);

select is(
  (select count(*) from public.notebooks where id = 'a1000000-0000-0000-0000-000000000001'),
  0::bigint,
  'the merged notebook of the giving account is gone'
);

select is(
  (select row(user_id, notebook_id)::text from public.chapters where id = 'a2000000-0000-0000-0000-000000000001'),
  '(bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb,b1000000-0000-0000-0000-000000000001)',
  'the chapter followed its pages into the existing notebook'
);

select is(
  (select chapter_id from public.pages where id = 'a3000000-0000-0000-0000-000000000001'),
  'a2000000-0000-0000-0000-000000000001'::uuid,
  'the page kept its chapter'
);

select is(
  (select user_id from public.notebooks where id = 'a1000000-0000-0000-0000-000000000002'),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'a notebook with no equivalent moved as it was'
);

select is(
  (select count(*) from public.notebooks where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  3::bigint,
  'a notebook whose name differs by case stays a separate notebook'
);

select is(
  (select count(*) from public.page_images where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and storage_path like 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/a3000000-%/original.jpg'),
  3::bigint,
  'the paths of the photos now start with the receiving account'
);

select is(
  (select storage_path from public.page_images where page_id = 'a3000000-0000-0000-0000-000000000001'),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/a3000000-0000-0000-0000-000000000001/original.jpg',
  'a photo path keeps its page folder and file name'
);

select is(
  (select count(*) from public.readings where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and page_id = 'a3000000-0000-0000-0000-000000000001')
    + (select count(*) from public.page_texts where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and page_id = 'a3000000-0000-0000-0000-000000000001'),
  3::bigint,
  'the readings and the text moved'
);

select is(
  (select array_agg(text order by token_index) from public.page_tokens where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and page_id = 'a3000000-0000-0000-0000-000000000001'),
  array['text', 'more'],
  'the positions moved with their page'
);

select is(
  (select count(*) from public.corrections where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and page_id = 'a3000000-0000-0000-0000-000000000001')
    + (select count(*) from public.page_alerts where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and page_id = 'a3000000-0000-0000-0000-000000000001')
    + (select count(*) from public.page_gaps where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and page_id = 'a3000000-0000-0000-0000-000000000001'),
  3::bigint,
  'the correction, the alert and the text of the user moved with their page'
);

select is(
  (select text from public.page_texts where page_id = 'a3000000-0000-0000-0000-000000000001'),
  'text most',
  'the shown text kept the correction'
);

select is(
  (select alto_path from public.readings where page_id = 'a3000000-0000-0000-0000-000000000001' and label = 'A'),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/a3000000-0000-0000-0000-000000000001/a.xml',
  'the path of the ALTO now starts with the receiving account and keeps its page folder and file name'
);

select is(
  (select language from public.pages where id = 'a3000000-0000-0000-0000-000000000001'),
  'en',
  'the page kept its language'
);

select is(
  (select count(*) from public.page_charges where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  18::bigint,
  'the 4 charges of the giving account, including the one of a deleted page, joined the 14 of the receiving account'
);

select is(
  (select charged_at < now() - interval '60 days' from public.page_charges where page_id = 'a3000000-0000-0000-0000-000000000002'),
  true,
  'a moved charge keeps its date'
);

select is(
  (select row(used, max, remaining, blocked_reason)::text from public.page_allowance('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')),
  '(17,15,0,monthly_limit)',
  'the receiving account counts the charges of the month it received, not the older one, and a transfer can take it past its limit'
);

select is(
  (select reason from public.charge_page('a3000000-0000-0000-0000-000000000001')),
  'already_charged',
  'a page that was charged is not charged again once moved'
);

select is(
  (select pages from public.transfer_account_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')),
  0,
  'playing the transfer again moves nothing and does not fail'
);

delete from auth.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (select count(*) from public.pages where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  18::bigint,
  'deleting the giving account leaves the moved pages in place'
);

select * from finish();

rollback;
