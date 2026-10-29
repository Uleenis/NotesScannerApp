begin;

select plan(54);

create function pg_temp.make_user(uid uuid) returns void
language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at) values (uid, uid::text || '@example.test', now());
  update public.profiles
  set birth_year = extract(year from now() at time zone 'Europe/Paris')::integer - 30, country = 'FR'
  where id = uid;
end;
$$;

create function pg_temp.login(uid uuid) returns void
language sql as $$
  select
    set_config('role', 'authenticated', true),
    set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.accept_test(uid uuid, test uuid, checked timestamptz) returns void
language sql as $$
  insert into public.writing_tests (id, user_id, template, status, training_lines, validation_lines, created_at, checked_at)
  values (test, uid, 'fr', 'accepted', 30, 10, checked, checked);
$$;

create function pg_temp.store_model(uid uuid, attempt uuid, bytes bigint) returns void
language sql as $$
  insert into storage.objects (bucket_id, name, metadata)
  values ('models', uid::text || '/' || attempt::text || '.safetensors', jsonb_build_object('size', bytes));
$$;

create function pg_temp.report(attempt uuid, cer numeric, base_cer numeric, faults integer, base_faults integer)
returns table (outcome text, remove text[])
language sql as $$
  select * from public.report_training_task(attempt, 'trained', cer, base_cer, faults, base_faults, 80, 500, repeat('a', 64));
$$;

select pg_temp.make_user('e5e5e5e5-0000-0000-0000-000000000001');
select pg_temp.make_user('e5e5e5e5-0000-0000-0000-000000000002');
select pg_temp.make_user('e5e5e5e5-0000-0000-0000-000000000003');
select pg_temp.make_user('e5e5e5e5-0000-0000-0000-000000000004');

insert into public.consents (user_id, kind, version, granted_by) values
  ('e5e5e5e5-0000-0000-0000-000000000001', 'training', 'training-1', 'user'),
  ('e5e5e5e5-0000-0000-0000-000000000002', 'training', 'training-1', 'user'),
  ('e5e5e5e5-0000-0000-0000-000000000004', 'training', 'training-1', 'user');

select has_table('public', 'training_tasks', 'the training tasks have a table');
select is(
  (select relrowsecurity from pg_class where oid = 'public.training_tasks'::regclass),
  true,
  'row level security is on for the training tasks'
);
select is(
  (select bool_or(has_table_privilege(role, 'public.training_tasks', priv))
   from (values ('anon'), ('authenticated')) as r(role)
   cross join (values ('select'), ('insert'), ('update'), ('delete')) as p(priv)),
  false,
  'neither anon nor a signed-in user has any right on the training tasks'
);
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('claim_training_task', 'training_upload_target', 'report_training_task', 'model_orphans', 'writing_test_orphans')
     and p.prosecdef and p.proconfig = array['search_path=""']),
  array['claim_training_task', 'model_orphans', 'report_training_task', 'training_upload_target', 'writing_test_orphans'],
  'the functions of the trainer run with the rights of their owner and an empty search path'
);
select is(
  (select bool_or(has_function_privilege(role, p.oid, 'execute'))
   from pg_proc p cross join (values ('anon'), ('authenticated')) as r(role)
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('claim_training_task', 'training_upload_target', 'report_training_task', 'model_orphans', 'writing_test_orphans')),
  false,
  'neither anon nor a signed-in user can call them'
);
select is(
  (select bool_and(has_function_privilege('service_role', p.oid, 'execute'))
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('claim_training_task', 'training_upload_target', 'report_training_task', 'model_orphans', 'writing_test_orphans')),
  true,
  'the server calls them'
);

select is(public.claim_training_task(), null, 'no task is claimed while nobody has an accepted test');

insert into public.writing_tests (id, user_id, template) values
  ('f5f5f5f5-0000-0000-0000-000000000001', 'e5e5e5e5-0000-0000-0000-000000000001', 'fr');
