import { createServiceClient } from '@/src/db/service';
import { createCompanyWithOwner } from '@/src/server/workspaces/createCompanyWithOwner';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

describe('createCompanyWithOwner', () => {
  const supabase = createServiceClient();
  const userIds: string[] = [];

  afterAll(async () => {
    for (const id of userIds) await supabase.auth.admin.deleteUser(id);
  });

  async function newUser() {
    const id = randomUUID();
    const { error } = await supabase.auth.admin.createUser({
      id,
      email: `onboard-${id}@example.com`,
      email_confirm: true,
    });
    if (error) throw error;
    userIds.push(id);
    return id;
  }

  it('creates exactly one company and workspace, owned by the user', async () => {
    const userId = await newUser();

    const workspaceId = await createCompanyWithOwner({
      userId,
      companyName: 'Northwind',
      workspaceName: 'General',
    });

    const { data: memberships } = await supabase
      .from('workspace_members')
      .select('workspace_id, role, status, workspaces(name, companies(name))')
      .eq('user_id', userId)
      .throwOnError();
    expect(memberships).toEqual([
      {
        workspace_id: workspaceId,
        role: 'owner',
        status: 'active',
        workspaces: { name: 'General', companies: { name: 'Northwind' } },
      },
    ]);
  });

  it('rejects a blank company name with a message the form can show', async () => {
    const userId = await newUser();

    await expect(
      createCompanyWithOwner({ userId, companyName: '  ', workspaceName: 'General' }),
    ).rejects.toThrow('Company name is required');
  });

  it('gives a new user a profile but no workspace until they onboard', async () => {
    const userId = await newUser();

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle()
      .throwOnError();
    expect(profile).toEqual({ id: userId });

    const { count } = await supabase
      .from('workspace_members')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .throwOnError();
    expect(count).toBe(0);
  });
});
