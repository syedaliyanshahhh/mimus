-- Seat limits (MULTI_USER_PLAN.md A5): a workspace on a plan with a
-- seat_limit can't invite or admit more people than the limit. A seat is an
-- active member or a pending, unexpired invite.
begin;
select plan(20);

insert into auth.users (id, email) values
  ('0d000000-0000-0000-0000-000000000001', 'owner@seats.test'),
  ('0d000000-0000-0000-0000-000000000002', 'second@seats.test'),
  ('0d000000-0000-0000-0000-000000000003', 'third@seats.test'),
  ('0d000000-0000-0000-0000-000000000004', 'outsider@seats.test');

insert into companies (id, name) values ('0d100000-0000-0000-0000-000000000001', 'Seats Co');
insert into workspaces (id, company_id, name) values
  ('0d200000-0000-0000-0000-000000000001', '0d100000-0000-0000-0000-000000000001', 'Limited'),
  ('0d200000-0000-0000-0000-000000000002', '0d100000-0000-0000-0000-000000000001', 'Unlimited');
insert into plans (id, name, seat_limit) values ('0d300000-0000-0000-0000-000000000001', 'Two seats', 2);
insert into workspace_subscriptions (workspace_id, plan_id, status) values
  ('0d200000-0000-0000-0000-000000000001', '0d300000-0000-0000-0000-000000000001', 'active');
insert into workspace_members (workspace_id, user_id, role) values
  ('0d200000-0000-0000-0000-000000000001', '0d000000-0000-0000-0000-000000000001', 'owner'),
  ('0d200000-0000-0000-0000-000000000002', '0d000000-0000-0000-0000-000000000001', 'owner');

-- Privileges.
select is(has_function_privilege('authenticated', 'workspace_seat_usage(uuid)', 'execute'), false, 'authenticated cannot call workspace_seat_usage directly');
select is(has_function_privilege('anon', 'workspace_seat_usage(uuid)', 'execute'), false, 'anon cannot call workspace_seat_usage');
select is(has_function_privilege('authenticated', 'create_invite(uuid, uuid, text, text, text, timestamptz)', 'execute'), false, 'authenticated cannot call create_invite');
select is(has_function_privilege('anon', 'create_invite(uuid, uuid, text, text, text, timestamptz)', 'execute'), false, 'anon cannot call create_invite');
select is(has_function_privilege('authenticated', 'workspace_seats(uuid)', 'execute'), true, 'authenticated can read seat counts through workspace_seats');

-- Counting.
select is(workspace_seat_usage('0d200000-0000-0000-0000-000000000001'), 1, 'one active member uses one seat');
select is(workspace_seat_limit('0d200000-0000-0000-0000-000000000001'), 2, 'the limit comes from the plan');
select is(workspace_seat_limit('0d200000-0000-0000-0000-000000000002'), null, 'no subscription means no limit');

-- Inviting up to the limit.
select isnt(
  create_invite('0d200000-0000-0000-0000-000000000001', '0d000000-0000-0000-0000-000000000001', 'second@seats.test', 'member', 'seat-tok-2', now() + interval '7 days'),
  null,
  'an invite within the limit is created'
);
select is(workspace_seat_usage('0d200000-0000-0000-0000-000000000001'), 2, 'a pending invite holds a seat');
select throws_ok(
  $$ select create_invite('0d200000-0000-0000-0000-000000000001', '0d000000-0000-0000-0000-000000000001', 'third@seats.test', 'member', 'seat-tok-3', now() + interval '7 days') $$,
  'Seat limit reached: 2 of 2 seats are in use',
  'an over-limit invite is rejected'
);
select is((select count(*) from invites where token = 'seat-tok-3'), 0::bigint, 'the rejected invite is not stored');

-- Expired and repeat invites don't take extra seats.
update invites set expires_at = now() - interval '1 minute' where token = 'seat-tok-2';
select is(workspace_seat_usage('0d200000-0000-0000-0000-000000000001'), 1, 'an expired invite frees its seat');
update invites set expires_at = now() + interval '7 days' where token = 'seat-tok-2';
insert into invites (workspace_id, email, role, token, expires_at)
values ('0d200000-0000-0000-0000-000000000001', 'SECOND@seats.test', 'member', 'seat-tok-2b', now() + interval '7 days');
select is(workspace_seat_usage('0d200000-0000-0000-0000-000000000001'), 2, 'two pending invites to one address hold one seat');

-- Unlimited workspaces never refuse.
select isnt(
  create_invite('0d200000-0000-0000-0000-000000000002', '0d000000-0000-0000-0000-000000000001', 'third@seats.test', 'member', 'seat-tok-u', now() + interval '7 days'),
  null,
  'a workspace without a seat limit accepts any invite'
);

-- Accepting within the limit.
select is(accept_invite('seat-tok-2', '0d000000-0000-0000-0000-000000000002'), '0d200000-0000-0000-0000-000000000001'::uuid, 'accepting a held seat works at the limit');

-- Accepting over the limit (e.g. the plan shrank after inviting).
insert into invites (workspace_id, email, role, token, expires_at)
values ('0d200000-0000-0000-0000-000000000001', 'third@seats.test', 'member', 'seat-tok-late', now() + interval '7 days');
select throws_ok(
  $$ select accept_invite('seat-tok-late', '0d000000-0000-0000-0000-000000000003') $$,
  'Seat limit reached: 2 of 2 seats are in use',
  'an over-limit accept is rejected'
);
select is(
  (select count(*) from workspace_members where user_id = '0d000000-0000-0000-0000-000000000003' and workspace_id = '0d200000-0000-0000-0000-000000000001'),
  0::bigint,
  'the rejected accept adds no membership'
);

-- The Members page's counts, as a member and as an outsider.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0d000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq(
  $$ select used, seat_limit from workspace_seats('0d200000-0000-0000-0000-000000000001') $$,
  $$ values (3, 2) $$,
  'a member sees used seats (2 active + 1 pending) and the limit'
);
select set_config('request.jwt.claims', '{"sub":"0d000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(
  (select count(*) from workspace_seats('0d200000-0000-0000-0000-000000000001')),
  0::bigint,
  'an outsider sees no seat counts'
);
reset role;

select * from finish();
rollback;
