#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
DAY="2031-06-15"
AT="${DAY} 12:00:00+00"
USER_PREFIX="c0c0c0c0"
failures=0

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "delete from auth.users where id::text like '${USER_PREFIX}%'; delete from public.anonymous_daily_counts where day = '${DAY}';" > /dev/null
}

trap cleanup EXIT
cleanup

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

make_account() {
  local id="${USER_PREFIX}-0000-0000-0000-$1" anonymous="$2" pages="$3"
  sql -c "
    insert into auth.users (id, email, is_anonymous)
    values ('${id}', case when ${anonymous} then null else '${id}@example.test' end, ${anonymous});
    insert into public.notebooks (user_id, name) values ('${id}', 'N');
    insert into public.pages (user_id, notebook_id)
    select '${id}', n.id from public.notebooks n, generate_series(1, ${pages}) where n.user_id = '${id}';
  " > /dev/null
}

charged_by() {
  sql -c "select count(*) from public.page_charges where user_id::text like '${USER_PREFIX}%${1}'"
}

make_account 000000000001 false 40
install_script registered <<EOS
select * from public.charge_page((select id from public.pages where user_id = '${USER_PREFIX}-0000-0000-0000-000000000001' order by id offset :client_id limit 1), '${AT}');
EOS
bench registered 40
check "a registered account cannot pass 15 pages with 40 simultaneous readings" 15 "$(charged_by 000000000001)"

make_account 000000000002 true 10
install_script anonymous <<EOS
select * from public.charge_page((select id from public.pages where user_id = '${USER_PREFIX}-0000-0000-0000-000000000002' order by id offset :client_id limit 1), '${AT}');
EOS
bench anonymous 10
check "an anonymous account cannot pass 3 pages with 10 simultaneous readings" 3 "$(charged_by 000000000002)"

make_account 000000000003 false 1
install_script same_page <<EOS
select * from public.charge_page((select id from public.pages where user_id = '${USER_PREFIX}-0000-0000-0000-000000000003'), '${AT}');
EOS
bench same_page 20
check "one page read 20 times at once is charged once" 1 "$(charged_by 000000000003)"

for n in $(seq 1 60); do
  make_account "$(printf '1000000%05d' "$n")" true 1
done
sql -c "insert into public.anonymous_daily_counts (day, pages) values ('${DAY}', 280) on conflict (day) do update set pages = 280;" > /dev/null
install_script daily_cap <<EOS
select * from public.charge_page((select id from public.pages where user_id::text like '${USER_PREFIX}-0000-0000-0000-1000000%' order by id offset :client_id limit 1), '${AT}');
EOS
bench daily_cap 60
check "60 anonymous accounts cannot pass the daily cap of 300" 20 "$(sql -c "select count(*) from public.page_charges where user_id::text like '${USER_PREFIX}-0000-0000-0000-1000000%'")"
check "the daily counter stops at 300" 300 "$(sql -c "select pages from public.anonymous_daily_counts where day = '${DAY}'")"

exit "$failures"