select is(
  (select outcome from public.finish_writing_test('e5e5e5e5-0000-0000-0000-000000000001', 'f5f5f5f5-0000-0000-0000-000000000001', 20, 10, 10)),
  'accepted',
  'the first test is accepted'
);
select is(
  (select count(*)::integer from public.training_tasks where user_id = 'e5e5e5e5-0000-0000-0000-000000000001' and status = 'queued'),
  1,
  'an accepted test creates a task in the same transaction'
);

select pg_temp.accept_test('e5e5e5e5-0000-0000-0000-000000000003', 'f5f5f5f5-0000-0000-0000-000000000003', now() - interval '1 hour');

insert into public.notebooks (id, user_id, name) values
  ('a5a5a5a5-0000-0000-0000-000000000001', 'e5e5e5e5-0000-0000-0000-000000000001', 'Journal'),
  ('a5a5a5a5-0000-0000-0000-000000000002', 'e5e5e5e5-0000-0000-0000-000000000002', 'Other');

insert into public.pages (id, user_id, notebook_id, status, page_type, read_at) values
  ('b5b5b5b5-0000-0000-0000-000000000001', 'e5e5e5e5-0000-0000-0000-000000000001', 'a5a5a5a5-0000-0000-0000-000000000001', 'read', 'text', now() - interval '2 hours'),
  ('b5b5b5b5-0000-0000-0000-000000000002', 'e5e5e5e5-0000-0000-0000-000000000001', 'a5a5a5a5-0000-0000-0000-000000000001', 'read', 'math', now() - interval '2 hours'),
  ('b5b5b5b5-0000-0000-0000-000000000003', 'e5e5e5e5-0000-0000-0000-000000000001', 'a5a5a5a5-0000-0000-0000-000000000001', 'queued', 'text', null),
  ('b5b5b5b5-0000-0000-0000-000000000004', 'e5e5e5e5-0000-0000-0000-000000000001', 'a5a5a5a5-0000-0000-0000-000000000001', 'read', 'text', now() - interval '2 hours'),
  ('b5b5b5b5-0000-0000-0000-000000000005', 'e5e5e5e5-0000-0000-0000-000000000001', 'a5a5a5a5-0000-0000-0000-000000000001', 'read', 'text', now() - interval '1 hour'),
  ('b5b5b5b5-0000-0000-0000-000000000006', 'e5e5e5e5-0000-0000-0000-000000000002', 'a5a5a5a5-0000-0000-0000-000000000002', 'read', 'text', now() - interval '1 hour');

insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
select g.user_id, g.id, 'B1', 'Bonjour Paul', 'gemini-3.6-flash', 'gemini-3.6-flash-001', 'V0', 0, 10, 2, 1500
from public.pages g where g.id::text like 'b5b5b5b5-%';

insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_a, reading_b1, b1_start, b1_end) values
  ('e5e5e5e5-0000-0000-0000-000000000001', 'b5b5b5b5-0000-0000-0000-000000000001', 0, 0, 'Bonjour', 'Bonjour', 'Bonjour', 0, 7),
  ('e5e5e5e5-0000-0000-0000-000000000001', 'b5b5b5b5-0000-0000-0000-000000000001', 1, 0, 'Paul', 'Pual', 'Paul', 8, 12),
  ('e5e5e5e5-0000-0000-0000-000000000001', 'b5b5b5b5-0000-0000-0000-000000000004', 0, 0, 'Bonjour', 'Bonjour', 'Bonjour', 0, 7),
  ('e5e5e5e5-0000-0000-0000-000000000001', 'b5b5b5b5-0000-0000-0000-000000000004', 1, 0, 'Paul', 'Paul', 'Paul', 8, 12);

insert into public.page_gaps (page_id, user_id, gap_index, text) values
  ('b5b5b5b5-0000-0000-0000-000000000004', 'e5e5e5e5-0000-0000-0000-000000000001', 0, 'Le ');

select pg_temp.login('e5e5e5e5-0000-0000-0000-000000000001');
insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
  values ('b5b5b5b5-0000-0000-0000-000000000001', 1, 'Pavel', 'keyboard');
insert into public.corrections (page_id, token_index, corrected_text, chosen_from)
  values ('b5b5b5b5-0000-0000-0000-000000000001', 1, 'Paule', 'keyboard');
