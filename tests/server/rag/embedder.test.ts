import {
  createOpenAiEmbedder,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  type OpenAiEmbeddingsClient,
  toVectorLiteral,
} from '@/src/server/rag/embedder';
import { describe, expect, it, vi } from 'vitest';

function fakeClient(data: Array<{ index: number; embedding: number[] }>) {
  const create = vi.fn().mockResolvedValue({ data, model: EMBEDDING_MODEL, object: 'list' });
  return { client: { embeddings: { create } } as unknown as OpenAiEmbeddingsClient, create };
}

describe('createOpenAiEmbedder', () => {
  it('asks for the model and dimension the database column expects', async () => {
    const { client, create } = fakeClient([{ index: 0, embedding: [1] }]);
    await createOpenAiEmbedder({ client }).embed(['hello']);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'text-embedding-3-small',
        dimensions: EMBEDDING_DIMENSIONS,
        input: ['hello'],
      }),
    );
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
  });

  it('returns vectors in input order, whatever order the API lists them in', async () => {
    const { client } = fakeClient([
      { index: 1, embedding: [2] },
      { index: 0, embedding: [1] },
    ]);
    expect(await createOpenAiEmbedder({ client }).embed(['a', 'b'])).toEqual([[1], [2]]);
  });

  it('fails loudly when a vector is missing', async () => {
    const { client } = fakeClient([{ index: 0, embedding: [1] }]);
    await expect(createOpenAiEmbedder({ client }).embed(['a', 'b'])).rejects.toThrow(/missing/);
  });

  it('skips the API call for no input', async () => {
    const { client, create } = fakeClient([]);
    expect(await createOpenAiEmbedder({ client }).embed([])).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('toVectorLiteral', () => {
  it('formats a pgvector literal', () => {
    expect(toVectorLiteral([0.5, -1, 2])).toBe('[0.5,-1,2]');
  });
});
