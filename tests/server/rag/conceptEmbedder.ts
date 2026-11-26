import { EMBEDDING_DIMENSIONS, type Embedder } from '@/src/server/rag/embedder';

// A stand-in for the paid embeddings API that still behaves like one: words
// that mean the same thing land on the same axis, so "tenancy" finds a mail
// about a "lease" though the two share no keyword. Text with none of these
// words lands on an axis of its own (picked by hashing the text), so it
// matches nothing else.
const CONCEPTS: string[][] = [
  ['lease', 'leased', 'tenancy', 'rental', 'rent', 'apartment', 'landlord'],
  ['acquisition', 'merger', 'buyout', 'acquire'],
  ['invoice', 'payment', 'billing'],
];

export function conceptVector(text: string): number[] {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const v: number[] = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  CONCEPTS.forEach((synonyms, axis) => {
    if (words.some((word) => synonyms.includes(word))) v[axis] = 1;
  });
  if (!v.includes(1)) v[ownAxis(text)] = 1;
  return v;
}

export function conceptEmbedder(): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async embed(texts) {
      calls.push(texts);
      return texts.map(conceptVector);
    },
  };
}

function ownAxis(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CONCEPTS.length + (hash % (EMBEDDING_DIMENSIONS - CONCEPTS.length));
}
