import { createServiceClient } from '@/src/db/service';
import { eventChunks, messageChunks } from '@/src/server/rag/chunk';
import { createOpenAiEmbedder, type Embedder, toVectorLiteral } from '@/src/server/rag/embedder';

// Embeds messages and events that have no chunks yet (newest first). A
// source loses its chunks when its content changes (normalize.ts), so this
// one queue covers both new and edited content. Safe to run concurrently or
// to cut off part-way: each source's chunks are written in one insert, and
// a source another run already embedded is skipped.

const PAGE_SIZE = 100;

interface PendingSource {
  source_type: 'message' | 'event';
  source_id: string;
}

interface MessageRow {
  id: string;
  workspace_id: string;
  connected_account_id: string;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  sent_at: string | null;
  connected_accounts: { provider: string };
  from_person: { email: string | null; display_name: string | null } | null;
}

interface EventRow {
  id: string;
  workspace_id: string;
  connected_account_id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  event_attendees: Array<{ people: { email: string | null; display_name: string | null } | null }>;
}

interface Chunked {
  key: { message_id: string } | { event_id: string };
  workspaceId: string;
  connectedAccountId: string;
  texts: string[];
}

export interface EmbedPendingOptions {
  embedder?: Embedder;
  connectedAccountId?: string;
  // Stop after this many sources; the next run picks up the rest.
  maxSources?: number;
  // Texts per embeddings API call.
  batchSize?: number;
  // Stop starting new pages after this time (epoch ms).
  deadline?: number;
}

export async function embedPending({
  embedder = createOpenAiEmbedder(),
  connectedAccountId,
  maxSources = 500,
  batchSize = 100,
  deadline,
}: EmbedPendingOptions = {}): Promise<{ sources: number; chunks: number }> {
  let sources = 0;
  let chunks = 0;
  while (sources < maxSources && (deadline === undefined || Date.now() < deadline)) {
    const pending = await nextPending(
      Math.min(PAGE_SIZE, maxSources - sources),
      connectedAccountId,
    );
    if (pending.length === 0) break;

    const chunked = await chunkSources(pending);
    const vectors = await embedInBatches(
      embedder,
      chunked.flatMap((c) => c.texts),
      batchSize,
    );
    let offset = 0;
    for (const source of chunked) {
      const sourceVectors = vectors.slice(offset, offset + source.texts.length);
      offset += source.texts.length;
      if (await insertChunks(source, sourceVectors)) chunks += source.texts.length;
    }
    sources += pending.length;
  }
  return { sources, chunks };
}

async function nextPending(limit: number, connectedAccountId?: string): Promise<PendingSource[]> {
  const { data } = await createServiceClient()
    .rpc('sources_missing_chunks', {
      p_limit: limit,
      p_connected_account_id: connectedAccountId ?? null,
    })
    .throwOnError();
  return (data ?? []) as PendingSource[];
}

async function chunkSources(pending: PendingSource[]): Promise<Chunked[]> {
  const service = createServiceClient();
  const messageIds = pending.filter((p) => p.source_type === 'message').map((p) => p.source_id);
  const eventIds = pending.filter((p) => p.source_type === 'event').map((p) => p.source_id);
  const chunked: Chunked[] = [];

  if (messageIds.length) {
    const { data } = await service
      .from('messages')
      .select(
        'id, workspace_id, connected_account_id, subject, snippet, body_text, sent_at, connected_accounts!inner(provider), from_person:people!messages_from_person_id_fkey(email, display_name)',
      )
      .in('id', messageIds)
      .overrideTypes<MessageRow[], { merge: false }>()
      .throwOnError();
    for (const row of data ?? []) {
      chunked.push({
        key: { message_id: row.id },
        workspaceId: row.workspace_id,
        connectedAccountId: row.connected_account_id,
        texts: messageChunks({
          provider: row.connected_accounts.provider,
          subject: row.subject,
          fromName: row.from_person?.display_name ?? null,
          fromEmail: row.from_person?.email ?? null,
          sentAt: row.sent_at,
          bodyText: row.body_text,
          snippet: row.snippet,
        }),
      });
    }
  }

  if (eventIds.length) {
    const { data } = await service
      .from('events')
      .select(
        'id, workspace_id, connected_account_id, title, description, location, starts_at, ends_at, all_day, event_attendees(people(email, display_name))',
      )
      .in('id', eventIds)
      .overrideTypes<EventRow[], { merge: false }>()
      .throwOnError();
    for (const row of data ?? []) {
      chunked.push({
        key: { event_id: row.id },
        workspaceId: row.workspace_id,
        connectedAccountId: row.connected_account_id,
        texts: eventChunks({
          title: row.title,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          allDay: row.all_day,
          location: row.location,
          attendees: row.event_attendees
            .map((a) => a.people?.display_name ?? a.people?.email)
            .filter((name): name is string => !!name),
          description: row.description,
        }),
      });
    }
  }
  return chunked;
}

async function embedInBatches(
  embedder: Embedder,
  texts: string[],
  batchSize: number,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    vectors.push(...(await embedder.embed(texts.slice(i, i + batchSize))));
  }
  return vectors;
}

// False when another run embedded this source first.
async function insertChunks(source: Chunked, vectors: number[][]): Promise<boolean> {
  const { error } = await createServiceClient()
    .from('content_chunks')
    .insert(
      source.texts.map((content, index) => ({
        ...source.key,
        workspace_id: source.workspaceId,
        connected_account_id: source.connectedAccountId,
        chunk_index: index,
        content,
        embedding: toVectorLiteral(vectors[index]),
      })),
    );
  if (error?.code === '23505') return false;
  if (error) throw error;
  return true;
}

// Right after a connection's first import, so it's searchable without
// waiting for the daily cron. Runs in the import's after(), which shares
// one function time limit -- whatever doesn't fit is left to the cron.
// Never throws: a failed embedding mustn't read as a failed import.
const AFTER_IMPORT_BUDGET_MS = 60_000;

export async function embedAfterImport(connectedAccountId: string): Promise<void> {
  try {
    await embedPending({ connectedAccountId, deadline: Date.now() + AFTER_IMPORT_BUDGET_MS });
  } catch (err) {
    console.error(`Embedding the import for account ${connectedAccountId} failed`, err);
  }
}
