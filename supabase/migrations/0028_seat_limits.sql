-- Seat limits (MULTI_USER_PLAN.md A5).
--
-- A workspace's limit is its plan's seat_limit (null, or no subscription,
-- means unlimited). A seat is an active member or a pending, unexpired
-- invite to someone who isn't already an active member. Inviting checks the
-- full count; accepting checks active members only, so one pending invite
-- can't block another from being accepted, but a plan that shrank after the
-- invites went out still can't be exceeded.

create function workspace_seat_limit(p_workspace_id uuid)
returns int
security definer
stable
set search_path = public
language sql
as $$
  select p.seat_limit
  from workspace_subscriptions s
  join plans p on p.id = s.plan_id
  where s.workspace_id = p_workspace_id;
$$;

create function workspace_active_member_count(p_workspace_id uuid)
returns int
security definer
stable
set search_path = public
language sql
as $$
  select count(*)::int
  from workspace_members
  where workspace_id = p_workspace_id and status = 'active';
$$;

create function workspace_seat_usage(p_workspace_id uuid)
returns int
security definer
stable
set search_path = public
language sql
as $$
  select workspace_active_member_count(p_workspace_id) + (
    select count(distinct lower(trim(i.email)))::int
    from invites i
    where i.workspace_id = p_workspace_id
      and i.status = 'pending'
      and i.expires_at > now()
      and not exists (
        select 1
        from workspace_members m
        join profiles p on p.id = m.user_id
        where m.workspace_id = p_workspace_id
          and m.status = 'active'
          and lower(trim(p.email)) = lower(trim(i.email))
      )
  );
$$;

revoke all on function workspace_seat_limit(uuid) from public, anon, authenticated;
revoke all on function workspace_active_member_count(uuid) from public, anon, authenticated;
revoke all on function workspace_seat_usage(uuid) from public, anon, authenticated;

-- Seat counts for the Members page: only for a workspace the caller is an
-- active member of, otherwise no row.
create function workspace_seats(p_workspace_id uuid)
returns table (used int, seat_limit int)
security definer
stable
set search_path = public
language sql
as $$
  select workspace_seat_usage(p_workspace_id), workspace_seat_limit(p_workspace_id)
  where get_workspace_role(p_workspace_id, auth.uid()) is not null;
$$;

revoke all on function workspace_seats(uuid) from public, anon;
grant execute on function workspace_seats(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Creating an invite. Service role only: the app checks the inviter may
-- invite at this role (can_invite_with_role) and passes their verified id.
-- The workspace row is locked so two concurrent invites can't both take the
-- last seat.
-- ---------------------------------------------------------------------------
create function create_invite(
  p_workspace_id uuid,
  p_invited_by_user_id uuid,
  p_email text,
  p_role text,
  p_token text,
  p_expires_at timestamptz
)
returns uuid
security definer
set search_path = public
language plpgsql
as $$
declare
  v_limit int;
  v_used int;
  v_invite_id uuid;
begin
  perform 1 from workspaces where id = p_workspace_id for update;
  if not found then
    raise exception 'Workspace not found';
  end if;

  v_limit := workspace_seat_limit(p_workspace_id);
  if v_limit is not null then
    v_used := workspace_seat_usage(p_workspace_id);
    if v_used >= v_limit then
      raise exception 'Seat limit reached: % of % seats are in use', v_used, v_limit;
    end if;
  end if;

  insert into invites (workspace_id, email, role, invited_by, token, status, expires_at)
  values (
    p_workspace_id,
    trim(p_email),
    p_role,
    (select id from workspace_members
     where workspace_id = p_workspace_id and user_id = p_invited_by_user_id),
    p_token,
    'pending',
    p_expires_at
  )
  returning id into v_invite_id;

  return v_invite_id;
end;
$$;

revoke all on function create_invite(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- accept_invite, as in 0025, plus the seat check at its hook point.
-- ---------------------------------------------------------------------------
create or replace function accept_invite(p_token text, p_user_id uuid)
returns uuid
security definer
set search_path = public
language plpgsql
as $$
declare
  v_invite invites%rowtype;
  v_user_email text;
  v_limit int;
  v_active int;
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

  -- Seat limit: someone already active takes no new seat. Lock the
  -- workspace so concurrent accepts of different invites serialize.
  perform 1 from workspaces where id = v_invite.workspace_id for update;
  v_limit := workspace_seat_limit(v_invite.workspace_id);
  if v_limit is not null and not exists (
    select 1 from workspace_members
    where workspace_id = v_invite.workspace_id and user_id = p_user_id and status = 'active'
  ) then
    v_active := workspace_active_member_count(v_invite.workspace_id);
    if v_active >= v_limit then
      raise exception 'Seat limit reached: % of % seats are in use', v_active, v_limit;
    end if;
  end if;

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
