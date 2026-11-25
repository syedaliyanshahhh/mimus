'use server';

import { createClient } from '@/src/db/server';
import { getSessionUser } from '@/src/server/auth/getSessionUser';
import { createCompanyWithOwner } from '@/src/server/workspaces/createCompanyWithOwner';
import { switchWorkspace } from '@/src/server/workspaces/switchWorkspace';
import { revalidatePath } from 'next/cache';
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
  // Existing members may create another company too (the avatar menu's
  // "Create a new company"); the switcher moves them between companies.
  let workspaceId: string;
  try {
    workspaceId = await createCompanyWithOwner({
      // Always the signed-in user's own id, from their verified session.
      userId: user.userId,
      companyName: formData.get('companyName')?.toString() ?? '',
      workspaceName: formData.get('workspaceName')?.toString() ?? '',
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not create your company.' };
  }

  // Open the company just created rather than whichever one was active.
  await switchWorkspace(await createClient(), workspaceId);
  revalidatePath('/', 'layout');
  redirect('/sky');
}
