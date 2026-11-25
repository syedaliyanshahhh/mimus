import { expect, test, type Page } from '@playwright/test';
import { addWorkspaceMember, completeOnboardingOnPage, signInViaMagicLink } from './helpers';

async function openAccountMenu(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  return page.getByRole('navigation', { name: 'Workspaces' });
}

test('a user in two companies switches between them and sees only that one', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-switcher-${stamp}@example.com`;
  const teammateEmail = `e2e-switcher-teammate-${stamp}@example.com`;

  // First company, via sign-up onboarding, with a teammate in it.
  await signInViaMagicLink(page, email, { onboard: false });
  await completeOnboardingOnPage(page, `Alpha ${stamp}`);
  await addWorkspaceMember(email, { email: teammateEmail, role: 'member' });

  await page.goto('/members');
  await expect(page.getByText(teammateEmail)).toBeVisible();

  // Second company, from the account menu. It opens straight away.
  const workspaces = await openAccountMenu(page);
  await expect(workspaces.getByText(`Alpha ${stamp}`)).toBeVisible();
  await workspaces.getByRole('link', { name: 'Create a new company' }).click();
  await expect(page.getByRole('heading', { name: 'Create a new company' })).toBeVisible();
  await completeOnboardingOnPage(page, `Beta ${stamp}`);

  let menu = await openAccountMenu(page);
  await expect(menu.getByText(`Alpha ${stamp}`)).toBeVisible();
  await expect(menu.getByText(`Beta ${stamp}`)).toBeVisible();
  // Each company's only workspace is "General"; the current one is marked.
  const generals = menu.getByRole('button', { name: 'General' });
  await expect(generals).toHaveCount(2);
  await expect(generals.nth(1)).toHaveAttribute('aria-current', 'true');

  // Beta has no teammate.
  await page.goto('/members');
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(teammateEmail)).toHaveCount(0);

  // Back to Alpha: the teammate is there again, and the choice sticks.
  menu = await openAccountMenu(page);
  await menu.getByRole('button', { name: 'General' }).first().click();
  await page.waitForURL((url) => url.pathname === '/sky');
  await page.goto('/members');
  await expect(page.getByText(teammateEmail)).toBeVisible();
  await page.reload();
  await expect(page.getByText(teammateEmail)).toBeVisible();
});
