'use client';

import { reminderSchedule, type ReminderEvent } from '@/src/lib/desktop';
import { useEffect } from 'react';

// The notification API the Tauri shell injects (app.withGlobalTauri, with
// only notification permissions granted to the remote origin).
type TauriNotification = {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<string>;
  sendNotification(options: { title: string; body?: string }): void;
};

declare global {
  interface Window {
    __TAURI__?: { notification?: TauriNotification };
  }
}

const NOTIFIED_KEY = 'mimus-desktop-reminded';

function readNotified(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(NOTIFIED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function markNotified(id: string) {
  try {
    const notified = readNotified();
    notified.add(id);
    sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notified]));
  } catch {
    // Storage unavailable: at worst a reminder repeats after a reload.
  }
}

export function DesktopReminderScheduler({
  events,
  timeZone,
}: {
  events: ReminderEvent[];
  timeZone: string;
}) {
  useEffect(() => {
    const notification = window.__TAURI__?.notification;
    if (!notification) return;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });

    (async () => {
      const granted =
        (await notification.isPermissionGranted()) ||
        (await notification.requestPermission()) === 'granted';
      if (!granted || cancelled) return;

      for (const event of reminderSchedule(events, new Date(), readNotified())) {
        timers.push(
          setTimeout(() => {
            markNotified(event.id);
            notification.sendNotification({
              title: event.title,
              body: `Starts at ${time.format(new Date(event.startsAt))}`,
            });
          }, event.delayMs),
        );
      }
    })();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [events, timeZone]);

  return null;
}
