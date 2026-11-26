import { AiNotConfiguredError, configuredProviders } from '@/src/server/agent/providers';
import { describe, expect, it } from 'vitest';

describe('configuredProviders', () => {
  it('puts OpenAI first and Claude second when both keys are set', () => {
    expect(configuredProviders({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' })).toEqual([
      'openai',
      'anthropic',
    ]);
  });

  it('uses only the providers that have a key', () => {
    expect(configuredProviders({ ANTHROPIC_API_KEY: 'a' })).toEqual(['anthropic']);
    expect(configuredProviders({ OPENAI_API_KEY: 'o' })).toEqual(['openai']);
  });

  it('leaves out providers switched off with AI_DISABLED_PROVIDERS', () => {
    expect(
      configuredProviders({
        OPENAI_API_KEY: 'o',
        ANTHROPIC_API_KEY: 'a',
        AI_DISABLED_PROVIDERS: ' OpenAI , ',
      }),
    ).toEqual(['anthropic']);
  });

  it('refuses to run with no provider at all', () => {
    expect(() => configuredProviders({})).toThrow(AiNotConfiguredError);
    expect(() =>
      configuredProviders({ OPENAI_API_KEY: 'o', AI_DISABLED_PROVIDERS: 'openai' }),
    ).toThrow(AiNotConfiguredError);
  });
});
