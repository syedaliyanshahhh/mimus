import { getTodayEvents } from '@/src/server/calendar/getTodayEvents';
import { getCurrentWorkspaceContext } from '@/src/server/workspaces/getCurrentWorkspaceContext';
import { isDesktopUserAgent } from '@/src/lib/desktop';
import { headers } from 'next/headers';
import { DesktopReminderScheduler } from './desktop-reminder-scheduler';

// Native reminders five minutes before each of today's meetings, only in
// the desktop app (desktop/). A browser request returns before touching
// the calendar, so the web app does no extra work.
export async function DesktopReminders() {
  if (!isDesktopUserAgent((await headers()).get('user-agent'))) {
    return null;
  }
  const context = await getCurrentWorkspaceContext();
  if (!context) return null;

  const { events, timeZone } = await getTodayEvents(context);
  const timed = events
    .filter((event) => !event.allDay)
    .map(({ id, title, startsAt }) => ({ id, title, startsAt }));
  return <DesktopReminderScheduler events={timed} timeZone={timeZone} />;
}
