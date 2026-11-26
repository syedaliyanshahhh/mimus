import { cronAuthError } from '@/src/server/http/cronAuth';
import { embedPending } from '@/src/server/rag/embedPending';
import { type NextRequest } from 'next/server';

// The Vercel Hobby limit (see resume-backfills). Work left when it stops is
// picked up next run.
export const maxDuration = 300;

// Leaves headroom under maxDuration for the page in flight to finish.
const BUDGET_MS = 240_000;

// Embeds new and changed messages/events for semantic search. Scheduled by
// Vercel Cron (vercel.json); POST is for a manual run. Both need
// `Authorization: Bearer $CRON_SECRET`.
async function run(request: NextRequest) {
  const denied = cronAuthError(request);
  if (denied) return denied;

  const result = await embedPending({ maxSources: 5000, deadline: Date.now() + BUDGET_MS });
  return Response.json(result);
}

export const GET = run;
export const POST = run;
