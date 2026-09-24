// export.rs — PNG frame export and the MP4 pipeline (frame transport +
// FFmpeg encode). Frame rasterization happens in the webview (Paper.js
// is JS); frames arrive here via base64 (mp4_frame) or — on desktop —
// as raw IPC binary (mp4_frame_raw, with session/frame as headers),
// and are pipelined: the webview renders frame N+1 while we write N.

use crate::{exports_dir, AppState};
use base64::{engine::general_purpose, Engine as _};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

// The FFmpeg sidecar lives on desktop only; on iOS, spawning subprocesses
// is forbidden — encoding there goes through a native plugin instead.
#[cfg(desktop)]
use tauri_plugin_shell::ShellExt;

// The Android MediaCodec encoder is fetched from managed app state
// (app.state::<Mp4Encoder>()), which needs the Manager trait in scope.
// Windows never compiles this path, so the import is Android-gated.
#[cfg(target_os = "android")]
use tauri::Manager as _;

// ═══════════════════════════════════════════════════
//   PNG EXPORT
// ═══════════════════════════════════════════════════

/// Decode a base64 PNG and write it to the given path (from a save dialog).
#[tauri::command]
pub(crate) fn export_png(image: String, path: String) -> Result<(), String> {
    let image_data = if let Some(pos) = image.find(',') {
        &image[pos + 1..]
    } else {
        &image
    };
    let bytes = general_purpose::STANDARD
        .decode(image_data)
        .map_err(|e| format!("Failed to decode image: {e}"))?;
    fs::write(&path, &bytes).map_err(|e| format!("Failed to write PNG: {e}"))?;
    Ok(())
}

// ═══════════════════════════════════════════════════
//   MP4 EXPORT
// ═══════════════════════════════════════════════════

/// Create a temporary directory for frame images.
#[tauri::command]
pub(crate) fn mp4_start(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string()[..12].to_string();
    let session_dir = exports_dir(&app).join(format!("mp4_{session_id}"));
    fs::create_dir_all(&session_dir).map_err(|e| format!("Failed to create session dir: {e}"))?;
    state
        .mp4_sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), session_dir);
    Ok(session_id)
}

/// Receive a single frame PNG (base64) and write it to the session dir.
#[tauri::command]
pub(crate) fn mp4_frame(
    state: State<'_, AppState>,
    session_id: String,
    frame_index: u32,
    image: String,
) -> Result<(), String> {
    let sessions = state.mp4_sessions.lock().unwrap();
    let session_dir = sessions
        .get(&session_id)
        .ok_or("Invalid or expired session")?;

    let image_data = if let Some(pos) = image.find(',') {
        &image[pos + 1..]
    } else {
        &image
    };
    let bytes = general_purpose::STANDARD
        .decode(image_data)
        .map_err(|e| format!("Decode error: {e}"))?;

    write_frame_png(session_dir, frame_index, &bytes)
}

/// Write one exported frame PNG into the session directory.
pub(crate) fn write_frame_png(session_dir: &Path, frame_index: u32, bytes: &[u8]) -> Result<(), String> {
    let frame_path = session_dir.join(format!("frame_{frame_index:04}.png"));
    fs::write(&frame_path, bytes).map_err(|e| format!("Write error: {e}"))
}

/// Receive a single frame PNG as RAW BINARY — the PNG bytes are the IPC
/// body itself (no base64 round-trip: ~25% less data over the bridge, no
/// encode on the JS side, no decode here). The session id and frame
/// index travel as invoke headers.
///
/// Raw IPC bodies are unsupported on Android — the JS side falls back
/// to the base64 `mp4_frame` command there.
#[tauri::command]
pub(crate) fn mp4_frame_raw(
    request: tauri::ipc::Request,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let headers = request.headers();
    let session_id = headers
        .get("session-id")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing session-id header")?
        .to_string();
    let frame_index: u32 = headers
        .get("frame-index")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("missing or invalid frame-index header")?;

    let sessions = state.mp4_sessions.lock().unwrap();
    let session_dir = sessions
        .get(&session_id)
        .ok_or("Invalid or expired session")?;

    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => write_frame_png(session_dir, frame_index, bytes),
        _ => Err("expected a raw binary body".to_string()),
    }
}

// ---------------------------------------------------------------------------
//  Helper: write base64 audio to a temp file inside the session directory.
//  Shared by both desktop and Android render paths.
// ---------------------------------------------------------------------------
fn write_temp_audio(
    session_dir: &Path,
    include_audio: bool,
    audio_data: Option<String>,
    audio_filename: Option<String>,
) -> Option<PathBuf> {
    if !include_audio {
        return None;
    }
    let b64 = audio_data?;
    let fname = audio_filename?;
    let ext = Path::new(&fname)
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("mp3");

    let temp_audio_path = session_dir.join(format!("track.{}", ext));
    let clean_data = if let Some(pos) = b64.find(',') {
        &b64[pos + 1..]
    } else {
        &b64
    };

    let bytes = general_purpose::STANDARD.decode(clean_data).ok()?;
    fs::write(&temp_audio_path, &bytes).ok()?;
    Some(temp_audio_path)
}

