-- Tenant isolation: signed in as each role in company A, no row that belongs
-- to company B is readable from any table. The workspace-scoped tables are
-- found from the catalog rather than listed by hand, so a table added later
-- is covered automatically -- and the seed-coverage assertion fails until
-- this file gives company B a row in it, so the check can't pass vacuously.
begin;
select plan(12);

-- ---------------------------------------------------------------------------
-- Fixture: company A and company B, each with an owner, a manager (reporting
-- to the owner) and a member (reporting to the manager).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'owner-a@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'manager-a@example.com'),
  ('a1000000-0000-0000-0000-000000000003', 'member-a@example.com'),
  ('b1000000-0000-0000-0000-000000000001', 'owner-b@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'manager-b@example.com'),
  ('b1000000-0000-0000-0000-000000000003', 'member-b@example.com');

insert into profiles (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'owner-a@example.com'),
  ('a1000000-0000-0000-0000-000000000002', 'manager-a@example.com'),
  ('a1000000-0000-0000-0000-000000000003', 'member-a@example.com'),
  ('b1000000-0000-0000-0000-000000000001', 'owner-b@example.com'),
  ('b1000000-0000-0000-0000-000000000002', 'manager-b@example.com'),
  ('b1000000-0000-0000-0000-000000000003', 'member-b@example.com')
on conflict (id) do nothing;

insert into companies (id, name) values
  ('a2000000-0000-0000-0000-000000000001', 'Company A'),
  ('b2000000-0000-0000-0000-000000000001', 'Company B');

insert into workspaces (id, company_id, name) values
  ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'A'),
  ('b3000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'B');

insert into workspace_members (id, workspace_id, user_id, role, manager_id) values
  ('a4000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'owner', null),
  ('b4000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'owner', null);
insert into workspace_members (id, workspace_id, user_id, role, manager_id) values
  ('a4000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'manager', 'a4000000-0000-0000-0000-000000000001'),
  ('b4000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'manager', 'b4000000-0000-0000-0000-000000000001');
insert into workspace_members (id, workspace_id, user_id, role, manager_id) values
  ('a4000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'member', 'a4000000-0000-0000-0000-000000000002'),
  ('b4000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 'member', 'b4000000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- Company B's content: at least one row in every table. Its connected
-- accounts cover all three visibility levels, and the company-visible one is
-- shared with B's member, so B's own visibility rules all have something to
-- grant -- none of which may leak across to A.
-- ---------------------------------------------------------------------------
insert into connected_accounts (id, workspace_id, owner_user_id, provider, account_type, visibility, external_account_id) values
  ('b5000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 'google', 'email', 'private', 'member-b@example.com'),
  ('b5000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'google', 'calendar', 'team', 'manager-b@example.com'),
  ('b5000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'microsoft', 'email', 'company', 'owner-b@example.com');

insert into connected_account_shares (connected_account_id, shared_with_user_id) values
  ('b5000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003');

insert into connected_account_secrets (connected_account_id, encrypted_access_token, encrypted_refresh_token) values
  ('b5000000-0000-0000-0000-000000000003', '\x00', '\x00');

insert into people (id, workspace_id, connected_account_id, email, display_name) values
  ('b6000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000003', 'customer@example.org', 'Customer');

insert into messages (id, workspace_id, connected_account_id, provider_message_id, subject, direction, from_person_id) values
  ('b7000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000003', 'b-msg-1', 'B secret', 'inbound', 'b6000000-0000-0000-0000-000000000001');

insert into message_participants (message_id, person_id, role) values
  ('b7000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'to');

insert into events (id, workspace_id, connected_account_id, provider_event_id, title, starts_at, ends_at) values
  ('b8000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000003', 'b-evt-1', 'B board meeting', now(), now() + interval '1 hour');

insert into event_attendees (event_id, person_id) values
  ('b8000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001');

insert into content_chunks (workspace_id, connected_account_id, message_id, chunk_index, content, embedding) values
  ('b3000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000003', 'b7000000-0000-0000-0000-000000000001',
   0, 'B secret', array_fill(0.1::real, array[1536])::extensions.vector);

insert into event_signals (workspace_id, type, source_connected_account_id) values
  ('b3000000-0000-0000-0000-000000000001', 'message.received', 'b5000000-0000-0000-0000-000000000003');

select log_agent_request(
  'b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
  'question', 'normal', 'fast', 'test-model', 1, 1, 0.01, '[]'::jsonb, 'ok'
);

insert into agent_spend_counters (workspace_id, day, cost_usd) values
  ('b3000000-0000-0000-0000-000000000001', current_date, 1);

insert into feature_switches (workspace_id, key, enabled) values
  ('b3000000-0000-0000-0000-000000000001', 'money', true);

insert into workspace_subscriptions (workspace_id, status) values
  ('b3000000-0000-0000-0000-000000000001', 'active');

insert into invites (workspace_id, email, role, token, expires_at) values
  ('b3000000-0000-0000-0000-000000000001', 'new-hire-b@example.com', 'member', 'b-invite-token', now() + interval '7 days');

insert into scheduling_rules (workspace_id, user_id) values
  ('b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001');

insert into approval_settings (workspace_id, user_id) values
  ('b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001');

insert into scheduling_proposals (workspace_id, user_id, source_message_id, email_account_id, kind, draft_body) values
  ('b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'b7000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000003', 'offer_times', 'How about Tuesday?');

insert into slack_installations (team_id, encrypted_bot_token, key_version, installed_by_workspace_id) values
  ('T-B', '\x00', 1, 'b3000000-0000-0000-0000-000000000001');

insert into terms_acceptances (user_id, terms_version, age_confirmed) values
  ('b1000000-0000-0000-0000-000000000001', 'test', true);

insert into ai_threads (id, workspace_id, user_id, title) values
  ('b9000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001', 'B board prep');

insert into ai_thread_messages (thread_id, workspace_id, user_id, role, content) values
  ('b9000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001', 'user', 'B secret question');

insert into ai_day_summaries (workspace_id, user_id, day, summary) values
  ('b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   current_date, 'B secret day');

-- ---------------------------------------------------------------------------
-- Helpers. Both run as the caller (security invoker), so under
-- `set local role authenticated` they see exactly what that user's RLS
-- allows. A table the role has no privilege on at all counts as 0 rows.
-- ---------------------------------------------------------------------------

-- Every public table that scopes its rows to a workspace.
create function pg_temp.workspace_scoped_tables()
returns table (table_name text, column_name text)
language sql stable as $$
  select c.relname::text, a.attname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and not a.attisdropped
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and a.attname in ('workspace_id', 'installed_by_workspace_id')
  order by 1
$$;

create function pg_temp.visible_count(p_sql text, p_arg uuid)
returns bigint
language plpgsql as $$
declare
  v_count bigint;
begin
  execute p_sql into v_count using p_arg;
  return v_count;
exception
  when insufficient_privilege then
    return 0;
end;
$$;

-- Workspace-scoped tables in which the caller can read any of workspace
-- p_ws's rows.
create function pg_temp.workspace_tables_leaking(p_ws uuid)
returns text[]
language plpgsql as $$
declare
  t record;
  v_leaks text[] := '{}';
begin
  for t in select * from pg_temp.workspace_scoped_tables() loop
    if pg_temp.visible_count(
      format('select count(*) from public.%I where %I = $1', t.table_name, t.column_name),
      p_ws
    ) > 0 then
      v_leaks := v_leaks || t.table_name;
    end if;
  end loop;
  return v_leaks;
end;
$$;

-- Tables without a workspace_id column, each checked against company B's
-- rows by the key that ties them to B.
create function pg_temp.other_tables_leaking()
returns text[]
language plpgsql as $$
declare
  v_leaks text[] := '{}';
  v_check record;
begin
  for v_check in
    select * from (values
      ('companies', 'select count(*) from public.companies where id = $1', 'b2000000-0000-0000-0000-000000000001'::uuid),
      ('workspaces', 'select count(*) from public.workspaces where id = $1', 'b3000000-0000-0000-0000-000000000001'),
      ('profiles', 'select count(*) from public.profiles where id::text like ''b1000000-%'' and $1 is not null', 'b3000000-0000-0000-0000-000000000001'),
      ('terms_acceptances', 'select count(*) from public.terms_acceptances where user_id = $1', 'b1000000-0000-0000-0000-000000000001'),
      ('connected_account_shares', 'select count(*) from public.connected_account_shares where connected_account_id = $1', 'b5000000-0000-0000-0000-000000000003'),
      ('connected_account_secrets', 'select count(*) from public.connected_account_secrets where connected_account_id = $1', 'b5000000-0000-0000-0000-000000000003'),
      ('message_participants', 'select count(*) from public.message_participants where message_id = $1', 'b7000000-0000-0000-0000-000000000001'),
      ('event_attendees', 'select count(*) from public.event_attendees where event_id = $1', 'b8000000-0000-0000-0000-000000000001')
    ) as checks (table_name, sql, arg)
  loop
    if pg_temp.visible_count(v_check.sql, v_check.arg) > 0 then
      v_leaks := v_leaks || v_check.table_name;
    end if;
  end loop;
  return v_leaks;
end;
$$;

-- ---------------------------------------------------------------------------
-- Meta checks, as postgres.
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  null,
  'every public table has row level security enabled'
);

select cmp_ok(
  (select count(*) from pg_temp.workspace_scoped_tables()), '>=', 15::bigint,
  'the catalog query finds the workspace-scoped tables'
);

select is(
  (select array_agg(t.table_name)
   from pg_temp.workspace_scoped_tables() t
   where pg_temp.visible_count(
     format('select count(*) from public.%I where %I = $1', t.table_name, t.column_name),
     'b3000000-0000-0000-0000-000000000001'
   ) = 0),
  null,
  'company B has a row in every workspace-scoped table (add one here for any new table)'
);

-- ---------------------------------------------------------------------------
-- As each role in company A.
-- ---------------------------------------------------------------------------
set local role authenticated;

set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*) from workspaces where id = 'a3000000-0000-0000-0000-000000000001'), 1::bigint, 'A owner: sees their own workspace (RLS is evaluating as them)');
select is(pg_temp.workspace_tables_leaking('b3000000-0000-0000-0000-000000000001'), '{}'::text[], 'A owner: no workspace-scoped table shows company B rows');
select is(pg_temp.other_tables_leaking(), '{}'::text[], 'A owner: no other table shows company B rows');

set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from workspaces where id = 'a3000000-0000-0000-0000-000000000001'), 1::bigint, 'A manager: sees their own workspace (RLS is evaluating as them)');
select is(pg_temp.workspace_tables_leaking('b3000000-0000-0000-0000-000000000001'), '{}'::text[], 'A manager: no workspace-scoped table shows company B rows');
select is(pg_temp.other_tables_leaking(), '{}'::text[], 'A manager: no other table shows company B rows');

set local request.jwt.claims to '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from workspaces where id = 'a3000000-0000-0000-0000-000000000001'), 1::bigint, 'A member: sees their own workspace (RLS is evaluating as them)');
select is(pg_temp.workspace_tables_leaking('b3000000-0000-0000-0000-000000000001'), '{}'::text[], 'A member: no workspace-scoped table shows company B rows');
select is(pg_temp.other_tables_leaking(), '{}'::text[], 'A member: no other table shows company B rows');

select * from finish();
rollback;
