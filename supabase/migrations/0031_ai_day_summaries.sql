-- Sky's AI day summary (Day 4, Main AI): today's events plus what needs the
-- user, written once per user per day on the fast tier and cached here so
-- every visit to Sky that day reads it back instead of paying for it again.
--
-- Private to its user, like ai_threads (0030): the summary is written from
-- their own mail and calendar, which a manager or owner may not be able to
-- see. "day" is the user's local date in their scheduling time zone.

create table public.ai_day_summaries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  summary text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id, day)
);

alter table public.ai_day_summaries enable row level security;

-- Append-only: a day's summary is written once (insert ... on conflict do
-- nothing, so two tabs racing both end up reading the same row).
create policy select_own_ai_day_summaries on public.ai_day_summaries
  for select using (
    user_id = auth.uid() and get_workspace_role(workspace_id, auth.uid()) is not null
  );
create policy insert_own_ai_day_summaries on public.ai_day_summaries
  for insert with check (
    user_id = auth.uid() and get_workspace_role(workspace_id, auth.uid()) is not null
  );
