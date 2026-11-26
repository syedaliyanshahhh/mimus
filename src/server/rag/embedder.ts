import OpenAI from 'openai';

// Text -> vector, behind an interface so tests fake the paid API. The model
// and dimension must match content_chunks.embedding (migration 0029), and a
// query must be embedded with the same model as the chunks it's compared to.
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

export interface Embedder {
  // One vector per input, in input order.
  embed(texts: string[]): Promise<number[][]>;
}

export interface OpenAiEmbeddingsClient {
  embeddings: {
    create(params: OpenAI.EmbeddingCreateParams): Promise<OpenAI.CreateEmbeddingResponse>;
  };
}

export function createOpenAiEmbedder({
  client,
}: { client?: OpenAiEmbeddingsClient } = {}): Embedder {
  const api = client ?? defaultClient();
  return {
    async embed(texts) {
      if (texts.length === 0) return [];
      const response = await api.embeddings.create({
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        input: texts,
        encoding_format: 'float',
      });
      const vectors = new Array<number[]>(texts.length);
      for (const item of response.data) vectors[item.index] = item.embedding;
      // A plain loop: some() skips the holes a missing index leaves.
      for (let i = 0; i < vectors.length; i++) {
        if (vectors[i] !== undefined) continue;
        throw new Error('The embeddings response is missing a vector');
      }
      return vectors;
    },
  };
}

// pgvector's text input format, which PostgREST passes through.
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

function defaultClient(): OpenAiEmbeddingsClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey });
}
