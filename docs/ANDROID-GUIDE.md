# Android Support Guide

**Status (2026-09-23):** the Rust side of Android now **check-compiles
cleanly from this Windows machine** (`cargo check --target
aarch64-linux-android` — zero errors, zero warnings), and this pass
found and fixed three real Android build breakers that desktop
compilation had been hiding. What remains is device/SDK work.

The good news up front: unlike iPad, **Android needs no Mac**. With
Android Studio + the Rust Android targets you can build and run on a
device or emulator from your current machine today.

## What already existed (before this pass)

- **A complete Kotlin MediaCodec encoder**: `src-tauri/gen/android/` is
  committed (not regenerated from scratch needed), including
  `Mp4EncoderPlugin.kt` — a full H.264 encoder (MediaCodec + EGL/GL
  surface path, the most device-compatible approach) with audio muxing
  and trimming. `lib.rs` registers it as the `mp4-encoder` plugin and
  `export.rs` calls it from the Android `mp4_render`.
- **Base64 IPC fallback**: Android doesn't support raw IPC bodies
  (`InvokeBody::Raw`), so `26-export-mp4.js` falls back to the base64
  `mp4_frame` command — already wired and untouched.
- **Mobile entry point + cfg guards**: `mobile_entry_point`, the
  `#[cfg(desktop)]` shell/window-state exclusions from the iPad pass,
  and the touch layer (`40-touch-input.js`: two-finger pan, pinch
  zoom, long-press context menus) all apply to Android unchanged.

## Found and fixed in this pass (all invisible to desktop builds)

1. **`app` out of scope in the plugin setup closure** (`lib.rs`). The
   Android-only registration block used `app.manage(...)` but the
   closure parameter was named `_app` — a guaranteed compile error on
   the Android target that Windows never saw. Fixed (params renamed,
   desktop branch silences the unused ones).
2. **Missing `Manager` trait in `export.rs`.** `app.state::<Mp4Encoder>()`
   needs `tauri::Manager` in scope; the import is now Android-gated.
3. **`externalBin` validation failure.** `tauri-build` validates the
   FFmpeg sidecar **per target** and required
   `bin/ffmpeg-aarch64-linux-android` — which must not exist (Android
   uses MediaCodec, no subprocesses). The new `tauri.android.conf.json`
   (auto-detected by Tauri for Android targets) strips `externalBin`/`resources`
   from the bundle config. It also points `frontendDist` at the bundled,
   trimmed `src-dist` — without it the APK would embed the ~28 MB of
   FontAwesome source trees. `npm run build:android` runs the frontend
   bundler first.
4. Cosmetic: `unused_mut` / unused-parameter warnings on the Android
   target are now silenced at the source.

**Verification:** `cargo check --target aarch64-linux-android` — exit 0,
no warnings (and Windows remains clean).

## What still needs a device / SDK (checklist)

1. **Prerequisites** — Android Studio (SDK + NDK + platform-tools), JDK
   17+, then `rustup target add aarch64-linux-android` (done) and
   `npm install`. Then:
   ```bash
   npm run tauri android dev      # emulator or connected device
   npm run build:android          # signed APK/AAB
   ```
   The committed `gen/android` project is the build base — **if the
   Tauri CLI asks to regenerate it** (version drift), let it, then
   re-copy `Mp4EncoderPlugin.kt` into
   `app/src/main/java/com/cinemint/pompedin/` — the repo's copy is the
   source of truth for that file.
2. **File open flows (the one real unknown).** Image and audio import
   use `read_image_file` / `read_file_base64` with **filesystem paths**,
   but Android document pickers can return `content://` URIs, which
   `std::fs` cannot read. This must be tested on device; if it fails,
   the fix is either (a) a content-URI variant of those commands using
   the Android ContentResolver via the plugin bridge, or (b) routing
   through `tauri-plugin-fs` (which handles content URIs on Android).
   Until verified, those flows may error with a clean toast — no data
   loss, since project files live in the app's own directories.
3. **Save flow on Android** — already handled generically:
   `pickSavePath` detects any mobile build (`VF.isMobileApp()`) and
   saves to the Documents/documents dir without a dialog. Verify the
   path on device (Tauri's `document_dir()` on Android resolves to the
   app's external documents dir).
4. **"Open folder" buttons** — the `open` crate routes Android through
   its `unix` backend (xdg-open), which fails on Android. Both
   `open_brush_folder` and `open_crash_reports` fail *gracefully*
   (error toast); a proper fix is an Android plugin `open` command or
   hiding those buttons on mobile. Low priority: the brush folder is
   app-internal storage on Android anyway.
5. **Back button UX** — the hardware/gesture back button currently
   does nothing (SPA). Polish item: override `onBackPressed` in
   `MainActivity.kt` to close the topmost modal (`.mo-ov:visible`) and
   exit with the unsaved-changes prompt when none is open. The close
   guard from Phase 0 makes exiting safe either way (autosave + crash
   flag recover the session).
6. **Edge-to-edge / insets** — Android 15+ draws edge-to-edge; the
   safe-area CSS env() values are typically 0 on Android WebView, so
   if the timeline sits under the gesture bar, apply insets via the
   generated project's theme or a small JS `visualViewport` shim.
   Device-verify.
7. **Play Store bits** — icons/adaptive icon (in `gen/android`),
   signing config, and the data-safety form. Storage is all
   app-scoped (no permissions needed); no unusual declarations apply.
   Encryption export compliance: standard.

## Platform behavior notes

- **Performance**: mid-range Android WebViews are slower than iPad's
  WKWebView, but the render path is heavily cached (Phase 2) and
  DPR-aware raster caches handle 2–3× device pixel ratios.
- **Keyboard**: on-screen keyboard overlays the bottom panel; if it
  obstructs, a `visualViewport` resize handler for the timeline is the
  follow-up (same applies to iPad).
- **MP4 encoding** is hardware MediaCodec — no FFmpeg, so the GPL
  obligations in `docs/FFMPEG-LICENSING.md` do **not** apply to the
  Android build at all.

Related: `docs/IPAD-GUIDE.md` covers the shared touch groundwork in
detail; both platforms use the same input layer and save fallback.
