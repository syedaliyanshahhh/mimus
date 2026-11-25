import { createServiceClient } from '@/src/db/service';
import { getSeatUsage } from '@/src/server/invites/seatUsage';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('getSeatUsage', () => {
  const service = createServiceClient();
  const memberId = randomUUID();
  const outsiderId = randomUUID();
  const password = `pw-${randomUUID()}`;
  let companyId: string;
  let planId: string;
  let workspaceId: string;

  async function signedIn(userId: string) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error } = await supabase.auth.signInWithPassword({
      email: `${userId}@example.com`,
      password,
    });
    if (error) throw error;
    return supabase;
  }

  beforeAll(async () => {
    for (const id of [memberId, outsiderId]) {
      const { error } = await service.auth.admin.createUser({
        id,
        email: `${id}@example.com`,
        password,
        email_confirm: true,
      });
      if (error) throw error;
    }
    const { data: company } = await service
      .from('companies')
      .insert({ name: 'Seat usage co' })
      .select('id')
      .single()
      .throwOnError();
    companyId = company!.id;
    const { data: workspace } = await service
      .from('workspaces')
      .insert({ company_id: companyId, name: 'Seat usage ws' })
      .select('id')
      .single()
      .throwOnError();
    workspaceId = workspace!.id;
    const { data: plan } = await service
      .from('plans')
      .insert({ name: `Five seats ${randomUUID()}`, seat_limit: 5 })
      .select('id')
      .single()
      .throwOnError();
    planId = plan!.id;
    await service
      .from('workspace_subscriptions')
      .insert({ workspace_id: workspaceId, plan_id: planId, status: 'active' })
      .throwOnError();
    await service
      .from('workspace_members')
      .insert({ workspace_id: workspaceId, user_id: memberId, role: 'member' })
      .throwOnError();
    await service
      .from('invites')
      .insert({
        workspace_id: workspaceId,
        email: `pending-${randomUUID()}@example.com`,
        role: 'member',
        token: randomUUID(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .throwOnError();
  });

  afterAll(async () => {
    await service.from('companies').delete().eq('id', companyId);
    await service.from('plans').delete().eq('id', planId);
    await service.auth.admin.deleteUser(memberId);
    await service.auth.admin.deleteUser(outsiderId);
  });

  it('gives a member the used seats (members + pending invites) and the limit', async () => {
    await expect(getSeatUsage(await signedIn(memberId), workspaceId)).resolves.toEqual({
      used: 2,
      limit: 5,
    });
  });

  it('gives an outsider nothing', async () => {
    await expect(getSeatUsage(await signedIn(outsiderId), workspaceId)).resolves.toBeNull();
  });
});
