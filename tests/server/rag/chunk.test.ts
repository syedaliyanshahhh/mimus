import { eventChunks, messageChunks, splitText } from '@/src/server/rag/chunk';
import { describe, expect, it } from 'vitest';

describe('splitText', () => {
  it('returns short text as one piece', () => {
    expect(splitText('hello world', { size: 100, overlap: 10, max: 8 })).toEqual(['hello world']);
  });

  it('returns nothing for blank text', () => {
    expect(splitText('  \n ', { size: 100, overlap: 10, max: 8 })).toEqual([]);
  });

  it('splits long text into overlapping windows that break on whitespace', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const pieces = splitText(words, { size: 100, overlap: 20, max: 20 });
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(100);
      expect(piece).toMatch(/^word\d+/);
      expect(piece).toMatch(/word\d+$/);
    }
    // Every word survives, and consecutive windows share some text.
    const joined = pieces.join(' ');
    for (let i = 0; i < 60; i++) expect(joined).toContain(`word${i}`);
    const lastOfFirst = pieces[0].split(' ').at(-1)!;
    expect(pieces[1]).toContain(lastOfFirst);
  });

  it('caps the number of pieces', () => {
    const text = 'x '.repeat(5000);
    expect(splitText(text, { size: 100, overlap: 10, max: 3 })).toHaveLength(3);
  });

  it('hard-splits a single word longer than the window', () => {
    const pieces = splitText('a'.repeat(250), { size: 100, overlap: 0, max: 8 });
    expect(pieces).toEqual(['a'.repeat(100), 'a'.repeat(100), 'a'.repeat(50)]);
  });
});

describe('messageChunks', () => {
  it('prefixes every chunk with who, what and when', () => {
    const chunks = messageChunks({
      provider: 'google',
      subject: 'Lease extension',
      fromName: 'Dana Landlord',
      fromEmail: 'dana@example.com',
      sentAt: '2026-11-20T10:00:00Z',
      bodyText: 'We can extend the lease by twelve months at the same rent.',
      snippet: null,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('Email from Dana Landlord <dana@example.com>');
    expect(chunks[0]).toContain('Subject: Lease extension');
    expect(chunks[0]).toContain('2026-11-20');
    expect(chunks[0]).toContain('extend the lease by twelve months');
  });

  it('labels Slack messages as Slack, and falls back to the snippet', () => {
    const [chunk] = messageChunks({
      provider: 'slack',
      subject: null,
      fromName: null,
      fromEmail: null,
      sentAt: null,
      bodyText: null,
      snippet: 'deploy is green',
    });
    expect(chunk).toContain('Slack message');
    expect(chunk).toContain('deploy is green');
  });

  it('always yields at least one chunk, even with no text at all', () => {
    const chunks = messageChunks({
      provider: 'google',
      subject: null,
      fromName: null,
      fromEmail: null,
      sentAt: null,
      bodyText: null,
      snippet: null,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].trim()).not.toBe('');
  });

  it('splits a long body into several chunks, each with the header', () => {
    const chunks = messageChunks({
      provider: 'google',
      subject: 'Long one',
      fromName: null,
      fromEmail: 'a@example.com',
      sentAt: null,
      bodyText: 'paragraph text '.repeat(600),
      snippet: null,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk).toContain('Subject: Long one');
  });
});

describe('eventChunks', () => {
  it('describes the event', () => {
    const [chunk] = eventChunks({
      title: 'Lease walkthrough',
      startsAt: '2026-11-27T15:00:00Z',
      endsAt: '2026-11-27T16:00:00Z',
      allDay: false,
      location: '12 Main St',
      attendees: ['Dana Landlord', 'bo@example.com'],
      description: 'Bring the signed addendum.',
    });
    expect(chunk).toContain('Calendar event: Lease walkthrough');
    expect(chunk).toContain('2026-11-27');
    expect(chunk).toContain('Where: 12 Main St');
    expect(chunk).toContain('Attendees: Dana Landlord, bo@example.com');
    expect(chunk).toContain('Bring the signed addendum.');
  });
});