select throws_ok(
  $$select count(*) from public.training_tasks$$,
  '42501', null, 'a signed-in user reads no training task, not even their own'
);
reset role;

create temp table claimed as select public.claim_training_task() as task;

select is(
  (select task ->> 'user_id' from claimed),
  'e5e5e5e5-0000-0000-0000-000000000001',
  'the task of the user who consents and has an accepted test is claimed'
);
select is(
  (select count(*)::integer from public.training_tasks where user_id = 'e5e5e5e5-0000-0000-0000-000000000003'),
  0,
  'no task is born for an accepted test without an active consent'
);
select is(
  (select task ->> 'template' from claimed),
  'fr',
  'the task names the template of the accepted test'
);
select is(
  (select task ->> 'test_id' from claimed),
  'f5f5f5f5-0000-0000-0000-000000000001',
  'the task names the accepted test'
);
select is((select task -> 'model' from claimed), 'null'::jsonb, 'without a personal model the task reads with the generic one');
select is(
  (select array_agg(p ->> 'page_id' order by p ->> 'page_id') from claimed, jsonb_array_elements(task -> 'pages') p),
  array['b5b5b5b5-0000-0000-0000-000000000001', 'b5b5b5b5-0000-0000-0000-000000000005'],
  'the task gives only the read text pages of the user that were not retouched'
);
select is(
  (select task -> 'pages' -> 0 ->> 'page_id' from claimed),
  'b5b5b5b5-0000-0000-0000-000000000005',
  'the most recent page comes first'
);
select is(
  (select p -> 'corrections' from claimed, jsonb_array_elements(task -> 'pages') p where p ->> 'page_id' = 'b5b5b5b5-0000-0000-0000-000000000001'),
  '[{"token_index": 1, "text": "Paule", "reading_a": "Pual"}]'::jsonb,
  'each corrected position gives its last correction and the reading of A'
);
select is(
  (select p ->> 'b1' from claimed, jsonb_array_elements(task -> 'pages') p where p ->> 'page_id' = 'b5b5b5b5-0000-0000-0000-000000000001'),
  'Bonjour Paul',
  'each page gives its B1'
);
select is(
  (select status || '/' || attempts from public.training_tasks where user_id = 'e5e5e5e5-0000-0000-0000-000000000001'),
  'claimed/1',
  'the task is claimed once'
);
select is(public.claim_training_task(), null, 'a claimed task is not given twice');

select is(
  (select outcome || ' ' || path from public.training_upload_target(((select task ->> 'task_id' from claimed))::uuid)),
  'ready e5e5e5e5-0000-0000-0000-000000000001/' || (select task ->> 'task_id' from claimed) || '.safetensors',
  'the upload path is fixed by the task: the folder of its user and the id of the attempt'
);
select is(
  (select outcome from public.training_upload_target(gen_random_uuid())),
  'task_not_found',
  'an unknown task gets no upload path'
);

select throws_ok(
  $$select * from public.report_training_task((select task ->> 'task_id' from claimed)::uuid, 'trained', -1, 0.3, 0, 0, 80, 500, repeat('a', 64))$$,
  '22023', 'invalid_report', 'a report out of its bounds is refused'
);
select throws_ok(
  $$select * from public.report_training_task((select task ->> 'task_id' from claimed)::uuid, 'trained', 0.1, 0.3, 0, 0, 80, 500, 'nope')$$,
  '22023', 'invalid_report', 'a report without a valid fingerprint is refused'
);

select is(
  (select outcome from pg_temp.report((select task ->> 'task_id' from claimed)::uuid, 0.10, 0.30, 0, 1)),
  'model_missing',
  'a report whose file was never uploaded fails the task'
);

