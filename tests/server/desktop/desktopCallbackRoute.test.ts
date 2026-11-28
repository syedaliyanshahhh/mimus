import { GET } from '@/app/auth/desktop/route';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

function get(query: string) {
  return GET(new NextRequest(`http://127.0.0.1:3000/auth/desktop${query}`));
}

describe('GET /auth/desktop', () => {
  it('relays the PKCE code to the desktop app without exchanging it', async () => {
    const res = await get('?code=abc-123');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');

    const html = await res.text();
    expect(html).toContain('href="mimus://auth/callback?code=abc-123"');
    expect(html).toMatch(/open mimus/i);
  });

  it('encodes the code so it cannot break out of the link', async () => {
    const html = await (await get(`?code=${encodeURIComponent('"><script>x</script>')}`)).text();
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain(
      `mimus://auth/callback?code=${encodeURIComponent('"><script>x</script>')}`,
    );
  });

  it('sends a link without a code back to sign-in', async () => {
    const res = await get('');
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/sign-in');
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('auth');
  });
});
