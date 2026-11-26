'use client';

import { ArrowUp, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AnswerMarkdown } from '../answer-markdown';
import { SourceList, streamAsk, type Source } from '../ask-client';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
}

type Pending =
  | { phase: 'idle' }
  | { phase: 'asking'; status: string; partial: string }
  | { phase: 'failed'; error: string };

// One /ask conversation. The server has already saved each turn by the
// time its answer is done; a new thread's id arrives first, and the URL
// switches to it without a navigation so the answer keeps streaming.
// `initialQuestion` (Sky's compact chat, via /ask?q=) is asked once on
// arrival.
export function AskConversation({
  threadId: initialThreadId,
  initialMessages,
  initialQuestion,
}: {
  threadId?: string;
  initialMessages: Message[];
  initialQuestion?: string;
}) {
  const router = useRouter();
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [pending, setPending] = useState<Pending>({ phase: 'idle' });
  const [question, setQuestion] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const askedInitial = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, pending]);

  useEffect(() => {
    if (!initialQuestion || askedInitial.current) return;
    askedInitial.current = true;
    // Drop ?q= so a reload doesn't ask it again.
    window.history.replaceState(null, '', '/ask');
    void ask(initialQuestion);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ask(text: string = question) {
    const asked = text.trim();
    if (!asked || pending.phase === 'asking') return;
    setQuestion('');
    setMessages((current) => [
      ...current,
      { id: `local-${current.length}`, role: 'user', content: asked, sources: [] },
    ]);
    setPending({ phase: 'asking', status: 'Thinking…', partial: '' });

    let answered = false;
    await streamAsk({ question: asked, ...(threadId ? { threadId } : {}) }, (event) => {
      if (event.type === 'thread') {
        if (!threadId) {
          setThreadId(event.threadId);
          window.history.replaceState(null, '', `/ask/${event.threadId}`);
        }
      } else if (event.type === 'status') {
        setPending({ phase: 'asking', status: event.text, partial: '' });
      } else if (event.type === 'delta') {
        setPending((current) =>
          current.phase === 'asking'
            ? { ...current, partial: current.partial + event.text }
            : current,
        );
      } else if (event.type === 'done') {
        answered = true;
        setMessages((current) => [
          ...current,
          {
            id: `local-${current.length}`,
            role: 'assistant',
            content: event.result.answer,
            sources: event.result.sources,
          },
        ]);
        setPending({ phase: 'idle' });
      } else {
        setPending({ phase: 'failed', error: event.error });
      }
    });
    // The thread list (titles, order) lives on the server.
    if (answered) router.refresh();
  }

  return (
    <section className="flex min-h-[60vh] flex-col rounded-card border border-line-muted bg-paper-raised">
      <div
        role="log"
        aria-label="Conversation"
        className="flex flex-1 flex-col gap-4 overflow-y-auto p-6"
      >
        {messages.length === 0 && pending.phase === 'idle' && (
          <div className="m-auto max-w-sm text-center">
            <h1 className="mb-1 text-lg font-semibold text-ink">Ask Mimus</h1>
            <p className="text-sm text-ink-muted">
              Questions about your email, calendar and Slack. Follow-ups keep the context.
            </p>
          </div>
        )}
        {messages.map((message) =>
          message.role === 'user' ? (
            <p
              key={message.id}
              className="max-w-[80%] self-end rounded-card bg-ink px-4 py-2 text-sm whitespace-pre-wrap text-ink-foreground"
            >
              {message.content}
            </p>
          ) : (
            <div key={message.id} className="max-w-[90%] text-sm text-ink">
              <AnswerMarkdown text={message.content} />
              <SourceList sources={message.sources} />
            </div>
          ),
        )}
        {pending.phase === 'asking' && (
          <div className="max-w-[90%] text-sm text-ink">
            <p className="flex items-center gap-2 text-ink-muted">
              <Loader2 className="size-4 animate-spin" /> {pending.status}
            </p>
            {pending.partial && (
              <div className="mt-2">
                <AnswerMarkdown text={pending.partial} />
              </div>
            )}
          </div>
        )}
        {pending.phase === 'failed' && <p className="text-sm text-danger">{pending.error}</p>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
        className="flex items-end gap-2 border-t border-line-muted p-4"
      >
        <textarea
          aria-label="Message Mimus"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void ask();
            }
          }}
          placeholder={messages.length ? 'Ask a follow-up' : 'Ask Mimus anything'}
          maxLength={2000}
          rows={1}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-md border border-line-muted bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!question.trim() || pending.phase === 'asking'}
          className="inline-flex size-10 items-center justify-center rounded-md bg-ink text-ink-foreground hover:bg-ink/90 disabled:opacity-50"
        >
          <ArrowUp className="size-4" />
        </button>
      </form>
    </section>
  );
}
