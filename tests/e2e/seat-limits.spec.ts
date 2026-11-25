import { expect, test } from '@playwright/test';
import { createServiceClient } from '@/src/db/service';
import { signInViaMagicLink } from './helpers';

test('an owner on a two-seat plan sees the count and is stopped at the limit', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-seats-owner-${stamp}@example.com`;
  await signInViaMagicLink(page, email);

  // Put the owner's new workspace on a two-seat plan.
  const supabase = createServiceClient();
  const { data: owner } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()
    .throwOnError();
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', owner!.id)
    .single()
    .throwOnError();
  const { data: plan } = await supabase
    .from('plans')
    .insert({ name: `E2E two seats ${stamp}`, seat_limit: 2 })
    .select('id')
    .single()
    .throwOnError();
  await supabase
    .from('workspace_subscriptions')
    .insert({ workspace_id: membership!.workspace_id, plan_id: plan!.id, status: 'active' })
    .throwOnError();

  await page.goto('/members');
  await expect(page.getByText('1 / 2 seats')).toBeVisible();

  await page.getByLabel('Email').fill(`e2e-seats-first-${stamp}@example.com`);
  await page.getByRole('button', { name: /send invite/i }).click();
  await expect(page.getByLabel('Email')).toHaveValue('');
  await expect(page.getByText('2 / 2 seats')).toBeVisible();

  await page.getByLabel('Email').fill(`e2e-seats-second-${stamp}@example.com`);
  await page.getByRole('button', { name: /send invite/i }).click();
  await expect(page.locator('form').locator('..').getByRole('alert')).toHaveText(
    'Seat limit reached: 2 of 2 seats are in use',
  );
});
