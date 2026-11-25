import { getMostUrgentDealId } from '@/src/mock';
import { showsDemoData } from '@/src/server/workspaces/demoData';
import { getCurrentWorkspaceContext } from '@/src/server/workspaces/getCurrentWorkspaceContext';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { NoDeals } from './no-deals';

export default function GroundPage() {
  return (
    <Suspense fallback={<p className="text-ink-muted">Loading…</p>}>
      <GroundContent />
    </Suspense>
  );
}

// Demo workspaces open the most urgent sample deal; everyone else has none.
async function GroundContent() {
  await connection();
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    redirect('/sign-in?next=/ground');
  }
  if (await showsDemoData(context.workspaceId)) {
    redirect(`/ground/${getMostUrgentDealId()}`);
  }
  return <NoDeals />;
}
