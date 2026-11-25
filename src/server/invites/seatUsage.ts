import type { SupabaseClient } from '@supabase/supabase-js';

export type SeatUsage = { used: number; limit: number | null };

// A thin pass-through to workspace_seats() (migration 0028): seats in use
// (active members plus pending invites) and the plan's limit, null when
// unlimited. Returns null unless the signed-in user is a member.
export async function getSeatUsage(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<SeatUsage | null> {
  const { data, error } = await supabase.rpc('workspace_seats', { p_workspace_id: workspaceId });
  if (error) throw error;
  const row = (data as { used: number; seat_limit: number | null }[] | null)?.[0];
  return row ? { used: row.used, limit: row.seat_limit } : null;
}
