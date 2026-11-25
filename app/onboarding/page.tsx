import { getAccountDeletionBlockers } from '@/src/server/account/deleteAccount';
import { getSessionUser } from '@/src/server/auth/getSessionUser';
import { hasActiveMembership } from '@/src/server/workspaces/resolvePostSignIn';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { DeleteAccountForm } from '@/app/(app)/settings/account/delete-account-form';
import { MimusLogo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { OnboardingForm } from './onboarding-form';

// Where a signed-in user with no workspace lands: a new sign-up, or someone
// removed from their only workspace. They name their company here, or --
// as the Privacy Policy promises -- can still delete their account. Existing
// members reach it from the avatar menu to create another company.
export default function OnboardingPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 bg-paper px-4 py-12">
      <ThemeToggle className="absolute top-4 right-4" />
      <Link href="/" aria-label="Mimus home" className="text-ink">
        <MimusLogo className="h-[34px] w-auto" />
      </Link>
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <Onboarding />
      </Suspense>
    </main>
  );
}

async function Onboarding() {
  await connection();
  const user = await getSessionUser();
  if (!user) {
    redirect('/sign-in?next=/onboarding');
  }
  if (await hasActiveMembership(user.userId)) {
    return <NewCompany email={user.email} />;
  }
  const blockers = await getAccountDeletionBlockers(user.userId);

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="rounded-card border border-line-muted bg-paper-raised p-6 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold text-ink">Set up your company</h1>
        <p className="mb-6 text-sm text-ink-muted">
          Signed in as {user.email}. If a teammate invited you, open the link in their invite email
          instead.
        </p>
        <OnboardingForm />
      </div>
      <details className="rounded-card border border-line-muted bg-paper-raised px-6 py-4 text-sm">
        <summary className="cursor-pointer text-ink-muted">Delete my account instead</summary>
        <div className="mt-4">
          {blockers.length > 0 && (
            <ul className="mb-3 list-disc pl-5 text-danger">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          <DeleteAccountForm disabled={blockers.length > 0} />
        </div>
      </details>
    </div>
  );
}

function NewCompany({ email }: { email: string }) {
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="rounded-card border border-line-muted bg-paper-raised p-6 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold text-ink">Create a new company</h1>
        <p className="mb-6 text-sm text-ink-muted">
          Signed in as {email}. You&apos;ll be its Owner, and can switch between your companies from
          the account menu.
        </p>
        <OnboardingForm />
      </div>
      <Link href="/sky" className="text-center text-sm text-ink-muted hover:text-ink">
        Back to Mimus
      </Link>
    </div>
  );
}
