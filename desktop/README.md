# Mimus desktop

A Tauri 2 shell around the web app (`https://getmimus.io` by default). It adds a tray icon,
native meeting reminders, and deep-link sign-in.

## Sign-in

The webview appends `MimusDesktop/<version>` to its user agent (`src-tauri/src/user_agent.rs`,
matched by `src/lib/desktop.ts`). The sign-in form then sends the magic link to `/auth/desktop`.
That route runs in the system browser and only relays the PKCE code to
`mimus://auth/callback?code=…`.

The app maps that link to `<base>/auth/callback?code=…` (`src-tauri/src/deeplink.rs`) and loads
it in the webview. The webview holds the code verifier, so the sign-in completes there and lands
on Sky.

Every Supabase project the app signs in against must allow `<site>/auth/desktop` as a redirect
URL.

## Develop

Linux and WSL need the system packages from https://v2.tauri.app/start/prerequisites/
(`libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`,
`libxdo-dev`, `build-essential`).

```sh
cd desktop && npm ci
MIMUS_URL=http://localhost:3000 npm run dev   # against `next dev`
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
npm run build                                 # installers in src-tauri/target/release/bundle
```

`MIMUS_URL` is read at compile time and defaults to production. The remote capability
(`src-tauri/capabilities/remote-notifications.json`) grants the web app the notification
permissions and nothing else.

## Builds and signing

`.github/workflows/desktop.yml` builds a universal macOS `.dmg` and a Windows `.msi` and NSIS
`.exe` as workflow artifacts. They are unsigned until an Apple Developer ID and a Windows
code-signing certificate are provided. The workflow has the signing env commented out, ready for
them.
