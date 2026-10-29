alter table public.htr_models
  add column sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  add column faults_correct smallint check (faults_correct between 0 and 8);

update storage.buckets
set file_size_limit = 104857600, allowed_mime_types = array['application/octet-stream']
where id = 'models';

create table public.training_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'claimed', 'done', 'failed')),
  attempts smallint not null default 0 check (attempts between 0 and 2),
  attempt_id uuid unique,
  base_model_id uuid,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint training_tasks_claimed check (status <> 'claimed' or (attempt_id is not null and claimed_at is not null)),
  constraint training_tasks_finished check ((status in ('done', 'failed')) = (finished_at is not null))
);

create index training_tasks_user_created_idx on public.training_tasks (user_id, created_at);
create unique index training_tasks_one_open on public.training_tasks (user_id) where status in ('queued', 'claimed');
create index training_tasks_queued_idx on public.training_tasks (created_at) where status = 'queued';

revoke all on public.training_tasks from anon, authenticated;
grant select, insert, update, delete on public.training_tasks to service_role;

alter table public.training_tasks enable row level security;

create index pages_user_read_idx on public.pages (user_id, read_at) where status = 'read' and page_type = 'text';

create function private.training_due(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with last_task as (
    select max(k.created_at) as created_at from public.training_tasks k where k.user_id = p_user_id
  ),
  test as (
    select t.checked_at from public.writing_tests t where t.user_id = p_user_id and t.status = 'accepted'
  )
  select
    exists (
      select 1 from public.consents c
      where c.user_id = p_user_id and c.kind = 'training' and c.revoked_at is null
    )
    and exists (select 1 from test)
    and not exists (
      select 1 from public.training_tasks k where k.user_id = p_user_id and k.status in ('queued', 'claimed')
    )
    and (
      (select l.created_at from last_task l) is null
      or (select l.created_at from last_task l) < (select t.checked_at from test t)
      or (
        (select l.created_at from last_task l) <= now() - interval '24 hours'
        and (
          select count(*) from public.pages g
          where g.user_id = p_user_id and g.status = 'read' and g.page_type = 'text'
            and g.read_at > (select l.created_at from last_task l)
        ) >= 20
      )
    );
$$;

create function private.enqueue_training(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.training_due(p_user_id) then
    return false;
  end if;
  insert into public.training_tasks (user_id) values (p_user_id) on conflict do nothing;
  return found;
end;
$$;

revoke all on function private.training_due(uuid) from public, anon, authenticated, service_role;
revoke all on function private.enqueue_training(uuid) from public, anon, authenticated, service_role;

create or replace function public.finish_writing_test(
  p_user_id uuid,
  p_test_id uuid,
  p_sheet1_training integer,
  p_sheet2_training integer,
  p_sheet2_validation integer
)
returns table (outcome text, redo smallint[], replaced uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_training integer;
  v_accepted boolean;
  v_redo smallint[] := '{}';
  v_replaced uuid[] := '{}';
begin
  if p_user_id is null then
    raise exception 'account_not_found';
  end if;
  if p_sheet1_training is null or p_sheet1_training not between 0 and 20
     or p_sheet2_training is null or p_sheet2_training not between 0 and 10
     or p_sheet2_validation is null or p_sheet2_validation not between 0 and 10 then
    raise exception 'invalid_counts';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  perform 1 from public.writing_tests t
  where t.id = p_test_id and t.user_id = p_user_id and t.status = 'pending'
  for update;
  if not found then
    return query select 'test_not_found'::text, '{}'::smallint[], '{}'::uuid[];
    return;
  end if;
  if not exists (
    select 1 from public.consents c
    where c.user_id = p_user_id and c.kind = 'training' and c.revoked_at is null
  ) then
    update public.writing_tests t set status = 'failed', checked_at = now() where t.id = p_test_id;
    return query select 'consent_required'::text, '{}'::smallint[], '{}'::uuid[];
    return;
  end if;

  v_training := p_sheet1_training + p_sheet2_training;
  v_accepted := v_training >= 24 and p_sheet2_validation >= 8;
  if not v_accepted then
    if p_sheet1_training < 16 and v_training < 24 then
      v_redo := v_redo || 1::smallint;
    end if;
    if p_sheet2_validation < 8 or (p_sheet2_training < 8 and v_training < 24) then
      v_redo := v_redo || 2::smallint;
    end if;
  else
    with replaced as (
      update public.writing_tests t
      set status = 'replaced'
      where t.user_id = p_user_id and t.status = 'accepted' and t.id <> p_test_id
      returning t.id
    )
    select coalesce(array_agg(r.id), '{}'::uuid[]) into v_replaced from replaced r;
  end if;

  update public.writing_tests t
  set status = case when v_accepted then 'accepted' else 'rejected' end,
      training_lines = v_training,
      validation_lines = p_sheet2_validation,
      redo = v_redo,
      checked_at = now()
  where t.id = p_test_id;

  if v_accepted then
    perform private.enqueue_training(p_user_id);
  end if;

  return query select case when v_accepted then 'accepted' else 'rejected' end, v_redo, v_replaced;
end;
$$;

create function public.claim_training_task()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_pages constant integer := 300;
  v_user uuid;
  v_task uuid;
  v_test record;
  v_model record;
  v_attempt uuid;
  v_pages jsonb;
begin
  update public.training_tasks k
  set status = case when k.attempts >= 2 then 'failed' else 'queued' end,
      finished_at = case when k.attempts >= 2 then now() end,
      attempt_id = case when k.attempts >= 2 then k.attempt_id end,
      claimed_at = case when k.attempts >= 2 then k.claimed_at end
  where k.status = 'claimed' and k.claimed_at < now() - interval '2 hours';

  for v_user in
    select c.user_id from public.consents c
    where c.kind = 'training' and c.revoked_at is null
      and exists (select 1 from public.writing_tests t where t.user_id = c.user_id and t.status = 'accepted')
      and not exists (
        select 1 from public.training_tasks k where k.user_id = c.user_id and k.status in ('queued', 'claimed')
      )
    order by c.user_id
  loop
    perform private.enqueue_training(v_user);
  end loop;

  for i in 1..20 loop
    select k.id, k.user_id into v_task, v_user
    from public.training_tasks k
    where k.status = 'queued'
    order by k.created_at, k.id
    limit 1
    for update skip locked;
    if not found then
      return null;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

    select t.id, t.template into v_test
    from public.writing_tests t
    where t.user_id = v_user and t.status = 'accepted';
    if v_test.id is null or not exists (
      select 1 from public.consents c
      where c.user_id = v_user and c.kind = 'training' and c.revoked_at is null
    ) then
      update public.training_tasks k set status = 'failed', finished_at = now() where k.id = v_task;
      continue;
    end if;

    select m.id, m.storage_path, m.sha256 into v_model
    from public.htr_models m
    where m.user_id = v_user and m.status = 'active';

    v_attempt := gen_random_uuid();
    update public.training_tasks k
    set status = 'claimed', attempts = k.attempts + 1, attempt_id = v_attempt, claimed_at = now(), base_model_id = v_model.id
    where k.id = v_task;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'page_id', g.id,
        'b1', g.b1,
        'language', g.language,
        'corrections', g.corrections
      ) order by g.read_at desc, g.id
    ), '[]'::jsonb)
    into v_pages
    from (
      select
        p.id,
        p.read_at,
        p.language,
        b.raw_text as b1,
        (
          select coalesce(jsonb_agg(
            jsonb_build_object('token_index', l.token_index, 'text', l.corrected_text, 'reading_a', l.reading_a)
            order by l.token_index
          ), '[]'::jsonb)
          from (
            select distinct on (c.token_index) c.token_index, c.corrected_text, k.reading_a
            from public.corrections c
            join public.page_tokens k on k.page_id = c.page_id and k.token_index = c.token_index
            where c.page_id = p.id and c.user_id = v_user
            order by c.token_index, c.revision desc
          ) l
        ) as corrections
      from public.pages p
      join public.readings b on b.page_id = p.id and b.user_id = v_user and b.label = 'B1'
      where p.user_id = v_user and p.status = 'read' and p.page_type = 'text'
        and not exists (select 1 from public.page_gaps g where g.page_id = p.id)
      order by p.read_at desc nulls last, p.id
      limit c_max_pages
    ) g;

    return jsonb_build_object(
      'task_id', v_attempt,
      'user_id', v_user,
      'test_id', v_test.id,
      'template', v_test.template,
      'model', case when v_model.id is null then null else jsonb_build_object(
        'id', v_model.id, 'path', v_model.storage_path, 'sha256', v_model.sha256
      ) end,
      'pages', v_pages
    );
  end loop;
  return null;
