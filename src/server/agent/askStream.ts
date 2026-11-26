// What POST /api/agent/ask streams: one JSON event per line (NDJSON).
// `done` carries the authoritative result; `error` ends a failed run with a
// generic message (the real error goes to onError, never to the client).
export type AskStreamEvent<Event, Result> =
  Event | { type: 'done'; result: Result } | { type: 'error'; error: string };

export function askEventStream<Event, Result>(
  run: (onEvent: (event: Event) => void) => Promise<Result>,
  onError: (err: unknown) => void = () => undefined,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const write = (event: AskStreamEvent<Event, Result>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        write({ type: 'done', result: await run(write) });
      } catch (err) {
        onError(err);
        write({ type: 'error', error: 'Mimus could not answer right now' });
      }
      controller.close();
    },
  });
}
