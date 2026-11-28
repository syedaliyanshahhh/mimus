mod deeplink;
mod user_agent;

pub use deeplink::callback_target;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

const MAIN: &str = "main";

/// The web app this shell loads. Production unless built with
/// `MIMUS_URL=https://dev.getmimus.io` (or `http://localhost:3000`).
fn base_url() -> Url {
    Url::parse(option_env!("MIMUS_URL").unwrap_or("https://getmimus.io"))
        .expect("MIMUS_URL must be an absolute URL")
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

fn show(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn navigate(app: &AppHandle, url: Url) {
    if let Some(window) = main_window(app) {
        let _ = window.navigate(url);
    }
    show(app);
}

/// A `mimus://auth/callback?code=…` link finishes sign-in in the webview,
/// which holds the PKCE verifier. Anything else just brings the app forward.
fn handle_deep_links(app: &AppHandle, urls: &[Url]) {
    let base = base_url();
    match urls
        .iter()
        .find_map(|url| callback_target(url.as_str(), &base))
    {
        Some(target) => navigate(app, target),
        None => show(app),
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_sky = MenuItem::with_id(app, "sky", "Open Sky", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Show/Hide Mimus", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Mimus", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open_sky, &toggle, &separator, &quit])?;

    TrayIconBuilder::with_id("mimus")
        .icon(app.default_window_icon().expect("bundle icon").clone())
        .tooltip("Mimus")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "sky" => {
                if let Ok(sky) = base_url().join("/sky") {
                    navigate(app, sky);
                }
            }
            "toggle" => match main_window(app) {
                Some(window) if window.is_visible().unwrap_or(false) => {
                    let _ = window.hide();
                }
                _ => show(app),
            },
            "quit" => app.exit(0),
            _ => {}
        })
        // Left click brings the window back (not reported on Linux, where
        // the menu is the way in).
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be the first plugin. With its deep-link feature, a mimus:// link
    // that launches a second process (Windows, Linux) is forwarded to the
    // running app's on_open_url handler instead.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show(app);
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let base = base_url();

            let opener = handle.clone();
            let window =
                WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(base.join("/sky")?))
                    .title("Mimus")
                    .inner_size(1280.0, 840.0)
                    .min_inner_size(720.0, 520.0)
                    .user_agent(&user_agent::desktop_user_agent())
                    // target="_blank" links (meeting links, docs) open in the
                    // system browser, not a second app window.
                    .on_new_window(move |url, _features| {
                        let _ = opener.opener().open_url(url.as_str(), None::<&str>);
                        tauri::webview::NewWindowResponse::Deny
                    })
                    .build()?;

            // Closing the window keeps Mimus in the tray, so reminders keep
            // coming; Quit is in the tray menu.
            let hide = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hide.hide();
                }
            });

            build_tray(&handle)?;

            // macOS registers the scheme from the bundle's Info.plist; the
            // installers do it on Windows and Linux, but a dev build has to.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            app.deep_link().register_all()?;

            if let Some(urls) = app.deep_link().get_current()? {
                handle_deep_links(&handle, &urls);
            }
            let links = handle.clone();
            app.deep_link()
                .on_open_url(move |event| handle_deep_links(&links, &event.urls()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Mimus desktop app");
}
