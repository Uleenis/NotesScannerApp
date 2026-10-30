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
  sql -c "delete from auth.users where id::text like '${USER_PREFIX}%'; drop table if exists private.levels_race_results;" > /dev/null
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

for i in $(seq 0 39); do
  OWNER="${USER_PREFIX}-0000-0000-0001-$(printf '%012d' "$i")"
  sql -c "insert into auth.users (id, email, email_confirmed_at) values ('${OWNER}', '${OWNER}@example.test', now());
    update public.profiles set birth_year = 1990, country = 'FR' where id = '${OWNER}';
    insert into public.consents (user_id, kind, version, granted_by) values ('${OWNER}', 'training', 'training-1', 'user');
    insert into public.htr_models (user_id, name, version, status, storage_path, cer)
      values ('${OWNER}', 'personal', 1, 'active', '${OWNER}/1.safetensors', 0.1);
    insert into public.notebooks (id, user_id, name) values ('${USER_PREFIX}-0000-0000-0002-$(printf '%012d' "$i")', '${OWNER}', 'Journal');" > /dev/null
done

SOLO="${USER_PREFIX}-0000-0000-0003-000000000001"
sql -c "insert into auth.users (id, email, email_confirmed_at) values ('${SOLO}', '${SOLO}@example.test', now());
  update public.profiles set birth_year = 1990, country = 'FR' where id = '${SOLO}';
  insert into public.consents (user_id, kind, version, granted_by) values ('${SOLO}', 'training', 'training-1', 'user');
  insert into public.htr_models (user_id, name, version, status, storage_path, cer)
    values ('${SOLO}', 'personal', 1, 'active', '${SOLO}/1.safetensors', 0.1);
  insert into public.notebooks (id, user_id, name) values ('${USER_PREFIX}-0000-0000-0004-000000000001', '${SOLO}', 'Journal');" > /dev/null

sql -c "create table private.levels_race_results (step text not null, outcome text not null);" > /dev/null

install_script solo <<EOS
insert into private.levels_race_results (step, outcome)
select 'solo', public.set_correction_level('${SOLO}', '${USER_PREFIX}-0000-0000-0004-000000000001', (array['journal', 'grammar', 'course'])[1 + (:client_id % 3)]);
EOS

install_script set <<EOS
insert into private.levels_race_results (step, outcome)
select 'set', public.set_correction_level(
  ('${USER_PREFIX}-0000-0000-0001-' || lpad((:client_id)::text, 12, '0'))::uuid,
  ('${USER_PREFIX}-0000-0000-0002-' || lpad((:client_id)::text, 12, '0'))::uuid,
  'journal');
EOS

install_script revoke <<EOS
insert into private.levels_race_results (step, outcome)
select 'revoke', public.revoke_training(('${USER_PREFIX}-0000-0000-0001-' || lpad((:client_id)::text, 12, '0'))::uuid)::text;
EOS

results() {
  sql -c "select count(*) from private.levels_race_results where step = '$1' and outcome = '$2'"
}

bench solo 40 1
check "40 simultaneous changes of the level of one notebook all end without error" 40 "$(sql -c "select count(*) from private.levels_race_results where step = 'solo' and outcome = 'set'")"
check "the notebook holds one of the three levels" 1 "$(sql -c "select count(*) from public.notebooks where id = '${USER_PREFIX}-0000-0000-0004-000000000001' and correction_level in ('course', 'journal', 'grammar')")"

bench set 40 1 &
setting=$!
bench revoke 40 1 &
revoking=$!
wait "$setting" "$revoking"

check "every change either set the level or found the model gone" 40 "$(sql -c "select count(*) from private.levels_race_results where step = 'set' and outcome in ('set', 'requires_model')")"
check "every withdrawal ran" 40 "$(sql -c "select count(*) from private.levels_race_results where step = 'revoke'")"
check "no model is left after the withdrawals" 0 "$(sql -c "select count(*) from public.htr_models where user_id::text like '${USER_PREFIX}-0000-0000-0001-%'")"
check "no notebook is left above the course level once its model is gone" 0 "$(sql -c "select count(*) from public.notebooks where user_id::text like '${USER_PREFIX}-0000-0000-0001-%' and correction_level <> 'course'")"

exit "$failures"
