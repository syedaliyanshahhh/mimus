import { createServiceClient } from '@/src/db/service';
import { getTodayEvents, meetingLinkFrom } from '@/src/server/calendar/getTodayEvents';
import { upsertEvent } from '@/src/server/shared/normalize';
import { loadWorkspaceContext } from '@/src/server/workspaces/getCurrentWorkspaceContext';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 10:00 in New York on Thursday 26 November 2026.
const NOW = new Date('2026-11-26T15:00:00Z');
const TIME_ZONE = 'America/New_York';

describe('getTodayEvents', () => {
  const service = createServiceClient();
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const password = `pw-${randomUUID()}`;
  let companyId: string;
  let workspaceId: string;
  let memberCalendarId: string;
  let memberCalendlyId: string;
  let ownerPrivateCalendarId: string;

  async function signedIn(userId: string) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error } = await supabase.auth.signInWithPassword({
      email: `${userId}@example.com`,
      password,
    });
    if (error) throw error;
    return supabase;
  }

  async function contextFor(userId: string) {
    const context = await loadWorkspaceContext(await signedIn(userId));
    if (!context) throw new Error('no workspace context');
    return context;
  }

  async function calendar(
    ownerUserId: string,
    provider: string,
    accountType: string,
    visibility: string,
  ) {
    const { data } = await service
      .from('connected_accounts')
      .insert({
        workspace_id: workspaceId,
        owner_user_id: ownerUserId,
        provider,
        account_type: accountType,
        visibility,
        external_account_id: `${randomUUID()}@example.com`,
      })
      .select('id')
      .single()
      .throwOnError();
    return data!.id as string;
  }

  beforeAll(async () => {
    for (const id of [ownerId, memberId]) {
      const { error } = await service.auth.admin.createUser({
        id,
        email: `${id}@example.com`,
        password,
        email_confirm: true,
      });
      if (error) throw error;
    }
    const { data: company } = await service
      .from('companies')
      .insert({ name: 'Calendar test co' })
      .select('id')
      .single()
      .throwOnError();
    companyId = company!.id;
    const { data: workspace } = await service
      .from('workspaces')
      .insert({ company_id: companyId, name: 'Calendar test ws' })
      .select('id')
      .single()
      .throwOnError();
    workspaceId = workspace!.id;
    await service
      .from('workspace_members')
      .insert([
        { workspace_id: workspaceId, user_id: ownerId, role: 'owner' },
        { workspace_id: workspaceId, user_id: memberId, role: 'member' },
      ])
      .throwOnError();
    await service
      .from('scheduling_rules')
      .insert({ workspace_id: workspaceId, user_id: memberId, time_zone: TIME_ZONE })
      .throwOnError();

    memberCalendarId = await calendar(memberId, 'google', 'calendar', 'private');
    memberCalendlyId = await calendar(memberId, 'calendly', 'scheduling', 'private');
    ownerPrivateCalendarId = await calendar(ownerId, 'google', 'calendar', 'private');

    const event = (id: string, title: string, startsAt: string, endsAt: string, extra = {}) => ({
      providerEventId: id,
      title,
      startsAt,
      endsAt,
      ...extra,
    });

    await upsertEvent(
      workspaceId,
      memberCalendarId,
      event('standup', 'Standup', '2026-11-26T14:00:00Z', '2026-11-26T14:15:00Z', {
        location: 'Room 4',
        attendees: [
          { person: { email: 'ana@example.com', displayName: 'Ana' }, responseStatus: 'accepted' },
          { person: { email: 'bo@example.com' }, responseStatus: 'needsAction' },
        ],
        raw: { hangoutLink: 'https://meet.google.com/abc-defg-hij' },
      }),
    );
    // 18:30 in New York: still today there, though tomorrow-ish in UTC.
    await upsertEvent(
      workspaceId,
      memberCalendarId,
      event('late', 'Late call', '2026-11-26T23:30:00Z', '2026-11-27T00:00:00Z'),
    );
    // 01:00 on the 27th in New York: tomorrow.
    await upsertEvent(
      workspaceId,
      memberCalendarId,
      event('tomorrow', 'Tomorrow', '2026-11-27T06:00:00Z', '2026-11-27T07:00:00Z'),
    );
    await upsertEvent(
      workspaceId,
      memberCalendarId,
      event('yesterday', 'Yesterday', '2026-11-25T15:00:00Z', '2026-11-25T16:00:00Z'),
    );
    await upsertEvent(
      workspaceId,
      memberCalendarId,
      event('holiday', 'Thanksgiving', '2026-11-26T00:00:00Z', '2026-11-27T00:00:00Z', {
        allDay: true,
      }),
    );
    await upsertEvent(
      workspaceId,
      memberCalendarId,
      event('cancelled', 'Cancelled sync', '2026-11-26T16:00:00Z', '2026-11-26T16:30:00Z', {
        status: 'cancelled',
      }),
    );
    // The same Calendly booking, also on the Google calendar.
    await upsertEvent(
      workspaceId,
      memberCalendarId,
      event('intro-g', 'Intro call', '2026-11-26T17:00:00Z', '2026-11-26T17:30:00Z'),
    );
    await upsertEvent(
      workspaceId,
      memberCalendlyId,
      event('intro-c', 'Intro call', '2026-11-26T17:00:00Z', '2026-11-26T17:30:00Z', {
        raw: { location: { join_url: 'https://zoom.us/j/123' } },
      }),
    );
    await upsertEvent(
      workspaceId,
      ownerPrivateCalendarId,
      event('board', 'Board prep (private)', '2026-11-26T15:00:00Z', '2026-11-26T16:00:00Z'),
    );
  });

  afterAll(async () => {
    await service.from('companies').delete().eq('id', companyId);
    await service.auth.admin.deleteUser(ownerId);
    await service.auth.admin.deleteUser(memberId);
  });

  it("lists the user's own events for today in their time zone, in order", async () => {
    const today = await getTodayEvents(await contextFor(memberId), NOW);

    expect(today.hasCalendar).toBe(true);
    expect(today.timeZone).toBe(TIME_ZONE);
    expect(today.events.map((e) => e.title)).toEqual([
      'Thanksgiving',
      'Standup',
      'Intro call',
      'Late call',
    ]);
    expect(today.events[0]).toMatchObject({ allDay: true });
    expect(today.events[1]).toMatchObject({
      title: 'Standup',
      startsAt: '2026-11-26T14:00:00+00:00',
      endsAt: '2026-11-26T14:15:00+00:00',
      location: 'Room 4',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      allDay: false,
    });
    expect(today.events[1].attendees).toEqual(
      expect.arrayContaining([
        { name: 'Ana', email: 'ana@example.com' },
        { name: null, email: 'bo@example.com' },
      ]),
    );
    // The duplicate kept its meeting link from whichever copy had one.
    expect(today.events[2].meetingUrl).toBe('https://zoom.us/j/123');
  });

  it("never shows a Member the Owner's Private calendar", async () => {
    const memberContext = await contextFor(memberId);
    const today = await getTodayEvents(memberContext, NOW);
    expect(today.events.map((e) => e.title)).not.toContain('Board prep (private)');

    // And RLS itself refuses the rows, not just the owner filter.
    const { data } = await memberContext.supabase
      .from('events')
      .select('id')
      .eq('connected_account_id', ownerPrivateCalendarId);
    expect(data).toEqual([]);
  });

  it('shows the Owner their own private calendar, in UTC without a time zone set', async () => {
    const today = await getTodayEvents(await contextFor(ownerId), NOW);
    expect(today.timeZone).toBe('UTC');
    expect(today.events.map((e) => e.title)).toEqual(['Board prep (private)']);
  });

  it('reports no calendar when the user has none connected', async () => {
    const { data: accounts } = await service
      .from('connected_accounts')
      .select('id')
      .eq('owner_user_id', ownerId)
      .throwOnError();
    await service
      .from('connected_accounts')
      .update({ account_type: 'email' })
      .in(
        'id',
        accounts!.map((a) => a.id),
      )
      .throwOnError();
    try {
      const today = await getTodayEvents(await contextFor(ownerId), NOW);
      expect(today).toMatchObject({ hasCalendar: false, events: [] });
    } finally {
      await service
        .from('connected_accounts')
        .update({ account_type: 'calendar' })
        .eq('id', ownerPrivateCalendarId)
        .throwOnError();
    }
  });
});

describe('meetingLinkFrom', () => {
  it('reads Google, Microsoft and Calendly links', () => {
    expect(meetingLinkFrom({ hangoutLink: 'https://meet.google.com/x' })).toBe(
      'https://meet.google.com/x',
    );
    expect(
      meetingLinkFrom({
        conferenceData: {
          entryPoints: [
            { entryPointType: 'phone', uri: 'tel:+1555' },
            { entryPointType: 'video', uri: 'https://zoom.us/j/9' },
          ],
        },
      }),
    ).toBe('https://zoom.us/j/9');
    expect(meetingLinkFrom({ onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/1' } })).toBe(
      'https://teams.microsoft.com/l/1',
    );
    expect(meetingLinkFrom({ location: { join_url: 'https://zoom.us/j/1' } })).toBe(
      'https://zoom.us/j/1',
    );
  });

  it('ignores anything that is not an https link', () => {
    expect(meetingLinkFrom({ hangoutLink: 'javascript:alert(1)' })).toBeNull();
    expect(meetingLinkFrom({ onlineMeeting: { joinUrl: 'http://insecure.example' } })).toBeNull();
    expect(meetingLinkFrom({})).toBeNull();
    expect(meetingLinkFrom(null)).toBeNull();
  });
});
