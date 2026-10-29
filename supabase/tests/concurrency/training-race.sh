#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_PREFIX="c9a9c9a9"
failures=0

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "select set_config('storage.allow_delete_query', 'true', false);
    delete from storage.objects where bucket_id = 'models' and name like '${USER_PREFIX}%';
    delete from auth.users where id::text like '${USER_PREFIX}%';
    drop table if exists private.training_race_results;" > /dev/null
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

sql -c "update public.training_tasks set status = 'failed', finished_at = now() where status in ('queued', 'claimed');" > /dev/null

for i in $(seq 0 39); do
  OWNER="${USER_PREFIX}-0000-0000-0001-$(printf '%012d' "$i")"
  TEST="${USER_PREFIX}-0000-0000-0002-$(printf '%012d' "$i")"
  sql -c "insert into auth.users (id, email, email_confirmed_at) values ('${OWNER}', '${OWNER}@example.test', now());
    update public.profiles set birth_year = 1990, country = 'FR' where id = '${OWNER}';
    insert into public.consents (user_id, kind, version, granted_by) values ('${OWNER}', 'training', 'training-1', 'user');
    insert into public.writing_tests (id, user_id, template, status, training_lines, validation_lines, checked_at)
      values ('${TEST}', '${OWNER}', 'fr', 'accepted', 30, 10, now());" > /dev/null
done

sql -c "create table private.training_race_results (step text not null, outcome text, removed integer);" > /dev/null

install_script claim <<EOS
insert into private.training_race_results (step, outcome)
select 'claim', public.claim_training_task() ->> 'user_id';
EOS

results() {
  sql -c "select count(*) from private.training_race_results where step = '$1' and $2"
}

bench claim 40 1
check "40 simultaneous claims take 40 tasks" 40 "$(results claim "outcome like '${USER_PREFIX}%'")"
check "no task is given twice" 40 "$(sql -c "select count(distinct outcome) from private.training_race_results where step = 'claim' and outcome is not null")"
check "each user has one claimed task" 40 "$(sql -c "select count(*) from public.training_tasks where user_id::text like '${USER_PREFIX}%' and status = 'claimed' and attempts = 1")"
check "no user has a second task" 0 "$(sql -c "select count(*) from (select user_id from public.training_tasks where user_id::text like '${USER_PREFIX}%' group by user_id having count(*) > 1) d")"

sql -c "insert into storage.objects (bucket_id, name, metadata)
  select 'models', k.user_id::text || '/' || k.attempt_id::text || '.safetensors', jsonb_build_object('size', 60000000)
  from public.training_tasks k where k.user_id::text like '${USER_PREFIX}%' and k.status = 'claimed';" > /dev/null

install_script report <<EOS
insert into private.training_race_results (step, outcome, removed)
select 'report', r.outcome, cardinality(r.remove)
from public.report_training_task(
  (select k.attempt_id from public.training_tasks k
   where k.user_id = ('${USER_PREFIX}-0000-0000-0001-' || lpad((:client_id)::text, 12, '0'))::uuid),
  'trained', 0.10, 0.30, 0, 1, 80, 500, repeat('a', 64)
) r;
EOS

install_script revoke <<EOS
insert into private.training_race_results (step, outcome)
select 'revoke', public.revoke_training(('${USER_PREFIX}-0000-0000-0001-' || lpad((:client_id)::text, 12, '0'))::uuid)::text;
EOS

bench report 40 1 &
reporting=$!
bench revoke 40 1 &
revoking=$!
wait "$reporting" "$revoking"

check "40 reports race their withdrawal: no personal model is left" 0 "$(sql -c "select count(*) from public.htr_models where user_id::text like '${USER_PREFIX}%'")"
check "no task is left" 0 "$(sql -c "select count(*) from public.training_tasks where user_id::text like '${USER_PREFIX}%'")"
check "no consent is left active" 0 "$(sql -c "select count(*) from public.consents where user_id::text like '${USER_PREFIX}%' and revoked_at is null")"
check "every report either landed before the withdrawal or was refused" 40 "$(sql -c "select count(*) from private.training_race_results where step = 'report' and outcome in ('activated', 'task_not_found', 'consent_required')")"
check "every refused report names its file to erase" 0 "$(sql -c "select count(*) from private.training_race_results where step = 'report' and outcome <> 'activated' and removed is distinct from 1")"

exit "$failures"
