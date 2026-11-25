-- accept_invite(): accepting an invite is one transaction in the database.
-- The invitee's address comes from their own auth.users row, never from the
-- caller, and the function is callable only by the service role.
begin;
select plan(17);

select has_function('public', 'accept_invite', array['text', 'uuid'], 'accept_invite(text, uuid) exists');
select is(has_function_privilege('anon', 'accept_invite(text, uuid)', 'execute'), false, 'anon cannot execute accept_invite');
select is(has_function_privilege('authenticated', 'accept_invite(text, uuid)', 'execute'), false, 'authenticated cannot execute accept_invite');

insert into auth.users (id, email) values
  ('ac000000-0000-0000-0000-000000000001', 'owner@example.com'),
  ('ac000000-0000-0000-0000-000000000002', 'Invitee@Example.com'),
  ('ac000000-0000-0000-0000-000000000003', 'other@example.com');
insert into companies (id, name) values ('ac100000-0000-0000-0000-000000000001', 'Co');
insert into workspaces (id, company_id, name)
  values ('ac200000-0000-0000-0000-000000000001', 'ac100000-0000-0000-0000-000000000001', 'WS');
insert into workspace_members (id, workspace_id, user_id, role) values
  ('ac300000-0000-0000-0000-000000000001', 'ac200000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000001', 'owner');

insert into invites (workspace_id, email, role, token, status, expires_at) values
  ('ac200000-0000-0000-0000-000000000001', 'invitee@example.com', 'manager', 'tok-ok', 'pending', now() + interval '1 day'),
  ('ac200000-0000-0000-0000-000000000001', 'invitee@example.com', 'member', 'tok-expired', 'pending', now() - interval '1 minute'),
  ('ac200000-0000-0000-0000-000000000001', 'invitee@example.com', 'member', 'tok-revoked', 'revoked', now() + interval '1 day'),
  ('ac200000-0000-0000-0000-000000000001', 'invitee@example.com', 'member', 'tok-again', 'pending', now() + interval '1 day'),
  ('ac200000-0000-0000-0000-000000000001', 'invitee@example.com', 'member', 'tok-rejoin', 'pending', now() + interval '1 day');

select throws_ok($$ select accept_invite('no-such-token', 'ac000000-0000-0000-0000-000000000002') $$, 'Invite not found', 'an unknown token is rejected');
select throws_ok($$ select accept_invite('tok-expired', 'ac000000-0000-0000-0000-000000000002') $$, 'Invite has expired', 'an expired invite is rejected');
select throws_ok($$ select accept_invite('tok-revoked', 'ac000000-0000-0000-0000-000000000002') $$, 'Invite is no longer pending', 'a revoked invite is rejected');
select throws_ok(
  $$ select accept_invite('tok-ok', 'ac000000-0000-0000-0000-000000000003') $$,
  'This invite was sent to a different email address. Sign in with that address to accept it.',
  'a user whose own email differs from the invite is rejected'
);
select is((select status from invites where token = 'tok-ok'), 'pending', 'a rejected attempt leaves the invite pending');

-- Accept (email matched case-insensitively against the auth record).
select is(
  accept_invite('tok-ok', 'ac000000-0000-0000-0000-000000000002'),
  'ac200000-0000-0000-0000-000000000001'::uuid,
  'accepting returns the workspace id'
);
select results_eq(
  $$ select role, status from workspace_members where user_id = 'ac000000-0000-0000-0000-000000000002' $$,
  $$ values ('manager'::text, 'active'::text) $$,
  'the invitee becomes an active member with the invited role'
);
select is((select status from invites where token = 'tok-ok'), 'accepted', 'the invite is marked accepted');
select throws_ok($$ select accept_invite('tok-ok', 'ac000000-0000-0000-0000-000000000002') $$, 'Invite is no longer pending', 'the same invite cannot be accepted twice');

-- A second invite to someone already a member keeps their role (changing it
-- is an Owner action) and never duplicates the membership.
select lives_ok($$ select accept_invite('tok-again', 'ac000000-0000-0000-0000-000000000002') $$, 'a second invite for an existing member is accepted');
select results_eq(
  $$ select role, status from workspace_members where user_id = 'ac000000-0000-0000-0000-000000000002' $$,
  $$ values ('manager'::text, 'active'::text) $$,
  'an existing member keeps their role and has a single membership'
);

-- A removed member rejoins with the invited role and no stale reporting line.
update workspace_members set status = 'removed', manager_id = 'ac300000-0000-0000-0000-000000000001'
  where user_id = 'ac000000-0000-0000-0000-000000000002';
select lives_ok($$ select accept_invite('tok-rejoin', 'ac000000-0000-0000-0000-000000000002') $$, 'a removed member can accept a new invite');
select results_eq(
  $$ select role, status, manager_id from workspace_members where user_id = 'ac000000-0000-0000-0000-000000000002' $$,
  $$ values ('member'::text, 'active'::text, null::uuid) $$,
  'a removed member rejoins with the invited role and no manager'
);
select is(
  (select count(*) from workspace_members where user_id = 'ac000000-0000-0000-0000-000000000002'),
  1::bigint,
  'rejoining reuses the existing membership row'
);

select * from finish();
rollback;
