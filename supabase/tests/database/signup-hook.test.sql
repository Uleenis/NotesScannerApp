begin;
select plan(11);

select is(
  private.refuse_email_signup('{"user":{"app_metadata":{"provider":"email","providers":["email"]},"email":"someone@example.test","is_anonymous":false}}'::jsonb) -> 'error' ->> 'http_code',
  '400',
  'a new account made with an e-mail address and a password is refused'
);

select ok(
  private.refuse_email_signup('{"user":{"app_metadata":{"provider":"email"},"email":"someone@example.test","is_anonymous":false}}'::jsonb) -> 'error' ->> 'message' is not null,
  'the refusal says why'
);

select is(
  private.refuse_email_signup('{"user":{"app_metadata":{"provider":"email"},"email":"someone@example.test","is_anonymous":false}}'::jsonb) - 'error',
  '{}'::jsonb,
  'the refusal holds nothing but the error'
);

select is(
  private.refuse_email_signup('{"user":{"app_metadata":{"provider":"phone"},"phone":"+33600000000","is_anonymous":false}}'::jsonb) -> 'error' ->> 'http_code',
  '400',
  'a new account made with a phone number is refused'
);

select is(
  private.refuse_email_signup('{"user":{"app_metadata":{"provider":"anonymous","providers":["anonymous"]},"is_anonymous":true}}'::jsonb),
  '{}'::jsonb,
  'an anonymous account is let through'
);

select is(
  private.refuse_email_signup('{"user":{"app_metadata":{"provider":"apple","providers":["apple"]},"email":"someone@example.test","is_anonymous":false}}'::jsonb),
  '{}'::jsonb,
  'an account that comes from Apple is let through'
);

select is(
  private.refuse_email_signup('{"user":{"app_metadata":{"provider":"google","providers":["google"]},"email":"someone@example.test","is_anonymous":false}}'::jsonb),
  '{}'::jsonb,
  'an account that comes from Google is let through'
);

select is(
  private.refuse_email_signup('{}'::jsonb),
  '{}'::jsonb,
  'an event with no user is let through, the settings of the project decide'
);

select ok(
  has_function_privilege('supabase_auth_admin', 'private.refuse_email_signup(jsonb)', 'execute'),
  'the authentication service can run the hook'
);

select ok(
  not has_function_privilege('anon', 'private.refuse_email_signup(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'private.refuse_email_signup(jsonb)', 'execute'),
  'a visitor and a signed-in user cannot run the hook'
);

select ok(
  has_schema_privilege('supabase_auth_admin', 'private', 'usage')
    and not has_schema_privilege('anon', 'private', 'usage')
    and not has_schema_privilege('authenticated', 'private', 'usage'),
  'only the authentication service enters the private schema, besides the owner'
);

select * from finish();
rollback;