// ---------------------------------------------------------------------------
//  DESKTOP: encode via FFmpeg sidecar  (Windows / macOS / Linux)
// ---------------------------------------------------------------------------
#[cfg(desktop)]
#[tauri::command]
pub(crate) async fn mp4_render(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    fps: u32,
    include_audio: bool,
    audio_data: Option<String>,
    audio_filename: Option<String>,
    audio_volume: f32, // NEW: Matches audioVolume in JS
    _total_frames: u32,
    duration_sec: f64, // NEW: Matches durationSec in JS
    output_path: String,
) -> Result<(), String> {
    let session_dir = {
        let sessions = state.mp4_sessions.lock().unwrap();
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Invalid or expired session")?
    };

    let fps = fps.max(1);

    let audio_file = write_temp_audio(&session_dir, include_audio, audio_data, audio_filename);

    // Build sidecar argument vector dynamically
    let input_pattern = session_dir.join("frame_%04d.png");
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-framerate".to_string(),
        fps.to_string(),
        "-i".to_string(),
        input_pattern.to_string_lossy().to_string(),
    ];

    if let Some(ref audio) = audio_file {
        args.push("-i".to_string());
        args.push(audio.to_string_lossy().to_string());
    }

    args.extend(vec![
        "-c:v".to_string(),
        "libx264".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-preset".to_string(),
        "medium".to_string(),
        "-crf".to_string(),
        "18".to_string(),
        "-vf".to_string(),
        "pad=ceil(iw/2)*2:ceil(ih/2)*2".to_string(),
    ]);

    if audio_file.is_some() {
        args.extend(vec![
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
            "-filter:a".to_string(),
            format!("volume={:.2}", audio_volume), // NEW: Apply volume scale
        ]);
    }

    // NEW: Force FFmpeg to truncate exactly at our calculated duration
    args.push("-t".to_string());
    args.push(format!("{duration_sec:.4}"));
    args.push(output_path);

    // FFmpeg source differs by platform:
    //   Windows / macOS -> bundled sidecar (externalBin)
    //   Linux           -> system ffmpeg on PATH (declared as a package dependency)
    #[cfg(target_os = "linux")]
    let ffmpeg = app.shell().command("ffmpeg");

    #[cfg(not(target_os = "linux"))]
    let ffmpeg = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("Failed to create FFmpeg sidecar: {}", e))?;

    let output = ffmpeg
        .args(&args)
        .output()
        .await
        .map_err(|e| {
            #[cfg(target_os = "linux")]
            {
                format!(
                    "Could not run ffmpeg. Make sure it is installed via your package manager \
                     (e.g. `sudo apt install ffmpeg` or `sudo dnf install ffmpeg`). Details: {e}"
                )
            }
            #[cfg(not(target_os = "linux"))]
            {
                format!("Failed to execute FFmpeg sidecar: {e}")
            }
        })?;

    cleanup_session(&state.mp4_sessions, &session_id);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr
            .chars()
            .rev()
            .take(1500)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        return Err(format!("FFmpeg encoding failed:\n{tail}"));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
//  ANDROID: encode via MediaCodec plugin
// ---------------------------------------------------------------------------
#[cfg(target_os = "android")]
#[tauri::command]
// audio_volume / duration_sec are accepted to keep one JS-facing signature
// across platforms; the Kotlin encoder doesn't apply them yet (see the
// note in the EncodeRequest call below).
#[allow(unused_variables)]
pub(crate) async fn mp4_render(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    fps: u32,
    include_audio: bool,
    audio_data: Option<String>,
    audio_filename: Option<String>,
    audio_volume: f32, // NEW: Match desktop signature
    total_frames: u32,
    duration_sec: f64, // NEW: Match desktop signature
    output_path: String,
) -> Result<(), String> {
    let session_dir = {
        let sessions = state.mp4_sessions.lock().unwrap();
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Invalid or expired session")?
    };

    let audio_path = write_temp_audio(&session_dir, include_audio, audio_data, audio_filename);

    // Call into the Kotlin MediaCodec encoder via the Tauri plugin bridge.
    // (Note: If you want to support volume/truncation on Android later, you'll need to pass these new variables into the EncodeRequest struct).
    let encoder = app.state::<crate::mp4_plugin::Mp4Encoder<tauri::Wry>>();
    encoder.encode(crate::mp4_plugin::EncodeRequest {
        input_dir: session_dir.to_string_lossy().to_string(),
        output_path,
        fps: fps.max(1),
        total_frames,
        audio_path: audio_path.map(|p| p.to_string_lossy().to_string()),
    })?;

    cleanup_session(&state.mp4_sessions, &session_id);
    Ok(())
}

// ---------------------------------------------------------------------------
//  iOS / iPadOS: frame collection works today (mp4_frame_raw — raw IPC
//  bodies ARE supported on iOS; only Android lacks them), but the final
//  encode needs a native AVAssetWriter plugin, mirroring the Android
//  MediaCodec pattern. Until that lands (Mac + Xcode required — see
//  docs/IPAD-GUIDE.md), exporting reports a clear error and the session
//  frames are cleaned up.
// ---------------------------------------------------------------------------
#[cfg(target_os = "ios")]
#[tauri::command]
#[allow(unused_variables)]
pub(crate) async fn mp4_render(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    fps: u32,
    include_audio: bool,
    audio_data: Option<String>,
    audio_filename: Option<String>,
    audio_volume: f32,
    total_frames: u32,
    duration_sec: f64,
    output_path: String,
) -> Result<(), String> {
    cleanup_session(&state.mp4_sessions, &session_id);
    Err("MP4 export is not available on iPad yet — it requires the native iOS encoder plugin (see docs/IPAD-GUIDE.md). PNG, PNG-sequence, GIF and spritesheet exports work.".to_string())
}

fn cleanup_session(sessions: &Mutex<HashMap<String, PathBuf>>, session_id: &str) {
    if let Some(dir) = sessions.lock().unwrap().remove(session_id) {
        fs::remove_dir_all(&dir).ok();
    }
}
