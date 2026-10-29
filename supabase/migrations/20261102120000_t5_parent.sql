create extension if not exists pgcrypto with schema extensions;

create function private.is_parent_email(p_email text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_email is not null
    and char_length(p_email) <= 254
    and p_email ~ '^(?=[^@]{1,64}@)[A-Za-z0-9_+-]+(\.[A-Za-z0-9_+-]+)*@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$';
$$;

revoke all on function private.is_parent_email(text) from public, anon, authenticated, service_role;

create table private.parent_consent_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  parent_email text not null check (parent_email = lower(parent_email) and private.is_parent_email(parent_email)),
  code_hash text not null check (code_hash like '$2a$%'),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint parent_consent_requests_expiry check (expires_at = created_at + interval '7 days')
);

revoke all on private.parent_consent_requests from public, anon, authenticated, service_role;

alter table private.parent_consent_requests enable row level security;

create table private.parent_consent_sends (
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now()
);

create index parent_consent_sends_user_idx on private.parent_consent_sends (user_id, sent_at);

revoke all on private.parent_consent_sends from public, anon, authenticated, service_role;

alter table private.parent_consent_sends enable row level security;

create table private.parent_address_sends (
  address_hash bytea not null,
  sent_at timestamptz not null default now()
);

create index parent_address_sends_address_idx on private.parent_address_sends (address_hash, sent_at);
create index parent_address_sends_sent_idx on private.parent_address_sends (sent_at);

revoke all on private.parent_address_sends from public, anon, authenticated, service_role;

alter table private.parent_address_sends enable row level security;

create function public.request_parent_consent(p_user_id uuid, p_parent_email text)
returns table (outcome text, request_id uuid, code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_under boolean;
  v_email text;
  v_bytes bytea;
  v_code text;
  v_hash bytea;
  v_id uuid;
begin
  if p_user_id is null then
    raise exception 'account_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if not private.is_registered(p_user_id) then
    return query select 'account_not_registered'::text, null::uuid, null::text;
    return;
  end if;
  v_under := private.under_consent_age(p_user_id);
  if v_under is null then
    return query select 'age_missing'::text, null::uuid, null::text;
    return;
  end if;
  if not v_under then
    return query select 'not_under_age'::text, null::uuid, null::text;
    return;
  end if;
  if exists (
    select 1 from public.consents c
    where c.user_id = p_user_id and c.kind = 'training' and c.revoked_at is null
  ) then
    return query select 'consent_already_active'::text, null::uuid, null::text;
    return;
  end if;

  if not private.is_parent_email(p_parent_email) then
    return query select 'invalid_email'::text, null::uuid, null::text;
    return;
  end if;
  v_email := lower(p_parent_email);
  if exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = v_email) then
    return query select 'same_email'::text, null::uuid, null::text;
    return;
  end if;

  delete from private.parent_consent_sends s
  where s.user_id = p_user_id and s.sent_at <= now() - interval '24 hours';
  if (select count(*) from private.parent_consent_sends s where s.user_id = p_user_id) >= 3 then
    return query select 'send_limit'::text, null::uuid, null::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('parent_address_sends', 0));
  v_hash := public.email_hash(v_email);
  delete from private.parent_address_sends a where a.sent_at <= now() - interval '7 days';
  if (select count(*) from private.parent_address_sends a where a.address_hash = v_hash) >= 3
    or (select count(*) from private.parent_address_sends a where a.sent_at > now() - interval '24 hours') >= 50 then
    return query select 'send_limit'::text, null::uuid, null::text;
    return;
  end if;

  v_bytes := extensions.gen_random_bytes(4);
  v_code := lpad((
    ((get_byte(v_bytes, 0)::bigint << 24) | (get_byte(v_bytes, 1) << 16) | (get_byte(v_bytes, 2) << 8) | get_byte(v_bytes, 3))
    % 1000000
  )::text, 6, '0');

  delete from private.parent_consent_requests r where r.user_id = p_user_id;
  insert into private.parent_consent_requests (user_id, parent_email, code_hash, created_at, expires_at)
  values (p_user_id, v_email, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), now(), now() + interval '7 days')
  returning id into v_id;
  insert into private.parent_consent_sends (user_id) values (p_user_id);
  insert into private.parent_address_sends (address_hash) values (v_hash);

  return query select 'requested'::text, v_id, v_code;
end;
$$;

revoke all on function public.request_parent_consent(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.request_parent_consent(uuid, text) to service_role;

create function public.withdraw_parent_request(p_user_id uuid, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'account_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  delete from private.parent_consent_requests r where r.user_id = p_user_id and r.id = p_request_id;
end;
$$;

revoke all on function public.withdraw_parent_request(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_parent_request(uuid, uuid) to service_role;

create function public.confirm_parent_consent(p_user_id uuid, p_code text)
returns table (outcome text, attempts_left integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.parent_consent_requests%rowtype;
  v_refusal text;
begin
  if p_user_id is null then
    raise exception 'account_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_request from private.parent_consent_requests r where r.user_id = p_user_id;
  if not found then
    return query select 'no_request'::text, null::integer;
    return;
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    return query select 'invalid_code'::text, null::integer;
    return;
  end if;
  if v_request.expires_at <= now() then
    delete from private.parent_consent_requests r where r.id = v_request.id;
    return query select 'code_expired'::text, null::integer;
    return;
  end if;
  if extensions.crypt(p_code, v_request.code_hash) is distinct from v_request.code_hash then
    if v_request.attempts >= 4 then
      delete from private.parent_consent_requests r where r.id = v_request.id;
    else
      update private.parent_consent_requests r set attempts = r.attempts + 1 where r.id = v_request.id;
    end if;
    return query select 'wrong_code'::text, 4 - v_request.attempts::integer;
    return;
  end if;

  begin
    insert into public.consents (user_id, kind, version, granted_by, parent_email)
    values (p_user_id, 'training', private.consent_version('training'), 'parent', v_request.parent_email);
  exception when check_violation or unique_violation then
    v_refusal := case
      when sqlerrm in ('account_not_registered', 'consent_version_outdated', 'age_missing', 'not_under_age', 'consent_already_active') then sqlerrm
    end;
    if v_refusal is null then
      raise;
    end if;
  end;

  delete from private.parent_consent_requests r where r.id = v_request.id;
  return query select coalesce(v_refusal, 'confirmed'), null::integer;
end;
$$;

revoke all on function public.confirm_parent_consent(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.confirm_parent_consent(uuid, text) to service_role;

create function private.purge_parent_requests() returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.parent_consent_requests r where r.expires_at <= now();
  delete from private.parent_consent_sends s where s.sent_at <= now() - interval '24 hours';
  delete from private.parent_address_sends a where a.sent_at <= now() - interval '7 days';
end;
$$;

revoke all on function private.purge_parent_requests() from public, anon, authenticated, service_role;

select cron.schedule('purge-parent-requests', '50 2 * * *', 'select private.purge_parent_requests()');
