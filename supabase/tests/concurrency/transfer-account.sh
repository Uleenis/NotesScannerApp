#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
DAY="2031-06-15"
AT="${DAY} 12:00:00+00"
USER_PREFIX="d0d0d0d0"
failures=0

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "drop trigger if exists pause_probe on public.pages; drop function if exists public.pause_probe(); drop table if exists public.reading_a_tally;" > /dev/null
  sql -c "delete from auth.users where id::text like '${USER_PREFIX}%'; delete from public.anonymous_daily_counts where day = '${DAY}'; delete from public.email_monthly_counts where month = '2031-06-01';" > /dev/null
}

trap cleanup EXIT
cleanup

install_script() {
  docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/$1.sql"
}

bench() {
  docker exec "$DB_CONTAINER" pgbench -U postgres -n -f "/tmp/$1.sql" -c "$2" -j "$2" -t 1 postgres > /dev/null 2>&1 || true
}

check() {
  if [ "$2" = "$3" ]; then
    echo "ok - $1 ($3)"
  else
    echo "not ok - $1 (expected $2, got $3)"
    failures=$((failures + 1))
  fi
}

make_account() {
  local id="${USER_PREFIX}-0000-0000-0000-$1" anonymous="$2" pages="$3" charged="$4"
  sql -c "
    insert into auth.users (id, email, is_anonymous)
    values ('${id}', case when ${anonymous} then null else '${id}@example.test' end, ${anonymous});
    insert into public.notebooks (user_id, name) values ('${id}', 'Shared name');
    insert into public.pages (user_id, notebook_id)
    select '${id}', n.id from public.notebooks n, generate_series(1, ${pages}) where n.user_id = '${id}';
  " > /dev/null
  if [ "$charged" = "true" ]; then
    sql -c "insert into public.page_charges (user_id, page_id, charged_at) select user_id, id, '${AT}' from public.pages where user_id = '${id}';" > /dev/null
  fi
}

id_of() {
  echo "${USER_PREFIX}-0000-0000-0000-$1"
}

count_of() {
  sql -c "select count(*) from public.$1 where user_id = '$(id_of "$2")'"
}

FROM="$(id_of 000000000001)"
TO="$(id_of 000000000002)"
make_account 000000000001 true 40 true
make_account 000000000002 false 2 false
install_script transfer <<EOS
select * from public.transfer_account_rows('${FROM}', '${TO}');
EOS
bench transfer 10

check "ten simultaneous transfers leave nothing of the anonymous account" 0 "$(count_of pages 000000000001)"
check "ten simultaneous transfers bring each page once" 42 "$(count_of pages 000000000002)"
check "ten simultaneous transfers bring each charge once" 40 "$(count_of page_charges 000000000002)"
check "no page is charged twice after ten simultaneous transfers" 40 "$(sql -c "select count(distinct page_id) from public.page_charges where user_id = '${TO}'")"
check "the notebooks of the same name are one notebook after ten simultaneous transfers" 1 "$(count_of notebooks 000000000002)"
check "the anonymous account keeps no charge after ten simultaneous transfers" 0 "$(count_of page_charges 000000000001)"

FROM="$(id_of 000000000003)"
TO="$(id_of 000000000004)"
make_account 000000000003 true 3 false
make_account 000000000004 false 0 false
install_script race_transfer <<EOS
select * from public.transfer_account_rows('${FROM}', '${TO}');
EOS
install_script race_charge <<EOS
select * from public.charge_page((select id from public.pages where user_id in ('${FROM}', '${TO}') order by id offset :client_id limit 1), '${AT}');
EOS
bench race_transfer 4 &
bench race_charge 3 &
wait

check "readings that race a transfer are charged once each" 3 "$(sql -c "select count(*) from public.page_charges where page_id in (select id from public.pages where user_id = '${TO}')")"
check "the pages that raced a transfer all belong to the account found" 3 "$(count_of pages 000000000004)"
check "nothing of the anonymous account is left after a transfer that raced readings" 0 "$(count_of pages 000000000003)"
check "no charge of the anonymous account is left after a transfer that raced readings" 0 "$(count_of page_charges 000000000003)"

FROM="$(id_of 000000000005)"
TO="$(id_of 000000000006)"
make_account 000000000005 true 1 false
make_account 000000000006 false 0 false
PAGE="$(sql -c "select id from public.pages where user_id = '${FROM}'")"
( sql -c "begin; select * from public.transfer_account_rows('${FROM}', '${TO}'); select pg_sleep(3); commit;" > /dev/null ) &
sleep 1
sql -c "select * from public.charge_page('${PAGE}', '${AT}')" > /dev/null 2>&1 || true
wait

