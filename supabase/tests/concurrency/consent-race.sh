#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_PREFIX="c5a5c5a5"
failures=0

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "delete from auth.users where id::text like '${USER_PREFIX}%'; drop table if exists private.consent_race_results;" > /dev/null
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
CLAIMS="{\"sub\":\"${ID}\",\"role\":\"authenticated\"}"
sql -c "insert into auth.users (id, email, email_confirmed_at) values ('${ID}', '${ID}@example.test', now());" > /dev/null
sql -c "create table private.consent_race_results (step text not null, ok integer not null);" > /dev/null

install_script birth_year <<EOS
begin;
select set_config('role', 'authenticated', true), set_config('request.jwt.claims', '${CLAIMS}', true);
do \$\$
begin
  update public.profiles set birth_year = 1950 + :client_id, country = 'FR' where id = '${ID}';
  perform set_config('race.ok', '1', true);
exception when others then
  perform set_config('race.ok', case when sqlerrm = 'age_already_set' then '0' else '2' end, true);
end
\$\$;
set local role postgres;
insert into private.consent_race_results (step, ok) values ('birth_year', current_setting('race.ok')::integer);
commit;
EOS

install_script consent <<EOS
begin;
select set_config('role', 'authenticated', true), set_config('request.jwt.claims', '${CLAIMS}', true);
do \$\$
begin
  insert into public.consents (kind, version) values ('training', 'training-1');
  perform set_config('race.ok', '1', true);
exception when others then
  perform set_config('race.ok', case when sqlerrm = 'consent_already_active' then '0' else '2' end, true);
end
\$\$;
set local role postgres;
insert into private.consent_race_results (step, ok) values ('consent', current_setting('race.ok')::integer);
commit;
EOS

results() {
  sql -c "select count(*) from private.consent_race_results where step = '$1' and ok = $2"
}

bench birth_year 40 1
check "40 simultaneous first writes of the birth year: one is kept" 1 "$(results birth_year 1)"
check "the 39 others are refused as a second write" 39 "$(results birth_year 0)"
check "the birth year kept is one of those written" 1 "$(sql -c "select count(*) from public.profiles where id = '${ID}' and birth_year between 1950 and 1989 and country = 'FR'")"

bench consent 40 1
check "40 simultaneous consents of one user: one is written" 1 "$(results consent 1)"
check "the 39 others are refused as a second active consent" 39 "$(results consent 0)"
check "the user has one active consent" 1 "$(sql -c "select count(*) from public.consents where user_id = '${ID}' and revoked_at is null")"

exit "$failures"
