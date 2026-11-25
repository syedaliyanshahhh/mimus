import type { SupabaseClient } from '@supabase/supabase-js';

// A thin pass-through to set_active_workspace() (migration 0027), which acts
// on the signed-in user's own profile and refuses any workspace they aren't
// an active member of. Pass the user's own session client, never the
// service client: the function identifies the user by auth.uid().
export async function switchWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_active_workspace', { p_workspace_id: workspaceId });
  if (error) {
    throw new Error(error.message);
  }
}
