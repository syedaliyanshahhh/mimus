import { createServiceClient } from '@/src/db/service';

// A thin pass-through to accept_invite() (migration 0025), which checks the
// invite, matches it against the user's own auth email and writes the
// membership in one transaction. `userId` must come from the caller's
// verified session. Errors carry the function's user-facing message.
export async function acceptInvite(params: { token: string; userId: string }): Promise<void> {
  const { error } = await createServiceClient().rpc('accept_invite', {
    p_token: params.token,
    p_user_id: params.userId,
  });
  if (error) {
    throw new Error(error.message);
  }
}
