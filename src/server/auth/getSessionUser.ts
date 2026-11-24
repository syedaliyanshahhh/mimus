import { createClient } from '@/src/db/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

export type SessionUser = { supabase: SupabaseClient; userId: string; email: string };

// The signed-in user from their verified session, whether or not they
// belong to a workspace yet (getCurrentWorkspaceContext() needs one).
// Memoized per request.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub as string | undefined;
  const email = data?.claims.email as string | undefined;
  return userId && email ? { supabase, userId, email } : null;
});
