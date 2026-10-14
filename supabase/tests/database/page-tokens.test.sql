begin;

select plan(28);

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

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Second');

insert into public.pages (id, user_id, notebook_id, status) values
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read'),
  ('55555555-5555-5555-5555-555555555555', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'read');

insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_a, reading_b1, anchor_kind, anchor) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 0, 0, 'Bonjour', 'Bonjonr', 'Bonjour', 'word', array[10, 20, 90, 60]),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 1, 0, 'Paul', null, 'Paul', 'line', array[0, 18, 1700, 64]),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 2, 1, 'fin', null, 'fin', null, null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 0, 0, 'Autre', 'Autre', 'Autre', 'word', array[5, 5, 50, 40]);

select pg_temp.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select is(
  (select array_agg(text order by token_index) from public.page_tokens),
  array['Bonjour', 'Paul', 'fin'],
  'a user reads the positions of their own pages only'
);

select is(
  (select anchor from public.page_tokens where token_index = 0),
  array[10, 20, 90, 60],
  'a position keeps its anchor as the box of four numbers the service gives'
);

select throws_ok(
  $$insert into public.page_tokens (page_id, token_index, line_index, text, reading_b1)
    values ('44444444-4444-4444-4444-444444444444', 3, 1, 'Invented', 'Invented')$$,
  '42501', null, 'a user cannot write a position, even on their own page'
);

select throws_ok(
  $$update public.page_tokens set text = 'Changed'$$,
  '42501', null, 'a user cannot change the word written at a position'
);

select throws_ok(
  $$update public.page_tokens set rule = 4, channel = 'layer'$$,
  '42501', null, 'a user cannot change the rule of a position'
);

select throws_ok(
  $$delete from public.page_tokens$$,
  '42501', null, 'a user cannot delete a position'
);

reset role;

select pg_temp.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select array_agg(text) from public.page_tokens),
  array['Autre'],
  'another user reads only the positions of their own page'
);

reset role;

select pg_temp.as_anon();

select throws_ok('select count(*) from public.page_tokens', '42501', null, 'a visitor without an account cannot read the positions');

reset role;

select is(
  (select count(*) from public.page_tokens where text in ('Invented', 'Changed') or rule is not null),
  0::bigint,
  'those attempts changed nothing'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x')$$,
  '23503', null, 'a position cannot be attached to the page of another user'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 0, 0, 'x', 'x')$$,
  '23505', null, 'a page has one position per rank of B1'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', -1, 0, 'x', 'x')$$,
  '23514', null, 'a negative rank is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, -1, 'x', 'x')$$,
  '23514', null, 'a negative line is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, rule)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', 4)$$,
  '23514', null, 'a rule without its channel is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, rule, channel)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', 11, 'none')$$,
  '23514', null, 'a rule outside 1 to 10 is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, rule, channel)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', 4, 'popup')$$,
  '23514', null, 'a channel that does not exist is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, anchor_kind)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', 'word')$$,
  '23514', null, 'a kind of anchor without its box is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, anchor_kind, anchor)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', 'page', array[0, 0, 1, 1])$$,
  '23514', null, 'a kind of anchor that does not exist is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, anchor_kind, anchor)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', 'word', array[0, 0, 1])$$,
  '23514', null, 'a box of three numbers is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, anchor_kind, anchor)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', 'word', array[5, 0, 5, 1])$$,
  '23514', null, 'an empty box is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, anchor_kind, anchor)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', 'word', array[-1, 0, 5, 1])$$,
  '23514', null, 'a box outside the photo is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, anchor_kind, anchor)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', 'x', 'word', array[0, null, 5, 1])$$,
  '23514', null, 'a box with a missing number is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', '')$$,
  '23514', null, 'an empty word of B1 is refused'
);

select throws_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_a, reading_b1)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 9, 0, 'x', '', 'x')$$,
  '23514', null, 'a reading of A that is empty is refused: A that read nothing here has no reading'
);

select pg_temp.as_server();

select lives_ok(
  $$insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_a, reading_b1, rule, channel, anchor_kind, anchor)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 3, 1, 'mot', 'mot', 'mot', 9, 'none', 'word', array[1, 2, 3, 4])$$,
  'the server writes a position with its rule and its channel'
);

select lives_ok(
  $$update public.page_tokens set rule = null, channel = null where token_index = 3 and page_id = '44444444-4444-4444-4444-444444444444'$$,
  'the server can clear the decision of a position'
);

reset role;

delete from public.pages where id = '44444444-4444-4444-4444-444444444444';

select is(
  (select count(*) from public.page_tokens where page_id = '44444444-4444-4444-4444-444444444444'),
  0::bigint,
  'deleting a page deletes its positions'
);

delete from auth.users where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select is(
  (select count(*) from public.page_tokens where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0::bigint,
  'deleting an account deletes its positions'
);

select * from finish();

rollback;
