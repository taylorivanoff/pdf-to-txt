mod commands;
mod host;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use serde_json::json;
use tauri_tray_base::{
    apply_window_settings, install_state, set_on_before_quit, setup_tray, sync_autostart,
    TrayBaseOptions, TraySetupOptions,
};

pub struct AppRuntime {
    pub cancelled: Arc<AtomicBool>,
    pub host: Arc<Mutex<host::PdfHost>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let host = Arc::new(Mutex::new(host::PdfHost::new()));
    let cancelled = Arc::new(AtomicBool::new(false));

    let builder = tauri_tray_base::with_common_plugins(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppRuntime {
            cancelled: cancelled.clone(),
            host: host.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            tauri_tray_base::settings_get,
            tauri_tray_base::settings_set,
            tauri_tray_base::app_get_state,
            commands::dialog_pick_pdfs,
            commands::dialog_pick_folder,
            commands::pdf_collect,
            commands::pdf_preview,
            commands::pdf_convert,
            commands::pdf_cancel,
            commands::shell_show_item,
            commands::shell_open_path,
        ])
        .setup(move |app| {
            let mut defaults = HashMap::new();
            defaults.insert("outDir".into(), json!(""));
            defaults.insert("openWhenDone".into(), json!(false));
            defaults.insert("opacity".into(), json!(0.94));
            defaults.insert("alwaysOnTop".into(), json!(false));
            defaults.insert("startMinimised".into(), json!(false));

            install_state(
                app.handle(),
                TrayBaseOptions {
                    app_name: "PDF to TXT".into(),
                    settings_file_name: "pdf-to-txt-settings.json".into(),
                    defaults,
                    ..Default::default()
                },
            )?;

            setup_tray(app.handle(), TraySetupOptions::default())?;
            apply_window_settings(app.handle());
            tauri_tray_base::enable_frameless_chrome(app.handle());
            sync_autostart(app.handle());

            let host_for_quit = host.clone();
            let cancelled_for_quit = cancelled.clone();
            set_on_before_quit(app.handle(), move || {
                cancelled_for_quit.store(true, Ordering::SeqCst);
                host_for_quit.lock().shutdown();
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            tauri_tray_base::on_window_event(window, event);
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running pdf-to-txt");
}
