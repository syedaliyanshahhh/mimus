import { createServiceClient } from '@/src/db/service';
import { EMBEDDING_DIMENSIONS, type Embedder } from '@/src/server/rag/embedder';
import { embedPending } from '@/src/server/rag/embedPending';
import { upsertEvent, upsertMessage } from '@/src/server/shared/normalize';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The embeddings API is the paid boundary, so it's faked: each text gets a
// deterministic vector, and every call's inputs are recorded.
function fakeEmbedder() {
  const calls: string[][] = [];
  const embedder: Embedder = {
    async embed(texts) {
      calls.push(texts);
      return texts.map((text) => {
        const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
        v[text.length % EMBEDDING_DIMENSIONS] = 1;
        return v;
      });
    },
  };
  return { embedder, calls };
}

describe('embedPending', () => {
  const service = createServiceClient();
  const ownerId = randomUUID();
  let companyId: string;
  let workspaceId: string;
  let accountId: string;
  let fake: ReturnType<typeof fakeEmbedder>;

  const lease = {
    providerMessageId: 'lease-1',
    subject: 'Lease extension',
    bodyText: 'We can extend the lease by twelve months at the same rent.',
    direction: 'inbound' as const,
    sentAt: '2026-11-20T10:00:00Z',
    from: { email: 'dana@example.com', displayName: 'Dana Landlord' },
  };
  const walkthrough = {
    providerEventId: 'walk-1',
    title: 'Lease walkthrough',
    description: 'Bring the addendum.',
    startsAt: '2026-11-27T15:00:00Z',
    endsAt: '2026-11-27T16:00:00Z',
    attendees: [{ person: { email: 'dana@example.com', displayName: 'Dana Landlord' } }],
  };

  async function chunksFor(column: 'message_id' | 'event_id', id: string) {
    const { data } = await service
      .from('content_chunks')
      .select('content, chunk_index, workspace_id, connected_account_id')
      .eq(column, id)
      .order('chunk_index')
      .throwOnError();
    return data ?? [];
  }

  beforeAll(async () => {
    const { error } = await service.auth.admin.createUser({
      id: ownerId,
      email: `${ownerId}@example.com`,
      email_confirm: true,
    });
    if (error) throw error;
    const { data: company } = await service
      .from('companies')
      .insert({ name: 'RAG test co' })
      .select('id')
      .single()
      .throwOnError();
    companyId = company!.id;
    const { data: workspace } = await service
      .from('workspaces')
      .insert({ company_id: companyId, name: 'RAG test ws' })
      .select('id')
      .single()
      .throwOnError();
    workspaceId = workspace!.id;
    await service
      .from('workspace_members')
      .insert({ workspace_id: workspaceId, user_id: ownerId, role: 'owner' })
      .throwOnError();
    const { data: account } = await service
      .from('connected_accounts')
      .insert({
        workspace_id: workspaceId,
        owner_user_id: ownerId,
        provider: 'google',
        account_type: 'email',
        visibility: 'private',
        external_account_id: `${ownerId}@example.com`,
      })
      .select('id')
      .single()
      .throwOnError();
    accountId = account!.id;
  });

  afterAll(async () => {
    await service.from('companies').delete().eq('id', companyId);
    await service.auth.admin.deleteUser(ownerId);
  });

  beforeEach(() => {
    fake = fakeEmbedder();
  });

  it('embeds messages and events that have no chunks yet', async () => {
    const messageId = await upsertMessage(workspaceId, accountId, lease);
    const eventId = await upsertEvent(workspaceId, accountId, walkthrough);

    const result = await embedPending({ embedder: fake.embedder, connectedAccountId: accountId });

    expect(result).toEqual({ sources: 2, chunks: 2 });
    const [messageChunk] = await chunksFor('message_id', messageId);
    expect(messageChunk.content).toContain('Subject: Lease extension');
    expect(messageChunk.content).toContain('Dana Landlord');
    expect(messageChunk.workspace_id).toBe(workspaceId);
    expect(messageChunk.connected_account_id).toBe(accountId);
    const [eventChunk] = await chunksFor('event_id', eventId);
    expect(eventChunk.content).toContain('Calendar event: Lease walkthrough');
    expect(eventChunk.content).toContain('Attendees: Dana Landlord');
  });

  it('does nothing on a rerun', async () => {
    const result = await embedPending({ embedder: fake.embedder, connectedAccountId: accountId });
    expect(result).toEqual({ sources: 0, chunks: 0 });
    expect(fake.calls).toEqual([]);
  });

  it('keeps chunks when a source is re-synced unchanged', async () => {
    const messageId = await upsertMessage(workspaceId, accountId, lease);
    await upsertEvent(workspaceId, accountId, walkthrough);
    expect(await chunksFor('message_id', messageId)).toHaveLength(1);

    const result = await embedPending({ embedder: fake.embedder, connectedAccountId: accountId });
    expect(result.sources).toBe(0);
  });

  it('re-embeds a message whose content changed', async () => {
    const messageId = await upsertMessage(workspaceId, accountId, {
      ...lease,
      bodyText: 'Actually, the rent goes up 5% on renewal.',
    });
    expect(await chunksFor('message_id', messageId)).toEqual([]);

    const result = await embedPending({ embedder: fake.embedder, connectedAccountId: accountId });
    expect(result).toEqual({ sources: 1, chunks: 1 });
    const [chunk] = await chunksFor('message_id', messageId);
    expect(chunk.content).toContain('rent goes up 5%');
  });

  it('re-embeds an event whose details changed', async () => {
    const eventId = await upsertEvent(workspaceId, accountId, {
      ...walkthrough,
      location: '12 Main St',
    });
    expect(await chunksFor('event_id', eventId)).toEqual([]);

    await embedPending({ embedder: fake.embedder, connectedAccountId: accountId });
    const [chunk] = await chunksFor('event_id', eventId);
    expect(chunk.content).toContain('Where: 12 Main St');
  });

  it('stores one chunk per window of a long message, in order', async () => {
    const messageId = await upsertMessage(workspaceId, accountId, {
      ...lease,
      providerMessageId: 'long-1',
      bodyText: 'renewal terms paragraph '.repeat(400),
    });
    await embedPending({ embedder: fake.embedder, connectedAccountId: accountId });
    const chunks = await chunksFor('message_id', messageId);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.chunk_index)).toEqual(chunks.map((_, i) => i));
  });

  it('sends texts to the embedder in bounded batches', async () => {
    for (let i = 0; i < 5; i++) {
      await upsertMessage(workspaceId, accountId, {
        ...lease,
        providerMessageId: `batch-${i}`,
        bodyText: `note ${i}`,
      });
    }
    const result = await embedPending({
      embedder: fake.embedder,
      connectedAccountId: accountId,
      batchSize: 2,
    });
    expect(result).toEqual({ sources: 5, chunks: 5 });
    expect(fake.calls.map((c) => c.length)).toEqual([2, 2, 1]);
  });

  it('stops at maxSources and leaves the rest for the next run', async () => {
    for (let i = 0; i < 3; i++) {
      await upsertMessage(workspaceId, accountId, {
        ...lease,
        providerMessageId: `cap-${i}`,
        bodyText: `capped ${i}`,
      });
    }
    const first = await embedPending({
      embedder: fake.embedder,
      connectedAccountId: accountId,
      maxSources: 2,
    });
    expect(first.sources).toBe(2);
    const second = await embedPending({ embedder: fake.embedder, connectedAccountId: accountId });
    expect(second.sources).toBe(1);
  });
});
