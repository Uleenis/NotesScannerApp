create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  interface_language text not null default 'en' check (interface_language in ('en', 'fr')),
  tier text not null default 'free' check (tier in ('free', 'subscriber'))
);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (interface_language) on public.profiles to authenticated;

alter table public.profiles enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id) select id from auth.users on conflict do nothing;

create table public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (btrim(name, E' \t\r\n') <> ''),
  position integer not null default 0,
  unique (id, user_id)
);

create unique index notebooks_user_name_key on public.notebooks (user_id, btrim(name, E' \t\r\n'));

revoke all on public.notebooks from anon, authenticated;
grant select on public.notebooks to authenticated;
grant insert (name, position) on public.notebooks to authenticated;
grant update (name, position) on public.notebooks to authenticated;

alter table public.notebooks enable row level security;

create policy notebooks_select on public.notebooks
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy notebooks_insert on public.notebooks
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy notebooks_update on public.notebooks
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  notebook_id uuid not null,
  name text not null check (btrim(name, E' \t\r\n') <> ''),
  position integer not null default 0,
  unique (id, user_id),
  unique (id, notebook_id),
  foreign key (notebook_id, user_id) references public.notebooks (id, user_id) on delete cascade
);

revoke all on public.chapters from anon, authenticated;
grant select on public.chapters to authenticated;
grant insert (notebook_id, name, position) on public.chapters to authenticated;
grant update (name, position) on public.chapters to authenticated;

alter table public.chapters enable row level security;

create policy chapters_select on public.chapters
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy chapters_insert on public.chapters
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy chapters_update on public.chapters
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
