import { createServiceClient } from '@/src/db/service';
import { expect, test } from '@playwright/test';
import {
  acceptTermsOnPage,
  clearMailbox,
  completeOnboardingOnPage,
  latestMagicLink,
  signInViaMagicLink,
} from './helpers';

async function membershipsOf(email: string) {
  const supabase = createServiceClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()
    .throwOnError();
  const { data } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces(name, companies(name))')
    .eq('user_id', profile!.id)
    .throwOnError();
  return data!;
}

test('a new user names their company before reaching the app', async ({ page }) => {
  const email = `e2e-onboarding-${Date.now()}@example.com`;

  await signInViaMagicLink(page, email, { onboard: false });

  await expect(page).toHaveURL(/\/onboarding$/);
  // Signing up alone creates nothing.
  expect(await membershipsOf(email)).toHaveLength(0);

  // The app shell sends them back here until they finish.
  await page.goto('/sky');
  await expect(page).toHaveURL(/\/onboarding$/);

  // A blank name is rejected with a message, not a crash.
  await page.getByLabel('Company name').fill('   ');
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByRole('alert')).toHaveText('Company name is required');

  await page.getByLabel('Workspace name').fill('Leadership');
  await completeOnboardingOnPage(page, 'Northwind Traders');

  expect(await membershipsOf(email)).toEqual([
    expect.objectContaining({
      role: 'owner',
      workspaces: { name: 'Leadership', companies: { name: 'Northwind Traders' } },
    }),
  ]);

  // Done: onboarding now forwards to the app.
  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/sky$/);
});

test('an invitee joins the inviting workspace without ever seeing onboarding', async ({ page }) => {
  const ownerEmail = `e2e-onboarding-owner-${Date.now()}@example.com`;
  const inviteeEmail = `e2e-onboarding-invitee-${Date.now()}@example.com`;
  await signInViaMagicLink(page, ownerEmail);
  const [{ workspace_id: workspaceId }] = await membershipsOf(ownerEmail);

  const supabase = createServiceClient();
  const token = `e2e-onboarding-${Date.now()}`;
  await supabase
    .from('invites')
    .insert({
      workspace_id: workspaceId,
      email: inviteeEmail,
      role: 'member',
      token,
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    })
    .throwOnError();

  await page.context().clearCookies();
  await clearMailbox();
  await page.goto(`/invite/${token}`);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(inviteeEmail);
  await page.getByRole('button', { name: /send magic link/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();
  await page.goto(await latestMagicLink(inviteeEmail));

  await expect(page).toHaveURL(/\/accept-terms\?next=%2Finvite%2F/);
  await acceptTermsOnPage(page);
  await expect(page.getByText(/joined the workspace/i)).toBeVisible();

  expect(await membershipsOf(inviteeEmail)).toEqual([
    expect.objectContaining({ workspace_id: workspaceId, role: 'member' }),
  ]);
});
