-- /ask conversation threads (Day 4, Main AI).
--
-- A thread is private to the user who started it: not their manager, not
-- the workspace owner. Every policy also requires an active membership in
-- the thread's workspace, so someone who leaves a company loses its threads
-- with the rest of its data.
--
-- ai_thread_messages carries its thread's workspace_id and user_id, tied to
-- the thread by a composite foreign key, so a message can't claim a
-- different owner or workspace than its thread -- and since a message's
-- user_id must be auth.uid(), the key alone means it can only be attached to
-- one of the caller's own threads.

create table public.ai_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, user_id)
);

create index ai_threads_user_workspace_updated_idx
  on public.ai_threads (user_id, workspace_id, updated_at desc);

create table public.ai_thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  -- What the UI shows: the question, or the answer's markdown.
  content text not null,
  -- Assistant turns only: the provider-neutral blocks of the final answer
  -- (AiAssistantBlock[], opaque reasoning items included), replayed as
  -- history on the next turn.
  blocks jsonb,
  -- Assistant turns only: the Source[] the answer cited.
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (thread_id, workspace_id, user_id)
    references public.ai_threads (id, workspace_id, user_id) on delete cascade
);

create index ai_thread_messages_thread_created_idx
  on public.ai_thread_messages (thread_id, created_at);

alter table public.ai_threads enable row level security;
alter table public.ai_thread_messages enable row level security;

create policy select_own_ai_threads on public.ai_threads
  for select using (
    user_id = auth.uid() and get_workspace_role(workspace_id, auth.uid()) is not null
  );
create policy insert_own_ai_threads on public.ai_threads
  for insert with check (
    user_id = auth.uid() and get_workspace_role(workspace_id, auth.uid()) is not null
  );
create policy update_own_ai_threads on public.ai_threads
  for update
  using (user_id = auth.uid() and get_workspace_role(workspace_id, auth.uid()) is not null)
  with check (user_id = auth.uid());
create policy delete_own_ai_threads on public.ai_threads
  for delete using (
    user_id = auth.uid() and get_workspace_role(workspace_id, auth.uid()) is not null
  );

-- Messages are append-only: no update policy, and they go only when their
-- thread is deleted.
create policy select_own_ai_thread_messages on public.ai_thread_messages
  for select using (
    user_id = auth.uid() and get_workspace_role(workspace_id, auth.uid()) is not null
  );
create policy insert_own_ai_thread_messages on public.ai_thread_messages
  for insert with check (
    user_id = auth.uid() and get_workspace_role(workspace_id, auth.uid()) is not null
  );
