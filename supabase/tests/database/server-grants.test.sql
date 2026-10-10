begin;

select plan(2);

select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not (
        has_table_privilege('service_role', c.oid, 'select')
        and has_table_privilege('service_role', c.oid, 'insert')
        and has_table_privilege('service_role', c.oid, 'update')
        and has_table_privilege('service_role', c.oid, 'delete')
      )
  $$,
  'the server can read, write, change and erase every table in public'
);

select is_empty(
  $$
    select d.defaclobjtype::text || ' ' || a.grantee::regrole::text || ' ' || a.privilege_type
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole
      and d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype in ('r', 'S')
      and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
      and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'USAGE')
  $$,
  'a new table in public gives no right by itself, as on the production project'
);

select * from finish();

rollback;
