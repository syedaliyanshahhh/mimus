-- Onboarding replaces auto-provisioning (MULTI_USER_PLAN.md A2).
--
-- Before: every sign-in called create_default_workspace_for_user(), which
-- named a company "<email>'s company" without asking and gave invitees a
-- stray workspace of their own. Now:
--
-- * a trigger on auth.users creates the profile, whatever the sign-up path,
-- * a company and workspace are created only when the user names them on
--   /onboarding, through create_company_with_owner().

-- ---------------------------------------------------------------------------
-- Profile on sign-up.
-- ---------------------------------------------------------------------------
create function handle_new_user()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Users who signed up before this migration but never got a profile.
insert into profiles (id, email, full_name)
select u.id, coalesce(u.email, ''), nullif(trim(u.raw_user_meta_data ->> 'full_name'), '')
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);

-- ---------------------------------------------------------------------------
-- Company creation, from the onboarding form.
-- ---------------------------------------------------------------------------
create function create_company_with_owner(
  p_user_id uuid,
  p_company_name text,
  p_workspace_name text
)
returns uuid
security definer
set search_path = public
language plpgsql
as $$
declare
  v_company_name text := trim(coalesce(p_company_name, ''));
  v_workspace_name text := trim(coalesce(p_workspace_name, ''));
  v_company_id uuid;
  v_workspace_id uuid;
begin
  if v_company_name = '' then
    raise exception 'Company name is required';
  end if;
  if length(v_company_name) > 100 then
    raise exception 'Company name must be 100 characters or fewer';
  end if;
  if v_workspace_name = '' then
    raise exception 'Workspace name is required';
  end if;
  if length(v_workspace_name) > 100 then
    raise exception 'Workspace name must be 100 characters or fewer';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User not found';
  end if;

  insert into companies (name) values (v_company_name)
  returning id into v_company_id;

  insert into workspaces (company_id, name) values (v_company_id, v_workspace_name)
  returning id into v_workspace_id;

  insert into workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, p_user_id, 'owner');

  return v_workspace_id;
end;
$$;

-- Service role only: the onboarding action calls it with the user id from
-- the verified session.
revoke all on function create_company_with_owner(uuid, text, text) from public, anon, authenticated;

drop function create_default_workspace_for_user(uuid, text);
