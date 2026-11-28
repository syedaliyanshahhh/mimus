import { DESKTOP_UA_MARKER, isDesktopUserAgent } from '@/src/lib/desktop';
import { describe, expect, it } from 'vitest';

describe('isDesktopUserAgent', () => {
  it('recognises the marker the Tauri window appends', () => {
    expect(
      isDesktopUserAgent(
        `Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 ${DESKTOP_UA_MARKER}/0.1.0`,
      ),
    ).toBe(true);
  });

  it('is false for ordinary browsers and a missing header', () => {
    expect(isDesktopUserAgent('Mozilla/5.0 (Macintosh) Safari/605.1.15')).toBe(false);
    expect(isDesktopUserAgent(null)).toBe(false);
    expect(isDesktopUserAgent(undefined)).toBe(false);
  });
});
