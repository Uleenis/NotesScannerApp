create table public.writing_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  template text not null check (template in ('fr', 'en')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'failed', 'replaced')),
  training_lines integer check (training_lines between 0 and 30),
  validation_lines integer check (validation_lines between 0 and 10),
  redo smallint[] not null default '{}' check (redo <@ array[1, 2]::smallint[] and cardinality(redo) <= 2),
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  constraint writing_tests_counted check (
    (status in ('accepted', 'rejected', 'replaced')) = (training_lines is not null and validation_lines is not null)
    or status = 'failed'
  )
);

create index writing_tests_user_created_idx on public.writing_tests (user_id, created_at);
create unique index writing_tests_one_pending on public.writing_tests (user_id) where status = 'pending';
create unique index writing_tests_one_accepted on public.writing_tests (user_id) where status = 'accepted';

revoke all on public.writing_tests from anon, authenticated;
grant select (id, user_id, template, status, training_lines, validation_lines, redo, created_at, checked_at)
  on public.writing_tests to authenticated;
grant select, insert, update, delete on public.writing_tests to service_role;

alter table public.writing_tests enable row level security;

create policy writing_tests_select on public.writing_tests
  for select to authenticated
  using (user_id = (select auth.uid()));

create function public.begin_writing_test(p_user_id uuid, p_template text)
returns table (outcome text, test_id uuid, expired uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired uuid[];
  v_id uuid;
begin
  if p_user_id is null then
    raise exception 'account_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if not exists (
    select 1 from public.consents c
    where c.user_id = p_user_id and c.kind = 'training' and c.revoked_at is null
  ) then
    return query select 'consent_required'::text, null::uuid, '{}'::uuid[];
    return;
  end if;

  with stale as (
    update public.writing_tests t
    set status = 'failed', checked_at = now()
    where t.user_id = p_user_id and t.status = 'pending' and t.created_at < now() - interval '30 minutes'
    returning t.id
  )
  select coalesce(array_agg(s.id), '{}'::uuid[]) into v_expired from stale s;

  delete from public.writing_tests t
  where t.user_id = p_user_id and t.status <> 'accepted' and t.status <> 'pending'
    and t.created_at < now() - interval '2 days';

  if exists (select 1 from public.writing_tests t where t.user_id = p_user_id and t.status = 'pending') then
    return query select 'test_in_progress'::text, null::uuid, v_expired;
    return;
  end if;
  if (select count(*) from public.writing_tests t where t.user_id = p_user_id and t.created_at > now() - interval '24 hours') >= 3 then
    return query select 'test_limit'::text, null::uuid, v_expired;
    return;
  end if;

  insert into public.writing_tests (user_id, template) values (p_user_id, p_template) returning id into v_id;
  return query select 'started'::text, v_id, v_expired;
end;
$$;

create function public.finish_writing_test(
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

  return query select case when v_accepted then 'accepted' else 'rejected' end, v_redo, v_replaced;
end;
$$;

create function public.fail_writing_test(p_user_id uuid, p_test_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failed integer;
begin
  if p_user_id is null then
    raise exception 'account_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  update public.writing_tests t
  set status = 'failed', checked_at = now()
  where t.id = p_test_id and t.user_id = p_user_id and t.status = 'pending';
  get diagnostics v_failed = row_count;
  return v_failed > 0;
end;
$$;

revoke all on function public.begin_writing_test(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.finish_writing_test(uuid, uuid, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.fail_writing_test(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_writing_test(uuid, text) to service_role;
grant execute on function public.finish_writing_test(uuid, uuid, integer, integer, integer) to service_role;
grant execute on function public.fail_writing_test(uuid, uuid) to service_role;

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
  delete from public.writing_tests where user_id = p_user_id;
  delete from public.htr_models where user_id = p_user_id;
  update public.notebooks
  set correction_level = 'course'
  where user_id = p_user_id and correction_level <> 'course';
  return v_revoked > 0;
end;
$$;
