create function public.revoke_training(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revoked integer;
begin
  if p_user_id is null then
    raise exception 'account_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  update public.consents
  set revoked_at = now()
  where user_id = p_user_id and kind = 'training' and revoked_at is null;
  get diagnostics v_revoked = row_count;
  delete from private.parent_consent_requests where user_id = p_user_id;
  delete from public.htr_models where user_id = p_user_id;
  update public.notebooks
  set correction_level = 'course'
  where user_id = p_user_id and correction_level <> 'course';
  return v_revoked > 0;
end;
$$;

revoke all on function public.revoke_training(uuid) from public, anon, authenticated, service_role;
grant execute on function public.revoke_training(uuid) to service_role;
