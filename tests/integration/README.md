# Integration Smoke Test

End-to-end smoke test that launches the real Tauri app through
[tauri-driver](https://docs.rs/tauri-driver/) (Tauri's WebDriver server) and
exercises the core pipeline: create a layer, draw a stroke, undo, render a
frame, save.

This complements the Node unit tests (`npm test`), which run the pure logic
in isolation — the smoke test catches wiring breakage between the webview,
the `invoke()` bridge, and the Rust backend that unit tests cannot see.

## Status

**Scaffolded, not yet wired into CI.** Activating it needs a `tauri-driver`
binary plus a WebDriver client. Until then this directory documents the
intended flow; `smoke.js` is written against WebdriverIO and will run
once the prerequisites are installed.

## Prerequisites

1. **tauri-driver** — install per platform:
   - Windows: download from the [releases page](https://github.com/tauri-apps/tauri-driver/releases) (or `cargo install tauri-driver`)
   - macOS: `brew install tauri-driver`
   - Linux: `cargo install tauri-driver` (needs `webkit2gtk` system deps)
2. **A release build of the app** (WebDriver tests run against the
   *packaged* binary):
   ```bash
   npm run build
   ```
3. **WebdriverIO**:
   ```bash
   npm install -D webdriverio
   ```

## Running

```bash
# Terminal 1 — start the WebDriver server
tauri-driver

# Terminal 2 — run the smoke test against the debug build
APPSRC="../src-tauri/target/debug/pompedin.exe" node tests/integration/smoke.js
```

`smoke.js` auto-detects the platform binary name (`pompedin.exe` on Windows,
`pompedin` elsewhere). Set `APPSRC` if the binary lives elsewhere.

## What it verifies

The script asserts, in order:

1. The app window opens and the canvas element is present
2. The layer panel shows the seeded "Layer 1"
3. A brush stroke produces a non-empty serialization (frame data written)
4. Undo empties the frame again
5. The FPS/timeline controls respond
6. The window closes cleanly (autosave cleared — no crash-recovery prompt
   should appear on the next launch)
