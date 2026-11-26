import { createServiceClient } from '@/src/db/service';
import { getDaySummary } from '@/src/server/agent/daySummary';
import { AiNotConfiguredError } from '@/src/server/agent/providers';
import type {
  AiCompletion,
  AiCompletionRequest,
  AiProvider,
} from '@/src/server/agent/providers/types';
import { upsertEvent, upsertMessage } from '@/src/server/shared/normalize';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentFixture, type AgentFixture } from './fixtures';

// The model is the one mocked boundary.
function summaryProvider(
  text = 'You have **Board sync** at 10, and the landlord wants the lease.',
) {
  const calls: AiCompletionRequest[] = [];
  const complete = vi.fn(async (request: AiCompletionRequest): Promise<AiCompletion> => {
    calls.push(structuredClone(request));
    return {
      modelId: 'gpt-6-luna',
      stopReason: 'end_turn',
      usage: { inputTokens: 1000, outputTokens: 100 },
      content: [{ type: 'text', text }],
    };
  });
  return { provider: { complete } satisfies AiProvider, calls, complete };
}

const MINUTE = 60_000;

describe("getDaySummary: Sky's AI summary of the day", () => {
  const service = createServiceClient();
  let fx: AgentFixture;
  let alice: { supabase: SupabaseClient; userId: string; workspaceId: string };
  let bob: { supabase: SupabaseClient; userId: string; workspaceId: string };
  let aliceMessageId: string;
  let aliceEventId: string;
  const now = new Date();

  beforeAll(async () => {
    fx = await createAgentFixture('Day summary');
    const aliceCalendar = await fx.connect(fx.alice, 'google', 'calendar');
    const aliceEmail = await fx.connect(fx.alice, 'google', 'email');
    const bobEmail = await fx.connect(fx.bob, 'google', 'email');
    // Overlaps "now", so it's today in any time zone.
    aliceEventId = await upsertEvent(fx.workspaceId, aliceCalendar, {
      providerEventId: 'sum-ev-1',
      title: 'Board sync',
      startsAt: new Date(now.getTime() - 10 * MINUTE).toISOString(),
      endsAt: new Date(now.getTime() + 20 * MINUTE).toISOString(),
    });
    aliceMessageId = await upsertMessage(fx.workspaceId, aliceEmail, {
      providerMessageId: 'sum-a-1',
      subject: 'Lease renewal',
      bodyText: 'Please sign the lease renewal by Friday.',
      direction: 'inbound',
      sentAt: new Date(now.getTime() - 60 * MINUTE).toISOString(),
      from: { email: 'landlord@example.com', displayName: 'Landlord' },
    });
    await upsertMessage(fx.workspaceId, bobEmail, {
      providerMessageId: 'sum-b-1',
      subject: 'Acquisition terms',
      bodyText: 'Confidential acquisition price: $40M.',
      direction: 'inbound',
      sentAt: new Date(now.getTime() - 60 * MINUTE).toISOString(),
    });
    alice = {
      supabase: await fx.signIn(fx.alice),
      userId: fx.alice.id,
      workspaceId: fx.workspaceId,
    };
    bob = { supabase: await fx.signIn(fx.bob), userId: fx.bob.id, workspaceId: fx.workspaceId };
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  beforeEach(async () => {
    await service.from('ai_day_summaries').delete().eq('workspace_id', fx.workspaceId);
    await service.from('agent_spend_counters').delete().eq('workspace_id', fx.workspaceId);
    await service.from('workspace_subscriptions').delete().eq('workspace_id', fx.workspaceId);
  });

  it("writes the summary on the fast tier from today's events and recent mail, logs it, and caches it for the day", async () => {
    const { provider, calls, complete } = summaryProvider();

    const first = await getDaySummary({ ctx: alice, provider: () => provider, now });
    expect(first).toMatchObject({
      status: 'ok',
      summary: 'You have **Board sync** at 10, and the landlord wants the lease.',
      cached: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].tier).toBe('fast');
    const prompt = JSON.stringify(calls[0].messages);
    expect(prompt).toContain('Board sync');
    expect(prompt).toContain('Lease renewal');
    // Bob's private mail never reaches Alice's prompt.
    expect(prompt).not.toContain('Acquisition');

    const { data: log } = await service
      .from('agent_logs')
      .select('*')
      .eq('user_id', fx.alice.id)
      .eq('nature', 'day_summary')
      .single()
      .throwOnError();
    expect(log).toMatchObject({
      model_tier: 'fast',
      model_id: 'gpt-6-luna',
      status: 'ok',
      source_ids: { messages: [aliceMessageId], events: [aliceEventId] },
    });

    // The rest of the day reads it back with no model call.
    const second = await getDaySummary({ ctx: alice, provider: () => provider, now });
    expect(second).toMatchObject({
      status: 'ok',
      summary: first.status === 'ok' && first.summary,
      cached: true,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('is private: another member gets their own summary, never the cached one', async () => {
    await getDaySummary({
      ctx: alice,
      provider: () => summaryProvider('Alice only.').provider,
      now,
    });
    const { provider, calls } = summaryProvider('Bob has one new email.');

    const result = await getDaySummary({ ctx: bob, provider: () => provider, now });

    expect(result).toMatchObject({
      status: 'ok',
      summary: 'Bob has one new email.',
      cached: false,
    });
    expect(JSON.stringify(calls[0].messages)).not.toContain('Lease renewal');
  });

  it('skips the model on a day with nothing scheduled and nothing waiting', async () => {
    const quiet = { ...bob, userId: fx.owner.id, supabase: await fx.signIn(fx.owner) };
    const { complete } = summaryProvider();

    expect(await getDaySummary({ ctx: quiet, provider: () => ({ complete }), now })).toMatchObject({
      status: 'quiet',
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('says so, without a model call, once the spend cap is reached', async () => {
    const { data: plan } = await service
      .from('plans')
      .insert({ name: 'Summary cap plan', ai_spend_cap_usd: 1 })
      .select('id')
      .single()
      .throwOnError();
    await service
      .from('workspace_subscriptions')
      .upsert({ workspace_id: fx.workspaceId, plan_id: plan!.id, status: 'active' })
      .throwOnError();
    await service.rpc('record_agent_spend', {
      p_workspace_id: fx.workspaceId,
      p_day: now.toISOString().slice(0, 10),
      p_cost_usd: 1,
    });
    const { complete } = summaryProvider();

    expect(await getDaySummary({ ctx: alice, provider: () => ({ complete }), now })).toMatchObject({
      status: 'spend_cap_reached',
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('says so when no AI provider is configured', async () => {
    const result = await getDaySummary({
      ctx: alice,
      provider: () => {
        throw new AiNotConfiguredError();
      },
      now,
    });
    expect(result).toMatchObject({ status: 'not_configured' });
  });
});
