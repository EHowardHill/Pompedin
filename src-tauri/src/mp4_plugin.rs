// src-tauri/src/mp4_plugin.rs
//
// Thin bridge between the mp4_render Tauri command and the
// Android-native MediaCodec encoder (Kotlin side).
// This module is only compiled on Android.

use serde::{Deserialize, Serialize};
use tauri::{plugin::PluginHandle, Runtime};

/// Managed state that holds the Android plugin handle.
pub struct Mp4Encoder<R: Runtime>(pub PluginHandle<R>);

/// Payload sent to the Kotlin `encode` command.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodeRequest {
    pub input_dir: String,
    pub output_path: String,
    pub fps: u32,
    pub total_frames: u32,
    pub audio_path: Option<String>,
}

/// Empty success response.
#[derive(Deserialize)]
pub struct EncodeResponse {}

impl<R: Runtime> Mp4Encoder<R> {
    /// Call the Kotlin Mp4EncoderPlugin.encode() method.
    pub fn encode(&self, req: EncodeRequest) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<EncodeResponse>("encode", req)
            .map(|_| ())
            .map_err(|e| format!("Android MediaCodec encode failed: {e}"))
    }
}
