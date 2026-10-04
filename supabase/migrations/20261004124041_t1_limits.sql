create unique index page_charges_page_key on public.page_charges (page_id) where page_id is not null;

create index page_charges_user_charged_idx on public.page_charges (user_id, charged_at);

create table public.anonymous_daily_counts (
  day date primary key,
  pages integer not null check (pages >= 0)
);

revoke all on public.anonymous_daily_counts from anon, authenticated;

alter table public.anonymous_daily_counts enable row level security;

create function public.anonymous_daily_cap()
returns integer
language sql
immutable
security definer
set search_path = ''
as $$
  select 300;
$$;

revoke all on function public.anonymous_daily_cap() from public, anon, authenticated;

create schema private;

create table private.email_pepper (
  id boolean primary key default true check (id),
  pepper text not null
);

revoke all on private.email_pepper from public, anon, authenticated;

alter table private.email_pepper enable row level security;

insert into private.email_pepper (pepper) values (gen_random_uuid()::text || gen_random_uuid()::text);

create table public.email_monthly_counts (
  email_hash bytea not null,
  month date not null,
  pages integer not null check (pages > 0),
  primary key (email_hash, month)
);

revoke all on public.email_monthly_counts from anon, authenticated;

alter table public.email_monthly_counts enable row level security;

create function public.email_hash(p_email text)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select sha256(convert_to((select e.pepper from private.email_pepper e) || lower(btrim(p_email)), 'utf8'));
$$;

revoke all on function public.email_hash(text) from public, anon, authenticated;

create function public.keep_month_count_on_delete() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email is not null and not coalesce(old.is_anonymous, false) then
    insert into public.email_monthly_counts as e (email_hash, month, pages)
    select public.email_hash(old.email), date_trunc('month', c.charged_at at time zone 'Europe/Paris')::date, count(*)
    from public.page_charges c
    where c.user_id = old.id
      and c.charged_at >= date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'
    group by 2
    on conflict (email_hash, month) do update set pages = e.pages + excluded.pages;
  end if;
  return old;
end;
$$;

revoke all on function public.keep_month_count_on_delete() from public, anon, authenticated;

create trigger keep_month_count_before_user_delete
  before delete on auth.users
  for each row execute function public.keep_month_count_on_delete();

create function public.page_allowance(p_user_id uuid, p_at timestamptz default now())
returns table (
  is_anonymous boolean,
  used integer,
  max integer,
  remaining integer,
  resets_at timestamptz,
  blocked_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anonymous boolean;
  v_tier text;
  v_max integer;
  v_used integer;
  v_remaining integer;
  v_resets timestamptz;
  v_month_start timestamptz;
  v_day_count integer;
  v_blocked text;
  v_email text;
  v_carried integer;
begin
  p_at := coalesce(p_at, now());

  select u.is_anonymous, u.email into v_anonymous, v_email from auth.users u where u.id = p_user_id;
  if not found then
    return;
  end if;

  select coalesce(p.tier, 'free') into v_tier from public.profiles p where p.id = p_user_id;

  if v_anonymous then
    v_max := 3;
    v_resets := null;
    select count(*) into v_used from public.page_charges c where c.user_id = p_user_id;
  else
    v_max := case coalesce(v_tier, 'free') when 'subscriber' then 200 else 15 end;
    v_month_start := date_trunc('month', p_at at time zone 'Europe/Paris') at time zone 'Europe/Paris';
    v_resets := (date_trunc('month', p_at at time zone 'Europe/Paris') + interval '1 month') at time zone 'Europe/Paris';
    select count(*) into v_used
    from public.page_charges c
    where c.user_id = p_user_id and c.charged_at >= v_month_start and c.charged_at < v_resets;
    select coalesce(sum(e.pages), 0) into v_carried
    from public.email_monthly_counts e
    where v_email is not null
      and e.email_hash = public.email_hash(v_email)
      and e.month = date_trunc('month', p_at at time zone 'Europe/Paris')::date;
    v_used := v_used + v_carried;
  end if;

  v_remaining := greatest(v_max - v_used, 0);

  if v_remaining = 0 then
    v_blocked := case when v_anonymous then 'anonymous_limit' else 'monthly_limit' end;
  elsif v_anonymous then
    select d.pages into v_day_count
    from public.anonymous_daily_counts d
    where d.day = (p_at at time zone 'Europe/Paris')::date;
    if coalesce(v_day_count, 0) >= public.anonymous_daily_cap() then
      v_blocked := 'anonymous_daily_cap';
    end if;
  end if;

  return query select v_anonymous, v_used, v_max, v_remaining, v_resets, v_blocked;
end;
$$;

revoke all on function public.page_allowance(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.page_allowance(uuid, timestamptz) to service_role;

create function public.charge_page(p_page_id uuid, p_at timestamptz default now())
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_allowance record;
  v_counted integer;
begin
  p_at := coalesce(p_at, now());

  select p.user_id into v_user from public.pages p where p.id = p_page_id;
  if not found then
    return query select false, 'page_not_found'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  if exists (select 1 from public.page_charges c where c.page_id = p_page_id) then
    return query select true, 'already_charged'::text;
    return;
  end if;

  select a.* into v_allowance from public.page_allowance(v_user, p_at) a;

  if v_allowance.blocked_reason in ('anonymous_limit', 'monthly_limit') then
    return query select false, v_allowance.blocked_reason;
    return;
  end if;

  if v_allowance.is_anonymous then
    insert into public.anonymous_daily_counts as d (day, pages)
    values ((p_at at time zone 'Europe/Paris')::date, 1)
    on conflict (day) do update set pages = d.pages + 1 where d.pages < public.anonymous_daily_cap()
    returning d.pages into v_counted;
    if v_counted is null then
      return query select false, 'anonymous_daily_cap'::text;
      return;
    end if;
  end if;

  insert into public.page_charges (user_id, page_id, charged_at) values (v_user, p_page_id, p_at);
  return query select true, 'charged'::text;
end;
$$;

revoke all on function public.charge_page(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.charge_page(uuid, timestamptz) to service_role;

create function public.my_page_allowance()
returns table (
  is_anonymous boolean,
  used integer,
  max integer,
  remaining integer,
  resets_at timestamptz,
  blocked_reason text
)
language sql
security definer
set search_path = ''
as $$
  select a.* from public.page_allowance((select auth.uid())) a;
$$;

revoke all on function public.my_page_allowance() from public, anon, authenticated;
grant execute on function public.my_page_allowance() to authenticated;
