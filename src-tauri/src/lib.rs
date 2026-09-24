// lib.rs — Pompedin entry point.
//
// All commands live in the sibling modules; this file keeps only the
// shared app state, the data-directory helpers, and run():
//
//   brush.rs      — brush texture listing/reading
//   files.rs      — native-dialog file reading (images, any file)
//   audio.rs      — the project's audio track
//   project_io.rs — project save/load + backup rotation + atomic writes
//   export.rs     — PNG export + the MP4 pipeline (FFmpeg sidecar)
//   crash.rs      — local-only crash reporting (JS errors + Rust panics)
//   tests.rs      — unit tests for the save-safety/export helpers

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

#[cfg(target_os = "android")]
mod mp4_plugin;

mod audio;
mod brush;
mod crash;
mod export;
mod files;
mod project_io;

#[cfg(test)]
mod tests;

// ═══════════════════════════════════════════════════
//   APP STATE
// ═══════════════════════════════════════════════════

pub(crate) struct AppState {
    pub(crate) mp4_sessions: Mutex<HashMap<String, PathBuf>>,
}

// ═══════════════════════════════════════════════════
//   DIRECTORY HELPERS
// ═══════════════════════════════════════════════════

pub(crate) fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
}

pub(crate) fn brush_dir(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("brush")
}

pub(crate) fn audio_dir(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("audio")
}

pub(crate) fn projects_dir(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("projects")
}

pub(crate) fn exports_dir(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("exports")
}

pub(crate) fn ensure_dirs(app: &tauri::AppHandle) {
    for dir in [
        data_dir(app),
        brush_dir(app),
        audio_dir(app),
        projects_dir(app),
        exports_dir(app),
    ] {
        fs::create_dir_all(&dir).ok();
    }
}

// ═══════════════════════════════════════════════════
//   ENTRY POINT
// ═══════════════════════════════════════════════════

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // `mut` is only exercised on desktop, where the plugin chain below
    // reassigns it (Android/iOS never do).
    #[cfg_attr(not(desktop), allow(unused_mut))]
    let mut builder = tauri::Builder::default();

    // Shell plugin: desktop only (FFmpeg sidecar). iOS forbids spawning
    // subprocesses entirely — the iOS encoder path is a native plugin
    // (see export.rs / docs/IPAD-GUIDE.md).
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_shell::init());
    }

    // Window geometry (size/position/maximized) survives restarts.
    // Desktop only — the window-state crate compiles empty on iOS/Android,
    // so its Builder type doesn't exist there.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        // ── Android MediaCodec plugin ──────────────────────────────
        .plugin(
            tauri::plugin::Builder::new("mp4-encoder")
                .setup(|app, api: tauri::plugin::PluginApi<tauri::Wry, ()>| {
                    // Desktop: this plugin does nothing (and the params
                    // would be unused — silence them).
                    #[cfg(not(target_os = "android"))]
                    {
                        let _ = &app;
                        let _ = &api;
                    }

                    // Android: register the Kotlin Mp4EncoderPlugin
                    // (gen/android/.../Mp4EncoderPlugin.kt) and manage its
                    // handle so export.rs can call into it.
                    #[cfg(target_os = "android")]
                    {
                        let handle = api.register_android_plugin(
                            "com.cinemint.pompedin",
                            "Mp4EncoderPlugin",
                        )?;
                        app.manage(mp4_plugin::Mp4Encoder(handle));
                    }

                    Ok(())
                })
                .build(),
        )
        .manage(AppState {
            mp4_sessions: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            brush::list_brushes,
            brush::get_brush_data,
            brush::open_brush_folder,
            audio::save_audio,
            audio::get_current_audio,
            audio::remove_audio,
            export::export_png,
            files::read_image_file,
            files::read_file_base64,
            project_io::save_project,
            project_io::save_project_to_path,
            project_io::clear_autosave,
            project_io::load_project,
            project_io::load_project_from_path,
            project_io::list_projects,
            project_io::get_projects_dir,
            crash::log_crash,
            crash::consume_crash_flag,
            crash::open_crash_reports,
            export::mp4_start,
            export::mp4_frame,
            export::mp4_frame_raw,
            export::mp4_render,
            files::get_data_dir,
            files::get_documents_dir
        ])
        .setup(|app| {
            ensure_dirs(app.handle());
            crash::install_panic_hook(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Pompedin");
}
