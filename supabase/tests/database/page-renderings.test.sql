begin;

select plan(34);

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

create function pg_temp.charge(uid uuid) returns text
language sql as $$
  select c.allowed::text || ':' || c.used from public.charge_render(uid) c;
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Second');

insert into public.pages (id, user_id, notebook_id, status) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read'),
  ('45454545-4545-4545-4545-454545454545', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read'),
  ('55555555-5555-5555-5555-555555555555', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'read');

insert into public.page_renderings (page_id, user_id, text, based_on, model, prompt_version) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', E'# Title\n\nSome **bold** text.', repeat('a', 64), 'gemini-3.6-flash', 'R1'),
  ('55555555-5555-5555-5555-555555555555', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Other text', repeat('b', 64), 'gemini-3.6-flash', 'R1');

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is(
  (select array_agg(page_id::text) from public.page_renderings),
  array['44444444-4444-4444-4444-444444444444'],
  'a user reads the renderings of their own pages only'
);

select is(
  (select text from public.page_renderings),
  E'# Title\n\nSome **bold** text.',
  'a rendering keeps its Markdown'
);

select throws_ok(
  $$insert into public.page_renderings (page_id, text, based_on, model, prompt_version)
    values ('45454545-4545-4545-4545-454545454545', 'Invented', repeat('c', 64), 'm', 'R1')$$,
  '42501', null, 'a user cannot write a rendering, even on their own page'
);

select throws_ok(
  $$update public.page_renderings set text = 'Changed'$$,
  '42501', null, 'a user cannot change a rendering'
);

select throws_ok(
  $$delete from public.page_renderings$$,
  '42501', null, 'a user cannot erase a rendering'
);

select throws_ok(
  $$select count(*) from public.render_daily_counts$$,
  '42501', null, 'a user cannot read the count of renderings of the day'
);

select throws_ok(
  $$select * from public.charge_render('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  '42501', null, 'a user cannot take a rendering of the day'
);

reset role;

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select array_agg(page_id::text) from public.page_renderings),
  array['55555555-5555-5555-5555-555555555555'],
  'another user reads only the rendering of their own page'
);

reset role;

select pg_temp.as_anon();

select throws_ok('select count(*) from public.page_renderings', '42501', null, 'a visitor without an account cannot read the renderings');
select throws_ok($$select * from public.charge_render('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$, '42501', null, 'a visitor cannot take a rendering of the day');

reset role;

select is(
  (select count(*) from public.page_renderings),
  2::bigint,
  'those attempts changed nothing'
);

select throws_ok(
  $$insert into public.page_renderings (page_id, user_id, text, based_on, model, prompt_version)
    values ('45454545-4545-4545-4545-454545454545', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'x', repeat('c', 64), 'm', 'R1')$$,
  '23503', null, 'a rendering cannot be attached to the page of another user'
);

select throws_ok(
  $$insert into public.page_renderings (page_id, user_id, text, based_on, model, prompt_version)
    values ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', repeat('c', 64), 'm', 'R1')$$,
  '23505', null, 'a page has one rendering at most'
);

select throws_ok(
  $$insert into public.page_renderings (page_id, user_id, text, based_on, model, prompt_version)
    values ('45454545-4545-4545-4545-454545454545', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '', repeat('c', 64), 'm', 'R1')$$,
  '23514', null, 'a rendering is never empty'
);

select throws_ok(
  $$insert into public.page_renderings (page_id, user_id, text, based_on, model, prompt_version)
    values ('45454545-4545-4545-4545-454545454545', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', repeat('x', 60001), repeat('c', 64), 'm', 'R1')$$,
  '23514', null, 'a rendering is bounded in size'
);

select throws_ok(
  $$insert into public.page_renderings (page_id, user_id, text, based_on, model, prompt_version)
    values ('45454545-4545-4545-4545-454545454545', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', 'not a fingerprint', 'm', 'R1')$$,
  '23514', null, 'the fingerprint of the input text is 64 hexadecimal characters'
);

select throws_ok(
  $$insert into public.page_renderings (page_id, user_id, text, based_on, model, prompt_version)
    values ('45454545-4545-4545-4545-454545454545', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', repeat('C', 64), 'm', 'R1')$$,
  '23514', null, 'the fingerprint is in lower case'
);

select pg_temp.as_server();

select lives_ok(
  $$insert into public.page_renderings (page_id, user_id, text, based_on, model, prompt_version)
    values ('45454545-4545-4545-4545-454545454545', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Plain', repeat('d', 64), 'gemini-3.6-flash', 'R1')$$,
  'the server writes a rendering'
);

select lives_ok(
  $$update public.page_renderings set text = 'Replaced', based_on = repeat('e', 64) where page_id = '45454545-4545-4545-4545-454545454545'$$,
  'the server replaces a rendering'
);

select is(pg_temp.charge('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'true:1', 'the first rendering of the day is allowed');

select lives_ok(
  $$select public.charge_render('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') from generate_series(1, 3)$$,
  'the server takes the following renderings of the day'
);

select is(pg_temp.charge('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'true:5', 'the fifth rendering of the day is allowed');
select is(pg_temp.charge('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'false:5', 'the sixth is refused');
select is(pg_temp.charge('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'false:5', 'a refusal does not count');
select is(pg_temp.charge('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 'true:1', 'the count of one user does not touch another');

select throws_ok(
  $$update public.render_daily_counts set renders = 6 where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  '23514', null, 'a count above the limit is refused by the table'
);

select throws_ok(
  $$select * from public.charge_render('99999999-9999-9999-9999-999999999999')$$,
  '23503', null, 'an account that does not exist has no rendering of the day'
);

select throws_ok($$select * from public.charge_render(null)$$, 'P0001', 'account_not_found', 'a call without an account is refused');

reset role;

update public.render_daily_counts
set day = day - 1
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select pg_temp.as_server();

select is(pg_temp.charge('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'true:1', 'the next day starts a new count');

reset role;

select is(
  (select count(*) from public.render_daily_counts where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint,
  'the count of an earlier day is dropped'
);

select is(
  (select count(*) from public.page_charges where user_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')),
  0::bigint,
  'a rendering takes nothing from the monthly limit'
);

select is(
  has_table_privilege('authenticated', 'public.page_renderings', 'select')
    and not has_table_privilege('authenticated', 'public.page_renderings', 'insert')
    and not has_table_privilege('authenticated', 'public.page_renderings', 'update')
    and not has_table_privilege('authenticated', 'public.page_renderings', 'delete')
    and not has_table_privilege('authenticated', 'public.render_daily_counts', 'select')
    and not has_function_privilege('authenticated', 'public.charge_render(uuid)', 'execute')
    and has_function_privilege('service_role', 'public.charge_render(uuid)', 'execute')
    and (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.charge_render(uuid)'::regprocedure),
  true,
  'a user only reads renderings; the server alone writes them and takes the count, with the rights of its owner'
);

delete from public.pages where id = '44444444-4444-4444-4444-444444444444';

select is(
  (select count(*) from public.page_renderings where page_id = '44444444-4444-4444-4444-444444444444'),
  0::bigint,
  'deleting a page deletes its rendering'
);

delete from auth.users where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select is(
  (select count(*) from public.page_renderings where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
    + (select count(*) from public.render_daily_counts where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0::bigint,
  'deleting an account deletes its renderings and its count'
);

select * from finish();

rollback;
