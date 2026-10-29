begin;

select plan(29);

create function pg_temp.make_user(uid uuid) returns void
language sql as $$
  insert into auth.users (id, email) values (uid, uid::text || '@example.test');
$$;

create function pg_temp.as_server() returns void
language sql as $$
  select set_config('role', 'service_role', true);
$$;

create function pg_temp.plain() returns jsonb
language sql as $$
  select '[{"token_index": 0, "line_index": 0, "text": "Bonjour", "reading_a": "Bonjour", "reading_b1": "Bonjour", "anchor_kind": null, "anchor": null}]'::jsonb;
$$;

create function pg_temp.ruled() returns jsonb
language sql as $$
  select '[{"token_index": 0, "line_index": 0, "text": "Bonsoir", "rule": 5, "channel": "layer", "reading_a": "Bonsoir", "reading_b1": "Bonjour", "anchor_kind": null, "anchor": null}]'::jsonb;
$$;

create function pg_temp.record(page uuid, model text, version text, model_id uuid, tokens jsonb default pg_temp.plain()) returns text
language sql as $$
  select row(r.recorded, r.reason)::text
  from public.record_reading_a(
    page,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Bonjour',
    model,
    version,
    28000,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/' || page::text || '/a.xml',
    'fr',
    tokens,
    '[]'::jsonb,
    model_id
  ) r;
$$;

select pg_temp.make_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.make_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.notebooks (id, user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First');

insert into public.pages (id, user_id, notebook_id, status, page_type)
select ('a6000000-0000-0000-0000-00000000000' || n)::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'read', 'text'
from generate_series(1, 9) n;

insert into public.htr_models (id, user_id, name, version, status, storage_path, cer, sha256) values
  ('c6000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'personal', 1, 'retired', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/c6000000-0000-0000-0000-000000000001.safetensors', 0.05, repeat('a', 64)),
  ('c6000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'personal', 2, 'active', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/c6000000-0000-0000-0000-000000000002.safetensors', 0.129, repeat('b', 64)),
  ('c6000000-0000-0000-0000-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'personal', 1, 'active', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/c6000000-0000-0000-0000-000000000003.safetensors', 0.05, repeat('c', 64));

select has_column('public', 'readings', 'htr_model_id', 'a reading keeps the model that made it');
select is(
  (select count(*) from pg_constraint c where c.conrelid = 'public.readings'::regclass and c.contype = 'f'
     and c.confrelid = 'public.htr_models'::regclass and array_length(c.conkey, 1) = 2),
  1::bigint,
  'the model of a reading is tied to the model and the owner together'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'record_reading_a'),
  1::bigint,
  'one function writes A'
);
select is(has_function_privilege('anon', 'public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb, jsonb, uuid)', 'execute'), false, 'a visitor cannot write A');
select is(has_function_privilege('authenticated', 'public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb, jsonb, uuid)', 'execute'), false, 'a signed-in user cannot write A');
select is(has_function_privilege('service_role', 'public.record_reading_a(uuid, uuid, text, text, text, integer, text, text, jsonb, jsonb, uuid)', 'execute'), true, 'the server can write A');
select is(has_function_privilege('authenticated', 'private.model_in_service(uuid, uuid)', 'execute'), false, 'a signed-in user cannot ask whether a model is in service');

