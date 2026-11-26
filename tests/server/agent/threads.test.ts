import { createServiceClient } from '@/src/db/service';
import type {
  AiCompletion,
  AiCompletionRequest,
  AiProvider,
} from '@/src/server/agent/providers/types';
import {
  askInThread,
  getThread,
  listThreads,
  ThreadNotFoundError,
  type ThreadAskEvent,
} from '@/src/server/agent/threads';
import type { ToolContext } from '@/src/server/agent/tools';
import { upsertMessage } from '@/src/server/shared/normalize';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAgentFixture, type AgentFixture } from './fixtures';

// The model is the one mocked boundary. Each answer carries a provider-
// private reasoning item, which must be stored and replayed next turn.
function threadProvider(answers: (string | Error)[]) {
  const calls: AiCompletionRequest[] = [];
  let turn = 0;
  const provider: AiProvider = {
    complete: vi.fn(async (request: AiCompletionRequest): Promise<AiCompletion> => {
      const base = {
        modelId: 'gpt-6-luna',
        usage: { inputTokens: 10, outputTokens: 10 },
      };
      if (request.toolChoice?.name === 'classify') {
        return {
          ...base,
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'c',
              name: 'classify',
              input: { module: 'lookup', tier: 'fast', confidence: 0.9 },
            },
          ],
        };
      }
      const { onTextDelta, ...cloneable } = request;
      calls.push(structuredClone(cloneable));
      const next = answers[turn++];
      if (next instanceof Error) throw next;
      onTextDelta?.(next);
      return {
        ...base,
        stopReason: 'end_turn',
        content: [
          { type: 'opaque', provider: 'openai', item: { type: 'reasoning', id: `rs_${turn}` } },
          { type: 'text', text: next },
        ],
      };
    }),
  };
  return { provider, calls };
}

describe('askInThread: multi-turn /ask conversations', () => {
  const service = createServiceClient();
  let fx: AgentFixture;
  let alice: ToolContext;
  let bob: ToolContext;

  beforeAll(async () => {
    fx = await createAgentFixture('Ask threads');
    const aliceEmail = await fx.connect(fx.alice, 'google', 'email');
    await upsertMessage(fx.workspaceId, aliceEmail, {
      providerMessageId: 'thread-a-1',
      subject: 'Lease renewal',
      bodyText: 'Please sign the lease renewal by Friday.',
      direction: 'inbound',
      sentAt: '2026-10-05T15:00:00Z',
    });
    alice = {
      supabase: await fx.signIn(fx.alice),
      userId: fx.alice.id,
      workspaceId: fx.workspaceId,
    };
    bob = {
      supabase: await fx.signIn(fx.bob),
      userId: fx.bob.id,
      workspaceId: fx.workspaceId,
    };
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('starts a thread, then continues it with the earlier turn replayed as history', async () => {
    const { provider, calls } = threadProvider([
      'The landlord wants it signed by Friday.',
      'Yes, this Friday.',
    ]);
    const events: ThreadAskEvent[] = [];

    const first = await askInThread({
      ctx: alice,
      question: 'what about the lease?',
      provider,
      onEvent: (event) => events.push(event),
    });
    expect(first).toMatchObject({
      status: 'ok',
      answer: 'The landlord wants it signed by Friday.',
      threadId: expect.any(String),
    });
    // The opaque reasoning stays on the server, never in the client result.
    expect(first).not.toHaveProperty('blocks');
    // The client learns the new thread's id before the answer starts.
    expect(events[0]).toEqual({ type: 'thread', threadId: first.threadId });
    expect(events).toContainEqual({
      type: 'delta',
      text: 'The landlord wants it signed by Friday.',
    });

    const second = await askInThread({
      ctx: alice,
      threadId: first.threadId,
      question: 'this Friday?',
      provider,
    });
    expect(second.threadId).toBe(first.threadId);

    // Turn two saw turn one: the question, then the answer's blocks exactly
    // as the provider returned them (reasoning item included).
    expect(calls[1].messages).toEqual([
      { role: 'user', content: 'what about the lease?' },
      {
        role: 'assistant',
        content: [
          { type: 'opaque', provider: 'openai', item: { type: 'reasoning', id: 'rs_1' } },
          { type: 'text', text: 'The landlord wants it signed by Friday.' },
        ],
      },
      { role: 'user', content: 'this Friday?' },
    ]);

    const thread = await getThread(alice.supabase, fx.workspaceId, first.threadId);
    expect(thread).toMatchObject({ id: first.threadId, title: 'what about the lease?' });
    expect(thread!.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'what about the lease?'],
      ['assistant', 'The landlord wants it signed by Friday.'],
      ['user', 'this Friday?'],
      ['assistant', 'Yes, this Friday.'],
    ]);
    expect(await listThreads(alice.supabase, fx.workspaceId)).toEqual([
      expect.objectContaining({ id: first.threadId, title: 'what about the lease?' }),
    ]);
  });

  it("refuses to continue someone else's thread and writes nothing into it", async () => {
    const { provider } = threadProvider(['Alice only.', 'Leaked?']);
    const { threadId } = await askInThread({ ctx: alice, question: 'private question', provider });

    await expect(
      askInThread({ ctx: bob, threadId, question: 'what did alice ask?', provider }),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);

    expect(await getThread(bob.supabase, fx.workspaceId, threadId)).toBeNull();
    expect(await listThreads(bob.supabase, fx.workspaceId)).toEqual([]);
    const { count } = await service
      .from('ai_thread_messages')
      .select('*', { count: 'exact', head: true })
      .eq('thread_id', threadId);
    expect(count).toBe(2);
  });

  it('keeps a question whose answer failed, but leaves it out of the next turn', async () => {
    const { provider, calls } = threadProvider([new Error('model down'), 'Back now.']);

    let threadId = '';
    await expect(
      askInThread({
        ctx: alice,
        question: 'first try',
        provider,
        onEvent: (event) => {
          if (event.type === 'thread') threadId = event.threadId;
        },
      }),
    ).rejects.toThrow('model down');

    const failed = await getThread(alice.supabase, fx.workspaceId, threadId);
    expect(failed!.messages.map((m) => m.content)).toEqual(['first try']);

    await askInThread({ ctx: alice, threadId, question: 'second try', provider });
    expect(calls.at(-1)!.messages).toEqual([{ role: 'user', content: 'second try' }]);
  });

  it('titles a thread from a long question, cut short', async () => {
    const { provider } = threadProvider(['Ok.']);
    const question = `summarise ${'everything '.repeat(30)}`.trim();
    const { threadId } = await askInThread({ ctx: alice, question, provider });
    const thread = await getThread(alice.supabase, fx.workspaceId, threadId);
    expect(thread!.title.length).toBeLessThanOrEqual(80);
    expect(thread!.title.endsWith('…')).toBe(true);
  });
});
