import type {
  AiCompletion,
  AiCompletionRequest,
  AiProvider,
  ProviderName,
} from '@/src/server/agent/providers/types';

// Tries each provider in order. A provider outage (rate limit, server
// error, timeout, dropped connection, or a key it won't accept) moves the
// same request to the next one; a request the provider rejected as
// malformed is rethrown, since the next provider would only be handed the
// same mistake. Once any answer text has streamed to the user it's never
// retried, so nobody sees half an answer followed by a different whole one.

export interface NamedProvider {
  name: ProviderName;
  provider: AiProvider;
}

// 401/403: a revoked or misconfigured key is an outage from the user's side.
const RETRIABLE_STATUS = new Set([401, 403, 408, 409, 429]);

export function isProviderOutage(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number') return status >= 500 || RETRIABLE_STATUS.has(status);
  // Both SDKs' network failures: APIConnectionError, APIConnectionTimeoutError.
  return /Connection|Timeout/.test(err.name);
}

export function createFallbackProvider(providers: NamedProvider[]): AiProvider {
  if (providers.length === 0) throw new Error('createFallbackProvider needs a provider');
  return {
    async complete(request: AiCompletionRequest): Promise<AiCompletion> {
      let lastError: unknown;
      for (const [index, { name, provider }] of providers.entries()) {
        let streamed = false;
        const onTextDelta = request.onTextDelta;
        try {
          return await provider.complete({
            ...request,
            ...(onTextDelta
              ? {
                  onTextDelta: (text: string) => {
                    streamed = true;
                    onTextDelta(text);
                  },
                }
              : {}),
          });
        } catch (err) {
          lastError = err;
          const isLast = index === providers.length - 1;
          if (isLast || streamed || !isProviderOutage(err)) throw err;
          console.warn(
            `[agent] ${name} failed (${err instanceof Error ? err.message : String(err)}); trying ${providers[index + 1].name}`,
          );
        }
      }
      throw lastError;
    },
  };
}
