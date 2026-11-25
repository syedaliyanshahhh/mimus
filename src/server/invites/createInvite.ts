import { createServiceClient } from '@/src/db/service';
import { assertWorkspaceWritable } from '@/src/server/billing/killSwitch';
import { canInviteWithRole, type WorkspaceRole } from '@/src/server/permissions/roles';
import { sendInviteEmail } from '@/src/server/email/sendInviteEmail';
import { randomUUID } from 'node:crypto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createInvite(params: {
  workspaceId: string;
  workspaceName: string;
  invitedByUserId: string;
  email: string;
  role: WorkspaceRole;
  baseUrl: string;
}) {
  const allowed = await canInviteWithRole(params.invitedByUserId, params.workspaceId, params.role);
  if (!allowed) {
    throw new Error('Not allowed to invite at this role');
  }
  await assertWorkspaceWritable(params.workspaceId);

  // create_invite() (migration 0028) checks the seat limit and inserts the
  // invite under one lock on the workspace.
  const supabase = createServiceClient();
  const token = randomUUID();
  const { data: inviteId, error } = await supabase.rpc('create_invite', {
    p_workspace_id: params.workspaceId,
    p_invited_by_user_id: params.invitedByUserId,
    p_email: params.email,
    p_role: params.role,
    p_token: token,
    p_expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);

  const { data: invite } = await supabase
    .from('invites')
    .select()
    .eq('id', inviteId as string)
    .single()
    .throwOnError();

  await sendInviteEmail({
    to: params.email,
    workspaceName: params.workspaceName,
    inviteUrl: `${params.baseUrl}/invite/${token}`,
  });

  return invite;
}
