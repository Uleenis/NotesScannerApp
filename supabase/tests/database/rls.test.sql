begin;

select plan(6);

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
    select c.relname || '.' || a.attname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and (
        has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
        or has_column_privilege('anon', c.oid, a.attnum, 'select,insert,update,references')
      )
  $$,
  'a visitor without an account has no right on any table or column in public'
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
      and (
        has_table_privilege('authenticated', c.oid, 'select')
        or has_any_column_privilege('authenticated', c.oid, 'select')
      )
  $$,
  'every table in public that a user can read has a read rule'
);

select set_eq(
  $$
    select c.relname::text, a.attname::text, p.privilege
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join (values ('insert'), ('update')) as p (privilege)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and has_column_privilege('authenticated', c.oid, a.attnum, p.privilege)
  $$,
  $$
    values
      ('notebooks', 'name', 'insert'),
      ('notebooks', 'position', 'insert'),
      ('notebooks', 'name', 'update'),
      ('notebooks', 'position', 'update'),
      ('chapters', 'notebook_id', 'insert'),
      ('chapters', 'name', 'insert'),
      ('chapters', 'position', 'insert'),
      ('chapters', 'name', 'update'),
      ('chapters', 'position', 'update'),
      ('pages', 'notebook_id', 'insert'),
      ('pages', 'chapter_id', 'insert'),
      ('pages', 'position', 'insert'),
      ('pages', 'source', 'insert'),
      ('pages', 'captured_at', 'insert'),
      ('pages', 'position', 'update'),
      ('pages', 'uploaded_at', 'update'),
      ('profiles', 'interface_language', 'update')
  $$,
  'the columns a user can write are exactly the ones the client may decide'
);

select * from finish();

rollback;
