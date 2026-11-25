-- Active workspace (MULTI_USER_PLAN.md A4): a user in several companies picks
-- one to work in. list_my_workspaces() returns only the caller's own active
-- memberships, and set_active_workspace() refuses a workspace the caller
-- isn't an active member of.
begin;
select plan(17);

insert into auth.users (id, email) values
  ('0c000000-0000-0000-0000-000000000001', 'two-co@example.com'),
  ('0c000000-0000-0000-0000-000000000002', 'stranger@example.com');

insert into companies (id, name) values
  ('0c100000-0000-0000-0000-000000000001', 'Alpha Co'),
  ('0c100000-0000-0000-0000-000000000002', 'Beta Co'),
  ('0c100000-0000-0000-0000-000000000003', 'Gamma Co');
insert into workspaces (id, company_id, name) values
  ('0c200000-0000-0000-0000-000000000001', '0c100000-0000-0000-0000-000000000001', 'Alpha HQ'),
  ('0c200000-0000-0000-0000-000000000002', '0c100000-0000-0000-0000-000000000002', 'Beta Sales'),
  ('0c200000-0000-0000-0000-000000000003', '0c100000-0000-0000-0000-000000000003', 'Gamma Ops');

-- Alpha joined first, then Beta; removed from Gamma.
insert into workspace_members (workspace_id, user_id, role, status, created_at) values
  ('0c200000-0000-0000-0000-000000000002', '0c000000-0000-0000-0000-000000000001', 'member', 'active', now() - interval '1 day'),
  ('0c200000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001', 'owner', 'active', now() - interval '2 days'),
  ('0c200000-0000-0000-0000-000000000003', '0c000000-0000-0000-0000-000000000001', 'manager', 'removed', now() - interval '3 days');

-- Schema and privileges.
select has_column('public', 'profiles', 'active_workspace_id', 'profiles has active_workspace_id');
select has_function('public', 'list_my_workspaces', array[]::text[], 'list_my_workspaces() exists');
select has_function('public', 'set_active_workspace', array['uuid'], 'set_active_workspace(uuid) exists');
select is(has_function_privilege('anon', 'list_my_workspaces()', 'execute'), false, 'anon cannot execute list_my_workspaces');
select is(has_function_privilege('anon', 'set_active_workspace(uuid)', 'execute'), false, 'anon cannot execute set_active_workspace');
select is(has_function_privilege('authenticated', 'set_active_workspace(uuid)', 'execute'), true, 'authenticated can execute set_active_workspace');

-- As the two-company user.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$ select workspace_id, workspace_name, company_name, role from list_my_workspaces() $$,
  $$ values
       ('0c200000-0000-0000-0000-000000000001'::uuid, 'Alpha HQ'::text, 'Alpha Co'::text, 'owner'::text),
       ('0c200000-0000-0000-0000-000000000002'::uuid, 'Beta Sales'::text, 'Beta Co'::text, 'member'::text) $$,
  'lists only active memberships, oldest first, with company names'
);

select lives_ok(
  $$ select set_active_workspace('0c200000-0000-0000-0000-000000000002') $$,
  'switching to a workspace you are an active member of works'
);
select is(
  (select active_workspace_id from profiles where id = '0c000000-0000-0000-0000-000000000001'),
  '0c200000-0000-0000-0000-000000000002'::uuid,
  'the switch is stored on the profile'
);
select throws_ok(
  $$ select set_active_workspace('0c200000-0000-0000-0000-000000000003') $$,
  'You are not a member of that workspace',
  'switching to a workspace you were removed from is refused'
);
select throws_ok(
  $$ select set_active_workspace('0c200000-0000-0000-0000-0000000000ff') $$,
  'You are not a member of that workspace',
  'switching to a workspace that does not exist is refused'
);
select is(
  (select active_workspace_id from profiles where id = '0c000000-0000-0000-0000-000000000001'),
  '0c200000-0000-0000-0000-000000000002'::uuid,
  'a refused switch leaves the active workspace unchanged'
);

-- As someone with no memberships at all.
select set_config('request.jwt.claims', '{"sub":"0c000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*) from list_my_workspaces()), 0::bigint, 'a stranger lists no workspaces');
select throws_ok(
  $$ select set_active_workspace('0c200000-0000-0000-0000-000000000001') $$,
  'You are not a member of that workspace',
  'a stranger cannot switch into another tenant'
);
select is(
  (select count(*) from profiles where active_workspace_id is not null),
  0::bigint,
  'a stranger cannot see or set anyone''s active workspace'
);

-- Without a session.
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select set_active_workspace('0c200000-0000-0000-0000-000000000001') $$,
  'You are not a member of that workspace',
  'switching without a session is refused'
);

reset role;

-- Deleting the active workspace clears the pointer rather than blocking.
delete from workspaces where id = '0c200000-0000-0000-0000-000000000002';
select is(
  (select active_workspace_id from profiles where id = '0c000000-0000-0000-0000-000000000001'),
  null,
  'deleting the active workspace clears active_workspace_id'
);

select * from finish();
rollback;
