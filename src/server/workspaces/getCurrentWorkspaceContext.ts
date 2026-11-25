import { createClient } from '@/src/db/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

export type WorkspaceRole = 'owner' | 'manager' | 'member';

export type WorkspaceMembership = {
  workspaceId: string;
  workspaceName: string;
  companyId: string;
  companyName: string;
  role: WorkspaceRole;
};

type MembershipRow = {
  workspace_id: string;
  workspace_name: string;
  company_id: string;
  company_name: string;
  role: WorkspaceRole;
};

export type WorkspaceContext = {
  supabase: SupabaseClient;
  userId: string;
  email: string;
  fullName: string | null;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  // Every workspace the user is an active member of, oldest first, for the
  // workspace switcher.
  memberships: WorkspaceMembership[];
};

// Memoized per request: the (app) layout's nav and read-only banner and the
// page itself all need this, and without cache() each one re-ran the auth
// check and both queries.
export const getCurrentWorkspaceContext = cache(async (): Promise<WorkspaceContext | null> =>
  loadWorkspaceContext(await createClient()),
);

export async function loadWorkspaceContext(
  supabase: SupabaseClient,
): Promise<WorkspaceContext | null> {
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub as string | undefined;
  const email = claims?.claims.email as string | undefined;

  if (!userId || !email) {
    return null;
  }

  // Independent lookups -- run them concurrently rather than back to back.
  const [{ data: rows, error }, { data: profile }] = await Promise.all([
    supabase.rpc('list_my_workspaces'),
    supabase
      .from('profiles')
      .select('full_name, active_workspace_id')
      .eq('id', userId)
      .maybeSingle<{ full_name: string | null; active_workspace_id: string | null }>(),
  ]);
  if (error) throw error;

  const memberships: WorkspaceMembership[] = ((rows ?? []) as MembershipRow[]).map((row) => ({
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    companyId: row.company_id,
    companyName: row.company_name,
    role: row.role,
  }));

  // The stored choice counts only while the membership there is still
  // active; otherwise fall back to the oldest active membership.
  const active =
    memberships.find((m) => m.workspaceId === profile?.active_workspace_id) ?? memberships[0];

  if (!active) {
    return null;
  }

  return {
    supabase,
    userId,
    email,
    fullName: profile?.full_name ?? null,
    workspaceId: active.workspaceId,
    workspaceName: active.workspaceName,
    role: active.role,
    memberships,
  };
}
