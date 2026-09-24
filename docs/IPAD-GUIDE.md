# iPad Support Guide

**Status (2026-09-23):** groundwork complete and verified against the
Tauri 2.11 / plugin sources. The app is now structured so that the day
a Mac is available, `tauri ios init` + a native encoder plugin is most
of the remaining distance. Nothing here was built — per the current
constraint — but every claim below was verified by reading the actual
crate sources in the local cargo registry, not from memory.

---

## The short answer

Yes — several things work differently on iPad, in four categories:
**the backend** (no subprocesses, so no FFmpeg sidecar), **the file
system** (sandboxed; save dialogs are unavailable), **input** (touch
gestures instead of mouse wheel / right-click), and **screen layout**
(safe areas). Most of the frontend already translates surprisingly
well, because the app was built on Pointer Events and Paper.js maps
single-touch to tools natively.

## What is already handled (in this pass)

| Area | What was done | Verified how |
|---|---|---|
| **Rust cfg correctness** | The `#[cfg(not(target_os = "android"))]` guards would have compiled the FFmpeg **sidecar** path on iOS (impossible: Apple forbids spawning subprocesses, and Tauri only injects `externalBin` into desktop bundles). Changed to `#[cfg(desktop)]` (Tauri's own alias) for the shell plugin, the desktop `mp4_render`, and `ShellExt`. Added an `#[cfg(target_os = "ios")]` `mp4_render` stub mirroring the existing Android pattern: it cleans the session frames and returns a clear "coming" error. | `tauri-plugin-shell` source: `new_sidecar()` is ungated and spawns processes; `tauri.conf.json` `externalBin` is a desktop-only bundle feature; `cargo check` passes with the new cfgs |
| **Window-state plugin** | `tauri-plugin-window-state` compiles to an **empty crate** on iOS/Android (`#![cfg(not(any(target_os = "android", target_os = "ios")))]` — the `Builder` type doesn't exist there). Its registration in `lib.rs` would have **broken the iOS build**; now behind `#[cfg(desktop)]`. | Read directly from the crate's `src/lib.rs` line 11 |
| **Raw IPC frames** | `mp4_frame_raw` (raw binary frames, the Phase 2 fast path) **works on iOS** — the Tauri source states raw bodies are unsupported on *Android only* ("On Android, [InvokeBody::Raw] is not supported"). No JS change needed; the base64 fallback stays Android-only. | `tauri-2.11.2/src/ipc/mod.rs:55` |
| **Saving without dialogs** | New `get_documents_dir` command (Rust). The JS save flow (`20-project-io.js`, `pickSavePath`) uses the native save dialog on desktop — unchanged — and on iPad writes to the app's **Documents folder** (timestamped name; visible in the Files app; subsequent Ctrl+S saves straight there). | `document_dir()` in the Tauri 2.11 path API; dialog plugin has an iOS target but save-picker support is not dependable — the fallback never relies on it |
| **Drawing with finger / Pencil** | Already worked: Paper.js maps single-touch to tool events, the canvas has `touch-action: none`, and the brush reads `PointerEvent.pressure` + `pointerType === 'pen'` — which WKWebView delivers for Apple Pencil. No changes. | Existing code (`03-paper-setup.js:11`, `style.css` canvas rule) |
| **Two-finger pan + pinch zoom** | New `40-touch-input.js`: capture-phase touch handling on the canvas — the touch equivalents of middle-drag pan and wheel zoom, **reusing their exact view math** from `14-tool-camera.js`. Gestures own the touches (`preventDefault` + `stopPropagation` capture) so Paper's tools never see the second finger. | Mirrors battle-tested formulas; pure math helpers unit-tested (`tests/touch-input.test.js`) |
| **Long-press → context menus** | All right-click menus in the app (timeline cells, camera keys, onion markers, switch dots) bind the standard `contextmenu` event — one synthetic-event dispatcher in `40-touch-input.js` (500 ms hold, 10 px tolerance, canvas excluded) makes **every one of them work on touch**. No per-menu changes. | Grep: 6 `contextmenu` bindings, all standard jQuery |
| **Page zoom / safe areas** | Viewport meta now `user-scalable=no, viewport-fit=cover` (system pinch must not zoom the page; pinch = view zoom). CSS pads `#top-bar` / `#left-tools` / `#right-panel` / `#timeline-bar` with `env(safe-area-inset-*)` (inert on desktop), and the canvas gets `-webkit-touch-callout: none` so iOS never shows its long-press magnifier over drawing. | Standard WKWebView behavior |
| **Device detection** | `VF.isTouchDevice()` / `VF.isIpad()` (modern iPadOS presents a Mac-like UA — the reliable recipe is *Mac UA + multi-touch*). Used by the save flow; safe in non-browser environments (returns false, never throws). | Unit-tested in the Node harness |

## What still needs a Mac (and roughly how)

1. **`npm run tauri ios init`** — generates `src-tauri/gen/apple/` (Xcode
   project). Requires macOS + Xcode + an Apple Developer account to run
   on device (the simulator is fine without one). The identifier
   `com.cinemint.pompedin` is already iOS-valid, and the
   `#[cfg_attr(mobile, tauri::mobile_entry_point)]` on `run()` is
   already in place.
2. **The native MP4 encoder plugin** — the iOS twin of the existing
   Android `mp4_plugin` (Kotlin/MediaCodec): a Swift
   `Mp4EncoderPlugin` registered the same way
   (`register_android_plugin`'s iOS counterpart), reading the session
   frames and encoding via **AVAssetWriter** (H.264 is built into
   iOS — no GPL FFmpeg involved on iPad, which also simplifies
   licensing for the iOS build). The Rust side (`export.rs`, iOS stub)
   and the JS pipeline (frames → `mp4_frame_raw` → `mp4_render`) are
   already wired; only the Swift encode step is missing.
   A scaffold checklist is in the iOS stub's doc comment.
3. **Open/load flows on iPad** — loading a project uses the open
   dialog (document picker). The dialog plugin has iOS support, but
   this needs on-device verification; if unavailable, the same
   pattern as saving applies: a Projects folder in Documents +
   a file list UI. (Groundwork note: PNG/sequence/GIF/spritesheet
   export flows also call save dialogs — adopt `pickSavePath`'s
   pattern there once verified on-device.)
4. **Files-app exposure** — set `UIFileSharingEnabled` /
   `LSSupportsOpeningDocumentsInPlace` in `Info.plist` so the Documents
   folder (where projects save on iPad) appears in the Files app.
5. **App Store bits** — icons/launch screens (`gen/apple`), bitcode/
   signing at upload time, and an export-compliance answer (the app
   uses standard encryption only — no ATS/encryption declarations
   beyond the standard exemption).

## Known limitations / follow-ups

- **Second finger mid-stroke**: landing a second finger while a stroke
  is in progress freezes that stroke (its moves are captured by the
  gesture) rather than cancelling it cleanly. Clean cancellation needs
  a Paper-tool hook (`40-touch-input.js` has the note); UX-wise, artists
  draw with one hand and gesture with the other, so this is rare.
- **Hover-dependent UI**: tooltips (`data-tip`) don't exist on touch;
  every control also has an `aria-label` (Phase 5 a11y) that could
  drive a touch-first hint mode later.
- **Keyboard shortcuts** are optional on iPad (Smart Keyboard/Folio);
  all primary actions are reachable by touch. The Keys panel works
  with the on-screen keyboard.
- **Performance**: iPad hardware is fast and the render path is heavily
  cached (Phase 2), but HiDPI canvas sizes (DPR 2) mean larger raster
  caches — the DPR-aware cache invalidation already handles it.
- **Android** remains indirectly supported (the existing MediaCodec
  plugin and base64 IPC fallback are untouched); this pass's cfg
  changes (`#[cfg(desktop)]` instead of `not(android)`) are semantically
  identical on Android.

## Mac-day quick-start

```bash
# on macOS:
npm install
npm run tauri ios init          # generates src-tauri/gen/apple
npm run tauri ios dev           # iPad simulator
npm run tauri ios build         # device build (needs signing)
```

Then work the checklist above — items 2–4 are the only real code.
