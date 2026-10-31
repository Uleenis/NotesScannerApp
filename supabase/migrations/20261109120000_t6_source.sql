alter table public.pages drop constraint pages_source_check;

alter table public.pages
  add constraint pages_source_check check (source in ('camera', 'import'));
