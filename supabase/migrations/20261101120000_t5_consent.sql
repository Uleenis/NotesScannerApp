create table private.digital_consent_ages (
  country text primary key check (country ~ '^[A-Z]{2}$'),
  age smallint not null check (age between 13 and 16)
);

revoke all on private.digital_consent_ages from public, anon, authenticated;

insert into private.digital_consent_ages (country, age) values
  ('BE', 13), ('DK', 13), ('EE', 13), ('FI', 13), ('GB', 13), ('LV', 13), ('MT', 13), ('PT', 13), ('SE', 13),
  ('AT', 14), ('BG', 14), ('CY', 14), ('ES', 14), ('IT', 14), ('LT', 14),
  ('CZ', 15), ('FR', 15), ('GR', 15),
  ('DE', 16), ('HR', 16), ('HU', 16), ('IE', 16), ('LU', 16), ('NL', 16), ('PL', 16), ('RO', 16), ('SI', 16), ('SK', 16);

create function private.is_registered(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and not coalesce(u.is_anonymous, false)
      and u.email is not null
      and u.email_confirmed_at is not null
  );
$$;

revoke all on function private.is_registered(uuid) from public, anon, authenticated, service_role;

create function private.paris_year() returns integer
language sql
stable
set search_path = ''
as $$
  select extract(year from now() at time zone 'Europe/Paris')::integer;
$$;

revoke all on function private.paris_year() from public, anon, authenticated, service_role;

alter table public.profiles
  add column birth_year smallint check (birth_year >= 1900),
  add column country text check (country = '' or country ~ '^[A-Z]{2}$'),
  add constraint profiles_age_together check ((birth_year is null) = (country is null));

create function private.check_profile_age() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.birth_year is not null or new.country is not null then
      raise exception 'age_set_on_insert' using errcode = '23514';
    end if;
    return new;
  end if;
  if old.birth_year is not null or old.country is not null then
    raise exception 'age_already_set' using errcode = '23514';
  end if;
  if new.birth_year is null and new.country is null then
    return new;
  end if;
  if not private.is_registered(new.id) then
    raise exception 'account_not_registered' using errcode = '23514';
  end if;
  if new.birth_year > private.paris_year() then
    raise exception 'birth_year_out_of_range' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.check_profile_age() from public, anon, authenticated, service_role;

create trigger profiles_check_age
  before insert or update of birth_year, country on public.profiles
  for each row execute function private.check_profile_age();

grant update (birth_year, country) on public.profiles to authenticated;

create function private.consent_version(p_kind text) returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'training' then 'training-1' end;
$$;

revoke all on function private.consent_version(text) from public, anon, authenticated, service_role;

create function private.under_consent_age(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.paris_year() - p.birth_year - 1 < coalesce(a.age, 16)
  from public.profiles p
  left join private.digital_consent_ages a on a.country = p.country
  where p.id = p_user_id and p.birth_year is not null;
$$;

revoke all on function private.under_consent_age(uuid) from public, anon, authenticated, service_role;

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('training')),
  version text not null check (version ~ '^[a-z]{1,20}-[0-9]{1,3}$'),
  granted_by text not null default 'user' check (granted_by in ('user', 'parent')),
  parent_email text check (char_length(parent_email) between 3 and 254 and parent_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint consents_parent_email check ((granted_by = 'parent') = (parent_email is not null)),
  constraint consents_revoked_after check (revoked_at is null or revoked_at >= granted_at)
);

create index consents_user_idx on public.consents (user_id);
create unique index consents_one_active on public.consents (user_id, kind) where revoked_at is null;

revoke all on public.consents from anon, authenticated;
grant select on public.consents to authenticated;
grant insert (kind, version) on public.consents to authenticated;
grant select, insert, update, delete on public.consents to service_role;

alter table public.consents enable row level security;

create policy consents_select on public.consents
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy consents_insert on public.consents
  for insert to authenticated
  with check (user_id = (select auth.uid()) and granted_by = 'user' and parent_email is null and revoked_at is null);

create function private.check_consent() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_under boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if new.revoked_at is not null then
    raise exception 'consent_revoked_on_insert' using errcode = '23514';
  end if;
  if not private.is_registered(new.user_id) then
    raise exception 'account_not_registered' using errcode = '23514';
  end if;
  if new.version is distinct from private.consent_version(new.kind) then
    raise exception 'consent_version_outdated' using errcode = '23514';
  end if;
  v_under := private.under_consent_age(new.user_id);
  if v_under is null then
    raise exception 'age_missing' using errcode = '23514';
  end if;
  if new.granted_by = 'user' and v_under then
    raise exception 'under_age' using errcode = '23514';
  end if;
  if new.granted_by = 'parent' and not v_under then
    raise exception 'not_under_age' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.consents c
    where c.user_id = new.user_id and c.kind = new.kind and c.revoked_at is null
  ) then
    raise exception 'consent_already_active' using errcode = '23505';
  end if;
  new.granted_at := now();
  return new;
end;
$$;

revoke all on function private.check_consent() from public, anon, authenticated, service_role;

create trigger consents_check
  before insert on public.consents
  for each row execute function private.check_consent();

create function private.keep_consent() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.kind is distinct from old.kind
    or new.version is distinct from old.version
    or new.granted_by is distinct from old.granted_by
    or new.parent_email is distinct from old.parent_email
    or new.granted_at is distinct from old.granted_at
    or old.revoked_at is not null
    or new.revoked_at is null then
    raise exception 'consent_immutable' using errcode = '23514';
  end if;
  new.revoked_at := greatest(now(), old.granted_at);
  return new;
end;
$$;

revoke all on function private.keep_consent() from public, anon, authenticated, service_role;

create trigger consents_keep
  before update on public.consents
  for each row execute function private.keep_consent();
