#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_ID="e2e2e2e2-0000-0000-0000-000000000001"
NOTEBOOK_ID="e2e2e2e2-0000-0000-0000-000000000002"
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

exit "$failures"