select is(private.model_in_service('c6000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), true, 'an active model at the threshold is in service');
select is(private.model_in_service('c6000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), false, 'a retired model is not in service');
select is(private.model_in_service('c6000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), false, 'the model of another user is not in service for this one');
select is(private.model_in_service(null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), false, 'the generic is not a model in service');

select pg_temp.as_server();

select is(pg_temp.record('a6000000-0000-0000-0000-000000000001', 'medium', '1', null), '(t,recorded)', 'A read by the generic is written');
reset role;
select is(
  (select row(model, model_version, htr_model_id)::text from public.readings where page_id = 'a6000000-0000-0000-0000-000000000001' and label = 'A'),
  '(medium,1,)',
  'A read by the generic keeps no personal model'
);

select pg_temp.as_server();
select is(
  pg_temp.record('a6000000-0000-0000-0000-000000000002', 'personal', '2', 'c6000000-0000-0000-0000-000000000002', pg_temp.ruled()),
  '(t,recorded)',
  'A read by the model in service is written with the decisions of the rules'
);
reset role;
select is(
  (select row(model, model_version, htr_model_id)::text from public.readings where page_id = 'a6000000-0000-0000-0000-000000000002' and label = 'A'),
  '(personal,2,c6000000-0000-0000-0000-000000000002)',
  'A keeps the personal model that read it'
);
select is(
  (select rule from public.page_tokens where page_id = 'a6000000-0000-0000-0000-000000000002'),
  5::smallint,
  'the decision of the rule is kept'
);

select pg_temp.as_server();
select is(
  pg_temp.record('a6000000-0000-0000-0000-000000000003', 'personal', '1', 'c6000000-0000-0000-0000-000000000003'),
  '(f,model_not_found)',
  'A cannot name the model of another user'
);
select is(
  pg_temp.record('a6000000-0000-0000-0000-000000000003', 'personal', '9', 'c6000000-0000-0000-0000-0000000000ff'),
  '(f,model_not_found)',
  'A cannot name a model that does not exist'
);
reset role;
select is(
  (select count(*) from public.readings where page_id = 'a6000000-0000-0000-0000-000000000003'),
  0::bigint,
  'a refused A writes nothing'
);

select pg_temp.as_server();
select throws_ok(
  $$select pg_temp.record('a6000000-0000-0000-0000-000000000004', 'medium', '1', null, pg_temp.ruled())$$,
  '23514', 'rules_without_model_in_service', 'the rules cannot decide a page read by the generic'
);
select throws_ok(
  $$select pg_temp.record('a6000000-0000-0000-0000-000000000004', 'personal', '1', 'c6000000-0000-0000-0000-000000000001', pg_temp.ruled())$$,
  '23514', 'rules_without_model_in_service', 'the rules cannot decide a page read by a retired model'
);
select is(
  pg_temp.record('a6000000-0000-0000-0000-000000000004', 'personal', '1', 'c6000000-0000-0000-0000-000000000001'),
  '(t,recorded)',
  'a page read by a retired model is written without rules'
);
select throws_ok(
  $$select pg_temp.record('a6000000-0000-0000-0000-000000000005', 'personal', '2', null)$$,
  '23514', 'invalid_model', 'a personal reading names its model'
);
select throws_ok(
  $$select pg_temp.record('a6000000-0000-0000-0000-000000000005', 'medium', '1', 'c6000000-0000-0000-0000-000000000002')$$,
  '23514', 'invalid_model', 'a generic reading names no personal model'
);
reset role;

update public.htr_models set cer = 0.1291 where id = 'c6000000-0000-0000-0000-000000000002';
select pg_temp.as_server();
select throws_ok(
  $$select pg_temp.record('a6000000-0000-0000-0000-000000000006', 'personal', '2', 'c6000000-0000-0000-0000-000000000002', pg_temp.ruled())$$,
  '23514', 'rules_without_model_in_service', 'the rules cannot decide a page read by a model above the threshold'
);
reset role;
update public.htr_models set cer = 0.129 where id = 'c6000000-0000-0000-0000-000000000002';

select throws_ok(
  $$insert into public.readings (user_id, page_id, label, raw_text, model, model_version, duration_ms, alto_path, htr_model_id)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a6000000-0000-0000-0000-000000000007', 'A', 'x', 'personal', '1', 1,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a6000000-0000-0000-0000-000000000007/a.xml', 'c6000000-0000-0000-0000-000000000003')$$,
  '23503', null, 'a reading cannot point at the model of another user'
);

delete from public.htr_models where id = 'c6000000-0000-0000-0000-000000000001';
select is(
  (select row(model, htr_model_id)::text from public.readings where page_id = 'a6000000-0000-0000-0000-000000000004' and label = 'A'),
  '(personal,)',
  'a reading outlives its model, which it no longer names'
);

select pg_temp.as_server();
select is(
  pg_temp.record('a6000000-0000-0000-0000-000000000008', 'personal', '1', 'c6000000-0000-0000-0000-000000000001'),
  '(f,model_not_found)',
  'A read by a model erased meanwhile is refused'
);
reset role;

select is(
  (select count(*) from public.page_tokens where page_id in ('a6000000-0000-0000-0000-000000000004', 'a6000000-0000-0000-0000-000000000005', 'a6000000-0000-0000-0000-000000000006') and rule is not null),
  0::bigint,
  'no refused page holds a decision of the rules'
);

select * from finish();
rollback;
