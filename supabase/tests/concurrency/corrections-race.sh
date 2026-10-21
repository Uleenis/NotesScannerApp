#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_ID="e1e1e1e1-0000-0000-0000-000000000001"
PAGE_ID="e1e1e1e1-0000-0000-0000-000000000002"
WORDS=20
ROUNDS=5
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
  insert into auth.users (id, email) values ('${USER_ID}', 'corrections-race@example.test');
  insert into public.notebooks (id, user_id, name) values ('${USER_ID}', '${USER_ID}', 'Race');
  insert into public.pages (id, user_id, notebook_id, status, page_type) values ('${PAGE_ID}', '${USER_ID}', '${USER_ID}', 'read', 'text');
  insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
  select '${USER_ID}', '${PAGE_ID}', 'B1', string_agg('w' || g, E'\n' order by g), 'gemini-3.6-flash', 'v', 'V0', 0, 1, 1, 1
  from generate_series(0, ${WORDS} - 1) g;
  insert into public.page_texts (user_id, page_id, text, pipeline_version)
  select '${USER_ID}', '${PAGE_ID}', string_agg('w' || g, E'\n' order by g), 'b1-raw' from generate_series(0, ${WORDS} - 1) g;
  insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, b1_start, b1_end)
  select '${USER_ID}', '${PAGE_ID}', g, g, 'w' || g, 'w' || g,
    (select coalesce(sum(char_length('w' || h) + 1), 0) from generate_series(0, g - 1) h),
    (select coalesce(sum(char_length('w' || h) + 1), 0) from generate_series(0, g - 1) h) + char_length('w' || g)
  from generate_series(0, ${WORDS} - 1) g;
" > /dev/null

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/corrections.sql" <<EOS
\set word random(1, 1000000000)
begin;
insert into public.corrections (user_id, page_id, token_index, corrected_text, chosen_from)
values ('${USER_ID}', '${PAGE_ID}', :client_id, 'c' || :word, 'keyboard');
select pg_sleep(0.02);
commit;
EOS

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/corrections-same.sql" <<EOS
\set word random(1, 1000000000)
begin;
insert into public.corrections (user_id, page_id, token_index, corrected_text, chosen_from)
values ('${USER_ID}', '${PAGE_ID}', 0, 'c' || :word, 'keyboard');
select pg_sleep(0.02);
commit;
EOS

SAME_ROUNDS=4

docker exec "$DB_CONTAINER" pgbench -U postgres -n -f /tmp/corrections.sql -c "$WORDS" -j 4 -t "$ROUNDS" postgres > /dev/null || true
docker exec "$DB_CONTAINER" pgbench -U postgres -n -f /tmp/corrections-same.sql -c "$WORDS" -j 4 -t "$SAME_ROUNDS" postgres > /dev/null || true

expected_text="$(sql -c "select string_agg(last_word, E'\n' order by token_index) from (select distinct on (token_index) token_index, corrected_text as last_word from public.corrections where page_id = '${PAGE_ID}' order by token_index, revision desc) x" | tr '\n' ',')"
shown_text="$(sql -c "select text from public.page_texts where page_id = '${PAGE_ID}'" | tr '\n' ',')"

check "every correction was kept" "$((WORDS * ROUNDS + WORDS * SAME_ROUNDS))" "$(sql -c "select count(*) from public.corrections where page_id = '${PAGE_ID}'")"
check "every position holds its revisions with no gap" "$WORDS" "$(sql -c "select count(*) from (select token_index from public.corrections where page_id = '${PAGE_ID}' group by token_index having min(revision) = 1 and max(revision) = count(*)) x")"
check "twenty clients writing one position get distinct revisions" "$((ROUNDS + WORDS * SAME_ROUNDS))" "$(sql -c "select count(distinct revision) from public.corrections where page_id = '${PAGE_ID}' and token_index = 0")"
check "the shown text holds the correction of every position" "$expected_text" "$shown_text"

exit "$failures"
