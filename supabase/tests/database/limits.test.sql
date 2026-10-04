begin;

select plan(42);

create function pg_temp.u(n integer) returns uuid
language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$$;

create function pg_temp.make_user(uid uuid, anon boolean default false) returns void
language sql as $$
  insert into auth.users (id, email, is_anonymous)
  values (uid, case when anon then null else uid::text || '@example.test' end, anon);
$$;

create function pg_temp.new_page(uid uuid) returns uuid
language plpgsql as $$
declare
  nb uuid;
  pid uuid;
begin
  select id into nb from public.notebooks where user_id = uid and name = 'N';
  if nb is null then
    insert into public.notebooks (user_id, name) values (uid, 'N') returning id into nb;
  end if;
  insert into public.pages (user_id, notebook_id) values (uid, nb) returning id into pid;
  return pid;
end;
$$;

create function pg_temp.charge_new(uid uuid, at timestamptz) returns text
language sql as $$
  select reason from public.charge_page(pg_temp.new_page(uid), at);
$$;

create function pg_temp.charge_many(uid uuid, n integer, at timestamptz) returns bigint
language sql as $$
  select count(*) filter (where pg_temp.charge_new(uid, at) = 'charged') from generate_series(1, n);
$$;

select pg_temp.make_user(pg_temp.u(1), true);
select pg_temp.make_user(pg_temp.u(2));
select pg_temp.make_user(pg_temp.u(3));
select pg_temp.make_user(pg_temp.u(4));
select pg_temp.make_user(pg_temp.u(5), true);
select pg_temp.make_user(pg_temp.u(6));
select pg_temp.make_user(pg_temp.u(7), true);
select pg_temp.make_user(pg_temp.u(8), true);
select pg_temp.make_user(pg_temp.u(9));
select pg_temp.make_user(pg_temp.u(10));
select pg_temp.make_user(pg_temp.u(11), true);
select pg_temp.make_user(pg_temp.u(12), true);

select is(
  pg_temp.charge_many(pg_temp.u(1), 3, '2026-01-15 12:00:00+00'),
  3::bigint,
  'an anonymous account is accepted for its first three pages'
);

select is(
  pg_temp.charge_new(pg_temp.u(1), '2026-10-04 12:00:00+00'),
  'anonymous_limit',
  'an anonymous account is refused its fourth page, months later'
);

select is(
  (select count(*) from public.page_charges where user_id = pg_temp.u(1)),
  3::bigint,
  'a refused page leaves no charge'
);

select is(
  pg_temp.charge_many(pg_temp.u(2), 15, '2026-10-31 22:30:00+00'),
  15::bigint,
  'a registered account is accepted for 15 pages in a month'
);

select is(
  pg_temp.charge_new(pg_temp.u(2), '2026-10-31 22:59:00+00'),
  'monthly_limit',
  'the 16th page is refused at 23:59 in Paris on the last day of the month'
);

select is(
  pg_temp.charge_new(pg_temp.u(2), '2026-10-31 23:30:00+00'),
  'charged',
  'the 16th page is accepted at 00:30 in Paris on the first of the next month'
);

select is(
  pg_temp.charge_many(pg_temp.u(3), 15, '2026-08-31 21:30:00+00'),
  15::bigint,
  'a registered account is accepted for 15 pages in a summer month'
);

select is(
  pg_temp.charge_new(pg_temp.u(3), '2026-08-31 21:59:00+00'),
  'monthly_limit',
  'the 16th page is refused at 23:59 in Paris on the last summer day of the month'
);

select is(
  pg_temp.charge_new(pg_temp.u(3), '2026-08-31 22:30:00+00'),
  'charged',
  'the 16th page is accepted at 00:30 in Paris on the first of the next summer month'
);

select is(
  pg_temp.charge_many(pg_temp.u(4), 15, '2026-10-10 10:00:00+00'),
  15::bigint,
  'an account that will subscribe is accepted for its first 15 pages'
);

update public.profiles set tier = 'subscriber' where id = pg_temp.u(4);

select is(
  pg_temp.charge_many(pg_temp.u(4), 185, '2026-10-10 10:00:00+00'),
  185::bigint,
  'a subscriber is accepted up to 200 pages in a month'
);

select is(
  pg_temp.charge_new(pg_temp.u(4), '2026-10-10 10:00:00+00'),
  'monthly_limit',
  'a subscriber is refused the 201st page of the month'
);

insert into public.anonymous_daily_counts (day, pages) values ('2031-03-10', 299);

select is(
  pg_temp.charge_new(pg_temp.u(7), '2031-03-10 12:00:00+00'),
  'charged',
  'the 300th anonymous page of the day is accepted'
);

select is(
  pg_temp.charge_new(pg_temp.u(8), '2031-03-10 12:00:00+00'),
  'anonymous_daily_cap',
  'the 301st anonymous page of the day is refused'
);

select is(
  (select count(*) from public.page_charges where user_id = pg_temp.u(8))
    + (select pages from public.anonymous_daily_counts where day = '2031-03-10'),
  300::bigint,
  'a page refused by the daily cap leaves no charge and does not move the counter'
);

select is(
  pg_temp.charge_new(pg_temp.u(9), '2031-03-10 12:00:00+00'),
  'charged',
  'a registered account is not held back by the daily cap of anonymous accounts'
);

