import { createFallbackProvider } from '@/src/server/agent/providers/fallback';
import type {
  AiCompletion,
  AiCompletionRequest,
  AiProvider,
} from '@/src/server/agent/providers/types';
import { describe, expect, it, vi } from 'vitest';

const request: AiCompletionRequest = {
  tier: 'fast',
  maxTokens: 64,
  messages: [{ role: 'user', content: 'hi' }],
};

function completion(modelId: string): AiCompletion {
  return {
    modelId,
    stopReason: 'end_turn',
    content: [{ type: 'text', text: `from ${modelId}` }],
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

function ok(modelId: string, deltas: string[] = []) {
  return {
    complete: vi.fn(async (req: AiCompletionRequest) => {
      deltas.forEach((delta) => req.onTextDelta?.(delta));
      return completion(modelId);
    }),
  } satisfies AiProvider;
}

function failing(error: unknown, deltasFirst: string[] = []) {
  return {
    complete: vi.fn(async (req: AiCompletionRequest) => {
      deltasFirst.forEach((delta) => req.onTextDelta?.(delta));
      throw error;
    }),
  } satisfies AiProvider;
}

function apiError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe('fallback provider', () => {
  it('uses the first provider when it works', async () => {
    const second = ok('claude-haiku-5-5');
    const provider = createFallbackProvider([
      { name: 'openai', provider: ok('gpt-6-luna') },
      { name: 'anthropic', provider: second },
    ]);

    expect((await provider.complete(request)).modelId).toBe('gpt-6-luna');
    expect(second.complete).not.toHaveBeenCalled();
  });

  it.each([429, 500, 503, 529, 401, 403])(
    'falls back to the next provider on HTTP %i',
    async (status) => {
      const provider = createFallbackProvider([
        { name: 'openai', provider: failing(apiError(status)) },
        { name: 'anthropic', provider: ok('claude-haiku-5-5') },
      ]);
      expect((await provider.complete(request)).modelId).toBe('claude-haiku-5-5');
    },
  );

  it('falls back on a timeout or a dropped connection', async () => {
    for (const name of ['APIConnectionTimeoutError', 'APIConnectionError']) {
      const error = Object.assign(new Error('network'), { name });
      const provider = createFallbackProvider([
        { name: 'openai', provider: failing(error) },
        { name: 'anthropic', provider: ok('claude-haiku-5-5') },
      ]);
      expect((await provider.complete(request)).modelId).toBe('claude-haiku-5-5');
    }
  });

  it('does not retry a request the provider rejected as malformed', async () => {
    const second = ok('claude-haiku-5-5');
    const provider = createFallbackProvider([
      { name: 'openai', provider: failing(apiError(400)) },
      { name: 'anthropic', provider: second },
    ]);

    await expect(provider.complete(request)).rejects.toThrow('HTTP 400');
    expect(second.complete).not.toHaveBeenCalled();
  });

  it('does not fall back once answer text has streamed, so nobody sees it twice', async () => {
    const second = ok('claude-haiku-5-5');
    const deltas: string[] = [];
    const provider = createFallbackProvider([
      { name: 'openai', provider: failing(apiError(500), ['Half an ']) },
      { name: 'anthropic', provider: second },
    ]);

    await expect(
      provider.complete({ ...request, onTextDelta: (delta) => deltas.push(delta) }),
    ).rejects.toThrow('HTTP 500');
    expect(second.complete).not.toHaveBeenCalled();
    expect(deltas).toEqual(['Half an ']);
  });

  it('streams the fallback provider’s text when the first failed before writing any', async () => {
    const deltas: string[] = [];
    const provider = createFallbackProvider([
      { name: 'openai', provider: failing(apiError(503)) },
      { name: 'anthropic', provider: ok('claude-haiku-5-5', ['Hello']) },
    ]);

    await provider.complete({ ...request, onTextDelta: (delta) => deltas.push(delta) });
    expect(deltas).toEqual(['Hello']);
  });

  it('throws the last error when every provider fails', async () => {
    const provider = createFallbackProvider([
      { name: 'openai', provider: failing(apiError(500)) },
      { name: 'anthropic', provider: failing(apiError(529)) },
    ]);
    await expect(provider.complete(request)).rejects.toThrow('HTTP 529');
  });
});
