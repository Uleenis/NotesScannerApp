#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_PREFIX="c9a9c9a9"
COUNT=20
failures=0

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "select set_config('storage.allow_delete_query', 'true', false);
    delete from storage.objects where bucket_id = 'models' and name like '${USER_PREFIX}%';
    delete from auth.users where id::text like '${USER_PREFIX}%';
    drop table if exists private.training_race_results;
    drop table if exists private.training_race_attempts;" > /dev/null
}

trap cleanup EXIT
cleanup

install_script() {
  docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/$1.sql"
}

bench() {
  local output
  if ! output=$(docker exec "$DB_CONTAINER" pgbench -U postgres -n -f "/tmp/$1.sql" -c "$2" -j "$2" -t "$3" postgres 2>&1); then
    echo "# $1: $(printf '%s\n' "$output" | grep -m 1 -iE 'error|fatal' || true)"
  fi
}

check() {
  if [ "$2" = "$3" ]; then
    echo "ok - $1 ($3)"
  else
    echo "not ok - $1 (expected $2, got $3)"
    failures=$((failures + 1))
  fi
}

make_users() {
  for i in $(seq 0 $((COUNT - 1))); do
    OWNER="${USER_PREFIX}-0000-0000-$1-$(printf '%012d' "$i")"
    sql -c "insert into auth.users (id, email, email_confirmed_at) values ('${OWNER}', '${OWNER}@example.test', now());
      update public.profiles set birth_year = 1990, country = 'FR' where id = '${OWNER}';
      insert into public.consents (user_id, kind, version, granted_by) values ('${OWNER}', 'training', 'training-1', 'user');
      insert into public.writing_tests (user_id, template, status, training_lines, validation_lines, checked_at)
        values ('${OWNER}', 'fr', 'accepted', 30, 10, now());" > /dev/null
  done
}

sql -c "update public.training_tasks set status = 'failed', finished_at = now() where status in ('queued', 'claimed') and user_id::text not like '${USER_PREFIX}%';" > /dev/null
sql -c "create table private.training_race_results (step text not null, outcome text, removed integer);" > /dev/null

results() {
  sql -c "select count(*) from private.training_race_results where step = '$1' and $2"
}

make_users 0001

install_script claim <<EOS
insert into private.training_race_results (step, outcome)
select 'claim', coalesce(public.claim_training_task() ->> 'user_id', 'none');
EOS

bench claim "$COUNT" 1
check "$COUNT simultaneous claims all answer" "$COUNT" "$(results claim "true")"
check "only one task is claimed at a time for the whole service" 1 "$(results claim "outcome like '${USER_PREFIX}%'")"
check "one claimed task in the database" 1 "$(sql -c "select count(*) from public.training_tasks where user_id::text like '${USER_PREFIX}%' and status = 'claimed'")"
check "no user has two open tasks" 0 "$(sql -c "select count(*) from (select user_id from public.training_tasks where user_id::text like '${USER_PREFIX}%' and status in ('queued', 'claimed') group by user_id having count(*) > 1) d")"

sql -c "update public.training_tasks set status = 'done', finished_at = now() where user_id::text like '${USER_PREFIX}%' and status = 'claimed';" > /dev/null
sql -c "delete from private.training_race_results" > /dev/null

install_script revoke_first <<EOS
insert into private.training_race_results (step, outcome)
select 'revoke', public.revoke_training(('${USER_PREFIX}-0000-0000-0001-' || lpad((:client_id)::text, 12, '0'))::uuid)::text;
EOS

install_script claim_again <<EOS
insert into private.training_race_results (step, outcome)
select 'claim', coalesce(public.claim_training_task() ->> 'user_id', 'none');
update public.training_tasks set status = 'done', finished_at = now()
where user_id::text like '${USER_PREFIX}%' and status = 'claimed';
EOS

bench claim_again "$COUNT" 1 &
claiming=$!
bench revoke_first "$COUNT" 1 &
revoking=$!
wait "$claiming" "$revoking"

check "$COUNT claims racing $COUNT withdrawals: every claim finished" "$COUNT" "$(results claim "true")"
check "every withdrawal finished, none was aborted" "$COUNT" "$(results revoke "outcome = 'true'")"
check "no consent is left active" 0 "$(sql -c "select count(*) from public.consents where user_id::text like '${USER_PREFIX}-0000-0000-0001-%' and revoked_at is null")"
check "no task is left to a user who withdrew" 0 "$(sql -c "select count(*) from public.training_tasks where user_id::text like '${USER_PREFIX}-0000-0000-0001-%'")"

sql -c "delete from private.training_race_results" > /dev/null
make_users 0003
sql -c "insert into public.training_tasks (user_id, status, attempts, attempt_id, claimed_at)
  select c.user_id, 'claimed', 1, gen_random_uuid(), now() from public.consents c where c.user_id::text like '${USER_PREFIX}-0000-0000-0003-%';
  insert into storage.objects (bucket_id, name, metadata)
  select 'models', k.user_id::text || '/' || k.attempt_id::text || '.safetensors', jsonb_build_object('size', 60000000)
  from public.training_tasks k where k.user_id::text like '${USER_PREFIX}-0000-0000-0003-%';
  create table private.training_race_attempts as
  select k.user_id, k.attempt_id from public.training_tasks k where k.user_id::text like '${USER_PREFIX}-0000-0000-0003-%';" > /dev/null

install_script report <<EOS
insert into private.training_race_results (step, outcome, removed)
select 'report', r.outcome, cardinality(r.remove)
from public.report_training_task(
  (select a.attempt_id from private.training_race_attempts a
   where a.user_id = ('${USER_PREFIX}-0000-0000-0003-' || lpad((:client_id)::text, 12, '0'))::uuid),
  'trained', 0.10, 0.30, 0, 1, 80, 500, repeat('a', 64)
) r;
EOS

install_script revoke <<EOS
insert into private.training_race_results (step, outcome)
select 'revoke', public.revoke_training(('${USER_PREFIX}-0000-0000-0003-' || lpad((:client_id)::text, 12, '0'))::uuid)::text;
EOS

bench report "$COUNT" 1 &
reporting=$!
bench revoke "$COUNT" 1 &
revoking=$!
wait "$reporting" "$revoking"

check "every withdrawal finished" "$COUNT" "$(results revoke "outcome = 'true'")"
check "$COUNT reports race their withdrawal: no personal model is left" 0 "$(sql -c "select count(*) from public.htr_models where user_id::text like '${USER_PREFIX}%'")"
check "no task is left" 0 "$(sql -c "select count(*) from public.training_tasks where user_id::text like '${USER_PREFIX}%'")"
check "no consent is left active" 0 "$(sql -c "select count(*) from public.consents where user_id::text like '${USER_PREFIX}%' and revoked_at is null")"
check "every report either landed before the withdrawal or was refused" "$COUNT" "$(results report "outcome in ('activated', 'task_not_found', 'consent_required')")"
check "every refused report names its file to erase" 0 "$(results report "outcome <> 'activated' and removed is distinct from 1")"

exit "$failures"
