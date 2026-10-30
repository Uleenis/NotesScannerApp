#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
USER_ID="e3e3e3e3-0000-0000-0000-000000000001"
FIRST_ID="e3e3e3e3-0000-0000-0000-000000000002"
SECOND_ID="e3e3e3e3-0000-0000-0000-000000000003"
MODEL_ID="e3e3e3e3-0000-0000-0000-000000000004"
CLIENTS=12
ROUNDS=15
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
  insert into auth.users (id, email, email_confirmed_at) values ('${USER_ID}', 'dates-race@example.test', now());
  update public.profiles
  set birth_year = extract(year from now() at time zone 'Europe/Paris')::integer - 30, country = 'FR'
  where id = '${USER_ID}';
  insert into public.consents (user_id, kind, version, granted_by) values ('${USER_ID}', 'training', 'training-1', 'user');
  insert into public.htr_models (id, user_id, name, version, status, storage_path, cer)
  values ('${MODEL_ID}', '${USER_ID}', 'personal', 1, 'active', '${USER_ID}/1.safetensors', 0.1);
  insert into public.notebooks (id, user_id, name) values
    ('${FIRST_ID}', '${USER_ID}', 'First'),
    ('${SECOND_ID}', '${USER_ID}', 'Second');
  update public.notebooks set correction_level = 'journal' where user_id = '${USER_ID}';
" > /dev/null

sql -c "
  create temp table made as
  select
    gen_random_uuid() as id,
    n,
    'Jour ' || n || ' ' || to_char(date '2026-01-01' + n, 'DD/MM/YYYY') || ' suite' as raw,
    length(n::text) as len
  from generate_series(1, 24) as n;
  with p as (
    insert into public.pages (id, user_id, notebook_id, status, page_type, language)
    select id, '${USER_ID}', case when n <= 12 then '${FIRST_ID}'::uuid else '${SECOND_ID}'::uuid end, 'read', 'text', 'fr' from made
    returning id
  ),
  r as (
    insert into public.readings (user_id, page_id, label, raw_text, model, model_version, prompt_version, thinking_budget, input_tokens, output_tokens, duration_ms)
    select '${USER_ID}', id, 'B1', raw, 'gemini-3.6-flash', 'v', 'V0', 0, 1, 1, 1 from made
    returning 1
  ),
  t as (
    insert into public.page_texts (user_id, page_id, text, pipeline_version)
    select '${USER_ID}', id, raw, 'b1-raw' from made
    returning 1
  )
  insert into public.page_tokens (user_id, page_id, token_index, line_index, text, reading_b1, b1_start, b1_end)
  select '${USER_ID}', m.id, w.idx, 0, w.word, w.word, w.s, w.e
  from made m
  cross join lateral (values
    (0, 'Jour', 0, 4),
    (1, m.n::text, 5, 5 + m.len),
    (2, to_char(date '2026-01-01' + m.n, 'DD/MM/YYYY'), 6 + m.len, 16 + m.len),
    (3, 'suite', 17 + m.len, 22 + m.len)
  ) as w(idx, word, s, e);
" > /dev/null

check "the pages start without any alert" "0" "$(sql -c "select count(*) from public.page_alerts where user_id = '${USER_ID}'")"

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/dates-correct.sql" <<EOS
\set pick random(0, 23)
\set roll random(0, 9)
\set number random(1, 60)
begin;
insert into public.corrections (user_id, page_id, token_index, corrected_text, chosen_from)
select '${USER_ID}', p.id, 1, (case when :roll < 7 then (to_date(t.text, 'DD/MM/YYYY') - date '2026-01-01') else :number end)::text, 'keyboard'
from (select id from public.pages where user_id = '${USER_ID}' order by id offset :pick limit 1) p
join public.page_tokens t on t.page_id = p.id and t.token_index = 2;
select pg_sleep(0.02);
commit;
EOS

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/dates-move.sql" <<EOS
\set pick random(0, 23)
begin;
update public.pages
set notebook_id = case when notebook_id = '${FIRST_ID}' then '${SECOND_ID}'::uuid else '${FIRST_ID}'::uuid end
where id = (select id from public.pages where user_id = '${USER_ID}' order by id offset :pick limit 1);
select pg_sleep(0.02);
commit;
EOS

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/dates-text.sql" <<EOS
\set pick random(0, 23)
\set roll random(0, 9)
\set number random(1, 60)
begin;
update public.page_texts x
set text = 'Jour ' || (case when :roll < 7 then (to_date(t.text, 'DD/MM/YYYY') - date '2026-01-01') else :number end) || ' ' || t.text || ' suite'
from public.page_tokens t
where t.page_id = x.page_id and t.token_index = 2
  and x.page_id = (select id from public.pages where user_id = '${USER_ID}' order by id offset :pick limit 1);
select pg_sleep(0.02);
commit;
EOS

run_log="$(docker exec "$DB_CONTAINER" pgbench -U postgres -n -f /tmp/dates-correct.sql@3 -f /tmp/dates-move.sql@1 -f /tmp/dates-text.sql@1 -c "$CLIENTS" -j 4 -t "$ROUNDS" postgres 2>&1 || true)"

check "no parallel write fails" "0" "$(printf '%s\n' "$run_log" | grep -c 'ERROR' || true)"

check "the run raised alerts, so the comparison is not empty" "t" "$(sql -c "select count(*) > 0 from public.page_alerts where user_id = '${USER_ID}' and kind = 'date_incoherent'")"

for notebook in "$FIRST_ID" "$SECOND_ID"; do
  differences="$(sql -c "
    select count(*) from (
      (select a.page_id from public.page_alerts a join public.pages p on p.id = a.page_id
       where p.notebook_id = '${notebook}' and a.kind = 'date_incoherent'
       except select page_id from private.date_alerts_notebook('${notebook}'))
      union all
      (select page_id from private.date_alerts_notebook('${notebook}')
       except select a.page_id from public.page_alerts a join public.pages p on p.id = a.page_id
       where p.notebook_id = '${notebook}' and a.kind = 'date_incoherent')
    ) x
  ")"
  check "the date alerts of the notebook equal a full recalculation after parallel writes" "0" "$differences"
done

check "no page of the notebooks holds two date alerts" "0" "$(sql -c "select count(*) from (select page_id from public.page_alerts where user_id = '${USER_ID}' and kind = 'date_incoherent' group by page_id having count(*) > 1) x")"

sql -c "update public.notebooks set correction_level = 'course' where user_id = '${USER_ID}';" > /dev/null
check "leaving the journal level clears every alert" "0" "$(sql -c "select count(*) from public.page_alerts where user_id = '${USER_ID}' and kind = 'date_incoherent'")"

exit "$failures"
