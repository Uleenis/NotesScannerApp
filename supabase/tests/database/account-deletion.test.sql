begin;

select plan(15);

create function pg_temp.make_user(uid uuid, anon boolean default false) returns void
language sql as $$
  insert into auth.users (id, email, is_anonymous)
  values (uid, case when anon then null else uid::text || '@example.test' end, anon);
$$;

create function pg_temp.fill(uid uuid, tag text) returns void
language plpgsql as $$
declare
  nb uuid := gen_random_uuid();
  ch uuid := gen_random_uuid();
  pg uuid := gen_random_uuid();
begin
  insert into public.notebooks (id, user_id, name) values (nb, uid, 'Notebook ' || tag);
  insert into public.chapters (id, user_id, notebook_id, name) values (ch, uid, nb, 'Chapter ' || tag);
  insert into public.pages (id, user_id, notebook_id, chapter_id) values (pg, uid, nb, ch);
  insert into public.page_images (user_id, page_id, kind, storage_path)
    values (uid, pg, 'original', uid::text || '/' || pg::text || '/original.jpg');
  insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
    values (uid, pg, 'B1', 'text ' || tag, 'model', 'version', 'V0', 0, 1, 1, 1);
  insert into public.page_texts (user_id, page_id, text, pipeline_version) values (uid, pg, 'text ' || tag, '1');
  insert into public.page_charges (user_id, page_id) values (uid, pg);
  insert into public.page_charges (user_id, page_id) values (uid, null);
end;
$$;

create function pg_temp.rows_of(uid uuid) returns bigint
language sql as $$
  select (select count(*) from public.profiles where id = uid)
    + (select count(*) from public.notebooks where user_id = uid)
    + (select count(*) from public.chapters where user_id = uid)
    + (select count(*) from public.pages where user_id = uid)
    + (select count(*) from public.page_images where user_id = uid)
    + (select count(*) from public.readings where user_id = uid)
    + (select count(*) from public.page_texts where user_id = uid)
    + (select count(*) from public.page_charges where user_id = uid);
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select pg_temp.make_user('cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select pg_temp.fill('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a');
select pg_temp.fill('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b');
select pg_temp.fill('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c');

select is(pg_temp.rows_of('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 9::bigint, 'the account has a row in every table before it is deleted');
select is(pg_temp.rows_of('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 9::bigint, 'the other account has its rows too');

delete from auth.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint, 'the profile is gone');
select is((select count(*) from public.notebooks where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint, 'the notebooks are gone');
select is((select count(*) from public.chapters where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint, 'the chapters are gone');
select is((select count(*) from public.pages where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint, 'the pages are gone');
select is((select count(*) from public.page_images where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint, 'the image rows are gone');
select is((select count(*) from public.readings where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint, 'the readings are gone');
select is((select count(*) from public.page_texts where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint, 'the texts are gone');
select is((select count(*) from public.page_charges where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint, 'the charges are gone');

select is(pg_temp.rows_of('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 9::bigint, 'the rows of another account are untouched');

delete from auth.users where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select is(pg_temp.rows_of('cccccccc-cccc-cccc-cccc-cccccccccccc'), 0::bigint, 'an anonymous account is deleted with all its rows too');
select is(pg_temp.rows_of('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 9::bigint, 'the account kept is still complete');

select cmp_ok(
  (select count(*) from pg_constraint c
   where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.connamespace = 'public'::regnamespace),
  '>=',
  8::bigint,
  'the tables of the public schema point to the accounts'
);

select is(
  (select array_agg(c.conrelid::regclass::text order by c.conrelid::regclass::text) from pg_constraint c
   where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.connamespace = 'public'::regnamespace and c.confdeltype <> 'c'),
  null::text[],
  'every link from a table of the public schema to an account is deleted with the account'
);

select * from finish();

rollback;
