-- /ask conversation threads (Day 4): a thread and its messages are readable
-- and writable only by the user who started it -- not by a manager, not by
-- the workspace owner, and not once that user has left the workspace.
begin;
select plan(18);

select has_table('public', 'ai_threads', 'ai_threads table exists');
select has_table('public', 'ai_thread_messages', 'ai_thread_messages table exists');
select is(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.ai_threads'::regclass, 'public.ai_thread_messages'::regclass)),
  true,
  'RLS is enabled on both thread tables'
);

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'at-owner@example.com'),
  ('c1000000-0000-0000-0000-000000000002', 'at-alice@example.com'),
  ('c1000000-0000-0000-0000-000000000003', 'at-bob@example.com'),
  ('c1000000-0000-0000-0000-000000000004', 'at-leaver@example.com');

insert into companies (id, name) values ('c2000000-0000-0000-0000-000000000001', 'Threads Co');
insert into workspaces (id, company_id, name)
  values ('c3000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'WS');

insert into workspace_members (workspace_id, user_id, role, status) values
  ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'member', 'active'),
  ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', 'member', 'active'),
  ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', 'member', 'active');

-- ---------------------------------------------------------------------------
-- Alice starts a thread and writes a turn, as herself.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ insert into ai_threads (id, workspace_id, user_id, title)
     values ('c4000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001',
             'c1000000-0000-0000-0000-000000000002', 'Lease renewal') $$,
  'a member can start their own thread'
);
select lives_ok(
  $$ insert into ai_thread_messages (thread_id, workspace_id, user_id, role, content)
     values ('c4000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001',
             'c1000000-0000-0000-0000-000000000002', 'user', 'what about the lease?') $$,
  'a member can add a message to their own thread'
);
select throws_ok(
  $$ insert into ai_threads (workspace_id, user_id, title)
     values ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', 'Forged') $$,
  'new row violates row-level security policy for table "ai_threads"',
  'a member cannot start a thread in someone else''s name'
);
select is(
  (select count(*)::int from ai_thread_messages where thread_id = 'c4000000-0000-0000-0000-000000000001'),
  1,
  'the thread''s owner reads its messages'
);

-- ---------------------------------------------------------------------------
-- Bob, a member of the same workspace, sees and changes nothing of Alice's.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-000000000003","role":"authenticated"}';

select is((select count(*)::int from ai_threads), 0, 'another member cannot read the thread');
select is((select count(*)::int from ai_thread_messages), 0, 'another member cannot read its messages');
select throws_ok(
  $$ insert into ai_thread_messages (thread_id, workspace_id, user_id, role, content)
     values ('c4000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001',
             'c1000000-0000-0000-0000-000000000002', 'user', 'injected') $$,
  'new row violates row-level security policy for table "ai_thread_messages"',
  'another member cannot write into the thread in its owner''s name'
);
select throws_ok(
  $$ insert into ai_thread_messages (thread_id, workspace_id, user_id, role, content)
     values ('c4000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001',
             'c1000000-0000-0000-0000-000000000003', 'user', 'injected') $$,
  '23503',
  null,
  'another member cannot attach their own message to the thread'
);
update ai_threads set title = 'Hijacked' where id = 'c4000000-0000-0000-0000-000000000001';
delete from ai_thread_messages where thread_id = 'c4000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- The workspace owner can't read a member's threads either.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select count(*)::int from ai_threads), 0, 'the workspace owner cannot read a member''s thread');
select is((select count(*)::int from ai_thread_messages), 0, 'the workspace owner cannot read its messages');

-- ---------------------------------------------------------------------------
-- Back as Alice: Bob's update and delete changed nothing.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select title from ai_threads where id = 'c4000000-0000-0000-0000-000000000001'),
  'Lease renewal',
  'another member''s update did not touch the thread'
);
select is(
  (select count(*)::int from ai_thread_messages where thread_id = 'c4000000-0000-0000-0000-000000000001'),
  1,
  'another member''s delete did not touch its messages'
);

-- ---------------------------------------------------------------------------
-- A member who has left the workspace loses their threads there.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-000000000004","role":"authenticated"}';
insert into ai_threads (id, workspace_id, user_id, title)
  values ('c4000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000001',
          'c1000000-0000-0000-0000-000000000004', 'Before I left');

reset role;
update workspace_members set status = 'removed'
  where user_id = 'c1000000-0000-0000-0000-000000000004';
set local role authenticated;

select is((select count(*)::int from ai_threads), 0, 'a removed member no longer reads their old threads');
select throws_ok(
  $$ insert into ai_threads (workspace_id, user_id, title)
     values ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', 'After') $$,
  'new row violates row-level security policy for table "ai_threads"',
  'a removed member cannot start a new thread there'
);

-- Deleting a thread removes its messages.
reset role;
delete from ai_threads where id = 'c4000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from ai_thread_messages where thread_id = 'c4000000-0000-0000-0000-000000000001'),
  0,
  'deleting a thread deletes its messages'
);

select * from finish();
rollback;
