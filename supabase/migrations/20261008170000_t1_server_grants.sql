grant select, insert, update, delete on public.profiles, public.notebooks, public.chapters, public.pages, public.page_images, public.readings, public.page_texts, public.page_charges, public.anonymous_daily_counts, public.email_monthly_counts to service_role;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon, authenticated, service_role;
