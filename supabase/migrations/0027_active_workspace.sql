-- Active workspace + switcher (MULTI_USER_PLAN.md A4).
--
-- One login can belong to several companies. RLS still lets a user see every
-- workspace they belong to; the app picks one active workspace per request
-- and filters by it, so two companies' data never blend in one view.
--
-- profiles.active_workspace_id is only a preference: the app re-checks it
-- against an active membership on every read and falls back to the oldest
-- one, so a stale value (removed, or the workspace deleted) is harmless.

alter table public.profiles
  add column active_workspace_id uuid references public.workspaces (id) on delete set null;

-- The caller's own active memberships, oldest first, with company names.
-- companies has no select policy (it carries stripe_customer_id), so this
-- returns names only, and only for the caller's own memberships.
create function list_my_workspaces()
returns table (
  workspace_id uuid,
  workspace_name text,
  company_id uuid,
  company_name text,
  role text
)
security definer
stable
set search_path = public
language sql
as $$
  select w.id, w.name, c.id, c.name, m.role
  from workspace_members m
  join workspaces w on w.id = m.workspace_id
  join companies c on c.id = w.company_id
  where m.user_id = auth.uid()
    and m.status = 'active'
  order by m.created_at, w.id;
$$;

-- Switches the caller's active workspace, refusing any workspace they aren't
-- an active member of. Acts only on auth.uid()'s own profile, so it's safe to
-- grant to every signed-in user (profiles has no update policy).
create function set_active_workspace(p_workspace_id uuid)
returns void
security definer
set search_path = public
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1 from workspace_members
    where user_id = v_user_id
      and workspace_id = p_workspace_id
      and status = 'active'
  ) then
    raise exception 'You are not a member of that workspace';
  end if;

  update profiles set active_workspace_id = p_workspace_id where id = v_user_id;
end;
$$;

revoke all on function list_my_workspaces() from public, anon;
revoke all on function set_active_workspace(uuid) from public, anon;
grant execute on function list_my_workspaces() to authenticated;
grant execute on function set_active_workspace(uuid) to authenticated;
