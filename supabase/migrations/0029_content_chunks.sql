-- Semantic search over connected content (Day 3, RAG).
--
-- content_chunks holds the embedded text of messages (email and Slack) and
-- events. A chunk carries the connected_account_id its source came through,
-- so its select policy is the same can_see_connected_account() predicate
-- messages/events use (0012): retrieval can never widen what someone sees.
-- Like messages/events, there are no write policies -- the embedding job
-- writes through the service role only.
--
-- A chunk points at its source through a real foreign key (message_id or
-- event_id, exactly one), so deleting the source or disconnecting the
-- account purges its chunks by cascade. When a source's content changes,
-- the app deletes its chunks; "needs embedding" is then just "has no
-- chunks" (sources_missing_chunks).

create extension if not exists vector with schema extensions;

create table public.content_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  connected_account_id uuid not null references public.connected_accounts (id) on delete cascade,
  message_id uuid references public.messages (id) on delete cascade,
  event_id uuid references public.events (id) on delete cascade,
  chunk_index int not null check (chunk_index >= 0),
  content text not null,
  -- OpenAI text-embedding-3-small
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(message_id, event_id) = 1)
);

create unique index content_chunks_message_id_chunk_index_key
  on public.content_chunks (message_id, chunk_index) where message_id is not null;
create unique index content_chunks_event_id_chunk_index_key
  on public.content_chunks (event_id, chunk_index) where event_id is not null;
create index on public.content_chunks (workspace_id);
create index on public.content_chunks (connected_account_id);
create index on public.content_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.content_chunks enable row level security;

create policy select_content_chunks on public.content_chunks
  for select using (can_see_connected_account(connected_account_id, auth.uid()));

-- Nearest chunks to a query embedding within one workspace. Security
-- invoker, so the caller's RLS decides which chunks exist for them at all.
-- RLS filters after the HNSW index scan, so iterative scanning keeps going
-- until k visible rows are found instead of returning too few.
create function public.match_chunks(
  p_query extensions.vector,
  p_workspace_id uuid,
  p_k int default 20
)
returns table (
  id uuid,
  message_id uuid,
  event_id uuid,
  content text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
set hnsw.iterative_scan = relaxed_order
as $$
  select m.id, m.message_id, m.event_id, m.content, 1 - m.distance as similarity
  from (
    select c.id, c.message_id, c.event_id, c.content, c.embedding <=> p_query as distance
    from public.content_chunks c
    where c.workspace_id = p_workspace_id
    order by c.embedding <=> p_query
    limit least(greatest(p_k, 1), 100)
  ) m
  order by m.distance
$$;

revoke all on function public.match_chunks(extensions.vector, uuid, int) from public, anon;
grant execute on function public.match_chunks(extensions.vector, uuid, int) to authenticated;

-- The newest messages and events that have no chunks yet: the embedding
-- job's work queue, optionally for one connected account (right after its
-- import). Internal to the service role.
create function public.sources_missing_chunks(
  p_limit int,
  p_connected_account_id uuid default null
)
returns table (source_type text, source_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select q.source_type, q.source_id
  from (
    select 'message'::text as source_type, m.id as source_id,
           coalesce(m.sent_at, m.created_at) as sort_at
    from public.messages m
    where not exists (select 1 from public.content_chunks c where c.message_id = m.id)
      and (p_connected_account_id is null or m.connected_account_id = p_connected_account_id)
    union all
    select 'event'::text, e.id, e.updated_at
    from public.events e
    where not exists (select 1 from public.content_chunks c where c.event_id = e.id)
      and (p_connected_account_id is null or e.connected_account_id = p_connected_account_id)
  ) q
  order by q.sort_at desc
  limit greatest(p_limit, 0)
$$;

revoke all on function public.sources_missing_chunks(int, uuid) from public, anon, authenticated;
