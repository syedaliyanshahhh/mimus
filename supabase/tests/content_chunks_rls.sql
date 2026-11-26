-- content_chunks: the embedded text that semantic search runs over. A chunk
-- is visible exactly when its connected account is (can_see_connected_account),
-- the same rule messages/events use -- so retrieval can never widen access.
-- match_chunks() runs as the caller, so RLS applies to it too.
begin;
select plan(25);

select has_table('public', 'content_chunks', 'content_chunks table exists');
select has_function('public', 'match_chunks', array['extensions.vector', 'uuid', 'integer'], 'match_chunks exists');
select has_function('public', 'sources_missing_chunks', array['integer', 'uuid'], 'sources_missing_chunks exists');

-- Owner (O) -> Manager A (MA) -> {Member B (MB), Member D (MD)}; Owner -> Member C (MC)
insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-00000000000f', 'owner-cc@example.com'),
  ('c1000000-0000-0000-0000-00000000000a', 'manager-a-cc@example.com'),
  ('c1000000-0000-0000-0000-00000000000b', 'member-b-cc@example.com'),
  ('c1000000-0000-0000-0000-00000000000c', 'member-c-cc@example.com'),
  ('c1000000-0000-0000-0000-00000000000d', 'member-d-cc@example.com'),
  ('c1000000-0000-0000-0000-0000000000ee', 'other-tenant-cc@example.com');

insert into companies (id, name) values
  ('d1000000-0000-0000-0000-000000000001', 'Co CC'),
  ('d1000000-0000-0000-0000-000000000002', 'Other CC');
