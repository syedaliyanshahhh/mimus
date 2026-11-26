import { describeError } from '@/src/server/agent/describeError';
import { getDaySummary, type DaySummary } from '@/src/server/agent/daySummary';
import type { WorkspaceContext } from '@/src/server/workspaces/getCurrentWorkspaceContext';
import { Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { AnswerMarkdown } from '../answer-markdown';
import { AskHandoff } from './ask-handoff';

const MESSAGES: Record<Exclude<DaySummary['status'], 'ok'>, string> = {
  quiet: 'Nothing on your calendar and nothing waiting on you today.',
  not_configured: 'Mimus AI is not configured yet.',
  spend_cap_reached: 'This workspace has reached its AI spend limit for the month.',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
        <Sparkles className="size-4 text-accent" /> Your day
      </h2>
      <section aria-label="Day summary" className="text-sm text-ink">
        {children}
      </section>
      <AskHandoff />
    </Card>
  );
}

export function AiSummaryCardSkeleton() {
  return (
    <Shell>
      <div className="flex flex-col gap-2" aria-busy="true">
        <div className="h-3 w-3/4 animate-pulse rounded bg-paper" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-paper" />
      </div>
    </Shell>
  );
}

// Sky's AI panel: the day's summary (written once a day on the fast tier,
// then cached) and a compact chat that hands off to /ask.
export async function AiSummaryCard({ context }: { context: WorkspaceContext }) {
  let result: DaySummary | null = null;
  try {
    result = await getDaySummary({ ctx: context });
  } catch (err) {
    console.error(`[agent] day summary failed: ${describeError(err)}`);
  }

  return (
    <Shell>
      {!result ? (
        <p className="text-ink-muted">Mimus couldn&apos;t write today&apos;s summary right now.</p>
      ) : result.status === 'ok' ? (
        <AnswerMarkdown text={result.summary} />
      ) : (
        <p className="text-ink-muted">{MESSAGES[result.status]}</p>
      )}
    </Shell>
  );
}
