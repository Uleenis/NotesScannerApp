create unique index page_charges_page_key on public.page_charges (page_id) where page_id is not null;

create index page_charges_user_charged_idx on public.page_charges (user_id, charged_at);

create table public.anonymous_daily_counts (
  day date primary key,
  pages integer not null check (pages >= 0)
);

revoke all on public.anonymous_daily_counts from anon, authenticated;

alter table public.anonymous_daily_counts enable row level security;

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
begin
  select u.is_anonymous into v_anonymous from auth.users u where u.id = p_user_id;
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
  end if;

  v_remaining := greatest(v_max - v_used, 0);

  if v_remaining = 0 then
    v_blocked := case when v_anonymous then 'anonymous_limit' else 'monthly_limit' end;
  elsif v_anonymous then
    select d.pages into v_day_count
    from public.anonymous_daily_counts d
    where d.day = (p_at at time zone 'Europe/Paris')::date;
    if coalesce(v_day_count, 0) >= 300 then
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
    on conflict (day) do update set pages = d.pages + 1 where d.pages < 300
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
