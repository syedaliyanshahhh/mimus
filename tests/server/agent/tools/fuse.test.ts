import { fuse } from '@/src/server/agent/tools/semanticSearch';
import { describe, expect, it } from 'vitest';

describe('fuse (reciprocal rank fusion)', () => {
  it('ranks a source both lists found above ones only one list found', () => {
    expect(
      fuse([
        ['message:a', 'message:b'],
        ['event:c', 'message:b'],
      ]),
    ).toEqual(['message:b', 'message:a', 'event:c']);
  });

  it('keeps each source once', () => {
    expect(fuse([['message:a'], ['message:a']])).toEqual(['message:a']);
  });

  it('handles empty lists', () => {
    expect(fuse([[], []])).toEqual([]);
  });
});
