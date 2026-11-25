// Lamio pour Mac et pour iPhone : une fenêtre qui ouvre le Lamio en ligne.
//
// L'app n'embarque qu'une page d'attente (ui/index.html) : elle vérifie que le serveur répond, puis
// lui passe la fenêtre. Une mise à jour du serveur met donc à jour l'app. Si le serveur est
// injoignable, la page le dit et réessaie, au lieu de laisser une fenêtre blanche.
// Pour viser un autre serveur : LAMIO_URL=https://… npm run build
use tauri::{webview::NewWindowResponse, AppHandle, Runtime, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const DEFAULT_URL: &str = "https://lamio.postmelo.ch";

/// Chosen when the app is built, so a double-clicked app needs no settings.
fn home() -> Url {
    option_env!("LAMIO_URL")
        .and_then(|url| url.parse().ok())
        .unwrap_or_else(|| DEFAULT_URL.parse().expect("adresse par défaut valide"))
}

/// The Compte Postmelo, where the sign-in happens: it stays in the window, so the session lands in the app.
/// Pour un autre service de compte : COMPTE_URL=https://… npm run build
const DEFAULT_ACCOUNT_URL: &str = "https://compte.postmelo.ch";

fn account_host() -> Option<String> {
    option_env!("COMPTE_URL")
        .unwrap_or(DEFAULT_ACCOUNT_URL)
        .parse::<Url>()
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
}

/// Through the plugin instance: on the iPhone it asks iOS to open the link (Safari, Mail). The plain
/// `tauri_plugin_opener::open_url` function starts a process, which an iPhone app may not do.
fn open_in_browser<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// On the iPhone a link can't ask for a new tab (no `on_new_window` there): such links are sent
/// through the window instead, where `on_navigation` hands them to the browser.
#[cfg(mobile)]
const SAME_WINDOW_LINKS: &str = r#"
(() => {
  window.open = (url) => { if (url) window.location.assign(url); return null; };
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[target=_blank]") : null;
    if (!link || !link.href || event.defaultPrevented) return;
    event.preventDefault();
    window.location.assign(link.href);
  });
})();
"#;

/// iPhone push notifications. The native side (main.mm) asks iOS for permission and for the device's
/// push token, then hands it to `lamio_push_token_ready`. The token is given to the Lamio page, which
/// registers it with the server (/api/push/devices) under the signed-in account. The window loads a
/// remote site and has no access to app commands, so the token goes in as a script, not through IPC.
#[cfg(target_os = "ios")]
mod push {
    use std::ffi::{c_char, CStr};
    use std::sync::{Mutex, OnceLock};
    use tauri::{AppHandle, Manager, Wry};

    static TOKEN: Mutex<Option<String>> = Mutex::new(None);
    static APP: OnceLock<AppHandle<Wry>> = OnceLock::new();

    pub fn script() -> Option<String> {
        let token = TOKEN.lock().ok()?.clone()?;
        // Hexadecimal only, so it can't break out of the string.
        if !token.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        Some(format!("window.__LAMIO_PUSH_TOKEN__ = \"{token}\"; window.dispatchEvent(new Event(\"lamio-push-token\"));"))
    }

    pub fn attach(app: &AppHandle<Wry>) {
        let _ = APP.set(app.clone());
    }

    /// Called by main.mm once iOS has given the token (on every launch, it may change).
    #[no_mangle]
    pub extern "C" fn lamio_push_token_ready(token: *const c_char) {
        if token.is_null() {
            return;
        }
        let token = unsafe { CStr::from_ptr(token) }.to_string_lossy().to_lowercase();
        if let Ok(mut slot) = TOKEN.lock() {
            *slot = Some(token);
        }
        if let (Some(app), Some(js)) = (APP.get(), script()) {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(&js);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    // Mac notifications: the plugin gives the window the browser's Notification interface, so Lamio's
    // own code (a message, a new mail) shows a real Mac notification.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_notification::init());
    builder
        .setup(|app| {
            let home = home();
            let host = home.host_str().map(str::to_owned);
            let account = account_host();
            // Lamio itself (and only Lamio) may notify and set the count on the Dock icon.
            #[cfg(desktop)]
            {
                use tauri::{ipc::CapabilityBuilder, Manager};
                let mut site = home.clone();
                site.set_path("/*");
                app.add_capability(
                    CapabilityBuilder::new("lamio-site")
                        .remote(site.to_string())
                        .window("main")
                        .permission("notification:default")
                        .permission("core:window:allow-set-badge-count"),
                )?;
            }
            #[cfg(target_os = "ios")]
            push::attach(app.handle());
            let for_new_window = app.handle().clone();
            let for_navigation = app.handle().clone();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()));
            #[cfg(mobile)]
            let builder = builder.initialization_script(SAME_WINDOW_LINKS);
            // On the iPhone the window is the whole screen: a size would shrink it.
            #[cfg(desktop)]
            let builder = builder.inner_size(1240.0, 820.0).min_inner_size(420.0, 560.0);
            // Each time a Lamio page has loaded, it gets the push token if iOS already gave one.
            #[cfg(target_os = "ios")]
            let builder = {
                let lamio = host.clone();
                builder.on_page_load(move |window, payload| {
                    let on_lamio = payload.url().host_str().map(str::to_owned) == lamio;
                    if on_lamio && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                        if let Some(js) = push::script() {
                            let _ = window.eval(&js);
                        }
                    }
                })
            };
            builder
                .title("Lamio")
                // Tells the waiting page which server to reach.
                .initialization_script(format!("window.__LAMIO_URL__ = {:?};", home.as_str()))
                // Links that ask for a new tab (Cairn, Metricove, a link in a message) go to the browser.
                .on_new_window(move |url, _features| {
                    open_in_browser(&for_new_window, &url);
                    NewWindowResponse::Deny
                })
                // The window itself never leaves Lamio, except to sign in with the Compte Postmelo.
                .on_navigation(move |url| {
                    // The waiting page is served by the app itself (tauri://localhost).
                    let target = url.host_str().map(str::to_owned);
                    let inside = matches!(url.scheme(), "about" | "tauri") || target == host || (target.is_some() && target == account);
                    if !inside {
                        open_in_browser(&for_navigation, url);
                    }
                    inside
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Lamio n'a pas pu démarrer");
}
