import {
  type AnthropicMessagesClient,
  createAnthropicProvider,
} from '@/src/server/agent/providers/anthropic';
import type { AiCompletionRequest } from '@/src/server/agent/providers/types';
import { describe, expect, it, vi } from 'vitest';

// The Anthropic API is a paid external boundary, so it's the one thing
// mocked: a fake client exposing only beta.messages.stream, which can play
// back text deltas before resolving the final message.
function fakeClient(message: Record<string, unknown>, deltas: string[] = []) {
  const stream = vi.fn((params: unknown) => {
    void params;
    const handlers: Array<(delta: string) => void> = [];
    return {
      on(event: 'text', handler: (delta: string) => void) {
        if (event === 'text') handlers.push(handler);
        return this;
      },
      async finalMessage() {
        for (const delta of deltas) handlers.forEach((handler) => handler(delta));
        return message;
      },
    };
  });
  return {
    stream,
    client: { beta: { messages: { stream } } } as unknown as AnthropicMessagesClient,
    params: () => stream.mock.calls.at(-1)![0] as Record<string, unknown>,
  };
}

function apiMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Done.' }],
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

const thinking = { type: 'thinking', thinking: '', signature: 'sig' };

const baseRequest: AiCompletionRequest = {
  tier: 'fast',
  maxTokens: 256,
  messages: [{ role: 'user', content: 'hi' }],
};

describe('anthropic provider', () => {
  it('sends the tier model, system, tools and history in Messages API shape', async () => {
    const fake = fakeClient(apiMessage({ model: 'claude-sonnet-5-5' }));
    await createAnthropicProvider({ client: fake.client }).complete({
      tier: 'standard',
      system: 'You are Mimus.',
      maxTokens: 512,
      tools: [
        {
          name: 'searchMessages',
          description: 'Search email',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
      messages: [
        { role: 'user', content: 'who emailed me?' },
        {
          role: 'assistant',
          content: [
            { type: 'opaque', provider: 'anthropic', item: thinking },
            { type: 'opaque', provider: 'openai', item: { type: 'reasoning', id: 'rs_1' } },
            { type: 'text', text: 'Let me look.' },
            { type: 'tool_use', id: 'toolu_1', name: 'searchMessages', input: { query: 'x' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', toolUseId: 'toolu_1', content: 'boom', isError: true },
            { type: 'text', text: 'also check slack' },
          ],
        },
      ],
    });

    const params = fake.params();
    expect(params).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: 'You are Mimus.',
      tools: [
        {
          name: 'searchMessages',
          description: 'Search email',
          input_schema: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
      messages: [
        { role: 'user', content: 'who emailed me?' },
        {
          role: 'assistant',
          content: [
            // Its own thinking replayed unchanged; OpenAI's reasoning dropped.
            thinking,
            { type: 'text', text: 'Let me look.' },
            { type: 'tool_use', id: 'toolu_1', name: 'searchMessages', input: { query: 'x' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'boom', is_error: true },
            { type: 'text', text: 'also check slack' },
          ],
        },
      ],
    });
    expect(JSON.stringify(params)).not.toContain('rs_1');
  });

  it('leaves room for thinking on top of the answer budget, and sets effort by tier', async () => {
    const fake = fakeClient(apiMessage());
    const provider = createAnthropicProvider({ client: fake.client });

    await provider.complete({ ...baseRequest, tier: 'fast', maxTokens: 256 });
    expect(fake.params()).toMatchObject({ output_config: { effort: 'low' } });
    expect(fake.params().max_tokens).toBeGreaterThan(256);

    await provider.complete({ ...baseRequest, tier: 'standard' });
    expect(fake.params()).toMatchObject({ output_config: { effort: 'medium' } });
    await provider.complete({ ...baseRequest, tier: 'deep' });
    expect(fake.params()).toMatchObject({ output_config: { effort: 'high' } });
  });

  it('never forces a tool: asks for it by name instead, one call at a time', async () => {
    const fake = fakeClient(apiMessage());
    await createAnthropicProvider({ client: fake.client }).complete({
      ...baseRequest,
      system: 'Route the question.',
      toolChoice: { name: 'classify' },
      tools: [{ name: 'classify', description: 'Record it', inputSchema: { type: 'object' } }],
    });

    const params = fake.params();
    expect(params.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(params.system).toContain('Route the question.');
    expect(params.system).toContain('classify');
  });

  it('opts Sonnet and Opus into a priced refusal fallback; Haiku has none', async () => {
    const fake = fakeClient(apiMessage());
    const provider = createAnthropicProvider({ client: fake.client });

    await provider.complete({ ...baseRequest, tier: 'deep' });
    expect(fake.params()).toMatchObject({
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: [{ model: 'claude-opus-4-8' }],
    });
    await provider.complete({ ...baseRequest, tier: 'standard' });
    expect(fake.params()).toMatchObject({ fallbacks: [{ model: 'claude-sonnet-5' }] });
    await provider.complete({ ...baseRequest, tier: 'fast' });
    expect(fake.params().fallbacks).toBeUndefined();
    expect(fake.params().betas).toBeUndefined();
  });

  it('maps the response: text, tool calls, and its own private blocks kept for replay', async () => {
    const fake = fakeClient(
      apiMessage({
        model: 'claude-opus-4-8',
        stop_reason: 'tool_use',
        content: [
          thinking,
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'toolu_9', name: 'searchEvents', input: { from: '2026-10-01' } },
        ],
        usage: { input_tokens: 120, output_tokens: 30 },
      }),
    );

    const result = await createAnthropicProvider({ client: fake.client }).complete({
      ...baseRequest,
      tier: 'deep',
    });

    expect(result).toEqual({
      // The model that actually answered, e.g. after a refusal fallback.
      modelId: 'claude-opus-4-8',
      stopReason: 'tool_use',
      content: [
        { type: 'opaque', provider: 'anthropic', item: thinking },
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'toolu_9', name: 'searchEvents', input: { from: '2026-10-01' } },
      ],
      usage: { inputTokens: 120, outputTokens: 30 },
    });
  });

  it.each([
    ['end_turn', 'end_turn'],
    ['stop_sequence', 'end_turn'],
    ['max_tokens', 'max_tokens'],
    ['refusal', 'other'],
    ['pause_turn', 'other'],
  ])('maps stop reason %s to %s', async (apiReason, expected) => {
    const fake = fakeClient(apiMessage({ stop_reason: apiReason }));
    const result = await createAnthropicProvider({ client: fake.client }).complete(baseRequest);
    expect(result.stopReason).toBe(expected);
  });

  it('streams text deltas to the caller and still returns the whole response', async () => {
    const fake = fakeClient(apiMessage({ content: [{ type: 'text', text: 'Sign by Friday.' }] }), [
      'Sign ',
      'by Friday.',
    ]);
    const deltas: string[] = [];

    const result = await createAnthropicProvider({ client: fake.client }).complete({
      ...baseRequest,
      onTextDelta: (text) => deltas.push(text),
    });

    expect(deltas).toEqual(['Sign ', 'by Friday.']);
    expect(result.content).toEqual([{ type: 'text', text: 'Sign by Friday.' }]);
  });

  it('fails clearly without an API key', () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => createAnthropicProvider()).toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
