use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;
use tauri_tray_base::{emit_to_renderer, save_settings, TrayBaseState};

use crate::AppRuntime;

#[tauri::command]
pub fn dialog_pick_pdfs(app: AppHandle) -> Result<Vec<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Choose PDF files")
        .add_filter("PDF", &["pdf"])
        .blocking_pick_files();

    Ok(match picked {
        Some(files) => files
            .into_iter()
            .filter_map(|f| file_path_to_string(f))
            .collect(),
        None => Vec::new(),
    })
}

#[tauri::command]
pub fn dialog_pick_folder(app: AppHandle, title: Option<String>) -> Result<Option<String>, String> {
    let title = title.unwrap_or_else(|| "Choose folder".into());
    let picked = app
        .dialog()
        .file()
        .set_title(title)
        .blocking_pick_folder();

    Ok(picked.and_then(file_path_to_string))
}

#[tauri::command]
pub fn pdf_collect(input_path: String) -> Result<Value, String> {
    match collect_pdfs(&input_path) {
        Ok(files) => Ok(json!({ "ok": true, "files": files })),
        Err(error) => Ok(json!({ "ok": false, "error": error })),
    }
}

#[tauri::command]
pub fn pdf_preview(runtime: State<'_, AppRuntime>, pdf_path: String) -> Result<Value, String> {
    let mut host = runtime.host.lock();
    match host.preview(&pdf_path) {
        Ok(value) => Ok(value),
        Err(error) => Ok(json!({ "ok": false, "error": error })),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertPayload {
    pub files: Vec<String>,
    pub out_dir: Option<String>,
}

#[tauri::command]
pub fn pdf_convert(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    tray: State<'_, TrayBaseState>,
    payload: ConvertPayload,
) -> Result<Value, String> {
    let files = payload.files;
    if files.is_empty() {
        return Ok(json!({ "ok": false, "error": "No PDF files selected." }));
    }

    runtime.cancelled.store(false, Ordering::SeqCst);

    let out_dir = resolve_out_dir(&app, &tray, payload.out_dir.as_deref())?;
    fs::create_dir_all(&out_dir).map_err(|e| format!("Could not create output folder: {e}"))?;

    {
        let mut settings = tray.settings.lock();
        settings.extra.insert(
            "outDir".into(),
            Value::String(out_dir.to_string_lossy().into_owned()),
        );
        let _ = save_settings(&tray.settings_path, &settings);
        emit_to_renderer(&app, "settings:changed", settings.to_value());
    }

    let mut results = Vec::new();
    let total = files.len();
    let mut cancelled = false;

    for (i, pdf_path) in files.iter().enumerate() {
        if runtime.cancelled.load(Ordering::SeqCst) {
            cancelled = true;
            results.push(json!({
                "pdfPath": pdf_path,
                "ok": false,
                "error": "Cancelled."
            }));
            emit_to_renderer(
                &app,
                "pdf:progress",
                json!({
                    "index": i,
                    "total": total,
                    "pdfPath": pdf_path,
                    "status": "cancelled"
                }),
            );
            break;
        }

        let out_path = default_out_path(pdf_path, &out_dir);
        emit_to_renderer(
            &app,
            "pdf:progress",
            json!({
                "index": i,
                "total": total,
                "pdfPath": pdf_path,
                "outPath": out_path,
                "status": "running"
            }),
        );

        let converted = {
            let mut host = runtime.host.lock();
            host.convert(pdf_path, &out_path)
        };

        match converted {
            Ok(value) if value.get("ok").and_then(|v| v.as_bool()) == Some(true) => {
                let pages = value.get("pages").cloned().unwrap_or(Value::Null);
                let bytes = value.get("bytes").cloned().unwrap_or(Value::Null);
                let out = value
                    .get("outPath")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&out_path)
                    .to_string();
                results.push(json!({
                    "ok": true,
                    "pdfPath": pdf_path,
                    "outPath": out,
                    "pages": pages,
                    "bytes": bytes
                }));
                emit_to_renderer(
                    &app,
                    "pdf:progress",
                    json!({
                        "index": i,
                        "total": total,
                        "pdfPath": pdf_path,
                        "outPath": out,
                        "pages": pages,
                        "bytes": bytes,
                        "status": "done"
                    }),
                );
            }
            Ok(value) => {
                let error = value
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Convert failed")
                    .to_string();
                results.push(json!({
                    "ok": false,
                    "pdfPath": pdf_path,
                    "outPath": out_path,
                    "error": error
                }));
                emit_to_renderer(
                    &app,
                    "pdf:progress",
                    json!({
                        "index": i,
                        "total": total,
                        "pdfPath": pdf_path,
                        "outPath": out_path,
                        "status": "error",
                        "error": error
                    }),
                );
            }
            Err(error) => {
                results.push(json!({
                    "ok": false,
                    "pdfPath": pdf_path,
                    "outPath": out_path,
                    "error": error
                }));
                emit_to_renderer(
                    &app,
                    "pdf:progress",
                    json!({
                        "index": i,
                        "total": total,
                        "pdfPath": pdf_path,
                        "outPath": out_path,
                        "status": "error",
                        "error": error
                    }),
                );
            }
        }
    }

    cancelled = cancelled || runtime.cancelled.load(Ordering::SeqCst);

    let open_when_done = tray
        .settings
        .lock()
        .extra
        .get("openWhenDone")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let any_ok = results.iter().any(|r| r.get("ok").and_then(|v| v.as_bool()) == Some(true));
    if open_when_done && any_ok {
        let _ = app.opener().open_path(out_dir.to_string_lossy().as_ref(), None::<&str>);
    }

    Ok(json!({
        "ok": true,
        "outDir": out_dir.to_string_lossy(),
        "results": results,
        "cancelled": cancelled
    }))
}

#[tauri::command]
pub fn pdf_cancel(runtime: State<'_, AppRuntime>) -> Value {
    runtime.cancelled.store(true, Ordering::SeqCst);
    json!({ "ok": true })
}

#[tauri::command]
pub fn shell_show_item(app: AppHandle, file_path: String) -> Result<(), String> {
    if file_path.is_empty() || !Path::new(&file_path).exists() {
        return Ok(());
    }
    app.opener()
        .reveal_item_in_dir(&file_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn shell_open_path(app: AppHandle, target_path: String) -> Value {
    if target_path.is_empty() {
        return json!({ "ok": false });
    }
    match app.opener().open_path(&target_path, None::<&str>) {
        Ok(()) => json!({ "ok": true, "error": null }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

fn file_path_to_string(path: FilePath) -> Option<String> {
    path.into_path()
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

fn collect_pdfs(input_path: &str) -> Result<Vec<String>, String> {
    let path = Path::new(input_path);
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.is_file() {
        if !input_path.to_ascii_lowercase().ends_with(".pdf") {
            return Err(format!("Not a PDF: {input_path}"));
        }
        return Ok(vec![path
            .canonicalize()
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy()
            .into_owned()]);
    }
    if !meta.is_dir() {
        return Err(format!("Not a file or directory: {input_path}"));
    }

    let mut files = Vec::new();
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        if entry_path.is_file() {
            if let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) {
                if name.to_ascii_lowercase().ends_with(".pdf") {
                    files.push(
                        entry_path
                            .canonicalize()
                            .unwrap_or(entry_path)
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
            }
        }
    }
    files.sort();
    Ok(files)
}

fn resolve_out_dir(
    app: &AppHandle,
    tray: &TrayBaseState,
    requested: Option<&str>,
) -> Result<PathBuf, String> {
    let settings_out = tray
        .settings
        .lock()
        .extra
        .get("outDir")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let chosen = requested
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or(settings_out);

    if let Some(dir) = chosen {
        return Ok(PathBuf::from(dir));
    }

    let documents = app
        .path()
        .document_dir()
        .map_err(|e| format!("Could not resolve Documents folder: {e}"))?;
    Ok(documents.join("PDF to TXT"))
}

fn default_out_path(pdf_path: &str, out_dir: &Path) -> String {
    let stem = Path::new(pdf_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    out_dir
        .join(format!("{stem}.txt"))
        .to_string_lossy()
        .into_owned()
}
