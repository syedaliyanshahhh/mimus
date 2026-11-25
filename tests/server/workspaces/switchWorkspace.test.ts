import { createServiceClient } from '@/src/db/service';
import { switchWorkspace } from '@/src/server/workspaces/switchWorkspace';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('switchWorkspace', () => {
  const service = createServiceClient();
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  const password = `pw-${randomUUID()}`;
  const companyIds: string[] = [];
  let ownWorkspaceId: string;
  let otherTenantWorkspaceId: string;

  async function makeWorkspace(name: string) {
    const { data: company } = await service
      .from('companies')
      .insert({ name })
      .select('id')
      .single()
      .throwOnError();
    companyIds.push(company!.id);
    const { data: workspace } = await service
      .from('workspaces')
      .insert({ company_id: company!.id, name })
      .select('id')
      .single()
      .throwOnError();
    return workspace!.id as string;
  }

  async function activeWorkspaceId() {
    const { data } = await service
      .from('profiles')
      .select('active_workspace_id')
      .eq('id', userId)
      .single()
      .throwOnError();
    return data!.active_workspace_id as string | null;
  }

  async function signedIn() {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return supabase;
  }

  beforeAll(async () => {
    const { error } = await service.auth.admin.createUser({
      id: userId,
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    ownWorkspaceId = await makeWorkspace('Switch own co');
    otherTenantWorkspaceId = await makeWorkspace('Switch other co');
    await service
      .from('workspace_members')
      .insert({ workspace_id: ownWorkspaceId, user_id: userId, role: 'member' })
      .throwOnError();
  });

  afterAll(async () => {
    await service.from('companies').delete().in('id', companyIds);
    await service.auth.admin.deleteUser(userId);
  });

  it('stores a workspace the user is an active member of', async () => {
    await switchWorkspace(await signedIn(), ownWorkspaceId);
    expect(await activeWorkspaceId()).toBe(ownWorkspaceId);
  });

  it("refuses a workspace the user isn't a member of and leaves the choice unchanged", async () => {
    await expect(switchWorkspace(await signedIn(), otherTenantWorkspaceId)).rejects.toThrow(
      'You are not a member of that workspace',
    );
    expect(await activeWorkspaceId()).toBe(ownWorkspaceId);
  });
});
