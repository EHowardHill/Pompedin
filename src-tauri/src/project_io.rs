// project_io.rs — project save/load with the data-safety layer:
// rolling backups (.bak1–.bak3) and atomic writes (temp file + rename),
// plus the autosave lifecycle (see 20-project-io.js / 24-init.js on the
// JS side).

use crate::projects_dir;
use chrono::Local;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub(crate) struct ProjectInfo {
    filename: String,
    modified: f64,
}

// ═══════════════════════════════════════════════════
//   PROJECT SAVE SAFETY
// ═══════════════════════════════════════════════════

/// Number of rolling backups kept next to each project file.
const PROJECT_BACKUPS: usize = 3;

/// Path of the Nth rolling backup for a project file (foo.json → foo.json.bakN).
pub(crate) fn backup_path(path: &Path, n: usize) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(format!(".bak{n}"));
    PathBuf::from(s)
}

/// Rotate rolling backups before a new save: foo.json.bak2 → .bak3,
/// .bak1 → .bak2, foo.json → .bak1. The last PROJECT_BACKUPS good
/// writes stay recoverable even if a save turns out to be bad.
pub(crate) fn rotate_backups(path: &Path) {
    for i in (2..=PROJECT_BACKUPS).rev() {
        let from = backup_path(path, i - 1);
        let to = backup_path(path, i);
        if from.exists() {
            let _ = fs::remove_file(&to);
            let _ = fs::rename(&from, &to);
        }
    }
    if path.exists() {
        let to = backup_path(path, 1);
        let _ = fs::remove_file(&to);
        let _ = fs::rename(path, &to);
    }
}

/// Atomic project write: serialize into a uniquely-named temp file in
/// the same directory, then rename over the destination. A crash or
/// power loss mid-write can never leave a truncated project file —
/// the destination only ever contains a complete previous or new state.
pub(crate) fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".to_string());
    let tmp = path.with_file_name(format!("{name}.{ts}.tmp"));
    if let Err(e) = fs::write(&tmp, contents) {
        return Err(format!("Write error: {e}"));
    }
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(format!("Rename error: {e}"))
        }
    }
}

/// Save project to the internal projects directory (used for autosave).
#[tauri::command]
pub(crate) fn save_project(
    app: tauri::AppHandle,
    state: serde_json::Value,
    name: Option<String>,
    is_autosave: bool,
) -> Result<String, String> {
    let dir = projects_dir(&app);
    let filename = if is_autosave {
        "autosave.json".to_string()
    } else {
        let n = name.unwrap_or_else(|| "untitled".to_string());
        let ts = Local::now().format("%Y%m%d_%H%M%S");
        format!("{n}_{ts}.json")
    };
    let path = dir.join(&filename);
    let json =
        serde_json::to_string_pretty(&state).map_err(|e| format!("Serialization error: {e}"))?;
    // Keep the last PROJECT_BACKUPS good writes recoverable next to the file.
    rotate_backups(&path);
    write_atomic(&path, &json)?;
    Ok(filename)
}

/// Save project to an arbitrary path chosen by the user via native save dialog.
#[tauri::command]
pub(crate) fn save_project_to_path(state: serde_json::Value, path: String) -> Result<(), String> {
    let target = Path::new(&path);
    let json =
        serde_json::to_string_pretty(&state).map_err(|e| format!("Serialization error: {e}"))?;
    rotate_backups(target);
    write_atomic(target, &json)
}

/// Remove the autosave and its rolling backups. Called on clean exits so
/// the next launch doesn't offer crash recovery for a session that ended
/// normally (see checkAutosaveRecovery in 20-project-io.js).
#[tauri::command]
pub(crate) fn clear_autosave(app: tauri::AppHandle) -> Result<(), String> {
    let base = projects_dir(&app).join("autosave.json");
    let _ = fs::remove_file(&base);
    for i in 1..=PROJECT_BACKUPS {
        let _ = fs::remove_file(backup_path(&base, i));
    }
    Ok(())
}

/// Load project from the internal projects directory (used for autosave restore).
#[tauri::command]
pub(crate) fn load_project(app: tauri::AppHandle, filename: String) -> Result<serde_json::Value, String> {
    let path = projects_dir(&app).join(&filename);
    if !path.exists() {
        return Err("File not found".to_string());
    }
    let contents = fs::read_to_string(&path).map_err(|e| format!("Read error: {e}"))?;
    let data: serde_json::Value =
        serde_json::from_str(&contents).map_err(|e| format!("Parse error: {e}"))?;
    Ok(data)
}

/// Load project from an arbitrary path chosen by the user via native open dialog.
#[tauri::command]
pub(crate) fn load_project_from_path(path: String) -> Result<serde_json::Value, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("File not found".to_string());
    }
    let contents = fs::read_to_string(p).map_err(|e| format!("Read error: {e}"))?;
    let data: serde_json::Value =
        serde_json::from_str(&contents).map_err(|e| format!("Parse error: {e}"))?;
    Ok(data)
}

#[tauri::command]
pub(crate) fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectInfo>, String> {
    let dir = projects_dir(&app);
    let mut files: Vec<ProjectInfo> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".json") {
                if let Ok(meta) = entry.metadata() {
                    let modified = meta
                        .modified()
                        .map(|t| {
                            t.duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs_f64()
                        })
                        .unwrap_or(0.0);
                    files.push(ProjectInfo {
                        filename: name,
                        modified,
                    });
                }
            }
        }
    }
    files.sort_by(|a, b| b.modified.partial_cmp(&a.modified).unwrap());
    Ok(files)
}

/// Returns the default projects directory so the JS dialog can use it as a starting path.
#[tauri::command]
pub(crate) fn get_projects_dir(app: tauri::AppHandle) -> String {
    projects_dir(&app).to_string_lossy().to_string()
}
