#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_PREFIX="c1c1c1c1"
failures=0
created_settings=""

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "
    delete from auth.users where id::text like '${USER_PREFIX}%';
    drop table if exists public.relaunch_tally;
    delete from vault.secrets where name in (${created_settings:-'-'});
  " > /dev/null
}

trap cleanup EXIT

install_script() {
  docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/$1.sql"
}

bench() {
  docker exec "$DB_CONTAINER" pgbench -U postgres -n -f "/tmp/$1.sql" -c "$2" -j "$2" -t 1 postgres > /dev/null || true
}

check() {
  if [ "$2" = "$3" ]; then
    echo "ok - $1 ($3)"
  else
    echo "not ok - $1 (expected $2, got $3)"
    failures=$((failures + 1))
  fi
}

sql -c "drop table if exists public.relaunch_tally; create table public.relaunch_tally (n integer not null);" > /dev/null
sql -c "delete from auth.users where id::text like '${USER_PREFIX}%';" > /dev/null

if [ "$(sql -c "select count(*) from vault.secrets where name = 'relaunch_secret'")" = "0" ]; then
  sql -c "select vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'relaunch_secret')" > /dev/null
  created_settings="'relaunch_secret'"
fi
if [ "$(sql -c "select count(*) from vault.secrets where name = 'relaunch_url'")" = "0" ]; then
  sql -c "select vault.create_secret('http://127.0.0.1:9/unreachable', 'relaunch_url')" > /dev/null
  created_settings="${created_settings:+${created_settings}, }'relaunch_url'"
fi

make_pages() {
  local owner="$1" count="$2" state="$3" age="$4" retries="$5"
  sql -c "
    insert into auth.users (id, email, is_anonymous)
    values ('${USER_PREFIX}-0000-0000-0000-${owner}', '${owner}@example.test', false)
    on conflict do nothing;
    insert into public.notebooks (id, user_id, name)
    values ('${USER_PREFIX}-0000-0000-0001-${owner}', '${USER_PREFIX}-0000-0000-0000-${owner}', 'N')
    on conflict do nothing;
    insert into public.pages (user_id, notebook_id, status, queue_reason, retry_count)
    select '${USER_PREFIX}-0000-0000-0000-${owner}', '${USER_PREFIX}-0000-0000-0001-${owner}',
           case when '${state}' = 'stale' then 'processing' else 'queued' end,
           case when '${state}' = 'stale' then null else 'read_error' end,
           ${retries}
    from generate_series(1, ${count});
    update public.pages set attempted_at = ${age} where user_id = '${USER_PREFIX}-0000-0000-0000-${owner}';
  " > /dev/null
}

install_script relaunch <<'EOS'
select private.relaunch_due_pages() as n \gset
insert into public.relaunch_tally (n) values (:n);
EOS

make_pages 000000000001 5 due null 0
bench relaunch 20
check "20 simultaneous runs send each of 5 due pages exactly once" 5 "$(sql -c "select coalesce(sum(n), 0) from public.relaunch_tally")"
check "every sent page carries the moment of its attempt" 5 "$(sql -c "select count(*) from public.pages where user_id::text like '${USER_PREFIX}%' and attempted_at is not null")"

sql -c "truncate public.relaunch_tally; delete from public.pages where user_id::text like '${USER_PREFIX}%';" > /dev/null
make_pages 000000000002 8 due "now() - interval '1 hour'" 0
bench relaunch 10
check "10 simultaneous runs send 8 due pages, five at most each, none twice" 8 "$(sql -c "select coalesce(sum(n), 0) from public.relaunch_tally")"
check "no run sent more than five pages" 0 "$(sql -c "select count(*) from public.relaunch_tally where n > 5")"

sql -c "truncate public.relaunch_tally; delete from public.pages where user_id::text like '${USER_PREFIX}%';" > /dev/null
make_pages 000000000003 4 stale "now() - interval '11 minutes'" 0
bench relaunch 10
check "10 simultaneous runs count each stale page once" 4 "$(sql -c "select count(*) from public.pages where user_id::text like '${USER_PREFIX}%' and status = 'queued' and queue_reason = 'read_error' and retry_count = 1")"
check "and send none of them, as they were tried 11 minutes ago" 0 "$(sql -c "select coalesce(sum(n), 0) from public.relaunch_tally")"

exit "$failures"
