import { createServiceClient } from '@/src/db/service';

const INVITE_PATH = /^\/invite\/([^/?#]+)$/;

export function inviteTokenFromPath(next: string): string | null {
  return INVITE_PATH.exec(next)?.[1] ?? null;
}

async function isAcceptableInvite(token: string): Promise<boolean> {
  const { data } = await createServiceClient()
    .from('invites')
    .select('status, expires_at')
    .eq('token', token)
    .maybeSingle();
  return data?.status === 'pending' && new Date(data.expires_at) > new Date();
}

export async function hasActiveMembership(userId: string): Promise<boolean> {
  const { count, error } = await createServiceClient()
    .from('workspace_members')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) throw error;
  return (count ?? 0) > 0;
}

// Where a user goes right after signing in. Nothing is created here: an
// invitee goes on to accept their invite, a member goes where they were
// headed, and anyone else names their company on /onboarding. The profile
// itself comes from the auth.users trigger (migration 0026).
export async function resolvePostSignIn({
  userId,
  next,
}: {
  userId: string;
  next: string;
}): Promise<string> {
  const token = inviteTokenFromPath(next);
  if (token && (await isAcceptableInvite(token))) {
    return next;
  }
  return (await hasActiveMembership(userId)) ? next : '/onboarding';
}
