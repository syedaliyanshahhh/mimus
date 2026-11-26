// Turns a message or event into the text chunks that get embedded. Every
// chunk repeats a short header (who, what, when), so a chunk from the middle
// of a long email still says which email it came from. The header also
// means a source always yields at least one chunk -- otherwise an empty
// message would stay "needs embedding" forever.

const BODY_WINDOW = 2000;
const BODY_OVERLAP = 200;
const MAX_CHUNKS = 8;

export interface SplitOptions {
  size: number;
  overlap: number;
  max: number;
}

// Overlapping windows of at most `size` characters, breaking on whitespace
// when there is any in the second half of the window.
export function splitText(text: string, { size, overlap, max }: SplitOptions): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  const pieces: string[] = [];
  let start = 0;
  while (start < clean.length && pieces.length < max) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const space = clean.lastIndexOf(' ', end);
      if (space > start + size / 2) end = space;
    }
    pieces.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    let next = Math.max(end - overlap, start + 1);
    // Start the next window on a word boundary.
    if (next > start && clean[next - 1] !== ' ') {
      const space = clean.indexOf(' ', next);
      next = space === -1 || space >= end ? end : space + 1;
    }
    start = next;
    while (clean[start] === ' ') start++;
  }
  return pieces;
}

function withHeader(header: string, body: string | null | undefined): string[] {
  const windows = splitText(body ?? '', {
    size: BODY_WINDOW,
    overlap: BODY_OVERLAP,
    max: MAX_CHUNKS,
  });
  if (windows.length === 0) return [header];
  return windows.map((window) => `${header}\n\n${window}`);
}

export interface ChunkableMessage {
  provider: string;
  subject: string | null;
  fromName: string | null;
  fromEmail: string | null;
  sentAt: string | null;
  bodyText: string | null;
  snippet: string | null;
}

export function messageChunks(message: ChunkableMessage): string[] {
  const kind = message.provider === 'slack' ? 'Slack message' : 'Email';
  const from =
    message.fromName && message.fromEmail
      ? `${message.fromName} <${message.fromEmail}>`
      : (message.fromName ?? message.fromEmail);
  const lines = [from ? `${kind} from ${from}` : kind];
  if (message.subject) lines.push(`Subject: ${message.subject}`);
  if (message.sentAt) lines.push(`Sent: ${message.sentAt}`);
  return withHeader(lines.join('\n'), message.bodyText || message.snippet);
}

export interface ChunkableEvent {
  title: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  attendees: string[];
  description: string | null;
}

export function eventChunks(event: ChunkableEvent): string[] {
  const lines = [`Calendar event: ${event.title ?? '(untitled)'}`];
  lines.push(
    event.allDay
      ? `When: ${event.startsAt.slice(0, 10)} (all day)`
      : `When: ${event.startsAt} to ${event.endsAt}`,
  );
  if (event.location) lines.push(`Where: ${event.location}`);
  if (event.attendees.length) lines.push(`Attendees: ${event.attendees.join(', ')}`);
  return withHeader(lines.join('\n'), event.description);
}