select is(
  pg_temp.charge_new(pg_temp.u(8), '2031-03-10 23:30:00+00'),
  'charged',
  'an anonymous account is accepted again once the Paris day has changed'
);

select is(
  (select pages from public.anonymous_daily_counts where day = '2031-03-11'),
  1,
  'the next Paris day has its own counter'
);

delete from auth.users where id = pg_temp.u(7);

select is(
  (select pages from public.anonymous_daily_counts where day = '2031-03-10'),
  300,
  'deleting an anonymous account does not lower the daily counter'
);

create temp table one_page as select pg_temp.new_page(pg_temp.u(6)) as id;

select is(
  (select reason from public.charge_page((select id from one_page), '2026-10-10 10:00:00+00')),
  'charged',
  'a page is charged the first time it is read'
);

select is(
  (select reason from public.charge_page((select id from one_page), '2026-10-10 10:00:00+00')),
  'already_charged',
  'the same page is not charged a second time'
);

select is(
  (select count(*) from public.page_charges where page_id = (select id from one_page)),
  1::bigint,
  'a page has exactly one charge'
);

select is(
  pg_temp.charge_many(pg_temp.u(6), 14, '2026-10-10 10:00:00+00'),
  14::bigint,
  'the account of that page reaches its monthly limit of 15'
);

select is(
  pg_temp.charge_new(pg_temp.u(6), '2026-10-10 10:00:00+00'),
  'monthly_limit',
  'a new page is refused at the monthly limit'
);

select is(
  (select reason from public.charge_page((select id from one_page), '2026-10-10 10:00:00+00')),
  'already_charged',
  'a page already charged can be read again at the monthly limit'
);

select throws_ok(
  $$insert into public.page_charges (user_id, page_id) values (pg_temp.u(6), (select id from one_page))$$,
  '23505',
  null,
  'the database refuses a second charge for the same page'
);

select is(
  pg_temp.charge_many(pg_temp.u(5), 3, '2026-10-10 10:00:00+00'),
  3::bigint,
  'an anonymous account uses its three pages'
);

update auth.users set is_anonymous = false where id = pg_temp.u(5);

select is(
  (select remaining from public.page_allowance(pg_temp.u(5), '2026-10-10 10:00:00+00')),
  12,
  'a new registered account keeps the pages it read as an anonymous account'
);

select is(
  pg_temp.charge_many(pg_temp.u(5), 12, '2026-10-10 10:00:00+00'),
  12::bigint,
  'the registered account can read the 12 pages it has left'
);

select is(
  pg_temp.charge_new(pg_temp.u(5), '2026-10-10 10:00:00+00'),
  'monthly_limit',
  'the registered account is then at its monthly limit of 15'
);

create temp table deleted_page as select pg_temp.new_page(pg_temp.u(10)) as id;

select is(
  (select reason from public.charge_page((select id from deleted_page), '2026-10-10 10:00:00+00')),
  'charged',
  'a page is charged before it is deleted'
);

delete from public.pages where id = (select id from deleted_page);

select is(
  (select used from public.page_allowance(pg_temp.u(10), '2026-10-10 10:00:00+00')),
  1,
  'deleting a page does not give its charge back'
);

create temp table charge_count_before as select count(*) as n from public.page_charges;

select is(
  (select reason from public.charge_page(gen_random_uuid(), '2026-10-10 10:00:00+00')),
  'page_not_found',
  'a page that does not exist is not charged'
);

select is(
  (select count(*) from public.page_charges) - (select n from charge_count_before),
  0::bigint,
  'a page that does not exist leaves no charge'
);

select is_empty(
  $$select * from public.page_allowance(gen_random_uuid(), '2026-10-10 10:00:00+00')$$,
  'an account that does not exist has no allowance'
);

select is(
  (select resets_at from public.page_allowance(pg_temp.u(2), '2026-10-15 10:00:00+00')),
  '2026-10-31 23:00:00+00'::timestamptz,
  'a registered account gets its pages back on the first of the next month, Paris time'
);

select is(
  (select resets_at from public.page_allowance(pg_temp.u(11), '2026-10-15 10:00:00+00')),
  null,
  'an anonymous account never gets its pages back'
);

select pg_temp.charge_new(pg_temp.u(11), '2026-10-15 10:00:00+00');

select is(
  (select max * 100 + remaining from public.page_allowance(pg_temp.u(11), '2026-10-15 10:00:00+00')),
  302,
  'an anonymous account with one page read has two of three left'
);

select is(
  (select blocked_reason from public.page_allowance(pg_temp.u(1), '2026-10-15 10:00:00+00')),
  'anonymous_limit',
  'an anonymous account with its three pages read is blocked for that reason'
);

select is(
  (select blocked_reason from public.page_allowance(pg_temp.u(6), '2026-10-10 10:00:00+00')),
  'monthly_limit',
  'a registered account at its monthly limit is blocked for that reason'
);

select is(
  (select blocked_reason from public.page_allowance(pg_temp.u(12), '2031-03-10 12:00:00+00')),
  'anonymous_daily_cap',
  'a fresh anonymous account is blocked when the daily cap of anonymous accounts is reached'
);

select is(
  (select blocked_reason from public.page_allowance(pg_temp.u(9), '2031-03-10 12:00:00+00')),
  null,
  'a registered account is not blocked by the daily cap of anonymous accounts'
);

select * from finish();

rollback;