insert into workspaces (id, company_id, name) values
  ('e1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'WS CC'),
  ('e1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', 'WS Other');

insert into workspace_members (id, workspace_id, user_id, role, manager_id) values
  ('f1000000-0000-0000-0000-00000000000f', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000f', 'owner', null),
  ('f1000000-0000-0000-0000-0000000000ee', 'e1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-0000000000ee', 'owner', null);
insert into workspace_members (id, workspace_id, user_id, role, manager_id) values
  ('f1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000a', 'manager', 'f1000000-0000-0000-0000-00000000000f');
insert into workspace_members (id, workspace_id, user_id, role, manager_id) values
  ('f1000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000b', 'member', 'f1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-00000000000d', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000d', 'member', 'f1000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000c', 'member', 'f1000000-0000-0000-0000-00000000000f');

-- Member B's private mailbox, and the other tenant's company-visible one.
insert into connected_accounts (id, workspace_id, owner_user_id, provider, account_type, visibility) values
  ('21000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000b', 'google', 'email', 'private'),
  ('21000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-0000000000ee', 'google', 'email', 'company');

insert into messages (id, workspace_id, connected_account_id, provider_message_id, subject, direction, sent_at) values
  ('41000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'cc-msg-1', 'Lease extension', 'inbound', now()),
  ('41000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'cc-msg-2', 'Not embedded yet', 'inbound', now()),
  ('41000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', 'cc-msg-3', 'Other tenant', 'inbound', now());

insert into events (id, workspace_id, connected_account_id, provider_event_id, title, starts_at, ends_at) values
  ('51000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'cc-evt-1', 'Lease walkthrough', now(), now() + interval '1 hour'),
  ('51000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'cc-evt-2', 'Not embedded yet', now(), now() + interval '1 hour');

create function pg_temp.vec(p real) returns extensions.vector
language sql immutable as $$ select array_fill(p, array[1536])::extensions.vector $$;

insert into content_chunks (workspace_id, connected_account_id, message_id, event_id, chunk_index, content, embedding) values
  ('e1000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', null, 0, 'Lease extension part 1', pg_temp.vec(0.1)),
  ('e1000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', null, 1, 'Lease extension part 2', pg_temp.vec(0.2)),
  ('e1000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', null, '51000000-0000-0000-0000-000000000001', 0, 'Lease walkthrough', pg_temp.vec(0.3)),
  ('e1000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-000000000003', null, 0, 'Other tenant', pg_temp.vec(0.1));

-- Constraints: a chunk belongs to exactly one message or event.
select throws_ok(
  $$ insert into content_chunks (workspace_id, connected_account_id, message_id, event_id, chunk_index, content, embedding)
     values ('e1000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
             '41000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000002', 0, 'both', pg_temp.vec(0.1)) $$,
  '23514', null, 'a chunk cannot point at both a message and an event'
);
select throws_ok(
  $$ insert into content_chunks (workspace_id, connected_account_id, message_id, event_id, chunk_index, content, embedding)
     values ('e1000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
             null, null, 0, 'neither', pg_temp.vec(0.1)) $$,
  '23514', null, 'a chunk must point at a message or an event'
);
select throws_ok(
  $$ insert into content_chunks (workspace_id, connected_account_id, message_id, chunk_index, content, embedding)
     values ('e1000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
             '41000000-0000-0000-0000-000000000001', 0, 'dup', pg_temp.vec(0.1)) $$,
  '23505', null, 'chunk_index is unique per message'
);

-- sources_missing_chunks: the newest messages/events with no chunks yet.
select set_eq(
  $$ select source_type, source_id from sources_missing_chunks(100)
     where source_id in ('41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000002',
                         '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000002') $$,
  $$ values ('message'::text, '41000000-0000-0000-0000-000000000002'::uuid),
            ('event'::text, '51000000-0000-0000-0000-000000000002'::uuid) $$,
  'sources_missing_chunks lists only sources with no chunks'
);
select is(
  (select count(*) from sources_missing_chunks(100, '21000000-0000-0000-0000-000000000002'))::int, 0,
  'sources_missing_chunks can be limited to one connected account'
);
select ok(
  not has_function_privilege('authenticated', 'public.sources_missing_chunks(integer, uuid)', 'execute'),
  'authenticated cannot call sources_missing_chunks'
);
select ok(
  not has_function_privilege('anon', 'public.sources_missing_chunks(integer, uuid)', 'execute'),
  'anon cannot call sources_missing_chunks'
);
select ok(
  has_function_privilege('authenticated', 'public.match_chunks(extensions.vector, uuid, integer)', 'execute'),
  'authenticated can call match_chunks'
);

-- Private: the connector sees their chunks, nobody else in the workspace does.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is((select count(*) from content_chunks)::int, 3, 'private: connector sees their own chunks');
select is(
  (select count(*) from match_chunks(pg_temp.vec(0.1), 'e1000000-0000-0000-0000-000000000001', 10))::int, 3,
  'private: match_chunks returns the connector''s chunks'
);
select is(
  (select message_id from match_chunks(pg_temp.vec(0.1), 'e1000000-0000-0000-0000-000000000001', 1)),
  '41000000-0000-0000-0000-000000000001'::uuid,
  'match_chunks returns the nearest chunk first'
);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-00000000000c","role":"authenticated"}';
select is((select count(*) from content_chunks)::int, 0, 'private: another member sees no chunks');
select is(
  (select count(*) from match_chunks(pg_temp.vec(0.1), 'e1000000-0000-0000-0000-000000000001', 10))::int, 0,
  'private: match_chunks returns nothing to another member'
);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-00000000000f","role":"authenticated"}';
select is(
  (select count(*) from match_chunks(pg_temp.vec(0.1), 'e1000000-0000-0000-0000-000000000001', 10)) > 0,
  (select count(*) from messages where connected_account_id = '21000000-0000-0000-0000-000000000001') > 0,
  'private: the owner sees chunks exactly when they see the source messages'
);
reset role;

-- Team: the manager and a peer under the same manager see them; an unrelated member doesn't.
update connected_accounts set visibility = 'team' where id = '21000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select is(
  (select count(*) from match_chunks(pg_temp.vec(0.1), 'e1000000-0000-0000-0000-000000000001', 10))::int, 3,
  'team: manager sees the chunks'
);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select is(
  (select count(*) from match_chunks(pg_temp.vec(0.1), 'e1000000-0000-0000-0000-000000000001', 10))::int, 3,
  'team: peer under the same manager sees the chunks'
);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-00000000000c","role":"authenticated"}';
select is(
  (select count(*) from match_chunks(pg_temp.vec(0.1), 'e1000000-0000-0000-0000-000000000001', 10))::int, 0,
  'team: unrelated member sees no chunks'
);
reset role;

-- Another tenant: never sees this workspace's chunks, even when asking for it by id.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-0000000000ee","role":"authenticated"}';
select is(
  (select count(*) from match_chunks(pg_temp.vec(0.1), 'e1000000-0000-0000-0000-000000000001', 10))::int, 0,
  'other tenant: match_chunks on this workspace returns nothing'
);
select is(
  (select count(*) from match_chunks(pg_temp.vec(0.1), 'e1000000-0000-0000-0000-000000000002', 10))::int, 1,
  'other tenant: match_chunks only returns its own workspace''s chunks'
);
reset role;

-- Writes are service-role only.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select throws_ok(
  $$ insert into content_chunks (workspace_id, connected_account_id, message_id, chunk_index, content, embedding)
     values ('e1000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
             '41000000-0000-0000-0000-000000000002', 0, 'x', array_fill(0.1::real, array[1536])::extensions.vector) $$,
  '42501', null, 'authenticated cannot insert chunks'
);
reset role;

-- Cascades: deleting a message, or disconnecting the account, purges its chunks.
delete from messages where id = '41000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from content_chunks where message_id = '41000000-0000-0000-0000-000000000001')::int, 0,
  'deleting a message deletes its chunks'
);
delete from connected_accounts where id = '21000000-0000-0000-0000-000000000001';
select is(
  (select count(*) from content_chunks where connected_account_id = '21000000-0000-0000-0000-000000000001')::int, 0,
  'disconnecting an account deletes its chunks'
);

select * from finish();
rollback;
