import { createAnthropicProvider } from '@/src/server/agent/providers/anthropic';
import { createFallbackProvider } from '@/src/server/agent/providers/fallback';
import { createOpenAiProvider } from '@/src/server/agent/providers/openai';
import type { AiProvider, ProviderName } from '@/src/server/agent/providers/types';

// Which providers answer, in order: OpenAI first, Claude as the fallback.
// A provider joins only when its key is set, and AI_DISABLED_PROVIDERS
// (comma-separated, e.g. "openai") takes one out -- for an outage, or to
// prove the fallback works.

const ORDER: ProviderName[] = ['openai', 'anthropic'];

const KEY_ENV: Record<ProviderName, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

const FACTORIES: Record<ProviderName, () => AiProvider> = {
  openai: () => createOpenAiProvider(),
  anthropic: () => createAnthropicProvider(),
};

export class AiNotConfiguredError extends Error {
  constructor() {
    super('No AI provider is configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY)');
  }
}

type Env = Record<string, string | undefined>;

export function configuredProviders(env: Env = process.env): ProviderName[] {
  const disabled = new Set(
    (env.AI_DISABLED_PROVIDERS ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
  const names = ORDER.filter((name) => !disabled.has(name) && env[KEY_ENV[name]]);
  if (names.length === 0) throw new AiNotConfiguredError();
  return names;
}

export function createAiProvider(env: Env = process.env): AiProvider {
  const names = configuredProviders(env);
  if (names.length === 1) return FACTORIES[names[0]]();
  return createFallbackProvider(names.map((name) => ({ name, provider: FACTORIES[name]() })));
}
