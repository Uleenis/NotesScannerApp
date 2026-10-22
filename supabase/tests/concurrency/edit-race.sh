#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_ID="e2e2e2e2-0000-0000-0000-000000000001"
PAGE_ID="e2e2e2e2-0000-0000-0000-000000000002"
WORDS=20
EDIT_CLIENTS=8
EDIT_ROUNDS=6
CORRECTION_CLIENTS=8
CORRECTION_ROUNDS=6
failures=0

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "delete from auth.users where id = '${USER_ID}'; drop table if exists public.edit_race_tally;" > /dev/null
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
  drop table if exists public.edit_race_tally;
  create table public.edit_race_tally (outcome text not null);
  delete from auth.users where id = '${USER_ID}';
  insert into auth.users (id, email) values ('${USER_ID}', 'edit-race@example.test');
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

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/edit.sql" <<EOS
begin;
select 1 from public.pages where id = '${PAGE_ID}' for update;
with r as (
  select public.edit_page(
    '${PAGE_ID}',
    '${USER_ID}',
    'P' || (select text from public.page_texts where page_id = '${PAGE_ID}'),
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('gap_index', 0, 'text', 'P' || coalesce((select text from public.page_gaps where page_id = '${PAGE_ID}' and gap_index = 0), '')))
  ) as outcome
)
insert into public.edit_race_tally select outcome from r;
select pg_sleep(0.02);
commit;
EOS

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/edit-words.sql" <<EOS
\set word random(1, 1000000000)
\set token random(0, ${WORDS} - 1)
begin;
insert into public.corrections (user_id, page_id, token_index, corrected_text, chosen_from)
values ('${USER_ID}', '${PAGE_ID}', :token, 'c' || :word, 'keyboard');
select pg_sleep(0.02);
commit;
EOS

docker exec "$DB_CONTAINER" pgbench -U postgres -n -f /tmp/edit.sql@1 -f /tmp/edit-words.sql@1 -c "$((EDIT_CLIENTS + CORRECTION_CLIENTS))" -j 4 -t "$EDIT_ROUNDS" postgres > /dev/null || true

edits="$(sql -c "select count(*) from public.edit_race_tally")"
edited="$(sql -c "select count(*) from public.edit_race_tally where outcome = 'edited'")"
prefix="$(sql -c "select char_length(coalesce((select text from public.page_gaps where page_id = '${PAGE_ID}' and gap_index = 0), ''))")"
shown_prefix="$(sql -c "select (regexp_match(text, '^P*'))[1] from public.page_texts where page_id = '${PAGE_ID}'" | awk '{ print length($0) }')"
latest_words="$(sql -c "select string_agg(w, ',' order by token_index) from (select k.token_index, coalesce((select c.corrected_text from public.corrections c where c.page_id = k.page_id and c.token_index = k.token_index order by c.revision desc limit 1), k.text) as w from public.page_tokens k where k.page_id = '${PAGE_ID}') x")"
shown_words="$(sql -c "select string_agg(w, ',' order by n) from (select row_number() over () as n, w from regexp_split_to_table(regexp_replace((select text from public.page_texts where page_id = '${PAGE_ID}'), '^P*', ''), E'\n') as w) x")"

check "the edits ran" "true" "$([ "$edits" -gt 0 ] && echo true || echo false)"
check "every edit ended edited, none in a deadlock or an error" "$edits" "$edited"
check "the text of the user holds one prefix per edit" "$edited" "$prefix"
check "the shown text begins with that prefix" "$prefix" "$shown_prefix"
check "the shown text holds the last correction of every position" "$latest_words" "$shown_words"

exit "$failures"
