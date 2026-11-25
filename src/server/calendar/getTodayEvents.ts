import type { WorkspaceContext } from '@/src/server/workspaces/getCurrentWorkspaceContext';

export type TodayEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  meetingUrl: string | null;
  attendees: { name: string | null; email: string | null }[];
};

export type TodayEvents = {
  // Whether the user has connected any calendar or scheduling account here,
  // so the card can tell "nothing today" from "nothing connected".
  hasCalendar: boolean;
  timeZone: string;
  events: TodayEvent[];
};

type EventRow = {
  id: string;
  title: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  status: string | null;
  raw: unknown;
  event_attendees: { people: { display_name: string | null; email: string | null } | null }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Today's events from the user's own calendars in the active workspace,
// read with their session client so RLS (can_see_connected_account) still
// applies. "Today" is the user's day in their scheduling time zone.
export async function getTodayEvents(
  context: WorkspaceContext,
  now: Date = new Date(),
): Promise<TodayEvents> {
  const { supabase, workspaceId, userId } = context;

  const [{ data: rules }, { count, error: countError }] = await Promise.all([
    supabase
      .from('scheduling_rules')
      .select('time_zone')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle<{ time_zone: string }>(),
    supabase
      .from('connected_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('owner_user_id', userId)
      .in('account_type', ['calendar', 'scheduling']),
  ]);
  if (countError) throw countError;

  const timeZone = validTimeZone(rules?.time_zone);
  if (!count) {
    return { hasCalendar: false, timeZone, events: [] };
  }

  const { start, end, date } = localDay(now, timeZone);
  // A day either side, so all-day events (stored at UTC midnight) are
  // fetched whichever side of UTC the user is on; filtered precisely below.
  const { data, error } = await supabase
    .from('events')
    .select(
      'id, title, location, starts_at, ends_at, all_day, status, raw, connected_accounts!inner(owner_user_id), event_attendees(people(display_name, email))',
    )
    .eq('workspace_id', workspaceId)
    .eq('connected_accounts.owner_user_id', userId)
    .lt('starts_at', new Date(end + DAY_MS).toISOString())
    .gt('ends_at', new Date(start - DAY_MS).toISOString())
    .order('starts_at')
    .returns<EventRow[]>();
  if (error) throw error;

  const byKey = new Map<string, TodayEvent>();
  for (const row of data ?? []) {
    if (row.status === 'cancelled' || !isOnDay(row, start, end, date)) continue;

    const event: TodayEvent = {
      id: row.id,
      title: row.title?.trim() || '(No title)',
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      allDay: row.all_day,
      location: row.location,
      meetingUrl: meetingLinkFrom(row.raw) ?? httpsUrl(row.location),
      attendees: row.event_attendees.flatMap(({ people }) =>
        people ? [{ name: people.display_name, email: people.email }] : [],
      ),
    };

    // One meeting can arrive through two accounts (a Calendly booking is
    // also on the Google calendar). Show it once, keeping what each knew.
    const key = `${event.title}|${Date.parse(event.startsAt)}|${Date.parse(event.endsAt)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, event);
      continue;
    }
    existing.meetingUrl ??= event.meetingUrl;
    existing.location ??= event.location;
    const seen = new Set(existing.attendees.map((a) => a.email ?? a.name));
    existing.attendees.push(...event.attendees.filter((a) => !seen.has(a.email ?? a.name)));
  }

  const events = [...byKey.values()].sort(
    (a, b) =>
      Number(b.allDay) - Number(a.allDay) || Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
  return { hasCalendar: true, timeZone, events };
}

// Timed events count when they overlap the local day. All-day events are
// stored as UTC-midnight dates, so they count when the local date falls in
// [start date, end date).
function isOnDay(row: EventRow, start: number, end: number, date: string): boolean {
  if (row.all_day) {
    const first = new Date(row.starts_at).toISOString().slice(0, 10);
    const last = new Date(row.ends_at).toISOString().slice(0, 10);
    return first <= date && (date < last || first === last);
  }
  return Date.parse(row.starts_at) < end && Date.parse(row.ends_at) > start;
}

function validTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

// The zone's offset from UTC at an instant, in ms.
function offsetAt(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - (instant - (instant % 1000));
}

// Local midnight of a wall-clock date in the zone, as a UTC instant.
function midnight(year: number, monthIndex: number, day: number, timeZone: string): number {
  const guess = Date.UTC(year, monthIndex, day);
  const first = guess - offsetAt(guess, timeZone);
  // Re-check across a DST change between the guess and the answer.
  return guess - offsetAt(first, timeZone);
}

function localDay(now: Date, timeZone: string) {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number);
  return {
    start: midnight(year, month - 1, day, timeZone),
    end: midnight(year, month - 1, day + 1, timeZone),
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

// The video link from a provider's raw event: Google (hangoutLink or a
// video conference entry point), Microsoft (onlineMeeting.joinUrl) or
// Calendly (location.join_url). Only https links, since it becomes an href.
export function meetingLinkFrom(raw: unknown): string | null {
  const entryPoints = field(field(raw, 'conferenceData'), 'entryPoints');
  const video = Array.isArray(entryPoints)
    ? entryPoints.find((entry) => field(entry, 'entryPointType') === 'video')
    : undefined;
  const candidates = [
    field(raw, 'hangoutLink'),
    field(video, 'uri'),
    field(field(raw, 'onlineMeeting'), 'joinUrl'),
    field(raw, 'onlineMeetingUrl'),
    field(field(raw, 'location'), 'join_url'),
  ];
  for (const candidate of candidates) {
    const url = httpsUrl(candidate);
    if (url) return url;
  }
  return null;
}
