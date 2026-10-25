begin;

select plan(7);

create function pg_temp.make_user(uid uuid, anon boolean default false) returns void
language sql as $$
  insert into auth.users (id, email, is_anonymous)
  values (uid, case when anon then null else uid::text || '@example.test' end, anon);
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Course'),
  ('a1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Solo'),
  ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', E'Course ');

insert into public.pages (id, user_id, notebook_id, status) values
  ('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000001', 'read'),
  ('a3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1000000-0000-0000-0000-000000000002', 'read'),
  ('b3000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1000000-0000-0000-0000-000000000001', 'read');

insert into public.page_renderings (page_id, user_id, text, based_on, model, prompt_version) values
  ('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First', repeat('1', 64), 'm', 'R1'),
  ('a3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Second', repeat('2', 64), 'm', 'R1'),
  ('b3000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Third', repeat('3', 64), 'm', 'R1');

insert into public.render_daily_counts (user_id, day, renders) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', (now() at time zone 'Europe/Paris')::date, 3),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', (now() at time zone 'Europe/Paris')::date - 1, 2),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', (now() at time zone 'Europe/Paris')::date, 4);

select is(
  (select count(*) from public.page_renderings where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2::bigint,
  'the anonymous account holds two renderings'
);

set local role service_role;

select lives_ok(
  $$select * from public.transfer_account_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'the transfer goes through'
);

reset role;

select is(
  (select string_agg(r.page_id::text || ':' || r.text, ',' order by r.page_id) from public.page_renderings r where r.user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'a3000000-0000-0000-0000-000000000001:First,a3000000-0000-0000-0000-000000000002:Second,b3000000-0000-0000-0000-000000000001:Third',
  'the renderings of the pages follow the pages to the registered account'
);

select is(
  (select count(*) from public.page_renderings where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'the anonymous account keeps no rendering'
);

select is(
  (select r.renders from public.render_daily_counts r where r.user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and r.day = (now() at time zone 'Europe/Paris')::date),
  5,
  'the renderings of the day add up and stop at the limit'
);

select is(
  (select r.renders from public.render_daily_counts r where r.user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and r.day = (now() at time zone 'Europe/Paris')::date - 1),
  2,
  'the count of an earlier day moves as it is'
);

select is(
  (select count(*) from public.render_daily_counts where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'the anonymous account keeps no count'
);

select * from finish();

rollback;