end;
$$;

create function private.expire_task(p_task_id uuid, p_attempts smallint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.training_tasks k
  set status = case when p_attempts >= 2 then 'failed' else 'queued' end,
      finished_at = case when p_attempts >= 2 then now() end,
      attempt_id = case when p_attempts >= 2 then k.attempt_id end,
      claimed_at = case when p_attempts >= 2 then k.claimed_at end
  where k.id = p_task_id;
$$;

revoke all on function private.expire_task(uuid, smallint) from public, anon, authenticated, service_role;

create function public.training_upload_target(p_attempt_id uuid)
returns table (outcome text, path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_task record;
begin
  select k.user_id into v_user from public.training_tasks k where k.attempt_id = p_attempt_id;
  if v_user is null then
    return query select 'task_not_found'::text, null::text;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select k.id, k.status, k.claimed_at, k.attempts into v_task
  from public.training_tasks k
  where k.attempt_id = p_attempt_id and k.user_id = v_user
  for update;
  if v_task.id is null or v_task.status <> 'claimed' then
    return query select 'task_not_found'::text, null::text;
    return;
  end if;
  if v_task.claimed_at < now() - interval '2 hours' then
    perform private.expire_task(v_task.id, v_task.attempts);
    return query select 'task_expired'::text, null::text;
    return;
  end if;
  if not exists (
    select 1 from public.consents c
    where c.user_id = v_user and c.kind = 'training' and c.revoked_at is null
  ) then
    update public.training_tasks k set status = 'failed', finished_at = now() where k.id = v_task.id;
    return query select 'consent_required'::text, null::text;
    return;
  end if;
  return query select 'ready'::text, v_user::text || '/' || p_attempt_id::text || '.safetensors';
end;
$$;

create function public.report_training_task(
  p_attempt_id uuid,
  p_outcome text,
  p_cer numeric,
  p_base_cer numeric,
  p_faults integer,
  p_base_faults integer,
  p_alphabet integer,
  p_samples integer,
  p_sha256 text
)
returns table (outcome text, remove text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_bytes constant bigint := 104857600;
  v_user uuid;
  v_task record;
  v_path text;
  v_size bigint;
  v_active uuid;
  v_version integer;
  v_remove text[];
begin
  if p_attempt_id is null or p_outcome is null or p_outcome not in ('trained', 'failed') then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  if p_outcome = 'trained' and (
    p_cer is null or p_cer < 0 or p_cer > 100
    or p_base_cer is null or p_base_cer < 0 or p_base_cer > 100
    or p_faults is null or p_faults not between 0 and 8
    or p_base_faults is null or p_base_faults not between 0 and 8
    or p_alphabet is null or p_alphabet not between 1 and 10000
    or p_samples is null or p_samples not between 1 and 20000
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'invalid_report' using errcode = '22023';
  end if;

  select k.user_id into v_user from public.training_tasks k where k.attempt_id = p_attempt_id;
  if v_user is null then
    return query select 'task_not_found'::text, coalesce(array(
      select o.name from storage.objects o
      where o.bucket_id = 'models'
        and o.name ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' || p_attempt_id::text || '\.safetensors$')
        and not exists (select 1 from public.htr_models m where m.storage_path = o.name)
    ), '{}'::text[]);
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  v_path := v_user::text || '/' || p_attempt_id::text || '.safetensors';

  select k.id, k.status, k.claimed_at, k.attempts, k.base_model_id into v_task
  from public.training_tasks k
  where k.attempt_id = p_attempt_id and k.user_id = v_user
  for update;
  if v_task.id is null or v_task.status <> 'claimed' then
    return query select 'task_not_found'::text, case when exists (
      select 1 from public.htr_models m where m.storage_path = v_path
    ) then '{}'::text[] else array[v_path] end;
    return;
  end if;
  if v_task.claimed_at < now() - interval '2 hours' then
    perform private.expire_task(v_task.id, v_task.attempts);
    return query select 'task_expired'::text, array[v_path];
    return;
  end if;
  if not exists (
    select 1 from public.consents c
    where c.user_id = v_user and c.kind = 'training' and c.revoked_at is null
  ) then
    update public.training_tasks k set status = 'failed', finished_at = now() where k.id = v_task.id;
    return query select 'consent_required'::text, array[v_path];
    return;
  end if;
  if p_outcome = 'failed' then
    update public.training_tasks k set status = 'failed', finished_at = now() where k.id = v_task.id;
    return query select 'failed'::text, array[v_path];
    return;
  end if;

  select (o.metadata ->> 'size')::bigint into v_size
  from storage.objects o
  where o.bucket_id = 'models' and o.name = v_path;
  if v_size is null or v_size <= 0 or v_size > c_max_bytes then
    update public.training_tasks k set status = 'failed', finished_at = now() where k.id = v_task.id;
    return query select 'model_missing'::text, array[v_path];
    return;
  end if;

  update public.training_tasks k set status = 'done', finished_at = now() where k.id = v_task.id;

  select m.id into v_active from public.htr_models m where m.user_id = v_user and m.status = 'active';
  if v_active is distinct from v_task.base_model_id or p_cer >= p_base_cer or p_faults > p_base_faults then
    return query select 'rejected'::text, array[v_path];
    return;
  end if;

  update public.htr_models m set status = 'retired' where m.id = v_active;
  select coalesce(max(m.version), 0) + 1 into v_version from public.htr_models m where m.user_id = v_user;
  insert into public.htr_models (id, user_id, name, version, status, storage_path, cer, alphabet_size, sample_count, sha256, faults_correct)
  values (p_attempt_id, v_user, 'personal', v_version, 'active', v_path, p_cer, p_alphabet, p_samples, p_sha256, p_faults);

  with gone as (
    delete from public.htr_models m
    where m.user_id = v_user and m.status <> 'active' and m.id is distinct from v_active
    returning m.storage_path
  )
  select coalesce(array_agg(g.storage_path) filter (where g.storage_path is not null), '{}'::text[]) into v_remove from gone g;

  return query select 'activated'::text, v_remove;
end;
$$;

revoke all on function public.claim_training_task() from public, anon, authenticated, service_role;
revoke all on function public.training_upload_target(uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_training_task(uuid, text, numeric, numeric, integer, integer, integer, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_training_task() to service_role;
grant execute on function public.training_upload_target(uuid) to service_role;
grant execute on function public.report_training_task(uuid, text, numeric, numeric, integer, integer, integer, integer, text) to service_role;

create or replace function public.revoke_training(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revoked integer;
begin
  if p_user_id is null then
    raise exception 'account_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  update public.consents
  set revoked_at = now()
  where user_id = p_user_id and kind = 'training' and revoked_at is null;
  get diagnostics v_revoked = row_count;
  delete from private.parent_consent_requests where user_id = p_user_id;
  delete from public.training_tasks where user_id = p_user_id;
  delete from public.writing_tests where user_id = p_user_id;
  delete from public.htr_models where user_id = p_user_id;
  update public.notebooks
  set correction_level = 'course'
  where user_id = p_user_id and correction_level <> 'course';
  return v_revoked > 0;
end;
$$;

create function public.model_orphans(p_limit integer)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'models'
    and o.created_at <= now() - interval '24 hours'
    and o.updated_at <= now() - interval '24 hours'
    and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.safetensors$'
    and not exists (select 1 from public.htr_models m where m.storage_path = o.name)
  order by o.created_at, o.name
  limit greatest(1, least(coalesce(p_limit, 1), 1000));
$$;

create function public.writing_test_orphans(p_limit integer)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'photos'
    and o.created_at <= now() - interval '24 hours'
    and o.updated_at <= now() - interval '24 hours'
    and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/writing-tests/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[12]\.jpg$'
    and not exists (
      select 1 from public.writing_tests t
      where t.user_id::text = split_part(o.name, '/', 1) and t.id::text = split_part(o.name, '/', 3)
        and t.status in ('pending', 'accepted')
    )
  order by o.created_at, o.name
  limit greatest(1, least(coalesce(p_limit, 1), 1000));
$$;

revoke all on function public.model_orphans(integer) from public, anon, authenticated;
revoke all on function public.writing_test_orphans(integer) from public, anon, authenticated;
grant execute on function public.model_orphans(integer) to service_role;
grant execute on function public.writing_test_orphans(integer) to service_role;
