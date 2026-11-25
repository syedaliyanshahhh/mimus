import { expect, test } from '@playwright/test';
import { createServiceClient } from '@/src/db/service';
import { seedConnectedAccount, signInViaMagicLink } from './helpers';

test("Sky shows today's real meetings once a calendar is connected", async ({ page }) => {
  const email = `e2e-sky-calendar-${Date.now()}@example.com`;
  await signInViaMagicLink(page, email);

  // Nothing connected yet: the card says how to fill it.
  await page.goto('/sky');
  await expect(page.getByText("Connect your calendar to see today's meetings here.")).toBeVisible();

  // A calendar with a meeting in progress (so it's "today" in any zone),
  // standing in for a Google sync as the other e2e specs do.
  const calendarId = await seedConnectedAccount(email, { accountType: 'calendar' });
  const { data: account } = await createServiceClient()
    .from('connected_accounts')
    .select('workspace_id')
    .eq('id', calendarId)
    .single()
    .throwOnError();
  const { upsertEvent } = await import('@/src/server/shared/normalize');
  await upsertEvent(account!.workspace_id, calendarId, {
    providerEventId: `e2e-${Date.now()}`,
    title: 'Pipeline review',
    location: 'Room 2',
    startsAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    attendees: [{ person: { email: 'dana@example.com', displayName: 'Dana' } }],
    raw: { hangoutLink: 'https://meet.google.com/e2e-test-link' },
  });

  await page.reload();
  const meetings = page.getByRole('list', { name: "Today's meetings" });
  await expect(meetings.getByText('Pipeline review')).toBeVisible();
  await expect(meetings.getByText('Room 2 · Dana')).toBeVisible();
  await expect(meetings.getByRole('link', { name: /join pipeline review/i })).toHaveAttribute(
    'href',
    'https://meet.google.com/e2e-test-link',
  );
});
