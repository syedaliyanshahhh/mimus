import type { AiUsage, ModelTier, ProviderName } from '@/src/server/agent/providers/types';

const TIER_ORDER: ModelTier[] = ['fast', 'standard', 'deep'];

const TIER_MODELS: Record<ProviderName, Record<ModelTier, string>> = {
  openai: { fast: 'gpt-6-luna', standard: 'gpt-6.1-sol', deep: 'gpt-5.6-sol' },
  anthropic: { fast: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', deep: 'claude-opus-5-5' },
};

// USD per million tokens, from developers.openai.com/api/docs/pricing
// (checked 2026-10-11). A request whose input is over 272k tokens pays the
// `long` rate for the whole request. GPT-5.6 Sol's rate is promotional "at
// least through November 21, 2026" -- re-check it after that date.
interface Rate {
  input: number;
  output: number;
}
const LONG_CONTEXT_TOKENS = 272_000;
const MODEL_PRICING: Record<string, { base: Rate; long?: { overInputTokens: number } & Rate }> = {
  'gpt-6-luna': {
    base: { input: 0.1, output: 0.5 },
    long: { overInputTokens: LONG_CONTEXT_TOKENS, input: 0.2, output: 0.75 },
  },
  'gpt-6.1-sol': {
    base: { input: 2, output: 10 },
    long: { overInputTokens: LONG_CONTEXT_TOKENS, input: 4, output: 15 },
  },
  'gpt-5.6-sol': {
    base: { input: 4, output: 20 },
    long: { overInputTokens: LONG_CONTEXT_TOKENS, input: 8, output: 30 },
  },
  // Claude, from the claude-api skill's model table (cached 2026-11-03).
  // Haiku 5.5's rate is for prompts up to 100k tokens; above that the whole
  // request pays the higher rate, the same shape as OpenAI's long context.
  'claude-haiku-5-5': {
    base: { input: 0.1, output: 0.5 },
    long: { overInputTokens: 100_000, input: 0.5, output: 2.5 },
  },
  'claude-sonnet-5-5': { base: { input: 2, output: 10 } },
  'claude-opus-5-5': { base: { input: 4, output: 20 } },
  // The models Sonnet 5.5 and Opus 5.5 hand a refused request to
  // (providers/anthropic.ts), so a rescued answer is still priced.
  'claude-sonnet-5': { base: { input: 2, output: 10 } },
  'claude-opus-4-8': { base: { input: 5, output: 25 } },
};

export function modelForTier(tier: ModelTier, provider: ProviderName = 'openai'): string {
  return TIER_MODELS[provider][tier];
}

export function tierUp(tier: ModelTier): ModelTier {
  return TIER_ORDER[Math.min(TIER_ORDER.indexOf(tier) + 1, TIER_ORDER.length - 1)];
}

export function tierDown(tier: ModelTier): ModelTier {
  return TIER_ORDER[Math.max(TIER_ORDER.indexOf(tier) - 1, 0)];
}

export function costUsd(modelId: string, usage: AiUsage): number {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) throw new Error(`No pricing configured for model "${modelId}"`);
  const rate =
    pricing.long && usage.inputTokens > pricing.long.overInputTokens ? pricing.long : pricing.base;
  return (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / 1_000_000;
}
