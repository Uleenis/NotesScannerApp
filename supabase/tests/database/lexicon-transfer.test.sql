begin;

select plan(7);

create function pg_temp.make_user(uid uuid, anon boolean default false) returns void
language sql as $$
  insert into auth.users (id, email, is_anonymous)
  values (uid, case when anon then null else uid::text || '@example.test' end, anon);
$$;

create function pg_temp.add_page(pid uuid, uid uuid, nb uuid, shown text) returns void
language plpgsql as $$
begin
  insert into public.pages (id, user_id, notebook_id, status, page_type) values (pid, uid, nb, 'read', 'text');
  insert into public.page_texts (user_id, page_id, text, pipeline_version) values (uid, pid, shown, 'b1-raw');
end;
$$;

create function pg_temp.entries(nb uuid) returns text
language sql as $$
  select coalesce(string_agg(e.form || ':' || e.occurrences || ':' || e.user_id::text, ',' order by e.form_key), '')
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

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Course'),
  ('a1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Solo'),
  ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', E'Course ');

set constraints all immediate;

select pg_temp.add_page('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000001', 'Un zorblax ici.');
select pg_temp.add_page('a3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000001', 'Le zorblax encore.');
select pg_temp.add_page('a3000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000002', 'Un quodrix ici.');
select pg_temp.add_page('a3000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000002', 'Le quodrix encore.');
select pg_temp.add_page('b3000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1000000-0000-0000-0000-000000000001', 'Voici un zorblax.');

select is(pg_temp.entries('a1000000-0000-0000-0000-000000000001'), 'zorblax:2:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'the anonymous account has its lexicon');
select is(pg_temp.entries('b1000000-0000-0000-0000-000000000001'), '', 'the registered account has none yet');

set local role service_role;

select lives_ok(
  $$select * from public.transfer_account_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'the transfer goes through'
);

reset role;

select is(pg_temp.entries('b1000000-0000-0000-0000-000000000001'), 'zorblax:3:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'a merged notebook has the lexicon of its pages from both accounts');

select is(pg_temp.entries('a1000000-0000-0000-0000-000000000002'), 'quodrix:2:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'a notebook that moves keeps its lexicon, now owned by the registered account');

select is((select count(*) from public.lexicon_entries where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0::bigint,
  'the anonymous account keeps no form');

select ok(
  pg_temp.consistent('b1000000-0000-0000-0000-000000000001') and pg_temp.consistent('a1000000-0000-0000-0000-000000000002'),
  'after the transfer both lexicons equal a full recomputation'
);

select * from finish();

rollback;
