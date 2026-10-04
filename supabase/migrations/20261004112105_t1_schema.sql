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

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  notebook_id uuid not null,
  chapter_id uuid,
  position integer not null default 0,
  source text not null default 'camera' check (source in ('camera')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'read', 'failed')),
  queue_reason text check (queue_reason in ('read_error', 'offline')),
  retry_count integer not null default 0 check (retry_count between 0 and 3),
  captured_at timestamptz not null default now(),
  uploaded_at timestamptz,
  read_at timestamptz,
  check (queue_reason is null or status = 'queued'),
  unique (id, user_id),
  foreign key (notebook_id, user_id) references public.notebooks (id, user_id) on delete cascade,
  foreign key (chapter_id, notebook_id) references public.chapters (id, notebook_id) on delete set null (chapter_id)
);

revoke all on public.pages from anon, authenticated;
grant select on public.pages to authenticated;
grant insert (notebook_id, chapter_id, position, source, captured_at) on public.pages to authenticated;
grant update (chapter_id, position, uploaded_at) on public.pages to authenticated;

alter table public.pages enable row level security;

create policy pages_select on public.pages
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy pages_insert on public.pages
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy pages_update on public.pages
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.page_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid not null,
  kind text not null check (kind in ('original', 'prepared')),
  storage_path text not null unique,
  check (storage_path like (user_id::text || '/' || page_id::text || '/%')),
  foreign key (page_id, user_id) references public.pages (id, user_id) on delete cascade
);

create table public.readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid not null,
  label text not null check (label in ('B1', 'B2', 'A')),
  raw_text text not null,
  model text not null,
  prompt_version text not null,
  thinking_budget integer not null,
  input_tokens integer not null,
  output_tokens integer not null,
  duration_ms integer not null,
  foreign key (page_id, user_id) references public.pages (id, user_id) on delete cascade
);

create table public.page_texts (
  page_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  pipeline_version text not null,
  foreign key (page_id, user_id) references public.pages (id, user_id) on delete cascade
);

create table public.page_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid,
  charged_at timestamptz not null default now(),
  foreign key (page_id, user_id) references public.pages (id, user_id) on delete set null (page_id)
);

revoke all on public.page_images, public.readings, public.page_texts, public.page_charges from anon, authenticated;
grant select on public.page_images, public.readings, public.page_texts, public.page_charges to authenticated;

alter table public.page_images enable row level security;
alter table public.readings enable row level security;
alter table public.page_texts enable row level security;
alter table public.page_charges enable row level security;

create policy page_images_select on public.page_images
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy readings_select on public.readings
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy page_texts_select on public.page_texts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy page_charges_select on public.page_charges
  for select to authenticated
  using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg']);

create policy photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
