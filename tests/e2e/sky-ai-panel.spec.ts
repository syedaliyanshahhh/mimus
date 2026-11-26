import { expect, test } from '@playwright/test';
import { signInViaMagicLink, stubAsk, workspaceOf } from './helpers';

// The summary itself (fast tier, cached per user per day, private) is
// covered against the real DB in tests/server/agent/daySummary.test.ts.
// Here: the panel on Sky, and its compact chat handing off to /ask.

test("Sky's AI panel summarises a quiet day and hands a question off to /ask", async ({ page }) => {
  const email = `e2e-sky-ai-${Date.now()}@example.com`;
  await signInViaMagicLink(page, email);
  const stub = stubAsk(page, await workspaceOf(email));
  await stub.route;

  await page.goto('/sky');
  // A new user has nothing connected, so there's nothing to summarise and
  // no model call is made.
  await expect(page.getByRole('region', { name: 'Day summary' })).toContainText(
    'Nothing on your calendar and nothing waiting on you today.',
  );

  const handoff = page.getByRole('textbox', { name: 'Ask about your day' });
  // Typing before the panel hydrates is lost, so retry until it takes.
  await expect(async () => {
    await handoff.fill('what should I prep for tomorrow?');
    await handoff.press('Enter');
    await expect(page).toHaveURL(/\/ask/, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  const conversation = page.getByRole('log', { name: 'Conversation' });
  await expect(conversation).toContainText('Answer to: what should I prep for tomorrow?', {
    timeout: 20_000,
  });
  // Asked once, as a new thread, which now has its own address.
  expect(stub.requests).toEqual([{ question: 'what should I prep for tomorrow?' }]);
  await expect(page).toHaveURL(/\/ask\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(conversation).toContainText('Answer to: what should I prep for tomorrow?');
  expect(stub.requests).toHaveLength(1);
});
