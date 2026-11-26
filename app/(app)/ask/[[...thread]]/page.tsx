import { getThread, listThreads, type Thread } from '@/src/server/agent/threads';
import { getCurrentWorkspaceContext } from '@/src/server/workspaces/getCurrentWorkspaceContext';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { AskConversation } from '../ask-conversation';

// /ask starts a new conversation; /ask/<id> continues one. Threads are read
// under the viewer's own session (0030: only their own), so someone else's
// thread id is simply not found.

type Params = Promise<{ thread?: string[] }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AskPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<p className="text-ink-muted">Loading…</p>}>
      <AskContent paramsPromise={params} />
    </Suspense>
  );
}

async function AskContent({ paramsPromise }: { paramsPromise: Params }) {
  await connection();
  const { thread: segments = [] } = await paramsPromise;
  const threadId = segments[0];
  if (segments.length > 1 || (threadId !== undefined && !UUID.test(threadId))) notFound();

  const context = await getCurrentWorkspaceContext();
  if (!context) redirect(`/sign-in?next=/ask${threadId ? `/${threadId}` : ''}`);
  const { supabase, workspaceId } = context;

  let thread: Thread | null = null;
  if (threadId) {
    thread = await getThread(supabase, workspaceId, threadId);
    if (!thread) notFound();
  }
  const threads = await listThreads(supabase, workspaceId);

  return (
    <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
      <aside className="flex flex-col gap-3">
        <Link
          href="/ask"
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-ink px-4 py-2 text-sm font-medium text-ink-foreground hover:bg-ink/90"
        >
          <Plus className="size-4" /> New conversation
        </Link>
        <nav aria-label="Conversations" className="flex flex-col gap-0.5">
          {threads.length === 0 && (
            <p className="px-3 py-2 text-sm text-ink-faint">No conversations yet.</p>
          )}
          {threads.map((item) => (
            <Link
              key={item.id}
              href={`/ask/${item.id}`}
              aria-current={item.id === threadId ? 'page' : undefined}
              className={`truncate rounded-md px-3 py-2 text-sm ${
                item.id === threadId
                  ? 'bg-paper-raised font-medium text-ink'
                  : 'text-ink-muted hover:bg-paper-raised hover:text-ink'
              }`}
            >
              {item.title}
            </Link>
          ))}
        </nav>
      </aside>
      <AskConversation
        key={thread?.id ?? 'new'}
        threadId={thread?.id}
        initialMessages={thread?.messages ?? []}
      />
    </div>
  );
}
