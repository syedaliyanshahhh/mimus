import { boundedInt, requiredString } from '@/src/server/agent/tools/input';
import type { AgentTool, Source, ToolContext } from '@/src/server/agent/tools/types';
import { createOpenAiEmbedder, toVectorLiteral } from '@/src/server/rag/embedder';
import { searchWords } from '@/src/server/shared/searchWords';

// Hybrid search over email, Slack and calendar: nearest chunks by meaning
// (match_chunks) plus the existing all-keywords match, merged by reciprocal
// rank fusion. Everything runs under the asker's session, so RLS decides
// which chunks and rows exist -- the same boundary as every other tool.

const EXCERPT_LENGTH = 1500;
// Below this cosine similarity a meaning-only hit is noise, and every
// source a tool returns becomes a citation. A starting point for
// text-embedding-3-small; tune it against real mail.
export const MIN_SIMILARITY = 0.3;
// Reciprocal rank fusion's damping constant (the usual 60).
const RRF_K = 60;

type Kind = 'message' | 'event';
type Key = `${Kind}:${string}`;

interface ChunkHit {
  message_id: string | null;
  event_id: string | null;
  content: string;
  similarity: number;
}

interface MessageRow {
  id: string;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  sent_at: string | null;
  connected_accounts: { provider: string; account_type: string };
  from_person: { email: string | null; display_name: string | null } | null;
}

interface EventRow {
  id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  connected_accounts: { provider: string };
}

export const semanticSearch: AgentTool = {
  name: 'semanticSearch',
  description:
    'Search email, Slack and calendar the asker can see by meaning, not just exact words: "what did the landlord say about renewing" finds a mail about a "lease extension". Best first.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for, in plain words' },
      limit: { type: 'integer', minimum: 1, maximum: 25 },
    },
    required: ['query'],
  },
  async run(ctx, input) {
    const query = requiredString(input, 'query', 1000);
    const limit = boundedInt(input, 'limit', 10, 1, 25);

    const [chunks, keywordHits] = await Promise.all([
      nearestChunks(ctx, query, limit * 3),
      keywordMatches(ctx, query, limit),
    ]);

    // Best chunk per source, in similarity order.
    const bestChunk = new Map<Key, ChunkHit>();
    for (const chunk of chunks) {
      if (chunk.similarity < MIN_SIMILARITY) continue;
      const key: Key = chunk.message_id ? `message:${chunk.message_id}` : `event:${chunk.event_id}`;
      if (!bestChunk.has(key)) bestChunk.set(key, chunk);
    }
    const ranked = fuse([[...bestChunk.keys()], keywordHits]).slice(0, limit);
    return describe(ctx, ranked, bestChunk);
  },
};

async function nearestChunks(ctx: ToolContext, query: string, k: number): Promise<ChunkHit[]> {
  const [vector] = await (ctx.embedder ?? createOpenAiEmbedder()).embed([query]);
  const { data, error } = await ctx.supabase.rpc('match_chunks', {
    p_query: toVectorLiteral(vector),
    p_workspace_id: ctx.workspaceId,
    p_k: k,
  });
  if (error) throw error;
  return (data ?? []) as ChunkHit[];
}

// Messages (email and Slack) then events containing every keyword, as one
// ranked list.
async function keywordMatches(ctx: ToolContext, query: string, limit: number): Promise<Key[]> {
  const words = searchWords(query);
  if (words.length === 0) return [];

  let messages = ctx.supabase.from('messages').select('id').eq('workspace_id', ctx.workspaceId);
  let events = ctx.supabase.from('events').select('id').eq('workspace_id', ctx.workspaceId);
  for (const word of words) {
    messages = messages.or(
      `subject.ilike.%${word}%,snippet.ilike.%${word}%,body_text.ilike.%${word}%`,
    );
    events = events.or(
      `title.ilike.%${word}%,description.ilike.%${word}%,location.ilike.%${word}%`,
    );
  }
  const [m, e] = await Promise.all([
    messages.order('sent_at', { ascending: false, nullsFirst: false }).limit(limit),
    events.order('starts_at', { ascending: false }).limit(limit),
  ]);
  if (m.error) throw m.error;
  if (e.error) throw e.error;
  return [
    ...(m.data ?? []).map((row): Key => `message:${row.id}`),
    ...(e.data ?? []).map((row): Key => `event:${row.id}`),
  ];
}

// Reciprocal rank fusion: a source ranked well by both lists beats one
// ranked first by only one of them.
export function fuse(lists: Key[][]): Key[] {
  const scores = new Map<Key, number>();
  for (const list of lists) {
    list.forEach((key, rank) => scores.set(key, (scores.get(key) ?? 0) + 1 / (RRF_K + rank + 1)));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

async function describe(ctx: ToolContext, ranked: Key[], bestChunk: Map<Key, ChunkHit>) {
  const idsOf = (kind: Kind) =>
    ranked.filter((key) => key.startsWith(`${kind}:`)).map((key) => key.slice(kind.length + 1));
  const messageIds = idsOf('message');
  const eventIds = idsOf('event');

  const [m, e] = await Promise.all([
    messageIds.length
      ? ctx.supabase
          .from('messages')
          .select(
            'id, subject, snippet, body_text, sent_at, connected_accounts!inner(provider, account_type), from_person:people!messages_from_person_id_fkey(email, display_name)',
          )
          .in('id', messageIds)
          .overrideTypes<MessageRow[], { merge: false }>()
      : { data: [] as MessageRow[], error: null },
    eventIds.length
      ? ctx.supabase
          .from('events')
          .select(
            'id, title, description, location, starts_at, ends_at, connected_accounts!inner(provider)',
          )
          .in('id', eventIds)
          .overrideTypes<EventRow[], { merge: false }>()
      : { data: [] as EventRow[], error: null },
  ]);
  if (m.error) throw m.error;
  if (e.error) throw e.error;
  const messages = new Map((m.data ?? []).map((row) => [row.id, row]));
  const events = new Map((e.data ?? []).map((row) => [row.id, row]));

  const data: unknown[] = [];
  const sources: Source[] = [];
  for (const key of ranked) {
    const chunk = bestChunk.get(key);
    const matchedBy = chunk ? 'meaning' : 'keywords';
    const id = key.slice(key.indexOf(':') + 1);
    const message = messages.get(id);
    if (key.startsWith('message:') && message) {
      const title = message.subject ?? message.snippet ?? '(no subject)';
      data.push({
        kind: message.connected_accounts.account_type === 'slack' ? 'slack' : 'email',
        id,
        subject: message.subject,
        from: message.from_person?.display_name ?? message.from_person?.email ?? null,
        sentAt: message.sent_at,
        matchedBy,
        excerpt: (chunk?.content ?? message.body_text ?? message.snippet ?? '').slice(
          0,
          EXCERPT_LENGTH,
        ),
      });
      sources.push({
        kind: 'message',
        id,
        title,
        timestamp: message.sent_at,
        provider: message.connected_accounts.provider,
      });
    }
    const event = events.get(id);
    if (key.startsWith('event:') && event) {
      data.push({
        kind: 'event',
        id,
        title: event.title,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        location: event.location,
        matchedBy,
        excerpt: (chunk?.content ?? event.description ?? '').slice(0, EXCERPT_LENGTH),
      });
      sources.push({
        kind: 'event',
        id,
        title: event.title ?? '(untitled)',
        timestamp: event.starts_at,
        provider: event.connected_accounts.provider,
      });
    }
  }
  return { data, sources };
}
