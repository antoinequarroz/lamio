// Lamio pour Mac : une fenêtre qui ouvre le Lamio en ligne.
//
// L'app n'embarque qu'une page d'attente (ui/index.html) : elle vérifie que le serveur répond, puis
// lui passe la fenêtre. Une mise à jour du serveur met donc à jour l'app. Si le serveur est
// injoignable, la page le dit et réessaie, au lieu de laisser une fenêtre blanche.
// Pour viser un autre serveur : LAMIO_URL=https://… npm run build
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{webview::NewWindowResponse, Url, WebviewUrl, WebviewWindowBuilder};

const DEFAULT_URL: &str = "https://lamio.antoinequarroz.ch";

/// Chosen when the app is built, so a double-clicked app needs no settings.
fn home() -> Url {
    option_env!("LAMIO_URL")
        .and_then(|url| url.parse().ok())
        .unwrap_or_else(|| DEFAULT_URL.parse().expect("adresse par défaut valide"))
}

fn open_in_browser(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let home = home();
            let host = home.host_str().map(str::to_owned);
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Lamio")
                // Tells the waiting page which server to reach.
                .initialization_script(format!("window.__LAMIO_URL__ = {:?};", home.as_str()))
                .inner_size(1240.0, 820.0)
                .min_inner_size(420.0, 560.0)
                // Links that ask for a new tab (Cairn, Metricove, a link in a message) go to the browser.
                .on_new_window(|url, _features| {
                    open_in_browser(&url);
                    NewWindowResponse::Deny
                })
                // The window itself never leaves Lamio.
                .on_navigation(move |url| {
                    // The waiting page is served by the app itself (tauri://localhost).
                    let inside = matches!(url.scheme(), "about" | "tauri") || url.host_str().map(str::to_owned) == host;
                    if !inside {
                        open_in_browser(url);
                    }
                    inside
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Lamio n'a pas pu démarrer");
}