select pg_temp.accept_test('e5e5e5e5-0000-0000-0000-000000000002', 'f5f5f5f5-0000-0000-0000-000000000002', now());
create temp table second_claim as select public.claim_training_task() as task;
select is(
  (select task ->> 'user_id' from second_claim),
  'e5e5e5e5-0000-0000-0000-000000000002',
  'a test accepted outside the function is also given its task at the next claim'
);
select pg_temp.store_model('e5e5e5e5-0000-0000-0000-000000000002', (select task ->> 'task_id' from second_claim)::uuid, 60000000);
select is(
  (select outcome || ' ' || array_length(remove, 1) from pg_temp.report((select task ->> 'task_id' from second_claim)::uuid, 0.30, 0.30, 0, 1)),
  'rejected 1',
  'a model that does not lower the CER is rejected and its file erased'
);
select is(
  (select count(*)::integer from public.htr_models where user_id = 'e5e5e5e5-0000-0000-0000-000000000002'),
  0,
  'a rejected model leaves no row'
);

update public.training_tasks set created_at = now() - interval '25 hours', finished_at = now() - interval '25 hours'
where user_id = 'e5e5e5e5-0000-0000-0000-000000000002';
update public.writing_tests set checked_at = now() - interval '26 hours' where user_id = 'e5e5e5e5-0000-0000-0000-000000000002';
insert into public.pages (user_id, notebook_id, status, page_type, read_at)
select 'e5e5e5e5-0000-0000-0000-000000000002', 'a5a5a5a5-0000-0000-0000-000000000002', 'read', 'text', now() - interval '1 hour'
from generate_series(1, 18);
select is(public.claim_training_task(), null, '19 text pages read since the last task are not enough');
insert into public.pages (user_id, notebook_id, status, page_type, read_at) values
  ('e5e5e5e5-0000-0000-0000-000000000002', 'a5a5a5a5-0000-0000-0000-000000000002', 'read', 'math', now() - interval '1 hour');
select is(public.claim_training_task(), null, 'a math page does not count in the cadence');
update public.training_tasks set created_at = now() - interval '23 hours' where user_id = 'e5e5e5e5-0000-0000-0000-000000000002';
insert into public.pages (user_id, notebook_id, status, page_type, read_at) values
  ('e5e5e5e5-0000-0000-0000-000000000002', 'a5a5a5a5-0000-0000-0000-000000000002', 'read', 'text', now());
select is(public.claim_training_task(), null, 'twenty pages wait until the last task is a day old');
update public.training_tasks set created_at = now() - interval '25 hours' where user_id = 'e5e5e5e5-0000-0000-0000-000000000002';
create temp table third_claim as select public.claim_training_task() as task;
select is(
  (select task ->> 'user_id' from third_claim),
  'e5e5e5e5-0000-0000-0000-000000000002',
  'twenty text pages read since a task a day old give a new task'
);

select pg_temp.store_model('e5e5e5e5-0000-0000-0000-000000000002', (select task ->> 'task_id' from third_claim)::uuid, 60000000);
select is(
  (select outcome || ' ' || coalesce(array_length(remove, 1), 0) from pg_temp.report((select task ->> 'task_id' from third_claim)::uuid, 0.20, 0.30, 1, 1)),
  'activated 0',
  'a model with a lower CER that writes no more faults correctly becomes active'
);
select is(
  (select status || ' ' || cer || ' ' || faults_correct || ' ' || storage_path from public.htr_models where user_id = 'e5e5e5e5-0000-0000-0000-000000000002'),
  'active 0.20 1 e5e5e5e5-0000-0000-0000-000000000002/' || (select task ->> 'task_id' from third_claim) || '.safetensors',
  'the active model keeps its measures and its file'
);
select is(
  (select status from public.training_tasks where attempt_id = (select task ->> 'task_id' from third_claim)::uuid),
  'done',
  'the reported task is done'
);
select is(
  (select outcome from pg_temp.report((select task ->> 'task_id' from third_claim)::uuid, 0.10, 0.20, 0, 1)),
  'task_not_found',
  'a second report of the same task is refused'
);

