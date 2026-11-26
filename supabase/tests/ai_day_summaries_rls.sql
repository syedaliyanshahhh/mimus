-- Sky's AI day summary cache (Day 4): one summary per user per day, readable
-- only by that user while they're an active member of the workspace.
begin;
select plan(9);

select has_table('public', 'ai_day_summaries', 'ai_day_summaries table exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.ai_day_summaries'::regclass),
  true,
  'RLS is enabled on ai_day_summaries'
);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'ds-owner@example.com'),
  ('d1000000-0000-0000-0000-000000000002', 'ds-alice@example.com'),
  ('d1000000-0000-0000-0000-000000000003', 'ds-bob@example.com');

insert into companies (id, name) values ('d2000000-0000-0000-0000-000000000001', 'Summary Co');
insert into workspaces (id, company_id, name)
  values ('d3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'WS');

insert into workspace_members (workspace_id, user_id, role) values
  ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'owner'),
  ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'member'),
  ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000003', 'member');

set local role authenticated;
set local request.jwt.claims to '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ insert into ai_day_summaries (workspace_id, user_id, day, summary)
     values ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002',
             '2026-11-28', 'Two meetings; the lease needs signing.') $$,
  'a member can cache their own summary'
);
select throws_ok(
  $$ insert into ai_day_summaries (workspace_id, user_id, day, summary)
     values ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002',
             '2026-11-28', 'A second one') $$,
  '23505',
  null,
  'there is one summary per user per day'
);
select throws_ok(
  $$ insert into ai_day_summaries (workspace_id, user_id, day, summary)
     values ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000003',
             '2026-11-28', 'Forged') $$,
  'new row violates row-level security policy for table "ai_day_summaries"',
  'a member cannot write a summary in someone else''s name'
);
select is((select count(*)::int from ai_day_summaries), 1, 'the member reads their own summary');

set local request.jwt.claims to '{"sub":"d1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from ai_day_summaries), 0, 'another member cannot read it');

set local request.jwt.claims to '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from ai_day_summaries), 0, 'the workspace owner cannot read it');

reset role;
update workspace_members set status = 'removed'
  where user_id = 'd1000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from ai_day_summaries), 0, 'a removed member no longer reads it');

select * from finish();
rollback;
