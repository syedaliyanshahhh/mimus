'use client';

import Link from 'next/link';

// The browser side of POST /api/agent/ask, shared by the top-nav Ask bar
// and the /ask page.

export interface Source {
  kind: 'message' | 'event';
  id: string;
  title: string;
  timestamp: string | null;
  provider: string;
}

export interface AskAnswer {
  answer: string;
  sources: Source[];
  threadId?: string;
}

export type StreamEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'status'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; result: AskAnswer }
  | { type: 'error'; error: string };

// Reads the route's NDJSON body, one event per line. Returns whether the
// stream reached a final `done` or `error` event.
async function readEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === 'done' || event.type === 'error') finished = true;
      onEvent(event);
    }
    if (done) return finished;
  }
}

// Asks Mimus, reporting progress through onEvent. Every way it can fail
// (an error status, a broken stream, the network) ends in one `error` event.
export async function streamAsk(
  request: { question: string; threadId?: string },
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  try {
    const response = await fetch('/api/agent/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      onEvent({ type: 'error', error: body.error ?? 'Something went wrong' });
      return;
    }
    if (!(await readEvents(response.body, onEvent))) {
      onEvent({ type: 'error', error: 'Mimus could not answer right now' });
    }
  } catch {
    onEvent({ type: 'error', error: 'Network error' });
  }
}

function formatTimestamp(timestamp: string | null): string {
  return timestamp
    ? new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '';
}

export function SourceList({
  sources,
  onNavigate,
}: {
  sources: Source[];
  onNavigate?: () => void;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-4 border-t border-line-muted pt-3">
      <p className="mb-2 text-xs font-medium tracking-wide text-ink-muted uppercase">Sources</p>
      <ul className="flex flex-col gap-1">
        {sources.map((source) => (
          <li key={`${source.kind}:${source.id}`}>
            <Link
              href={`/sources/${source.kind}/${source.id}`}
              onClick={onNavigate}
              className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1 text-sm hover:bg-paper"
            >
              <span className="truncate text-ink">{source.title}</span>
              <span className="shrink-0 text-xs text-ink-faint capitalize">
                {source.provider} · {formatTimestamp(source.timestamp)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