check "a reading that waits for a transfer is charged to the account that received the page" 1 "$(sql -c "select count(*) from public.page_charges where page_id = '${PAGE}' and user_id = '${TO}'")"
check "a reading that waits for a transfer leaves no charge to the anonymous account" 0 "$(count_of page_charges 000000000005)"

FROM="$(id_of 000000000007)"
TO="$(id_of 000000000008)"
make_account 000000000007 true 1 false
make_account 000000000008 false 0 false
PAGE="$(sql -c "select id from public.pages where user_id = '${FROM}'")"
sql -c "
  create function public.pause_probe() returns trigger language plpgsql as \$\$ begin if current_setting('transfer.pause', true) = 'on' then perform pg_sleep(3); end if; return null; end \$\$;
  create trigger pause_probe before update on public.pages for each statement execute function public.pause_probe();
" > /dev/null
( sql -c "set transfer.pause = 'on'; select * from public.transfer_account_rows('${FROM}', '${TO}')" > /dev/null ) &
sleep 1
sql -c "update public.pages set status = 'processing' where id = '${PAGE}' and user_id = '${FROM}' and status = 'queued'" > /dev/null
wait
sql -c "drop trigger pause_probe on public.pages; drop function public.pause_probe();" > /dev/null

check "a reading that starts while the pages are being moved does not catch a page on its way" queued "$(sql -c "select status from public.pages where id = '${PAGE}'")"
check "the page that raced a reading arrived in the account found" "${TO}" "$(sql -c "select user_id from public.pages where id = '${PAGE}'")"

record_a() {
  echo "select * from public.record_reading_a('$1', '$2', 'text', 'medium', 'version', 1, '$2/$1/a.xml', 'en', '[{\"token_index\": 0, \"line_index\": 0, \"text\": \"text\", \"reading_a\": \"text\", \"reading_b1\": \"text\", \"anchor_kind\": null, \"anchor\": null}]'::jsonb)"
}

FROM="$(id_of 000000000009)"
TO="$(id_of 000000000010)"
make_account 000000000009 true 1 false
make_account 000000000010 false 0 false
PAGE="$(sql -c "select id from public.pages where user_id = '${FROM}'")"
( sql -c "begin; select * from public.transfer_account_rows('${FROM}', '${TO}'); select pg_sleep(3); commit;" > /dev/null ) &
sleep 1
REFUSAL="$(sql -c "$(record_a "${PAGE}" "${FROM}")" 2>&1 || true)"
wait

check "a reading A that waits for a transfer is refused, the page having changed owner" "f|page_not_found" "${REFUSAL}"
check "a reading A that waits for a transfer writes no reading" 0 "$(sql -c "select count(*) from public.readings where page_id = '${PAGE}'")"
check "a reading A that waits for a transfer writes no position" 0 "$(sql -c "select count(*) from public.page_tokens where page_id = '${PAGE}'")"

OWNER="$(id_of 000000000011)"
make_account 000000000011 false 1 false
PAGE="$(sql -c "select id from public.pages where user_id = '${OWNER}'")"
sql -c "drop table if exists public.reading_a_tally; create table public.reading_a_tally (recorded integer not null, refused integer not null);" > /dev/null
install_script record_a <<EOS
select r.recorded::integer as recorded, (r.reason = 'already_read')::integer as refused from ($(record_a "${PAGE}" "${OWNER}")) r \gset
insert into public.reading_a_tally (recorded, refused) values (:recorded, :refused);
EOS
bench record_a 10

check "ten simultaneous writes of A for one page all answer, none fails" 10 "$(sql -c "select count(*) from public.reading_a_tally")"
check "of ten simultaneous writes of A for one page, one is recorded" 1 "$(sql -c "select coalesce(sum(recorded), 0) from public.reading_a_tally")"
check "of ten simultaneous writes of A for one page, nine are refused as already read" 9 "$(sql -c "select coalesce(sum(refused), 0) from public.reading_a_tally")"
sql -c "drop table public.reading_a_tally;" > /dev/null
check "ten simultaneous writes of A for one page write one reading" 1 "$(sql -c "select count(*) from public.readings where page_id = '${PAGE}' and label = 'A'")"
check "ten simultaneous writes of A for one page write its positions once" 1 "$(sql -c "select count(*) from public.page_tokens where page_id = '${PAGE}'")"

exit "$failures"
