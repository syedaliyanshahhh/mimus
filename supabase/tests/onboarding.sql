-- Onboarding replaces auto-provisioning: signing up creates only a profile
-- (via a trigger on auth.users), and a company is created only when the
-- user names it, through create_company_with_owner().
begin;
select plan(16);

-- Profile trigger.
insert into auth.users (id, email, raw_user_meta_data) values
  ('0b000000-0000-0000-0000-000000000001', 'founder@example.com', '{"full_name":"Fay Founder"}');

select results_eq(
  $$ select email, full_name from profiles where id = '0b000000-0000-0000-0000-000000000001' $$,
  $$ values ('founder@example.com'::text, 'Fay Founder'::text) $$,
  'a new auth user gets a profile with their email and name'
);
select is(
  (select count(*) from workspace_members where user_id = '0b000000-0000-0000-0000-000000000001'),
  0::bigint,
  'signing up alone creates no workspace'
);
select is(
  (select count(*)::int from information_schema.routines where routine_schema = 'public' and routine_name = 'create_default_workspace_for_user'),
  0,
  'the old auto-provisioning function is gone'
);

-- Privileges.
select has_function('public', 'create_company_with_owner', array['uuid', 'text', 'text'], 'create_company_with_owner(uuid, text, text) exists');
select is(has_function_privilege('anon', 'create_company_with_owner(uuid, text, text)', 'execute'), false, 'anon cannot execute create_company_with_owner');
select is(has_function_privilege('authenticated', 'create_company_with_owner(uuid, text, text)', 'execute'), false, 'authenticated cannot execute create_company_with_owner');

-- Creating a company.
select isnt(
  create_company_with_owner('0b000000-0000-0000-0000-000000000001', '  Fay Co  ', ' Leadership '),
  null,
  'creating a company returns the new workspace id'
);
select results_eq(
  $$ select c.name, w.name, m.role, m.status
     from workspace_members m
     join workspaces w on w.id = m.workspace_id
     join companies c on c.id = w.company_id
     where m.user_id = '0b000000-0000-0000-0000-000000000001' $$,
  $$ values ('Fay Co'::text, 'Leadership'::text, 'owner'::text, 'active'::text) $$,
  'the user is the active Owner of one workspace in one company, with trimmed names'
);
select is(
  (select w.id from workspaces w join workspace_members m on m.workspace_id = w.id
   where m.user_id = '0b000000-0000-0000-0000-000000000001'),
  (select workspace_id from workspace_members where user_id = '0b000000-0000-0000-0000-000000000001'),
  'the returned id is that workspace'
);

-- Validation.
select throws_ok(
  $$ select create_company_with_owner('0b000000-0000-0000-0000-000000000001', '   ', 'General') $$,
  'Company name is required',
  'a blank company name is rejected'
);
select throws_ok(
  $$ select create_company_with_owner('0b000000-0000-0000-0000-000000000001', 'Co', '') $$,
  'Workspace name is required',
  'a blank workspace name is rejected'
);
select throws_ok(
  $$ select create_company_with_owner('0b000000-0000-0000-0000-000000000001', repeat('x', 101), 'General') $$,
  'Company name must be 100 characters or fewer',
  'an overlong company name is rejected'
);
select throws_ok(
  $$ select create_company_with_owner('0b000000-0000-0000-0000-0000000000ff', 'Co', 'General') $$,
  'User not found',
  'a user id with no auth user is rejected'
);
select is(
  (select count(*) from workspace_members where user_id = '0b000000-0000-0000-0000-000000000001'),
  1::bigint,
  'rejected attempts create nothing'
);

-- Users created without name metadata (e.g. magic-link sign-ups).
insert into auth.users (id, email) values ('0b000000-0000-0000-0000-000000000002', 'second@example.com');
select is(
  (select email from profiles where id = '0b000000-0000-0000-0000-000000000002'),
  'second@example.com',
  'a user without name metadata still gets a profile'
);
select is(
  (select full_name from profiles where id = '0b000000-0000-0000-0000-000000000002'),
  null,
  'and their name is left empty'
);

select * from finish();
rollback;
