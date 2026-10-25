#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_PREFIX="c1c1c1c1"
failures=0

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "delete from auth.users where id::text like '${USER_PREFIX}%';" > /dev/null
}

trap cleanup EXIT
cleanup

install_script() {
  docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/$1.sql"
}

bench() {
  docker exec "$DB_CONTAINER" pgbench -U postgres -n -f "/tmp/$1.sql" -c "$2" -j "$2" -t "$3" postgres > /dev/null || true
}

check() {
  if [ "$2" = "$3" ]; then
    echo "ok - $1 ($3)"
  else
    echo "not ok - $1 (expected $2, got $3)"
    failures=$((failures + 1))
  fi
}

ID="${USER_PREFIX}-0000-0000-0000-000000000001"
sql -c "insert into auth.users (id, email) values ('${ID}', '${ID}@example.test');" > /dev/null

install_script charge_render <<EOS
select * from public.charge_render('${ID}');
EOS
bench charge_render 40 1
check "40 simultaneous renderings of one user stop at 30" 30 "$(sql -c "select renders from public.render_daily_counts where user_id = '${ID}'")"

bench charge_render 8 10
check "80 more renderings leave the count at 30" 30 "$(sql -c "select renders from public.render_daily_counts where user_id = '${ID}'")"
check "the user has one row of count for the day" 1 "$(sql -c "select count(*) from public.render_daily_counts where user_id = '${ID}'")"

exit "$failures"
