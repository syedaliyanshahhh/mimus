'use server';

import { createClient } from '@/src/db/server';
import { switchWorkspace } from '@/src/server/workspaces/switchWorkspace';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

// Switches the signed-in user's active workspace. Membership is checked by
// set_active_workspace() itself (migration 0027). Lands on Sky, since the
// page the user was on may belong to the workspace they just left.
export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const workspaceId = formData.get('workspaceId')?.toString() ?? '';
  await switchWorkspace(await createClient(), workspaceId);
  revalidatePath('/', 'layout');
  redirect('/sky');
}
