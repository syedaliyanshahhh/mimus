-- Accepting an invite as one database transaction, replacing four separate
-- writes from app code. The invite row is locked first, so two concurrent
-- accepts of the same link can't both succeed. The invitee's address is
-- read from their own auth.users row rather than taken from the caller, so
-- a forwarded or leaked link only works for the address it was sent to.
--
-- Service role only: the app calls it after verifying the session, with the
-- user id from that session.

create function accept_invite(p_token text, p_user_id uuid)
returns uuid
security definer
set search_path = public
language plpgsql
as $$
declare
  v_invite invites%rowtype;
  v_user_email text;
begin
  select * into v_invite from invites where token = p_token for update;

  if not found then
    raise exception 'Invite not found';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'Invite is no longer pending';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'Invite has expired';
  end if;

  select email into v_user_email from auth.users where id = p_user_id;
  if v_user_email is null
     or lower(trim(v_user_email)) <> lower(trim(v_invite.email)) then
    raise exception 'This invite was sent to a different email address. Sign in with that address to accept it.';
  end if;

  -- Seat-limit check goes here (MULTI_USER_PLAN.md A5).

  -- A new invitee joins with the invited role. Someone already active keeps
  -- their role (changing it is an Owner action, not something an invite
  -- link does). A removed member rejoins with the invited role and no
  -- reporting line from before.
  insert into workspace_members (workspace_id, user_id, role)
  values (v_invite.workspace_id, p_user_id, v_invite.role)
  on conflict (workspace_id, user_id) do update
    set status = 'active',
        role = case when workspace_members.status = 'removed'
                    then excluded.role else workspace_members.role end,
        manager_id = case when workspace_members.status = 'removed'
                          then null else workspace_members.manager_id end;

  update invites set status = 'accepted' where id = v_invite.id;

  return v_invite.workspace_id;
end;
$$;

revoke all on function accept_invite(text, uuid) from public, anon, authenticated;
