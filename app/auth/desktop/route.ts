import { NextResponse, type NextRequest } from 'next/server';

// The desktop app's magic links land here, in the system browser. The PKCE
// code verifier lives in the desktop webview, not this browser, so this
// route never exchanges the code -- it hands it to the app through the
// mimus:// scheme, and the app completes sign-in at /auth/callback. A code
// intercepted on the way is useless without that verifier.
export function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/sign-in?error=auth', request.url));
  }

  const link = `mimus://auth/callback?code=${encodeURIComponent(code)}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opening Mimus</title>
<style>
  body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #faf9f7; color: #1c1b19; }
  main { max-width: 22rem; padding: 1.5rem; text-align: center; }
  a { display: inline-block; margin-top: 1rem; padding: 0.6rem 1.2rem; border-radius: 0.5rem; background: #1c1b19; color: #fff; text-decoration: none; }
  @media (prefers-color-scheme: dark) { body { background: #151412; color: #f1efe9; } a { background: #f1efe9; color: #151412; } }
</style>
</head>
<body>
<main>
<h1>Finishing sign-in</h1>
<p>Your browser should ask to open the Mimus desktop app. If nothing happens, use the button.</p>
<a id="open" href="${link}">Open Mimus</a>
<p><small>You can close this tab afterwards.</small></p>
</main>
<script>window.location.href = document.getElementById('open').href;</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
