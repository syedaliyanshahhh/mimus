import { getTodayEvents, type TodayEvent } from '@/src/server/calendar/getTodayEvents';
import type { WorkspaceContext } from '@/src/server/workspaces/getCurrentWorkspaceContext';
import { Video } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { MondayCard } from './monday-card';

const MAX_NAMES = 3;

function timeLabel(event: TodayEvent, timeZone: string): string {
  if (event.allDay) return 'All day';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(event.startsAt));
}

function attendeeLabel(attendees: TodayEvent['attendees']): string | null {
  if (attendees.length === 0) return null;
  const names = attendees.map((a) => a.name ?? a.email ?? 'Guest');
  const shown = names.slice(0, MAX_NAMES).join(', ');
  return names.length > MAX_NAMES ? `${shown} +${names.length - MAX_NAMES}` : shown;
}

// Sky's schedule: today's meetings from the user's own calendars. A demo
// workspace with nothing connected keeps the sample schedule.
export async function TodayCard({ context, demo }: { context: WorkspaceContext; demo: boolean }) {
  const { hasCalendar, timeZone, events } = await getTodayEvents(context);

  if (!hasCalendar && demo) {
    return <MondayCard />;
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-ink">Today</h2>
      {!hasCalendar ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-ink-muted">
            Connect your calendar to see today&apos;s meetings here.
          </p>
          <Link
            href="/settings/connections"
            className="text-sm font-medium text-accent-strong hover:text-accent"
          >
            Connect a calendar
          </Link>
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing on your calendar today.</p>
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Today's meetings">
          {events.map((event) => {
            const people = attendeeLabel(event.attendees);
            const details = [event.location, people].filter(Boolean).join(' · ');
            return (
              <li key={event.id} className="flex items-start gap-3 text-sm">
                <span className="w-16 shrink-0 pt-px text-ink-faint">
                  {timeLabel(event, timeZone)}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-ink">{event.title}</span>
                  {details && <span className="truncate text-xs text-ink-muted">{details}</span>}
                </div>
                {event.meetingUrl && (
                  <a
                    href={event.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-pill border border-line-muted px-2.5 py-0.5 text-xs font-medium text-accent-strong hover:border-accent"
                  >
                    <Video className="size-3.5" aria-hidden />
                    Join
                    <span className="sr-only"> {event.title}</span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function TodayCardSkeleton() {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-ink">Today</h2>
      <p className="text-sm text-ink-muted">Loading your calendar…</p>
    </Card>
  );
}
