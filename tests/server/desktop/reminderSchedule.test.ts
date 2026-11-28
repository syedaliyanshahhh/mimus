import { REMINDER_LEAD_MS, reminderSchedule } from '@/src/lib/desktop';
import { describe, expect, it } from 'vitest';

const NOW = new Date('2026-11-29T09:00:00Z');
const at = (iso: string) => new Date(iso).toISOString();

describe('reminderSchedule', () => {
  it('fires five minutes before each upcoming event', () => {
    expect(REMINDER_LEAD_MS).toBe(5 * 60 * 1000);
    const schedule = reminderSchedule(
      [{ id: 'a', title: 'Standup', startsAt: at('2026-11-29T10:00:00Z') }],
      NOW,
      new Set(),
    );
    expect(schedule).toEqual([
      { id: 'a', title: 'Standup', startsAt: at('2026-11-29T10:00:00Z'), delayMs: 55 * 60 * 1000 },
    ]);
  });

  it('fires right away for an event starting within the lead time', () => {
    const [entry] = reminderSchedule(
      [{ id: 'a', title: 'Soon', startsAt: at('2026-11-29T09:02:00Z') }],
      NOW,
      new Set(),
    );
    expect(entry.delayMs).toBe(0);
  });

  it('skips events that already started or were already notified', () => {
    const schedule = reminderSchedule(
      [
        { id: 'past', title: 'Past', startsAt: at('2026-11-29T08:59:00Z') },
        { id: 'done', title: 'Done', startsAt: at('2026-11-29T11:00:00Z') },
        { id: 'next', title: 'Next', startsAt: at('2026-11-29T12:00:00Z') },
      ],
      NOW,
      new Set(['done']),
    );
    expect(schedule.map((e) => e.id)).toEqual(['next']);
  });
});
