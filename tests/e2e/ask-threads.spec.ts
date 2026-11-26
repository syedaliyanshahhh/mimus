import { createServiceClient } from '@/src/db/service';
import { expect, test } from '@playwright/test';
import { signInViaMagicLink, stubAsk, workspaceOf } from './helpers';

// The model is the one stubbed boundary (no AI key in CI). The stub stands
// in for POST /api/agent/ask whole, so it also writes what that route
// persists -- the thread and both messages of each turn. That persistence
// (and the history replayed to the model) is covered against the real DB
// in tests/server/agent/threads.test.ts; this spec covers the page around it.

test('a two-turn conversation on /ask persists across a reload', async ({ page }) => {
  const email = `e2e-ask-threads-${Date.now()}@example.com`;
  await signInViaMagicLink(page, email);
  const stub = stubAsk(page, await workspaceOf(email));
  await stub.route;

  await page.goto('/ask');
  const composer = page.getByRole('textbox', { name: 'Message Mimus' });
  const conversation = page.getByRole('log', { name: 'Conversation' });
  // Typing before the page hydrates is lost, so retry until it takes.
  await expect(async () => {
    await composer.fill('what about the lease?');
    await composer.press('Enter');
    await expect(conversation).toContainText('Answer to: what about the lease?', {
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });

  // The new thread gets its own address, and shows in the thread list.
  await expect(page).toHaveURL(/\/ask\/[0-9a-f-]{36}$/);
  const threadUrl = page.url();
  const threads = page.getByRole('navigation', { name: 'Conversations' });
  await expect(threads.getByRole('link', { name: 'what about the lease?' })).toBeVisible();

  await composer.fill('is that this Friday?');
  await composer.press('Enter');
  await expect(conversation).toContainText('Answer to: is that this Friday?');
  // The follow-up continued the same thread.
  expect(stub.requests).toEqual([
    { question: 'what about the lease?' },
    { question: 'is that this Friday?', threadId: threadUrl.split('/').pop() },
  ]);

  await page.reload();
  await expect(page).toHaveURL(threadUrl);
  await expect(conversation.getByText(/^(what about|Answer to|is that)/)).toHaveText([
    'what about the lease?',
    'Answer to: what about the lease?',
    'is that this Friday?',
    'Answer to: is that this Friday?',
  ]);
});

test('the Ask bar continues its thread and links to it on /ask', async ({ page }) => {
  const email = `e2e-ask-bar-thread-${Date.now()}@example.com`;
  await signInViaMagicLink(page, email);
  const stub = stubAsk(page, await workspaceOf(email));
  await stub.route;

  await page.goto('/sky');
  const askBox = page.getByRole('textbox', { name: 'Ask Mimus' });
  const answer = page.getByRole('region', { name: 'Mimus answer' });
  await expect(async () => {
    await askBox.fill('anything urgent?');
    await askBox.press('Enter');
    await expect(answer).toContainText('Answer to: anything urgent?', { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });

  await askBox.fill('and tomorrow?');
  await askBox.press('Enter');
  await expect(answer).toContainText('Answer to: and tomorrow?');
  // The second question went into the first one's thread.
  expect(stub.requests[0]).toEqual({ question: 'anything urgent?' });
  const threadId = stub.requests[1]?.threadId;
  expect(threadId).toMatch(/^[0-9a-f-]{36}$/);

  await answer.getByRole('link', { name: 'Continue in Ask' }).click();
  await expect(page).toHaveURL(`/ask/${threadId}`, { timeout: 20_000 });
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText(
    'Answer to: and tomorrow?',
  );
});

test("another user's thread is not found", async ({ page }) => {
  const owner = `e2e-ask-thread-owner-${Date.now()}@example.com`;
  const outsider = `e2e-ask-thread-outsider-${Date.now()}@example.com`;
  await signInViaMagicLink(page, owner);
  const { userId, workspaceId } = await workspaceOf(owner);
  const { data: thread } = await createServiceClient()
    .from('ai_threads')
    .insert({ workspace_id: workspaceId, user_id: userId, title: 'Private board prep' })
    .select('id')
    .single()
    .throwOnError();

  await page.context().clearCookies();
  await signInViaMagicLink(page, outsider);
  await page.goto(`/ask/${thread!.id}`);

  await expect(page.getByText('Private board prep')).toHaveCount(0);
  await expect(page.getByText(/not found|404/i).first()).toBeVisible();
});
