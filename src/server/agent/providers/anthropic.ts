import Anthropic from '@anthropic-ai/sdk';
import type {
  AiAssistantBlock,
  AiCompletion,
  AiCompletionRequest,
  AiMessage,
  AiProvider,
  ModelTier,
} from '@/src/server/agent/providers/types';
import { modelForTier } from '@/src/server/agent/router/tiers';

type Params = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// Only the slice of the SDK this provider uses, so tests can inject a fake.
// Every request streams: thinking can make a turn long, and the final
// message is the same whole response a plain call returns.
export interface AnthropicMessagesClient {
  beta: {
    messages: {
      stream(params: Omit<Params, 'stream'>): {
        on(event: 'text', handler: (delta: string) => void): unknown;
        finalMessage(): Promise<Message>;
      };
    };
  };
}

// Thinking is always on for these models and counts against max_tokens, so
// the caller's budget (sized for the visible answer) gets this on top.
const THINKING_HEADROOM_TOKENS = 4096;

// Thinking depth per tier. Claude Opus 5.5 defaults to medium, so it's set
// explicitly everywhere.
const EFFORT: Record<ModelTier, 'low' | 'medium' | 'high'> = {
  fast: 'low',
  standard: 'medium',
  deep: 'high',
};

// When the safety classifiers decline a request, the API re-runs it on
// this model within the same call. Named explicitly (rather than
// fallbacks: "default") so every model that can answer has a price in
// tiers.ts. Haiku has no server-side fallback.
const REFUSAL_FALLBACK: Record<string, string> = {
  'claude-opus-5-5': 'claude-opus-4-8',
  'claude-sonnet-5-5': 'claude-sonnet-5',
};
const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function toApiContent(message: AiMessage): Anthropic.Beta.Messages.BetaMessageParam {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content.flatMap((block): Anthropic.Beta.Messages.BetaContentBlockParam[] => {
        if (block.type === 'text') return [{ type: 'text', text: block.text }];
        if (block.type === 'tool_use')
          return [{ type: 'tool_use', id: block.id, name: block.name, input: block.input }];
        // Thinking blocks are replayed unchanged, in order; another
        // provider's private items (after a fallback) mean nothing here.
        return block.provider === 'anthropic'
          ? [block.item as Anthropic.Beta.Messages.BetaContentBlockParam]
          : [];
      }),
    };
  }
  if (typeof message.content === 'string') return { role: 'user', content: message.content };
  return {
    role: 'user',
    content: message.content.map((block): Anthropic.Beta.Messages.BetaContentBlockParam =>
      block.type === 'text'
        ? { type: 'text', text: block.text }
        : {
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: block.content,
            is_error: block.isError,
          },
    ),
  };
}

function fromApiContent(content: Anthropic.Beta.Messages.BetaContentBlock[]): AiAssistantBlock[] {
  return content.map((block): AiAssistantBlock => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'tool_use')
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    // Thinking, fallback markers and the like: kept to send back next turn.
    return { type: 'opaque', provider: 'anthropic', item: block };
  });
}

function fromApiStopReason(reason: Message['stop_reason']): AiCompletion['stopReason'] {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'end_turn';
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'max_tokens') return 'max_tokens';
  // refusal (the whole fallback chain declined), pause_turn, ...
  return 'other';
}

// Forced tool use is rejected by Claude Sonnet 5.5 and Opus 5.5, so a
// required tool is asked for by name, one call at a time, instead. A caller
// that needs the call (the router's classifier) already copes when it
// doesn't come.
function systemWithToolRequest(request: AiCompletionRequest): string | undefined {
  if (!request.toolChoice) return request.system;
  const ask = `Respond by calling the ${request.toolChoice.name} tool.`;
  return request.system ? `${request.system}\n\n${ask}` : ask;
}

export function createAnthropicProvider({
  client,
}: { client?: AnthropicMessagesClient } = {}): AiProvider {
  const api = client ?? defaultClient();
  return {
    async complete(request: AiCompletionRequest): Promise<AiCompletion> {
      const model = modelForTier(request.tier, 'anthropic');
      const system = systemWithToolRequest(request);
      const fallback = REFUSAL_FALLBACK[model];
      const params: Omit<Params, 'stream'> = {
        model,
        max_tokens: request.maxTokens + THINKING_HEADROOM_TOKENS,
        output_config: { effort: EFFORT[request.tier] },
        ...(system ? { system } : {}),
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
              })),
            }
          : {}),
        ...(request.toolChoice
          ? { tool_choice: { type: 'auto' as const, disable_parallel_tool_use: true } }
          : {}),
        ...(fallback ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: [{ model: fallback }] } : {}),
        messages: request.messages.map(toApiContent),
      };

      const stream = api.beta.messages.stream(params);
      if (request.onTextDelta) stream.on('text', request.onTextDelta);
      const message = await stream.finalMessage();

      return {
        // The model that actually answered: after a refusal fallback, it's
        // the fallback model, which is what the request is priced at.
        modelId: message.model,
        stopReason: fromApiStopReason(message.stop_reason),
        content: fromApiContent(message.content),
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      };
    },
  };
}

function defaultClient(): AnthropicMessagesClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  return new Anthropic({ apiKey });
}