update public.training_tasks set created_at = now() - interval '25 hours' where user_id = 'e5e5e5e5-0000-0000-0000-000000000002';
insert into public.pages (user_id, notebook_id, status, page_type, read_at)
select 'e5e5e5e5-0000-0000-0000-000000000002', 'a5a5a5a5-0000-0000-0000-000000000002', 'read', 'text', now()
from generate_series(1, 20);
create temp table fourth_claim as select public.claim_training_task() as task;
select is(
  (select task -> 'model' ->> 'path' from fourth_claim),
  (select storage_path from public.htr_models where user_id = 'e5e5e5e5-0000-0000-0000-000000000002' and status = 'active'),
  'the task gives the active personal model'
);
select pg_temp.store_model('e5e5e5e5-0000-0000-0000-000000000002', (select task ->> 'task_id' from fourth_claim)::uuid, 60000000);
select is(
  (select outcome from pg_temp.report((select task ->> 'task_id' from fourth_claim)::uuid, 0.10, 0.20, 2, 1)),
  'rejected',
  'a model that writes more faults in their correct form is rejected even with a lower CER'
);

update public.training_tasks set created_at = now() - interval '25 hours' where user_id = 'e5e5e5e5-0000-0000-0000-000000000002';
insert into public.pages (user_id, notebook_id, status, page_type, read_at)
select 'e5e5e5e5-0000-0000-0000-000000000002', 'a5a5a5a5-0000-0000-0000-000000000002', 'read', 'text', now()
from generate_series(1, 20);
create temp table fifth_claim as select public.claim_training_task() as task;
select pg_temp.store_model('e5e5e5e5-0000-0000-0000-000000000002', (select task ->> 'task_id' from fifth_claim)::uuid, 60000000);
select is(
  (select outcome from pg_temp.report((select task ->> 'task_id' from fifth_claim)::uuid, 0.10, 0.20, 1, 1)),
  'activated',
  'a better model replaces the active one'
);
select is(
  (select string_agg(status, ',' order by version) from public.htr_models where user_id = 'e5e5e5e5-0000-0000-0000-000000000002'),
  'retired,active',
  'the replaced model is retired and keeps its file until the next replacement'
);

update public.training_tasks set created_at = now() - interval '25 hours' where user_id = 'e5e5e5e5-0000-0000-0000-000000000002';
insert into public.pages (user_id, notebook_id, status, page_type, read_at)
select 'e5e5e5e5-0000-0000-0000-000000000002', 'a5a5a5a5-0000-0000-0000-000000000002', 'read', 'text', now()
from generate_series(1, 20);
create temp table sixth_claim as select public.claim_training_task() as task;
select pg_temp.store_model('e5e5e5e5-0000-0000-0000-000000000002', (select task ->> 'task_id' from sixth_claim)::uuid, 60000000);
select is(
  (select remove from pg_temp.report((select task ->> 'task_id' from sixth_claim)::uuid, 0.05, 0.10, 1, 1)),
  array['e5e5e5e5-0000-0000-0000-000000000002/' || (select task ->> 'task_id' from third_claim) || '.safetensors'],
  'the oldest retired model is deleted with its file'
);
select is(
  (select count(*)::integer from public.htr_models where user_id = 'e5e5e5e5-0000-0000-0000-000000000002'),
  2,
  'one active model and the one it replaced remain'
);

select pg_temp.accept_test('e5e5e5e5-0000-0000-0000-000000000004', 'f5f5f5f5-0000-0000-0000-000000000004', now());
create temp table expiring as select public.claim_training_task() as task;
update public.training_tasks set claimed_at = now() - interval '3 hours' where user_id = 'e5e5e5e5-0000-0000-0000-000000000004';
create temp table again as select public.claim_training_task() as task;
select is(
  (select status || '/' || attempts from public.training_tasks where user_id = 'e5e5e5e5-0000-0000-0000-000000000004'),
  'claimed/2',
  'a task claimed for more than two hours goes back to the queue once'
);
select isnt(
  (select task ->> 'task_id' from again),
  (select task ->> 'task_id' from expiring),
  'the second attempt has a new id, so the first one can no longer upload or report'
);
select is(
  (select outcome from public.training_upload_target((select task ->> 'task_id' from expiring)::uuid)),
  'task_not_found',
  'the expired attempt gets no upload path'
);
update public.training_tasks set claimed_at = now() - interval '3 hours' where user_id = 'e5e5e5e5-0000-0000-0000-000000000004';
select is(public.claim_training_task(), null, 'a task that expires twice is not given again');
select is(
  (select status from public.training_tasks where user_id = 'e5e5e5e5-0000-0000-0000-000000000004'),
  'failed',
  'a task that expires twice fails'
);

