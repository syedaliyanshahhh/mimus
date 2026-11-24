import { createServiceClient } from '@/src/db/service';
import { expect, test } from '@playwright/test';
import { signInViaMagicLink } from './helpers';

test('owner toggles a feature switch and it persists through real RLS', async ({ page }) => {
  const ownerEmail = `e2e-fs-owner-${Date.now()}@example.com`;
  await signInViaMagicLink(page, ownerEmail);
  await page.goto('/feature-switches');

  await expect(page.getByRole('heading', { name: 'Feature switches' })).toBeVisible();

  const moneyToggle = page.getByRole('checkbox', { name: /money/i });
  await expect(moneyToggle).not.toBeChecked();

  await moneyToggle.click();
  await expect(moneyToggle).toBeChecked();

  // Reload to prove the toggle was written under the owner's own session
  // through the real `manage_feature_switches` RLS policy, not just held
  // in client-side state.
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /money/i })).toBeChecked();
});

// Seeds the member's workspace_members row via the service client before
// their first sign-in, rather than going through the /invite/[token] flow
// (tests/e2e/members.spec.ts and onboarding.spec.ts cover that). With a
// membership already in place, sign-in skips /onboarding and lands them
// straight in the owner's workspace.
test('a non-owner member sees a gated message instead of controls', async ({ page, browser }) => {
  const ownerEmail = `e2e-fs-owner2-${Date.now()}@example.com`;
  const memberEmail = `e2e-fs-member-${Date.now()}@example.com`;

  await signInViaMagicLink(page, ownerEmail);

  const supabase = createServiceClient();
  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', ownerEmail)
    .single()
    .throwOnError();
  const { data: ownerMembership } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', ownerProfile!.id)
    .single()
    .throwOnError();

  const { data: created } = await supabase.auth.admin.createUser({
    email: memberEmail,
    email_confirm: true,
  });
  const { error: memberError } = await supabase.from('workspace_members').insert({
    workspace_id: ownerMembership!.workspace_id,
    user_id: created!.user!.id,
    role: 'member',
  });
  if (memberError) throw memberError;

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await signInViaMagicLink(memberPage, memberEmail);

  await memberPage.goto('/feature-switches');
  await expect(
    memberPage.getByText(/only workspace owners can manage feature switches/i),
  ).toBeVisible();
  await expect(memberPage.getByRole('checkbox')).toHaveCount(0);

  await memberContext.close();
});
