drop function public.delete_notebook(uuid, uuid);

create function public.delete_notebook(p_notebook_id uuid, p_user_id uuid)
returns table (outcome text, page_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if p_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  end if;

  perform 1 from public.notebooks n
  where n.id = p_notebook_id and p_user_id is not null and n.user_id = p_user_id
  for update;
  if not found then
    return query select 'notebook_not_found'::text, '{}'::uuid[];
    return;
  end if;

  perform 1 from public.pages p where p.notebook_id = p_notebook_id order by p.id for update;
  if exists (select 1 from public.pages p where p.notebook_id = p_notebook_id and p.status = 'processing') then
    return query select 'page_processing'::text, '{}'::uuid[];
    return;
  end if;

  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[]) into v_ids
  from public.pages p where p.notebook_id = p_notebook_id;

  delete from public.notebooks n where n.id = p_notebook_id;

  return query select 'deleted'::text, v_ids;
end;
$$;

revoke all on function public.delete_notebook(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_notebook(uuid, uuid) to service_role;
