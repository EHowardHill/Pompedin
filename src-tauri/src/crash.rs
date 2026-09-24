// crash.rs — local-only crash reporting. Uncaught JS errors (via the
// log_crash command) and Rust panics (via install_panic_hook) are
// appended to <data-dir>/crash-reports/crash-log.txt. Nothing is ever
// sent anywhere; sharing the file is the user's explicit choice
// (About → Crash Reports).

use crate::data_dir;
use chrono::Local;
use std::fs;
use std::path::PathBuf;

fn crash_reports_dir(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("crash-reports")
}

/// Append a crash entry to the local crash log and set the pending flag.
/// Reports stay on the user's machine — nothing is ever sent anywhere
/// unless the user explicitly shares the file (About → Crash Reports).
fn append_crash(app: &tauri::AppHandle, kind: &str, message: &str) {
    let dir = crash_reports_dir(app);
    if fs::create_dir_all(&dir).is_err() {
        return; // best effort — never crash the crash reporter
    }
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S");
    let entry = format!("[{ts}] ({kind}) {message}\n");
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("crash-log.txt"))
        .and_then(|mut f| std::io::Write::write_all(&mut f, entry.as_bytes()));
    let _ = fs::write(dir.join("pending.flag"), "1");
}

/// Record a JS-side crash (uncaught error / unhandled rejection).
#[tauri::command]
pub(crate) fn log_crash(app: tauri::AppHandle, message: String) {
    append_crash(&app, "js", &message);
}

/// True (and clears the flag) when the previous session recorded a
/// crash — lets the UI mention it once on the next launch.
#[tauri::command]
pub(crate) fn consume_crash_flag(app: tauri::AppHandle) -> bool {
    let flag = crash_reports_dir(&app).join("pending.flag");
    if flag.exists() {
        let _ = fs::remove_file(&flag);
        true
    } else {
        false
    }
}

/// Open the crash-reports folder in the system file manager.
#[tauri::command]
pub(crate) fn open_crash_reports(app: tauri::AppHandle) -> Result<(), String> {
    let dir = crash_reports_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create crash dir: {e}"))?;
    open::that(&dir).map_err(|e| format!("Failed to open crash reports folder: {e}"))
}

/// Forward Rust panics into the same local crash log.
pub(crate) fn install_panic_hook(app: tauri::AppHandle) {
    std::panic::set_hook(Box::new(move |info| {
        let msg = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic".to_string()
        };
        let location = info
            .location()
            .map(|l| format!(" at {}:{}", l.file(), l.line()))
            .unwrap_or_default();
        append_crash(&app, "rust-panic", &format!("panic: {msg}{location}"));
    }));
}
