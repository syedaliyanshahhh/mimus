import { expect, test } from '@playwright/test';
import { signInViaMagicLink } from './helpers';

test('a new company sees empty states until the owner turns on sample data', async ({ page }) => {
  await signInViaMagicLink(page, `e2e-demo-${Date.now()}@example.com`);

  // A new tenant sees no sample deals, only prompts to connect.
  await page.goto('/sky');
  await expect(page.getByRole('heading', { name: /good morning/i })).toBeVisible();
  await expect(page.getByText('Connect your email to see what needs you')).toBeVisible();
  await expect(page.getByText('Sample data')).toHaveCount(0);
  await expect(page.getByText(/invoice 1042/i)).toHaveCount(0);

  await page.goto('/canopy/sales');
  await expect(page.getByText('No pipeline data yet')).toBeVisible();

  await page.goto('/ground');
  await expect(page.getByText('No deals yet')).toBeVisible();

  // Turning on Demo data brings the sample workspace back.
  await page.goto('/feature-switches');
  const demoToggle = page.getByRole('checkbox', { name: 'Demo data' });
  await expect(demoToggle).not.toBeChecked();
  await demoToggle.click();
  await expect(demoToggle).toBeChecked();
  await expect(demoToggle).toBeEnabled();

  await page.goto('/sky');
  await expect(page.getByText('Sample data')).toBeVisible();
  await expect(page.getByText('Connect your email to see what needs you')).toHaveCount(0);
});
