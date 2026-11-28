// Shared by the web app and the Tauri desktop shell (desktop/), which
// appends this marker to its webview's user agent.
export const DESKTOP_UA_MARKER = 'MimusDesktop';

export function isDesktopUserAgent(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent?.includes(DESKTOP_UA_MARKER));
}

export const REMINDER_LEAD_MS = 5 * 60 * 1000;

export type ReminderEvent = { id: string; title: string; startsAt: string };
export type ScheduledReminder = ReminderEvent & { delayMs: number };

// Which of today's events still need a reminder, and how long from `now`
// until each one is due. An event already under way, or one this window
// already notified about, gets none; one starting within the lead time is
// due immediately.
export function reminderSchedule(
  events: ReminderEvent[],
  now: Date,
  notified: ReadonlySet<string>,
): ScheduledReminder[] {
  return events.flatMap((event) => {
    const startsAt = new Date(event.startsAt).getTime();
    if (Number.isNaN(startsAt) || startsAt <= now.getTime() || notified.has(event.id)) {
      return [];
    }
    return [{ ...event, delayMs: Math.max(0, startsAt - REMINDER_LEAD_MS - now.getTime()) }];
  });
}
