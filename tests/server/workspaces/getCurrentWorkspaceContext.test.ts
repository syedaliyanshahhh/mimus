import { createServiceClient } from '@/src/db/service';
import { loadWorkspaceContext } from '@/src/server/workspaces/getCurrentWorkspaceContext';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('loadWorkspaceContext', () => {
  const service = createServiceClient();
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  const password = `pw-${randomUUID()}`;
  let workspaceId: string;
  let companyId: string;

  beforeAll(async () => {
    const { error } = await service.auth.admin.createUser({
      id: userId,
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;

    await service
      .from('profiles')
      .upsert({ id: userId, email, full_name: 'Ada Lovelace' })
      .throwOnError();

    const { data: company } = await service
      .from('companies')
      .insert({ name: 'Context test co' })
      .select('id')
      .single()
      .throwOnError();
    companyId = company!.id;
    const { data: workspace } = await service
      .from('workspaces')
      .insert({ company_id: companyId, name: 'Context test ws' })
      .select('id')
      .single()
      .throwOnError();
    workspaceId = workspace!.id;

    await service
      .from('workspace_members')
      .insert({ workspace_id: workspaceId, user_id: userId, role: 'manager' })
      .throwOnError();
  });

  afterAll(async () => {
    await service.from('companies').delete().eq('id', companyId);
    await service.auth.admin.deleteUser(userId);
  });

  function anonClient() {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  it('returns membership, workspace name and profile name for a signed-in user', async () => {
    const supabase = anonClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const context = await loadWorkspaceContext(supabase);

    expect(context).toMatchObject({
      userId,
      email,
      fullName: 'Ada Lovelace',
      workspaceId,
      workspaceName: 'Context test ws',
      role: 'manager',
      memberships: [
        {
          workspaceId,
          workspaceName: 'Context test ws',
          companyId,
          companyName: 'Context test co',
          role: 'manager',
        },
      ],
    });
    expect(context?.supabase).toBe(supabase);
  });

  it('returns null without a session', async () => {
    await expect(loadWorkspaceContext(anonClient())).resolves.toBeNull();
  });

  describe('with memberships in two companies', () => {
    const twoCoUserId = randomUUID();
    const twoCoEmail = `${twoCoUserId}@example.com`;
    const companyIds: string[] = [];
    let olderWorkspaceId: string;
    let newerWorkspaceId: string;

    async function makeWorkspace(name: string, role: string, joinedAt: string) {
      const { data: company } = await service
        .from('companies')
        .insert({ name: `${name} co` })
        .select('id')
        .single()
        .throwOnError();
      companyIds.push(company!.id);
      const { data: workspace } = await service
        .from('workspaces')
        .insert({ company_id: company!.id, name: `${name} ws` })
        .select('id')
        .single()
        .throwOnError();
      await service
        .from('workspace_members')
        .insert({ workspace_id: workspace!.id, user_id: twoCoUserId, role, created_at: joinedAt })
        .throwOnError();
      return workspace!.id as string;
    }

    async function signedIn() {
      const supabase = anonClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: twoCoEmail,
        password,
      });
      if (error) throw error;
      return supabase;
    }

    async function setActive(id: string | null) {
      await service
        .from('profiles')
        .update({ active_workspace_id: id })
        .eq('id', twoCoUserId)
        .throwOnError();
    }

    beforeAll(async () => {
      const { error } = await service.auth.admin.createUser({
        id: twoCoUserId,
        email: twoCoEmail,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      // Created second, joined first: the fallback is by membership age.
      newerWorkspaceId = await makeWorkspace('Newer', 'member', '2026-02-01T00:00:00Z');
      olderWorkspaceId = await makeWorkspace('Older', 'owner', '2026-01-01T00:00:00Z');
    });

    afterAll(async () => {
      await service.from('companies').delete().in('id', companyIds);
      await service.auth.admin.deleteUser(twoCoUserId);
    });

    it('falls back to the oldest membership when none is active', async () => {
      await setActive(null);
      const context = await loadWorkspaceContext(await signedIn());
      expect(context).toMatchObject({ workspaceId: olderWorkspaceId, role: 'owner' });
      expect(context?.memberships.map((m) => m.workspaceId)).toEqual([
        olderWorkspaceId,
        newerWorkspaceId,
      ]);
    });

    it('uses the active workspace when the membership there is active', async () => {
      await setActive(newerWorkspaceId);
      const context = await loadWorkspaceContext(await signedIn());
      expect(context).toMatchObject({
        workspaceId: newerWorkspaceId,
        workspaceName: 'Newer ws',
        role: 'member',
      });
    });

    it('ignores a stale active workspace the user was removed from', async () => {
      await setActive(newerWorkspaceId);
      await service
        .from('workspace_members')
        .update({ status: 'removed' })
        .eq('workspace_id', newerWorkspaceId)
        .eq('user_id', twoCoUserId)
        .throwOnError();
      try {
        const context = await loadWorkspaceContext(await signedIn());
        expect(context).toMatchObject({ workspaceId: olderWorkspaceId, role: 'owner' });
        expect(context?.memberships.map((m) => m.workspaceId)).toEqual([olderWorkspaceId]);
      } finally {
        await service
          .from('workspace_members')
          .update({ status: 'active' })
          .eq('workspace_id', newerWorkspaceId)
          .eq('user_id', twoCoUserId)
          .throwOnError();
      }
    });
  });
});
