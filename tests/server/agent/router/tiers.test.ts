import { costUsd, modelForTier, tierDown, tierUp } from '@/src/server/agent/router/tiers';
import { describe, expect, it } from 'vitest';

describe('model tiers', () => {
  it('maps each tier to a current OpenAI model', () => {
    expect(modelForTier('fast')).toBe('gpt-6-luna');
    expect(modelForTier('standard')).toBe('gpt-6.1-sol');
    expect(modelForTier('deep')).toBe('gpt-5.6-sol');
  });

  it('maps each tier to a current Claude model for the Anthropic provider', () => {
    expect(modelForTier('fast', 'anthropic')).toBe('claude-haiku-5-5');
    expect(modelForTier('standard', 'anthropic')).toBe('claude-sonnet-5-5');
    expect(modelForTier('deep', 'anthropic')).toBe('claude-opus-5-5');
  });

  it('prices the Claude models, including their refusal-fallback models', () => {
    // Sonnet 5.5: $2 / $10. Opus 5.5: $4 / $20. Opus 4.8: $5 / $25. Sonnet 5: $2 / $10.
    expect(
      costUsd('claude-sonnet-5-5', { inputTokens: 200_000, outputTokens: 60_000 }),
    ).toBeCloseTo(1);
    expect(costUsd('claude-opus-5-5', { inputTokens: 250_000, outputTokens: 100_000 })).toBeCloseTo(
      3,
    );
    expect(costUsd('claude-opus-4-8', { inputTokens: 200_000, outputTokens: 0 })).toBeCloseTo(1);
    expect(costUsd('claude-sonnet-5', { inputTokens: 500_000, outputTokens: 0 })).toBeCloseTo(1);
  });

  it('applies Haiku 5.5 long-prompt pricing above 100k input tokens', () => {
    // $0.10 / $0.50 up to 100k input tokens; $0.50 / $2.50 for the whole request beyond.
    expect(
      costUsd('claude-haiku-5-5', { inputTokens: 100_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(0.01 + 0.5);
    expect(
      costUsd('claude-haiku-5-5', { inputTokens: 200_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(0.1 + 2.5);
  });

  it('steps one tier up or down, clamped at the ends', () => {
    expect(tierUp('fast')).toBe('standard');
    expect(tierUp('standard')).toBe('deep');
    expect(tierUp('deep')).toBe('deep');
    expect(tierDown('deep')).toBe('standard');
    expect(tierDown('standard')).toBe('fast');
    expect(tierDown('fast')).toBe('fast');
  });

  it('prices usage per million tokens from the published rates', () => {
    // GPT-6.1 Sol: $2 in / $10 out per MTok (input under the 272k threshold).
    expect(costUsd('gpt-6.1-sol', { inputTokens: 200_000, outputTokens: 60_000 })).toBeCloseTo(1);
    // GPT-5.6 Sol: $4 / $20.
    expect(costUsd('gpt-5.6-sol', { inputTokens: 250_000, outputTokens: 100_000 })).toBeCloseTo(3);
  });

  it('applies long-context pricing above 272k input tokens', () => {
    // GPT-6 Luna: $0.10 / $0.50, or $0.20 / $0.75 for the whole request
    // once input is over 272k tokens.
    expect(costUsd('gpt-6-luna', { inputTokens: 272_000, outputTokens: 1_000_000 })).toBeCloseTo(
      0.0272 + 0.5,
    );
    expect(costUsd('gpt-6-luna', { inputTokens: 300_000, outputTokens: 1_000_000 })).toBeCloseTo(
      0.06 + 0.75,
    );
  });

  it('refuses to price an unknown model rather than logging $0', () => {
    expect(() => costUsd('gpt-unknown', { inputTokens: 1, outputTokens: 1 })).toThrow(
      /no pricing/i,
    );
  });
});
