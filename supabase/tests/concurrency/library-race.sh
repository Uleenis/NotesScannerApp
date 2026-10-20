#!/usr/bin/env bash
set -euo pipefail

export MSYS_NO_PATHCONV=1

DB_CONTAINER="${DB_CONTAINER:-supabase_db_NotesScannerApp}"
FROM_ID="d1d1d1d1-0000-0000-0000-000000000001"
TO_ID="d1d1d1d1-0000-0000-0000-000000000002"
failures=0

sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -tA "$@"
}

cleanup() {
  sql -c "
    delete from auth.users where id in ('${FROM_ID}', '${TO_ID}');
    drop table if exists public.library_tally;
  " > /dev/null
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
  delete from auth.users where id in ('${FROM_ID}', '${TO_ID}');
  drop table if exists public.library_tally;
  create table public.library_tally (outcome text not null);
" > /dev/null

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/library.sql" <<'EOS'
do $$
declare
  c_user constant uuid := 'd1d1d1d1-0000-0000-0000-000000000001';
  v_kind integer := floor(random() * 6);
  v_page uuid;
  v_notebook uuid;
  v_chapter uuid;
  v_outcome text;
  v_detail text;
begin
  select p.id into v_page from public.pages p where p.user_id = c_user order by random() limit 1;
  select n.id into v_notebook from public.notebooks n where n.user_id = c_user order by random() limit 1;
  select c.id into v_chapter from public.chapters c where c.user_id = c_user and c.notebook_id = v_notebook order by random() limit 1;
  if v_kind in (0, 1, 2) then
    select outcome into v_outcome from public.move_page(coalesce(v_page, gen_random_uuid()), c_user, coalesce(v_notebook, gen_random_uuid()), v_chapter);
  elsif v_kind = 3 then
    select outcome into v_outcome from public.delete_page(coalesce(v_page, gen_random_uuid()), c_user);
  elsif v_kind = 4 then
    select outcome into v_outcome from public.delete_chapter(coalesce(v_chapter, gen_random_uuid()), c_user);
  else
    select outcome into v_outcome from public.delete_notebook(coalesce(v_notebook, gen_random_uuid()), c_user);
  end if;
  insert into public.library_tally (outcome) values (v_outcome);
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  insert into public.library_tally (outcome) values ('error ' || v_kind || ' ' || sqlstate || ' ' || coalesce(v_detail, sqlerrm));
end
$$;
EOS

docker exec -i "$DB_CONTAINER" sh -c "cat > /tmp/library-transfer.sql" <<'EOS'
do $$
begin
  perform count(*) from public.transfer_account_rows('d1d1d1d1-0000-0000-0000-000000000001', 'd1d1d1d1-0000-0000-0000-000000000002');
  insert into public.library_tally (outcome) values ('transferred');
exception
  when sqlstate 'P0001' then
    insert into public.library_tally (outcome) values ('transfer_refused');
  when others then
    insert into public.library_tally (outcome) values ('error transfer ' || sqlstate || ' ' || sqlerrm);
end
$$;
EOS

for round in 1 2 3 4 5 6 7 8; do
  sql -c "
    delete from auth.users where id in ('${FROM_ID}', '${TO_ID}');
    insert into auth.users (id, email, is_anonymous) values ('${FROM_ID}', null, true);
    insert into auth.users (id, email, is_anonymous) values ('${TO_ID}', 'race@example.test', false);
    insert into public.notebooks (user_id, name)
    select '${FROM_ID}', 'N' || g from generate_series(1, 3) g;
    insert into public.notebooks (user_id, name) values ('${TO_ID}', 'N1');
    insert into public.chapters (user_id, notebook_id, name)
    select n.user_id, n.id, 'C' || g from public.notebooks n cross join generate_series(1, 2) g where n.user_id in ('${FROM_ID}', '${TO_ID}');
    insert into public.pages (user_id, notebook_id, chapter_id, status)
    select c.user_id, c.notebook_id, c.id, 'read' from public.chapters c cross join generate_series(1, 4) g where c.user_id = '${FROM_ID}';
  " > /dev/null
  held=""
  if [ $((round % 2)) -eq 0 ]; then
    held="$(sql -c "
      update public.pages set status = 'processing'
      where id = (select id from public.pages where user_id = '${FROM_ID}' order by id limit 1)
      returning id || '|' || notebook_id;
    " | head -n 1)"
  fi
  docker exec "$DB_CONTAINER" pgbench -U postgres -n -f /tmp/library.sql@20 -f /tmp/library-transfer.sql@1 -c 24 -j 8 -t 3 postgres > /dev/null || true
  if [ -n "$held" ]; then
    check "round ${round}: a page being read is still where it was" 1 "$(sql -c "select count(*) from public.pages where id = '${held%%|*}' and notebook_id = '${held##*|}' and status = 'processing'")"
  fi
done

total="$(sql -c "select count(*) from public.library_tally")"
check "the calls ran" "true" "$([ "$total" -ge 500 ] && echo true || echo "false ($total)")"
check "no call ended in an error or a deadlock" 0 "$(sql -c "select count(*) from public.library_tally where outcome like 'error%'")"
sql -c "select outcome from public.library_tally where outcome like 'error%' limit 3"
check "every call ended with a known outcome" 0 "$(sql -c "select count(*) from public.library_tally where outcome is null or outcome not in ('moved', 'unchanged', 'deleted', 'page_not_found', 'chapter_not_found', 'notebook_not_found', 'page_processing', 'transferred', 'transfer_refused')")"
for outcome in moved deleted page_not_found page_processing transferred transfer_refused; do
  check "some call ended with ${outcome}" "true" "$([ "$(sql -c "select count(*) from public.library_tally where outcome = '${outcome}'")" -gt 0 ] && echo true || echo false)"
done

exit "$failures"
