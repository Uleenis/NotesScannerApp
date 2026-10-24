#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_ID="e2e2e2e2-0000-0000-0000-000000000001"
NOTEBOOK_ID="e2e2e2e2-0000-0000-0000-000000000002"
DELETED_ID="e2e2e2e2-0000-0000-0000-000000000003"
DELETED_PAGE_ID="e2e2e2e2-0000-0000-0000-000000000004"
CLIENTS=12
ROUNDS=6
failures=0

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "delete from auth.users where id = '${USER_ID}';" > /dev/null
}

trap cleanup EXIT

check() {
  if [ "$2" = "$3" ]; then
    echo "ok - $1 ($3)"
  else
    echo "not ok - $1 (expected $2, got $3)"
    failures=$((failures + 1))
  fi
}

sql -c "
  delete from auth.users where id = '${USER_ID}';
  insert into auth.users (id, email) values ('${USER_ID}', 'lexicon-race@example.test');
  insert into public.notebooks (id, user_id, name) values ('${NOTEBOOK_ID}', '${USER_ID}', 'Race');
" > /dev/null

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/lexicon-add.sql" <<EOS
\set word random(1, 1000000000)
begin;
with page as (
  insert into public.pages (user_id, notebook_id, status, page_type)
  values ('${USER_ID}', '${NOTEBOOK_ID}', 'read', 'text')
  returning id
)
insert into public.page_texts (user_id, page_id, text, pipeline_version)
select '${USER_ID}', id, 'Un zorblax et un quodrix avec Zz' || :word || ' et Zz' || :client_id || '.', 'b1-raw' from page;
select pg_sleep(0.02);
commit;
EOS

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/lexicon-change.sql" <<EOS
begin;
update public.page_texts set text = 'Un autre quodrix et un zorblax ' || :client_id || ' encore.'
where page_id = (select id from public.pages where notebook_id = '${NOTEBOOK_ID}' order by id offset (:client_id * 3) % 20 limit 1);
select pg_sleep(0.02);
commit;
EOS

docker exec "$DB_CONTAINER" pgbench -U postgres -n -f /tmp/lexicon-add.sql -c "$CLIENTS" -j 4 -t "$ROUNDS" postgres > /dev/null || true
docker exec "$DB_CONTAINER" pgbench -U postgres -n -f /tmp/lexicon-change.sql@1 -f /tmp/lexicon-add.sql@1 -c "$CLIENTS" -j 4 -t "$ROUNDS" postgres > /dev/null || true

differences="$(sql -c "
  select count(*) from (
    (select form_key, form, occurrences, confirmed from public.lexicon_entries where notebook_id = '${NOTEBOOK_ID}'
     except select form_key, form, occurrences, confirmed from private.lexicon_notebook('${NOTEBOOK_ID}'))
    union all
    (select form_key, form, occurrences, confirmed from private.lexicon_notebook('${NOTEBOOK_ID}')
     except select form_key, form, occurrences, confirmed from public.lexicon_entries where notebook_id = '${NOTEBOOK_ID}')
  ) x
")"

check "the lexicon of the notebook equals a full recomputation after parallel writes" "0" "$differences"
check "the shared form counts every page that carries it" "$(sql -c "select count(*) from public.page_texts where user_id = '${USER_ID}' and text like '%zorblax%'")" "$(sql -c "select occurrences from public.lexicon_entries where notebook_id = '${NOTEBOOK_ID}' and form_key = 'zorblax'")"

sql -c "
  insert into public.notebooks (id, user_id, name) values ('${DELETED_ID}', '${USER_ID}', 'Deleted');
  insert into public.pages (id, user_id, notebook_id, status, page_type) values ('${DELETED_PAGE_ID}', '${USER_ID}', '${DELETED_ID}', 'read', 'text');
  insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
  values ('${USER_ID}', '${DELETED_PAGE_ID}', 'B1', 'le mot', 'gemini-3.6-flash', 'v', 'V0', 0, 1, 1, 1);
  insert into public.page_texts (user_id, page_id, text, pipeline_version) values ('${USER_ID}', '${DELETED_PAGE_ID}', 'le mot', 'b1-raw');
  insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, b1_start, b1_end) values
    ('${USER_ID}', '${DELETED_PAGE_ID}', 0, 0, 'le', 'le', 0, 2),
    ('${USER_ID}', '${DELETED_PAGE_ID}', 1, 0, 'mot', 'mot', 3, 6);
" > /dev/null

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/lexicon-correct.sql" <<EOS
begin;
insert into public.corrections (user_id, page_id, token_index, corrected_text, chosen_from)
values ('${USER_ID}', '${DELETED_PAGE_ID}', 1, 'zorblaxy', 'keyboard');
select pg_sleep(1.5);
commit;
EOS

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/lexicon-delete.sql" <<EOS
select pg_sleep(0.5);
select outcome from public.delete_notebook('${DELETED_ID}', '${USER_ID}');
EOS

correct_status=0
delete_status=0
docker exec "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/lexicon-correct.sql > /dev/null 2>&1 &
correct_pid=$!
delete_outcome="$(docker exec "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA -f /tmp/lexicon-delete.sql 2>/dev/null | tr -d '
')" || delete_status=$?
wait "$correct_pid" || correct_status=$?

check "a correction that adds a form and the deletion of its notebook both go through" "0,0,deleted" "${correct_status},${delete_status},${delete_outcome}"
check "the deleted notebook leaves no form" "0" "$(sql -c "select count(*) from public.lexicon_entries where notebook_id = '${DELETED_ID}'")"

exit "$failures"
