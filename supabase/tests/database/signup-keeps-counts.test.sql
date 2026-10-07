begin;

select plan(11);

create function pg_temp.make_user(uid uuid, anon boolean default false) returns void
language sql as $$
  insert into auth.users (id, email, is_anonymous)
  values (uid, case when anon then null else uid::text || '@example.test' end, anon);
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Kept');

insert into public.pages (id, user_id, notebook_id) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

select is((select count(*) from public.charge_page('44444444-4444-4444-4444-444444444444') where reason = 'charged'), 1::bigint, 'the first page is charged to the anonymous account');
select is((select count(*) from public.charge_page('55555555-5555-5555-5555-555555555555') where reason = 'charged'), 1::bigint, 'the second page is charged to the anonymous account');

select is(
  (select row(is_anonymous, used, max)::text from public.page_allowance('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  '(t,2,3)',
  'an anonymous account has used 2 of its 3 trial pages'
);

update auth.users
  set email = 'kept@example.test', is_anonymous = false, email_confirmed_at = now()
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (select row(is_anonymous, used, max, remaining)::text from public.page_allowance('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  '(f,2,15,13)',
  'after sign-up the same 2 pages count against the 15 pages of the month'
);

select is((select count(*) from public.notebooks where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 1::bigint, 'the notebook is still there');
select is((select count(*) from public.pages where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 2::bigint, 'the pages are still there');
select is((select count(*) from public.page_charges where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 2::bigint, 'the charges are still there');
select is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 1::bigint, 'the profile is still there');

select is((select count(*) from public.charge_page('44444444-4444-4444-4444-444444444444') where reason = 'already_charged'), 1::bigint, 'a page already charged is not charged again after sign-up');

select is(
  (select count(*) from public.anonymous_daily_counts where pages > 0),
  (select count(*) from public.anonymous_daily_counts),
  'the daily counts of anonymous accounts are untouched by sign-up'
);

select is(
  (select blocked_reason from public.page_allowance('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  null::text,
  'the account is not blocked after sign-up'
);

select * from finish();

rollback;
