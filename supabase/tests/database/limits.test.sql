begin;

select plan(66);

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
select pg_temp.make_user(pg_temp.u(13));
select pg_temp.make_user(pg_temp.u(14), true);
select pg_temp.make_user(pg_temp.u(15), true);
select pg_temp.make_user(pg_temp.u(28));
select pg_temp.make_user(pg_temp.u(n), true) from generate_series(20, 27) as n;

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

select pg_temp.charge_new(pg_temp.u(13), '2026-10-31 22:59:59.999999+00');
select pg_temp.charge_new(pg_temp.u(13), '2026-10-31 23:00:00+00');

select is(
  (select used from public.page_allowance(pg_temp.u(13), '2026-10-15 12:00:00+00')),
  1,
  'a charge made after the end of the month is not counted in that month'
);

select is(
  (select used from public.page_allowance(pg_temp.u(13), '2026-11-15 12:00:00+00')),
  1,
  'a charge made exactly at midnight in Paris on the first of the month counts in the new month'
);

select is(
  (select used from public.page_allowance(pg_temp.u(13), '2026-10-31 23:00:00+00')),
  1,
  'the month changes exactly at midnight in Paris'
);

create temp table first_page_14 as select pg_temp.new_page(pg_temp.u(14)) as id;

select public.charge_page((select id from first_page_14), '2031-05-05 12:00:00+00');
select pg_temp.charge_many(pg_temp.u(14), 2, '2031-05-05 12:00:00+00');

update public.anonymous_daily_counts set pages = 300 where day = '2031-05-05';

select is(
  (select blocked_reason from public.page_allowance(pg_temp.u(14), '2031-05-05 12:00:00+00')),
  'anonymous_limit',
  'an anonymous account at its three pages is told about its own limit before the daily cap'
);

select is(
  (select reason from public.charge_page((select id from first_page_14), '2031-05-05 12:00:00+00')),
  'already_charged',
  'an anonymous page already charged can be read again at both limits'
);

select is(
  (select pages from public.anonymous_daily_counts where day = '2031-05-05'),
  300,
  'reading an anonymous page again does not move the daily counter'
);

create temp table page_15 as select pg_temp.new_page(pg_temp.u(15)) as id;

select is(
  (select reason from public.charge_page((select id from page_15), '2031-06-06 12:00:00+00')),
  'charged',
  'an anonymous page is charged the first time'
);

select is(
  (select reason from public.charge_page((select id from page_15), '2031-06-06 12:00:00+00')),
  'already_charged',
  'the same anonymous page is not charged a second time'
);

select is(
  (select pages from public.anonymous_daily_counts where day = '2031-06-06'),
  1,
  'an anonymous page moves the daily counter once, not once per reading'
);

select pg_temp.charge_new(pg_temp.u(20), '2031-03-29 22:59:59+00');
select pg_temp.charge_new(pg_temp.u(21), '2031-03-29 23:00:00+00');
select pg_temp.charge_new(pg_temp.u(22), '2031-03-30 21:59:59+00');
select pg_temp.charge_new(pg_temp.u(23), '2031-03-30 22:00:00+00');
select pg_temp.charge_new(pg_temp.u(24), '2031-10-25 21:59:59+00');
select pg_temp.charge_new(pg_temp.u(25), '2031-10-25 22:00:00+00');
select pg_temp.charge_new(pg_temp.u(26), '2031-10-26 22:59:59+00');
select pg_temp.charge_new(pg_temp.u(27), '2031-10-26 23:00:00+00');

select is(
  (select pages from public.anonymous_daily_counts where day = '2031-03-29'),
  1,
  'the day before the spring clock change ends at midnight in Paris'
);

select is(
  (select pages from public.anonymous_daily_counts where day = '2031-03-30'),
  2,
  'the 23-hour day of the spring clock change runs from midnight to midnight in Paris'
);

select is(
  (select pages from public.anonymous_daily_counts where day = '2031-03-31'),
  1,
  'the day after the spring clock change starts at midnight in Paris'
);

select is(
  (select pages from public.anonymous_daily_counts where day = '2031-10-25'),
  1,
  'the day before the autumn clock change ends at midnight in Paris'
);

select is(
  (select pages from public.anonymous_daily_counts where day = '2031-10-26'),
  2,
  'the 25-hour day of the autumn clock change runs from midnight to midnight in Paris'
);

select is(
  (select pages from public.anonymous_daily_counts where day = '2031-10-27'),
  1,
  'the day after the autumn clock change starts at midnight in Paris'
);

select is(
  (select reason from public.charge_page(pg_temp.new_page(pg_temp.u(28)), null)),
  'charged',
  'a missing date means now'
);

select is(
  (select used from public.page_allowance(pg_temp.u(28), null)),
  1,
  'the allowance with a missing date counts the pages of the current month'
);

insert into auth.users (id, email, is_anonymous) values (pg_temp.u(30), 'carry@example.test', false);

select pg_temp.charge_many(pg_temp.u(30), 15, now());

delete from auth.users where id = pg_temp.u(30);

insert into auth.users (id, email, is_anonymous) values (pg_temp.u(31), ' Carry@Example.test', false);

select is(
  (select used from public.page_allowance(pg_temp.u(31))),
  15,
  'an address that deleted its account keeps the pages it read this month, whatever its letter case'
);

select is(
  pg_temp.charge_new(pg_temp.u(31), now()),
  'monthly_limit',
  'a new account on the same address is refused its first page at the monthly limit'
);

select pg_temp.make_user(pg_temp.u(32));

select is(
  (select used from public.page_allowance(pg_temp.u(32))),
  0,
  'a new account on another address starts with no pages read'
);

select is(
  (select used from public.page_allowance(pg_temp.u(31), now() + interval '40 days')),
  0,
  'the pages kept for an address are forgotten when the month is over'
);

create temp table count_rows_before as select count(*) as n from public.email_monthly_counts;

select pg_temp.make_user(pg_temp.u(33), true);
select pg_temp.charge_many(pg_temp.u(33), 2, now());
delete from auth.users where id = pg_temp.u(33);

select pg_temp.make_user(pg_temp.u(34));
delete from auth.users where id = pg_temp.u(34);

select is(
  (select count(*) from public.email_monthly_counts) - (select n from count_rows_before),
  0::bigint,
  'deleting an anonymous account, or an account without pages, keeps nothing'
);

delete from auth.users where id = pg_temp.u(31);

select pg_temp.make_user(pg_temp.u(35), true);

update auth.users set email = 'carry@example.test', is_anonymous = false where id = pg_temp.u(35);

select is(
  (select used from public.page_allowance(pg_temp.u(35))),
  15,
  'an anonymous account that registers on that address inherits the pages kept for it'
);

select set_eq(
  $$
    select a.attname::text, format_type(a.atttypid, a.atttypmod)
    from pg_attribute a
    where a.attrelid = 'public.email_monthly_counts'::regclass and a.attnum > 0 and not a.attisdropped
  $$,
  $$ values ('email_hash', 'bytea'), ('month', 'date'), ('pages', 'integer') $$,
  'what is kept for an address is a hash, a month and a number, never the address'
);

select * from finish();

rollback;
