import { expect, test } from '@playwright/test';
import { DESKTOP_UA_MARKER } from '@/src/lib/desktop';
import {
  acceptTermsOnPage,
  clearMailbox,
  completeOnboardingOnPage,
  latestMagicLink,
} from './helpers';

// The desktop app (desktop/) is a webview with this marker in its user
// agent. Its magic link opens in the system browser, which relays the PKCE
// code back through mimus://; the Tauri shell then loads /auth/callback
// with that code in the webview, which holds the code verifier.
test.describe('desktop sign-in', () => {
  test.use({ userAgent: `Mozilla/5.0 AppleWebKit/537.36 ${DESKTOP_UA_MARKER}/0.1.0` });

  test('the magic link relays the code to mimus:// and the webview lands on Sky', async ({
    page,
    browser,
  }) => {
    const email = `e2e-desktop-${Date.now()}@example.com`;
    await clearMailbox();

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: /send magic link/i }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible();

    const link = await latestMagicLink(email);
    expect(new URL(link).searchParams.get('redirect_to')).toMatch(/\/auth\/desktop$/);

    // The system browser: a separate context with no verifier cookie.
    const systemBrowser = await browser.newContext();
    const browserPage = await systemBrowser.newPage();
    // The relay page then tries to open mimus://, which headless Chromium
    // has no handler for; read the link the page offers instead.
    await browserPage.goto(link, { waitUntil: 'commit' });
    await browserPage.waitForURL((url) => url.pathname === '/auth/desktop');
    const deepLink = await browserPage
      .getByRole('link', { name: /open mimus/i })
      .getAttribute('href');
    await systemBrowser.close();

    const relayed = new URL(deepLink!);
    expect(relayed.protocol).toBe('mimus:');
    const code = relayed.searchParams.get('code');
    expect(code).toBeTruthy();

    // What the Tauri shell does with it (desktop/src-tauri/src/deeplink.rs).
    await page.goto(`/auth/callback?code=${encodeURIComponent(code!)}`);
    await page.waitForURL((url) => url.pathname !== '/' && !url.pathname.startsWith('/auth/'));
    if (new URL(page.url()).pathname === '/accept-terms') await acceptTermsOnPage(page);
    if (new URL(page.url()).pathname === '/onboarding') {
      await completeOnboardingOnPage(page, `Company of ${email}`);
    }
    await expect(page).toHaveURL(/\/sky$/);
    await expect(page.getByRole('heading', { name: /good morning/i })).toBeVisible();
  });
});

test('a plain browser still signs in through /auth/callback', async ({ page }) => {
  const email = `e2e-web-${Date.now()}@example.com`;
  await clearMailbox();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /send magic link/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();

  const link = await latestMagicLink(email);
  expect(new URL(link).searchParams.get('redirect_to')).toMatch(/\/auth\/callback$/);
});