select throws_ok(
  $$insert into public.training_tasks (user_id) values ('e5e5e5e5-0000-0000-0000-000000000002'), ('e5e5e5e5-0000-0000-0000-000000000002')$$,
  '23505', null, 'a user has one open task at most'
);

update public.training_tasks set created_at = now() - interval '25 hours' where user_id = 'e5e5e5e5-0000-0000-0000-000000000002';
insert into public.pages (user_id, notebook_id, status, page_type, read_at)
select 'e5e5e5e5-0000-0000-0000-000000000002', 'a5a5a5a5-0000-0000-0000-000000000002', 'read', 'text', now()
from generate_series(1, 20);
create temp table revoked_claim as select public.claim_training_task() as task;
select pg_temp.store_model('e5e5e5e5-0000-0000-0000-000000000002', (select task ->> 'task_id' from revoked_claim)::uuid, 60000000);
select public.revoke_training('e5e5e5e5-0000-0000-0000-000000000002');
select is(
  (select count(*)::integer from public.training_tasks where user_id = 'e5e5e5e5-0000-0000-0000-000000000002'),
  0,
  'the withdrawal deletes the tasks'
);
select is(
  (select outcome || ' ' || array_to_string(remove, ',') from pg_temp.report((select task ->> 'task_id' from revoked_claim)::uuid, 0.01, 0.10, 0, 1)),
  'task_not_found e5e5e5e5-0000-0000-0000-000000000002/' || (select task ->> 'task_id' from revoked_claim) || '.safetensors',
  'a report that arrives after the withdrawal is refused and names its file to erase'
);
select is(
  (select count(*)::integer from public.htr_models where user_id = 'e5e5e5e5-0000-0000-0000-000000000002'),
  0,
  'no model is written after the withdrawal'
);

insert into storage.objects (bucket_id, name, created_at, updated_at) values
  ('models', 'e5e5e5e5-0000-0000-0000-000000000009/c5c5c5c5-0000-0000-0000-000000000001.safetensors', now() - interval '25 hours', now() - interval '25 hours'),
  ('models', 'e5e5e5e5-0000-0000-0000-000000000009/c5c5c5c5-0000-0000-0000-000000000002.safetensors', now() - interval '23 hours', now() - interval '23 hours'),
  ('photos', 'e5e5e5e5-0000-0000-0000-000000000001/writing-tests/f5f5f5f5-0000-0000-0000-000000000001/1.jpg', now() - interval '25 hours', now() - interval '25 hours'),
  ('photos', 'e5e5e5e5-0000-0000-0000-000000000001/writing-tests/c5c5c5c5-0000-0000-0000-000000000009/2.jpg', now() - interval '25 hours', now() - interval '25 hours'),
  ('photos', 'e5e5e5e5-0000-0000-0000-000000000001/writing-tests/c5c5c5c5-0000-0000-0000-000000000008/1.jpg', now() - interval '23 hours', now() - interval '23 hours');

select is(
  (select array_agg(name) from public.model_orphans(100) where name like 'e5e5e5e5-0000-0000-0000-000000000009/%'),
  array['e5e5e5e5-0000-0000-0000-000000000009/c5c5c5c5-0000-0000-0000-000000000001.safetensors'],
  'a model file no row names for more than a day is an orphan, a younger one is not'
);
select is(
  (select array_agg(name) from public.writing_test_orphans(100) where name like 'e5e5e5e5-0000-0000-0000-000000000001/%'),
  array['e5e5e5e5-0000-0000-0000-000000000001/writing-tests/c5c5c5c5-0000-0000-0000-000000000009/2.jpg'],
  'a test photo no kept test names for more than a day is an orphan; the accepted test keeps its photos'
);

select * from finish();
rollback;
