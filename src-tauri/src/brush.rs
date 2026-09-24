// brush.rs — brush texture listing/reading (JS loads PNG brushes
// as data URLs through these commands).

use crate::brush_dir;
use base64::{engine::general_purpose, Engine as _};
use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub(crate) fn list_brushes(app: tauri::AppHandle) -> Vec<String> {
    let dir: PathBuf = brush_dir(&app);
    let mut files: Vec<String> = fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.to_lowercase().ends_with(".png") {
                Some(name)
            } else {
                None
            }
        })
        .collect();
    files.sort();
    files
}

/// Returns the brush PNG as a base64-encoded string.
#[tauri::command]
pub(crate) fn get_brush_data(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    let path = brush_dir(&app).join(&filename);
    let data = fs::read(&path).map_err(|e| format!("Failed to read brush: {e}"))?;
    Ok(general_purpose::STANDARD.encode(&data))
}

/// Open the brush folder in the system's native file explorer.
#[tauri::command]
pub(crate) fn open_brush_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = brush_dir(&app);
    open::that(&dir).map_err(|e| format!("Failed to open folder: {e}"))
}
