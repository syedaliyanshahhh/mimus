'use server';

import { getSessionUser } from '@/src/server/auth/getSessionUser';
import { createCompanyWithOwner } from '@/src/server/workspaces/createCompanyWithOwner';
import { hasActiveMembership } from '@/src/server/workspaces/resolvePostSignIn';
import { redirect } from 'next/navigation';

export type OnboardingState = { error: string | null };

// Returns validation errors instead of throwing them: production builds
// replace a thrown server-action error's message with a generic one.
export async function createCompany(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/sign-in?next=/onboarding');
  }
  // Until the workspace switcher exists (MULTI_USER_PLAN.md A4), a member
  // can't reach a second company, so don't create one.
  if (await hasActiveMembership(user.userId)) {
    redirect('/sky');
  }

  try {
    await createCompanyWithOwner({
      // Always the signed-in user's own id, from their verified session.
      userId: user.userId,
      companyName: formData.get('companyName')?.toString() ?? '',
      workspaceName: formData.get('workspaceName')?.toString() ?? '',
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not create your company.' };
  }

  redirect('/sky');
}
