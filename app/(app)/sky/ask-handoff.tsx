'use client';

import { ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Sky's compact chat: the question is answered on /ask, as a new thread.
export function AskHandoff() {
  const router = useRouter();
  const [question, setQuestion] = useState('');

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const asked = question.trim();
        if (asked) router.push(`/ask?q=${encodeURIComponent(asked)}`);
      }}
      className="flex items-center gap-2 border-t border-line-muted pt-4"
    >
      <input
        aria-label="Ask about your day"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Ask about your day"
        maxLength={2000}
        className="flex-1 rounded-md border border-line-muted bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
      />
      <button
        type="submit"
        aria-label="Ask"
        disabled={!question.trim()}
        className="inline-flex size-9 items-center justify-center rounded-md bg-ink text-ink-foreground hover:bg-ink/90 disabled:opacity-50"
      >
        <ArrowUp className="size-4" />
      </button>
    </form>
  );
}
