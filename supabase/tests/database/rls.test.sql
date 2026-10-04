begin;

select plan(5);

select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  $$,
  'every table in public has row level security enabled'
);

select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
  $$,
  'a visitor without an account has no right on any table in public'
);

select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate,references,trigger')
  $$,
  'a user has no right on a whole table in public beyond reading it'
);

select is_empty(
  $$
    select tablename
    from pg_policies
    where schemaname = 'public'
      and roles <> array['authenticated']::name[]
  $$,
  'every access rule in public applies to signed-in users only'
);

select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname and p.cmd = 'SELECT'
      )
  $$,
  'every table in public has a read rule'
);

select * from finish();

rollback;
