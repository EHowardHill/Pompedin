// audio.rs — the single audio track that can be attached to a project
// (stored under <data-dir>/audio, re-encoded into exports by export.rs).

use crate::audio_dir;
use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::fs;

const ALLOWED_AUDIO_EXT: &[&str] = &[".wav", ".mp3", ".ogg", ".flac", ".aac", ".m4a", ".webm"];

fn is_audio_ext(ext: &str) -> bool {
    ALLOWED_AUDIO_EXT.contains(&ext.to_lowercase().as_str())
}

#[derive(Serialize)]
pub(crate) struct AudioInfo {
    filename: Option<String>,
    data: Option<String>, // base64
}

/// Save audio data (base64) to the audio directory, replacing any existing track.
#[tauri::command]
pub(crate) fn save_audio(app: tauri::AppHandle, data: String, filename: String) -> Result<String, String> {
    let dir = audio_dir(&app);

    // Validate extension
    let ext = filename.rfind('.').map(|i| &filename[i..]).unwrap_or("");
    if !is_audio_ext(ext) {
        return Err(format!("Unsupported audio format: {ext}"));
    }

    // Clear existing audio files
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                fs::remove_file(entry.path()).ok();
            }
        }
    }

    let safe_name = format!("track{ext}");
    let path = dir.join(&safe_name);
    let bytes = general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Failed to decode audio data: {e}"))?;
    fs::write(&path, &bytes).map_err(|e| format!("Failed to write audio: {e}"))?;

    Ok(safe_name)
}

/// Returns info about the current audio file, including its data as base64.
#[tauri::command]
pub(crate) fn get_current_audio(app: tauri::AppHandle) -> Result<AudioInfo, String> {
    let dir = audio_dir(&app);
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| format!(".{x}"))
                .unwrap_or_default();
            if is_audio_ext(&ext) {
                let name = entry.file_name().to_string_lossy().to_string();
                let bytes = fs::read(&path).map_err(|e| format!("Failed to read audio: {e}"))?;
                return Ok(AudioInfo {
                    filename: Some(name),
                    data: Some(general_purpose::STANDARD.encode(&bytes)),
                });
            }
        }
    }
    Ok(AudioInfo {
        filename: None,
        data: None,
    })
}

/// Remove all audio files.
#[tauri::command]
pub(crate) fn remove_audio(app: tauri::AppHandle) -> Result<u32, String> {
    let dir = audio_dir(&app);
    let mut removed = 0u32;
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                fs::remove_file(entry.path()).ok();
                removed += 1;
            }
        }
    }
    Ok(removed)
}
