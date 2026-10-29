#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_PREFIX="c7a7c7a7"
failures=0

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "delete from auth.users where id::text like '${USER_PREFIX}%'; drop table if exists private.revoke_race_results;" > /dev/null
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

SOLO="${USER_PREFIX}-0000-0000-0000-000000000001"
sql -c "insert into auth.users (id, email, email_confirmed_at) values ('${SOLO}', '${SOLO}@example.test', now());
  update public.profiles set birth_year = 1990, country = 'FR' where id = '${SOLO}';
  insert into public.consents (user_id, kind, version, granted_by) values ('${SOLO}', 'training', 'training-1', 'user');" > /dev/null

for i in $(seq 0 39); do
  CHILD="${USER_PREFIX}-0000-0000-0001-$(printf '%012d' "$i")"
  sql -c "insert into auth.users (id, email, email_confirmed_at) values ('${CHILD}', '${CHILD}@example.test', now());
    update public.profiles set birth_year = extract(year from now() at time zone 'Europe/Paris')::integer - 14, country = 'FR' where id = '${CHILD}';
    insert into private.parent_consent_requests (user_id, parent_email, code_hash, expires_at)
    select '${CHILD}', 'c7a7-parent-${i}@example.test', extensions.crypt('111111', extensions.gen_salt('bf', 8)), now() + interval '7 days';" > /dev/null
done

sql -c "create table private.revoke_race_results (step text not null, outcome text not null);" > /dev/null

install_script solo <<EOS
insert into private.revoke_race_results (step, outcome)
select 'solo', public.revoke_training('${SOLO}')::text;
EOS

install_script confirm <<EOS
insert into private.revoke_race_results (step, outcome)
select 'confirm', outcome from public.confirm_parent_consent(('${USER_PREFIX}-0000-0000-0001-' || lpad((:client_id)::text, 12, '0'))::uuid, '111111');
EOS

install_script revoke <<EOS
insert into private.revoke_race_results (step, outcome)
select 'revoke', public.revoke_training(('${USER_PREFIX}-0000-0000-0001-' || lpad((:client_id)::text, 12, '0'))::uuid)::text;
EOS

results() {
  sql -c "select count(*) from private.revoke_race_results where step = '$1' and outcome = '$2'"
}

bench solo 40 1
check "40 simultaneous withdrawals of one user: one finds the consent" 1 "$(results solo true)"
check "the 39 others find nothing to withdraw" 39 "$(results solo false)"
check "the consent is withdrawn once" 1 "$(sql -c "select count(*) from public.consents where user_id = '${SOLO}' and revoked_at is not null")"
check "no consent is left active" 0 "$(sql -c "select count(*) from public.consents where user_id = '${SOLO}' and revoked_at is null")"

bench confirm 40 1 &
confirming=$!
bench revoke 40 1 &
revoking=$!
wait "$confirming" "$revoking"

check "40 children confirm while their withdrawal runs: no consent is left active" 0 "$(sql -c "select count(*) from public.consents where user_id::text like '${USER_PREFIX}-0000-0000-0001-%' and revoked_at is null")"
check "no request to a parent is left in progress" 0 "$(sql -c "select count(*) from private.parent_consent_requests where user_id::text like '${USER_PREFIX}-0000-0000-0001-%'")"
check "no child has more than one consent" 0 "$(sql -c "select count(*) from (select user_id from public.consents where user_id::text like '${USER_PREFIX}-0000-0000-0001-%' group by user_id having count(*) > 1) t")"
check "every confirmation either wrote a consent that was then withdrawn or found no request" 40 "$(sql -c "select count(*) from private.revoke_race_results where step = 'confirm' and outcome in ('confirmed', 'no_request')")"
check "every consent written by a confirmation is in the history, withdrawn" "$(results confirm confirmed)" "$(sql -c "select count(*) from public.consents where user_id::text like '${USER_PREFIX}-0000-0000-0001-%' and revoked_at is not null")"

exit "$failures"
