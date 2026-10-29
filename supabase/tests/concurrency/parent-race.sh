#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_PREFIX="c6a6c6a6"
failures=0

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "delete from auth.users where id::text like '${USER_PREFIX}%'; delete from private.parent_address_sends where address_hash in (public.email_hash('c6a6-sender@example.test'), public.email_hash('c6a6-guesser@example.test'), public.email_hash('c6a6-confirmer@example.test'), public.email_hash('c6a6-shared@example.test')); drop table if exists private.parent_race_results;" > /dev/null
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

make_child() {
  sql -c "insert into auth.users (id, email, email_confirmed_at) values ('$1', '$1@example.test', now());
    update public.profiles set birth_year = extract(year from now() at time zone 'Europe/Paris')::integer - 14, country = 'FR' where id = '$1';" > /dev/null
}

SENDER="${USER_PREFIX}-0000-0000-0000-000000000001"
GUESSER="${USER_PREFIX}-0000-0000-0000-000000000002"
CONFIRMER="${USER_PREFIX}-0000-0000-0000-000000000003"
make_child "$SENDER"
make_child "$GUESSER"
make_child "$CONFIRMER"
for i in $(seq 0 39); do make_child "${USER_PREFIX}-0000-0000-0001-$(printf '%012d' "$i")"; done
sql -c "create table private.parent_race_results (step text not null, outcome text not null);" > /dev/null

sql -c "select outcome from public.request_parent_consent('${GUESSER}', 'c6a6-guesser@example.test');
  select outcome from public.request_parent_consent('${CONFIRMER}', 'c6a6-confirmer@example.test');
  update private.parent_consent_requests set code_hash = extensions.crypt('111111', extensions.gen_salt('bf', 8))
  where user_id in ('${GUESSER}', '${CONFIRMER}');" > /dev/null

install_script request <<EOS
insert into private.parent_race_results (step, outcome)
select 'request', outcome from public.request_parent_consent('${SENDER}', 'c6a6-sender@example.test');
EOS

install_script shared <<EOS
insert into private.parent_race_results (step, outcome)
select 'shared', outcome from public.request_parent_consent(('${USER_PREFIX}-0000-0000-0001-' || lpad((:client_id)::text, 12, '0'))::uuid, 'c6a6-shared@example.test');
EOS

install_script guess <<EOS
insert into private.parent_race_results (step, outcome)
select 'guess', outcome from public.confirm_parent_consent('${GUESSER}', '222222');
EOS

install_script confirm <<EOS
insert into private.parent_race_results (step, outcome)
select 'confirm', outcome from public.confirm_parent_consent('${CONFIRMER}', '111111');
EOS

results() {
  sql -c "select count(*) from private.parent_race_results where step = '$1' and outcome = '$2'"
}

bench request 40 1
check "40 simultaneous requests of one child: three are sent" 3 "$(results request requested)"
check "the 37 others are refused by the limit of the day" 37 "$(results request send_limit)"
check "three sends are counted" 3 "$(sql -c "select count(*) from private.parent_consent_sends where user_id = '${SENDER}'")"
check "one request is in progress" 1 "$(sql -c "select count(*) from private.parent_consent_requests where user_id = '${SENDER}'")"

bench shared 40 1
check "40 children write at once to one address: three are sent" 3 "$(results shared requested)"
check "the 37 others are refused by the limit of the address" 37 "$(results shared send_limit)"
check "three sends are counted for the address" 3 "$(sql -c "select count(*) from private.parent_address_sends where address_hash = public.email_hash('c6a6-shared@example.test')")"

bench guess 40 1
check "40 simultaneous wrong codes: five count as attempts" 5 "$(results guess wrong_code)"
check "the 35 others find the request gone after five attempts" 35 "$(results guess no_request)"
check "no request is left" 0 "$(sql -c "select count(*) from private.parent_consent_requests where user_id = '${GUESSER}'")"

bench confirm 40 1
check "40 simultaneous right codes: one confirms" 1 "$(results confirm confirmed)"
check "the 39 others find no request left" 39 "$(results confirm no_request)"
check "the child has one parent consent" 1 "$(sql -c "select count(*) from public.consents where user_id = '${CONFIRMER}' and granted_by = 'parent' and revoked_at is null")"

exit "$failures"
