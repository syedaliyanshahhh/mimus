import { createServiceClient } from '@/src/db/service';
import { acceptInvite } from '@/src/server/invites/acceptInvite';
import { createCompanyWithOwner } from '@/src/server/workspaces/createCompanyWithOwner';
import {
  hasActiveMembership,
  inviteTokenFromPath,
  resolvePostSignIn,
} from '@/src/server/workspaces/resolvePostSignIn';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('inviteTokenFromPath', () => {
  it('extracts the token from an invite path', () => {
    expect(inviteTokenFromPath('/invite/abc-123')).toBe('abc-123');
  });

  it('rejects anything that is not exactly /invite/<token>', () => {
    for (const path of [
      '/',
      '/invite/',
      '/invite/x/extra',
      '/invites/x',
      '/invite/x?y=1',
      '/invite/x#y',
      '//evil.example/invite/x',
    ]) {
      expect(inviteTokenFromPath(path)).toBeNull();
    }
  });
});

describe('resolvePostSignIn', () => {
  const supabase = createServiceClient();
  const userIds: string[] = [];
  let inviteWorkspaceId: string;

  beforeAll(async () => {
    const { data: company } = await supabase
      .from('companies')
      .insert({ name: 'Post sign-in test co' })
      .select('id')
      .single()
      .throwOnError();
    const { data: workspace } = await supabase
      .from('workspaces')
      .insert({ company_id: company!.id, name: 'Post sign-in test ws' })
      .select('id')
      .single()
      .throwOnError();
    inviteWorkspaceId = workspace!.id;
  });

  afterAll(async () => {
    for (const id of userIds) await supabase.auth.admin.deleteUser(id);
  });

  async function newUser() {
    const id = randomUUID();
    const email = `post-sign-in-${id}@example.com`;
    const { error } = await supabase.auth.admin.createUser({ id, email, email_confirm: true });
    if (error) throw error;
    userIds.push(id);
    return { userId: id, email };
  }

  async function insertInvite(overrides: Partial<Record<string, unknown>> = {}) {
    const { data } = await supabase
      .from('invites')
      .insert({
        workspace_id: inviteWorkspaceId,
        email: 'post-sign-in-invitee@example.com',
        role: 'member',
        token: randomUUID(),
        status: 'pending',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
      })
      .select('token')
      .single()
      .throwOnError();
    return data!.token as string;
  }

  async function memberships(userId: string) {
    const { data } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', userId)
      .throwOnError();
    return data!;
  }

  it('sends a brand new user to onboarding and creates nothing', async () => {
    const user = await newUser();

    await expect(resolvePostSignIn({ userId: user.userId, next: '/sky' })).resolves.toBe(
      '/onboarding',
    );
    expect(await memberships(user.userId)).toHaveLength(0);
  });

  it('sends an existing member on to where they were going', async () => {
    const user = await newUser();
    await createCompanyWithOwner({
      userId: user.userId,
      companyName: 'Existing co',
      workspaceName: 'General',
    });

    await expect(resolvePostSignIn({ userId: user.userId, next: '/members' })).resolves.toBe(
      '/members',
    );
  });

  it('sends a user whose only membership was removed to onboarding', async () => {
    const user = await newUser();
    await createCompanyWithOwner({
      userId: user.userId,
      companyName: 'Left co',
      workspaceName: 'General',
    });
    await supabase
      .from('workspace_members')
      .update({ status: 'removed' })
      .eq('user_id', user.userId)
      .throwOnError();

    expect(await hasActiveMembership(user.userId)).toBe(false);
    await expect(resolvePostSignIn({ userId: user.userId, next: '/sky' })).resolves.toBe(
      '/onboarding',
    );
  });

  it('sends a user signing in to accept a pending invite on to the invite', async () => {
    const user = await newUser();
    const token = await insertInvite();

    await expect(
      resolvePostSignIn({ userId: user.userId, next: `/invite/${token}` }),
    ).resolves.toBe(`/invite/${token}`);
    expect(await memberships(user.userId)).toHaveLength(0);
  });

  it.each([
    ['expired', { expires_at: new Date(Date.now() - 60_000).toISOString() }],
    ['already accepted', { status: 'accepted' }],
  ])('sends a new user to onboarding when the invite is %s', async (_label, overrides) => {
    const user = await newUser();
    const token = await insertInvite(overrides);

    await expect(
      resolvePostSignIn({ userId: user.userId, next: `/invite/${token}` }),
    ).resolves.toBe('/onboarding');
  });

  it('sends a new user to onboarding when the invite token is unknown', async () => {
    const user = await newUser();

    await expect(
      resolvePostSignIn({ userId: user.userId, next: `/invite/${randomUUID()}` }),
    ).resolves.toBe('/onboarding');
  });

  // Regression: a new user signing in through an invite link used to get an
  // auto-created owner workspace *and* the invited membership.
  it('leaves an invitee with exactly one membership, in the invited workspace', async () => {
    const user = await newUser();
    const token = await insertInvite({ role: 'manager', email: user.email });

    await resolvePostSignIn({ userId: user.userId, next: `/invite/${token}` });
    await acceptInvite({ token, userId: user.userId });

    expect(await memberships(user.userId)).toEqual([
      { workspace_id: inviteWorkspaceId, role: 'manager' },
    ]);
  });
});
