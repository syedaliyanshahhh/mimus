import { createServiceClient } from '@/src/db/service';
import { emitSignal } from '@/src/server/events/emit';

// The one place provider payloads become shared rows. Every connector
// (Google, then Microsoft) maps its own API responses into these shapes
// and calls these helpers -- normalization happens once, here, never
// downstream. Writes go through the service role only: these tables carry
// no insert/update/delete RLS policies (see
// supabase/migrations/0012_messages_events_people.sql).

export interface NormalizedPerson {
  externalPersonId?: string;
  email?: string;
  displayName?: string;
  raw?: Record<string, unknown>;
}

export interface NormalizedMessage {
  providerMessageId: string;
  threadId?: string;
  subject?: string;
  snippet?: string;
  bodyText?: string;
  bodyHtml?: string;
  direction: 'inbound' | 'outbound';
  sentAt?: string;
  from?: NormalizedPerson;
  participants?: Array<{ person: NormalizedPerson; role: 'to' | 'cc' | 'bcc' }>;
  raw?: Record<string, unknown>;
}

export interface NormalizedEvent {
  providerEventId: string;
  calendarId?: string;
  title?: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  status?: string;
  organizer?: NormalizedPerson;
  attendees?: Array<{ person: NormalizedPerson; responseStatus?: string }>;
  raw?: Record<string, unknown>;
}

// Dedupes by (connected_account_id, email) when an email is present --
// there's no stable identity to dedupe on otherwise, so a person with no
// email gets a fresh row each time (acceptable for now; see the schema
// migration's note on deferring cross-connector identity resolution).
export async function upsertPerson(
  workspaceId: string,
  connectedAccountId: string,
  person: NormalizedPerson,
): Promise<string> {
  const supabase = createServiceClient();

  if (person.email) {
    const { data: existing } = await supabase
      .from('people')
      .select('id')
      .eq('connected_account_id', connectedAccountId)
      .ilike('email', person.email)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('people')
        .update({
          display_name: person.displayName,
          external_person_id: person.externalPersonId,
          raw: person.raw ?? {},
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .throwOnError();
      return existing.id as string;
    }
  }

  const { data } = await supabase
    .from('people')
    .insert({
      workspace_id: workspaceId,
      connected_account_id: connectedAccountId,
      external_person_id: person.externalPersonId,
      email: person.email,
      display_name: person.displayName,
      raw: person.raw ?? {},
    })
    .select('id')
    .single()
    .throwOnError();
  return data!.id as string;
}

export async function upsertMessage(
  workspaceId: string,
  connectedAccountId: string,
  message: NormalizedMessage,
): Promise<string> {
  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from('messages')
    .select('id, subject, snippet, body_text, sent_at, from_person_id')
    .eq('connected_account_id', connectedAccountId)
    .eq('provider_message_id', message.providerMessageId)
    .maybeSingle();

  const fromPersonId = message.from
    ? await upsertPerson(workspaceId, connectedAccountId, message.from)
    : null;

  let messageId: string;
  if (existing) {
    await supabase
      .from('messages')
      .update({
        thread_id: message.threadId,
        subject: message.subject,
        snippet: message.snippet,
        body_text: message.bodyText,
        body_html: message.bodyHtml,
        direction: message.direction,
        sent_at: message.sentAt,
        from_person_id: fromPersonId,
        raw: message.raw ?? {},
      })
      .eq('id', existing.id)
      .throwOnError();
    messageId = existing.id as string;
    const changed =
      existing.subject !== (message.subject ?? null) ||
      existing.snippet !== (message.snippet ?? null) ||
      existing.body_text !== (message.bodyText ?? null) ||
      !sameInstant(existing.sent_at, message.sentAt) ||
      existing.from_person_id !== fromPersonId;
    if (changed) await dropChunks('message_id', messageId);
  } else {
    const { data } = await supabase
      .from('messages')
      .insert({
        workspace_id: workspaceId,
        connected_account_id: connectedAccountId,
        provider_message_id: message.providerMessageId,
        thread_id: message.threadId,
        subject: message.subject,
        snippet: message.snippet,
        body_text: message.bodyText,
        body_html: message.bodyHtml,
        direction: message.direction,
        sent_at: message.sentAt,
        from_person_id: fromPersonId,
        raw: message.raw ?? {},
      })
      .select('id')
      .single()
      .throwOnError();
    messageId = data!.id as string;
    await emitSignal(workspaceId, 'message.received', { messageId }, connectedAccountId);
  }

  if (message.participants?.length) {
    const rows = await Promise.all(
      message.participants.map(async (p) => ({
        message_id: messageId,
        person_id: await upsertPerson(workspaceId, connectedAccountId, p.person),
        role: p.role,
      })),
    );
    await supabase.from('message_participants').upsert(rows).throwOnError();
  }

  return messageId;
}

export async function upsertEvent(
  workspaceId: string,
  connectedAccountId: string,
  event: NormalizedEvent,
): Promise<string> {
  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from('events')
    .select('id, title, description, location, starts_at, ends_at, all_day')
    .eq('connected_account_id', connectedAccountId)
    .eq('provider_event_id', event.providerEventId)
    .maybeSingle();

  const organizerPersonId = event.organizer
    ? await upsertPerson(workspaceId, connectedAccountId, event.organizer)
    : null;

  let eventId: string;
  if (existing) {
    await supabase
      .from('events')
      .update({
        calendar_id: event.calendarId,
        title: event.title,
        description: event.description,
        location: event.location,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        all_day: event.allDay ?? false,
        status: event.status,
        organizer_person_id: organizerPersonId,
        raw: event.raw ?? {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .throwOnError();
    eventId = existing.id as string;
    // Attendee changes alone don't re-embed; the event's own text does.
    const changed =
      existing.title !== (event.title ?? null) ||
      existing.description !== (event.description ?? null) ||
      existing.location !== (event.location ?? null) ||
      !sameInstant(existing.starts_at, event.startsAt) ||
      !sameInstant(existing.ends_at, event.endsAt) ||
      existing.all_day !== (event.allDay ?? false);
    if (changed) await dropChunks('event_id', eventId);
  } else {
    const { data } = await supabase
      .from('events')
      .insert({
        workspace_id: workspaceId,
        connected_account_id: connectedAccountId,
        provider_event_id: event.providerEventId,
        calendar_id: event.calendarId,
        title: event.title,
        description: event.description,
        location: event.location,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        all_day: event.allDay ?? false,
        status: event.status,
        organizer_person_id: organizerPersonId,
        raw: event.raw ?? {},
      })
      .select('id')
      .single()
      .throwOnError();
    eventId = data!.id as string;
    await emitSignal(workspaceId, 'event.created', { eventId }, connectedAccountId);
  }

  if (event.attendees?.length) {
    const rows = await Promise.all(
      event.attendees.map(async (a) => ({
        event_id: eventId,
        person_id: await upsertPerson(workspaceId, connectedAccountId, a.person),
        response_status: a.responseStatus,
      })),
    );
    await supabase.from('event_attendees').upsert(rows).throwOnError();
  }

  return eventId;
}

// A source whose text changed loses its chunks, which puts it back in the
// embedding queue (sources_missing_chunks, migration 0029).
async function dropChunks(column: 'message_id' | 'event_id', id: string): Promise<void> {
  await createServiceClient().from('content_chunks').delete().eq(column, id).throwOnError();
}

// Postgres returns timestamps in its own format, so compare instants.
function sameInstant(stored: string | null, incoming: string | undefined): boolean {
  if (!stored || !incoming) return !stored && !incoming;
  return new Date(stored).getTime() === new Date(incoming).getTime();
}
