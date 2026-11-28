/// Must match `DESKTOP_UA_MARKER` in the web app (src/lib/desktop.ts), which
/// switches magic links to the mimus:// relay and turns on reminders.
pub const MARKER: &str = "MimusDesktop";

/// Tauri can only replace the webview's user agent, not append to it, so
/// this is a full browser-like string per platform with the marker on the
/// end. Sites (Google sign-in among them) sniff the browser part.
pub fn desktop_user_agent() -> String {
    let platform = if cfg!(target_os = "macos") {
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
    } else if cfg!(windows) {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"
    } else {
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
    };
    format!("{platform} {MARKER}/{}", env!("CARGO_PKG_VERSION"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ends_with_the_marker_the_web_app_looks_for() {
        let ua = desktop_user_agent();
        assert!(ua.starts_with("Mozilla/5.0 "));
        assert!(ua.ends_with(&format!(" MimusDesktop/{}", env!("CARGO_PKG_VERSION"))));
    }
}
