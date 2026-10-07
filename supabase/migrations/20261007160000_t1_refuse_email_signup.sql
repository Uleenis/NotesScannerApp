create function private.refuse_email_signup(event jsonb) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if event -> 'user' -> 'app_metadata' ->> 'provider' in ('email', 'phone') then
    return jsonb_build_object(
      'error',
      jsonb_build_object('http_code', 400, 'message', 'An account is created by the app, then given an e-mail address.')
    );
  end if;
  return '{}'::jsonb;
end;
$$;

revoke all on function private.refuse_email_signup(jsonb) from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.refuse_email_signup(jsonb) to supabase_auth_admin;
