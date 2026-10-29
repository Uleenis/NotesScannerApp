#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_PREFIX="c8a8c8a8"
failures=0

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "delete from auth.users where id::text like '${USER_PREFIX}%'; drop table if exists private.writing_race_results;" > /dev/null
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

make_user() {
  sql -c "insert into auth.users (id, email, email_confirmed_at) values ('$1', '$1@example.test', now());
    update public.profiles set birth_year = 1990, country = 'FR' where id = '$1';
    insert into public.consents (user_id, kind, version, granted_by) values ('$1', 'training', 'training-1', 'user');" > /dev/null
}

SOLO="${USER_PREFIX}-0000-0000-0000-000000000001"
make_user "$SOLO"

for i in $(seq 0 39); do
  OWNER="${USER_PREFIX}-0000-0000-0001-$(printf '%012d' "$i")"
  make_user "$OWNER"
  sql -c "insert into public.writing_tests (id, user_id, template) values ('${USER_PREFIX}-0000-0000-0002-$(printf '%012d' "$i")', '${OWNER}', 'fr');" > /dev/null
done

sql -c "create table private.writing_race_results (step text not null, outcome text not null);" > /dev/null

install_script begin <<EOS
insert into private.writing_race_results (step, outcome)
select 'begin', outcome from public.begin_writing_test('${SOLO}', 'fr');
EOS

install_script finish <<EOS
insert into private.writing_race_results (step, outcome)
select 'finish', outcome
from public.finish_writing_test(
  ('${USER_PREFIX}-0000-0000-0001-' || lpad((:client_id)::text, 12, '0'))::uuid,
  ('${USER_PREFIX}-0000-0000-0002-' || lpad((:client_id)::text, 12, '0'))::uuid,
  20, 10, 10
);
EOS

install_script revoke <<EOS
insert into private.writing_race_results (step, outcome)
select 'revoke', public.revoke_training(('${USER_PREFIX}-0000-0000-0001-' || lpad((:client_id)::text, 12, '0'))::uuid)::text;
EOS

results() {
  sql -c "select count(*) from private.writing_race_results where step = '$1' and outcome = '$2'"
}

bench begin 40 1
check "40 simultaneous starts of one user: one test starts" 1 "$(results begin started)"
check "the 39 others find a test in progress" 39 "$(results begin test_in_progress)"
check "the user has one test" 1 "$(sql -c "select count(*) from public.writing_tests where user_id = '${SOLO}'")"

bench finish 40 1
check "40 owners finish their test at once: every test is accepted" 40 "$(results finish accepted)"
check "every owner has one accepted test" 40 "$(sql -c "select count(*) from public.writing_tests where id::text like '${USER_PREFIX}-0000-0000-0002-%' and status = 'accepted'")"

for i in $(seq 0 39); do
  OWNER="${USER_PREFIX}-0000-0000-0001-$(printf '%012d' "$i")"
  sql -c "update public.writing_tests set status = 'rejected', training_lines = 0, validation_lines = 0 where user_id = '${OWNER}';
    insert into public.writing_tests (id, user_id, template) values ('${USER_PREFIX}-0000-0000-0003-$(printf '%012d' "$i")', '${OWNER}', 'fr');" > /dev/null
done
sql -c "delete from private.writing_race_results" > /dev/null

install_script finish_again <<EOS
insert into private.writing_race_results (step, outcome)
select 'finish_again', outcome
from public.finish_writing_test(
  ('${USER_PREFIX}-0000-0000-0001-' || lpad((:client_id)::text, 12, '0'))::uuid,
  ('${USER_PREFIX}-0000-0000-0003-' || lpad((:client_id)::text, 12, '0'))::uuid,
  20, 10, 10
);
EOS

bench finish_again 40 1 &
finishing=$!
bench revoke 40 1 &
revoking=$!
wait "$finishing" "$revoking"

check "40 owners finish while their consent is withdrawn: no test of theirs is left" 0 "$(sql -c "select count(*) from public.writing_tests where user_id::text like '${USER_PREFIX}-0000-0000-0001-%'")"
check "no accepted test stands without an active consent" 0 "$(sql -c "select count(*) from public.writing_tests t where t.user_id::text like '${USER_PREFIX}-0000-0000-0001-%' and t.status = 'accepted'")"
check "no consent is left active" 0 "$(sql -c "select count(*) from public.consents where user_id::text like '${USER_PREFIX}-0000-0000-0001-%' and revoked_at is null")"
check "every finish either accepted the test before the withdrawal or found nothing" 40 "$(sql -c "select count(*) from private.writing_race_results where step = 'finish_again' and outcome in ('accepted', 'test_not_found')")"

exit "$failures"
