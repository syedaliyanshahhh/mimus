import { describeError } from '@/src/server/agent/describeError';
import { askEventStream } from '@/src/server/agent/askStream';
import { AGENT_MODULES } from '@/src/server/agent/modules';
import { AiNotConfiguredError, createAiProvider } from '@/src/server/agent/providers';
import type { AiProvider } from '@/src/server/agent/providers/types';
import { askInThread } from '@/src/server/agent/threads';
import { getCurrentWorkspaceContext } from '@/src/server/workspaces/getCurrentWorkspaceContext';

// API-first so future native clients call the same endpoint the web UI
// does. Thin by design: the logic and its tests live in
// src/server/agent/ask.ts, threads.ts and askStream.ts. Every question
// lands in a thread: `threadId` continues one, and without it a new one is
// started (its id is the stream's first event). Errors before the answer starts
// are JSON with a status code; after that the body is NDJSON events.

export const maxDuration = 60;

const MAX_QUESTION_LENGTH = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  // A JSON content type can't be sent cross-site without a CORS preflight,
  // which this route never grants -- so this doubles as CSRF protection
  // for the cookie-authenticated session.
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ error: 'Expected application/json' }, { status: 415 });
  }

  const context = await getCurrentWorkspaceContext();
  if (!context) return Response.json({ error: 'Not signed in' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    module?: unknown;
    threadId?: unknown;
  } | null;
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return Response.json(
      { error: `Ask a question of 1-${MAX_QUESTION_LENGTH} characters` },
      { status: 400 },
    );
  }
  const threadId = body?.threadId ?? undefined;
  if (threadId !== undefined && (typeof threadId !== 'string' || !UUID.test(threadId))) {
    return Response.json({ error: 'Invalid threadId' }, { status: 400 });
  }
  const requestedModule =
    typeof body?.module === 'string' && AGENT_MODULES.some((m) => m.name === body.module)
      ? body.module
      : undefined;

  // Built before the stream opens, so having no provider is a clean 503.
  let provider: AiProvider;
  try {
    provider = createAiProvider();
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return Response.json({ error: 'Mimus AI is not configured yet' }, { status: 503 });
    }
    throw err;
  }

  const stream = askEventStream(
    (onEvent) =>
      askInThread({
        ctx: {
          supabase: context.supabase,
          userId: context.userId,
          workspaceId: context.workspaceId,
        },
        threadId,
        question,
        module: requestedModule,
        provider,
        onEvent,
      }),
    (err) => console.error(`[agent] ask failed: ${describeError(err)}`),
  );
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  });
}
