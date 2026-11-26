'use client';

import { ArrowRight, Loader2, Search, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { SourceList, streamAsk, type Source } from './ask-client';
import { AnswerMarkdown } from './answer-markdown';
import { searchPlaceholderFor } from './view-toggle';

type State =
  | { phase: 'idle' }
  | { phase: 'asking'; question: string; status: string; partial: string }
  | { phase: 'answered'; question: string; answer: string; sources: Source[] }
  | { phase: 'failed'; question: string; error: string };

// Each question goes into a thread: the first one starts it, and follow-ups
// asked while the answer is open continue it. Closing the answer ends it,
// so the next question starts fresh. "Continue in Ask" opens it on /ask.
export function AskBar() {
  const pathname = usePathname() ?? '';
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [threadId, setThreadId] = useState<string | undefined>();

  // /ask has its own composer.
  if (pathname === '/ask' || pathname.startsWith('/ask/')) return null;

  function close() {
    setState({ phase: 'idle' });
    setThreadId(undefined);
  }

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const asked = question.trim();
    if (!asked || state.phase === 'asking') return;
    setQuestion('');
    setState({ phase: 'asking', question: asked, status: 'Thinking…', partial: '' });
    await streamAsk({ question: asked, ...(threadId ? { threadId } : {}) }, (event) => {
      if (event.type === 'thread') {
        setThreadId(event.threadId);
      } else if (event.type === 'status') {
        // A new step: any text so far was a preamble or a discarded attempt.
        setState({ phase: 'asking', question: asked, status: event.text, partial: '' });
      } else if (event.type === 'delta') {
        setState((current) =>
          current.phase === 'asking'
            ? { ...current, partial: current.partial + event.text }
            : current,
        );
      } else if (event.type === 'done') {
        setState({
          phase: 'answered',
          question: asked,
          answer: event.result.answer,
          sources: event.result.sources,
        });
      } else {
        setState({ phase: 'failed', question: asked, error: event.error });
      }
    });
  }

  return (
    <div className="relative hidden w-72 sm:block">
      <form onSubmit={ask} role="search">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
        <input
          aria-label="Ask Mimus"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={threadId ? 'Ask a follow-up' : searchPlaceholderFor(pathname)}
          maxLength={2000}
          className="w-full rounded-pill border border-line-muted bg-paper py-1.5 pr-3 pl-9 text-sm text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
        />
      </form>

      {state.phase !== 'idle' && (
        <div
          role="region"
          aria-label="Mimus answer"
          className="absolute right-0 z-20 mt-2 w-[28rem] max-w-[90vw] rounded-card border border-line-muted bg-paper-raised p-4 shadow-lg"
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <p className="text-xs font-medium text-ink-muted">{state.question}</p>
            <button
              type="button"
              aria-label="Close answer"
              onClick={close}
              className="text-ink-faint hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>

          {state.phase === 'asking' && (
            <>
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <Loader2 className="size-4 animate-spin" /> {state.status}
              </p>
              {state.partial && (
                <div className="mt-2">
                  <AnswerMarkdown text={state.partial} />
                </div>
              )}
            </>
          )}
          {state.phase === 'failed' && <p className="text-sm text-danger">{state.error}</p>}
          {state.phase === 'answered' && (
            <>
              <AnswerMarkdown text={state.answer} />
              <SourceList sources={state.sources} onNavigate={close} />
            </>
          )}
          {threadId && state.phase !== 'asking' && (
            <div className="mt-3 flex justify-end border-t border-line-muted pt-3">
              <Link
                href={`/ask/${threadId}`}
                onClick={close}
                className="inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:text-accent"
              >
                Continue in Ask <ArrowRight className="size-4" />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
