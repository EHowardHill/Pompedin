// files.rs — reading files picked in native dialogs (images for image
// layers, any file for audio import) and returning them as base64.

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::Path;

/// Returns the app data directory path so the user knows where brushes go.
#[tauri::command]
pub(crate) fn get_data_dir(app: tauri::AppHandle) -> String {
    crate::data_dir(&app).to_string_lossy().to_string()
}

/// Documents directory — the user-visible storage location. On iOS this
/// is the app's Documents folder (visible in the Files app); on desktop
/// it's the user's Documents folder. Used by the JS save flow as the
/// fallback when native save dialogs are unavailable (iPad).
#[tauri::command]
pub(crate) fn get_documents_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    app.path()
        .document_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Documents directory unavailable: {e}"))
}

/// Read an image file from an absolute path and return it as a data URL.
/// Used after the native open dialog returns a file path.
#[tauri::command]
pub(crate) fn read_image_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("File not found".to_string());
    }
    let data = fs::read(p).map_err(|e| format!("Failed to read file: {e}"))?;
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    };
    Ok(format!(
        "data:{};base64,{}",
        mime,
        general_purpose::STANDARD.encode(&data)
    ))
}

/// Read any file and return (base64_data, filename).
/// Used for audio import after native open dialog.
#[derive(Serialize)]
pub(crate) struct FileReadResult {
    pub data: String,
    pub filename: String,
}

#[tauri::command]
pub(crate) fn read_file_base64(path: String) -> Result<FileReadResult, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("File not found".to_string());
    }
    let filename = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    let data = fs::read(p).map_err(|e| format!("Failed to read file: {e}"))?;
    Ok(FileReadResult {
        data: general_purpose::STANDARD.encode(&data),
        filename,
    })
}
