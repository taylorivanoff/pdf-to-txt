use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};

/// Persistent Node JSON-lines host for PDF extract/convert.
pub struct PdfHost {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    reader: Option<mpsc::Receiver<Result<String, String>>>,
    project_root: PathBuf,
}

impl PdfHost {
    pub fn new() -> Self {
        Self {
            child: None,
            stdin: None,
            reader: None,
            project_root: resolve_project_root(),
        }
    }

    pub fn ensure_started(&mut self) -> Result<(), String> {
        if self.child.is_some() {
            return Ok(());
        }
        let script = resolve_host_script(&self.project_root)?;
        let node = which::which("node").map_err(|_| {
            "Node.js not found on PATH. Install Node 18+ to run PDF extraction.".to_string()
        })?;

        let mut child = Command::new(node)
            .arg(&script)
            .current_dir(&self.project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to start PDF host: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "PDF host stdin missing".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "PDF host stdout missing".to_string())?;

        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        if tx.send(Ok(l)).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(format!("PDF host read error: {e}")));
                        break;
                    }
                }
            }
        });

        self.stdin = Some(stdin);
        self.reader = Some(rx);
        self.child = Some(child);
        Ok(())
    }

    pub fn request(&mut self, payload: Value) -> Result<Value, String> {
        self.ensure_started()?;
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| "PDF host not started".to_string())?;
        let reader = self
            .reader
            .as_ref()
            .ok_or_else(|| "PDF host reader missing".to_string())?;

        let line = format!("{payload}\n");
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("PDF host write failed: {e}"))?;
        stdin
            .flush()
            .map_err(|e| format!("PDF host flush failed: {e}"))?;

        let response = reader
            .recv_timeout(Duration::from_secs(120))
            .map_err(|_| "PDF host timed out waiting for response".to_string())??;

        serde_json::from_str(&response)
            .map_err(|e| format!("Invalid PDF host response: {e} ({response})"))
    }

    pub fn preview(&mut self, pdf_path: &str) -> Result<Value, String> {
        self.request(json!({ "op": "preview", "pdfPath": pdf_path }))
    }

    pub fn convert(&mut self, pdf_path: &str, out_path: &str) -> Result<Value, String> {
        self.request(json!({
            "op": "convert",
            "pdfPath": pdf_path,
            "outPath": out_path
        }))
    }

    pub fn shutdown(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.stdin = None;
        self.reader = None;
    }
}

impl Drop for PdfHost {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn resolve_project_root() -> PathBuf {
    // src-tauri/ → project root
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(manifest)
}

fn resolve_host_script(project_root: &Path) -> Result<PathBuf, String> {
    let candidates = [
        project_root.join("sidecar").join("host.mjs"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar").join("host.mjs"),
    ];
    for path in candidates {
        if path.is_file() {
            return Ok(path);
        }
    }
    Err(format!(
        "sidecar/host.mjs not found under {}",
        project_root.display()
    ))
}
