# pompedin

Frame-by-frame vector animation tool, built with Tauri 2 + Rust + Paper.js.

## Prerequisites

- **Rust** — [Install via rustup](https://rustup.rs/)
- **Node.js** (v18+) — [nodejs.org](https://nodejs.org/)
- **FFmpeg** — needed for MP4 export. Install via your package manager:
  - macOS: `brew install ffmpeg`
  - Ubuntu: `sudo apt install ffmpeg`
  - Windows: `choco install ffmpeg` or [download](https://ffmpeg.org/download.html)
- **Tauri system dependencies** — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Setup

1. **Install npm dependencies:**

   ```bash
   npm install
   ```

2. **Run in dev mode:**

   ```bash
   npm run dev
   ```

3. **Build for release:**

   ```bash
   npm run build
   ```

   The packaged app will be in `src-tauri/target/release/bundle/`.

   Release builds first generate a bundled, minified, trimmed copy of the
   frontend into `src-dist/` (38 scripts → one minified bundle; only the
   runtime parts of `lib/` ship — FontAwesome's ~28 MB of source trees are
   excluded). Dev mode keeps serving `src/` directly, so iteration is
   unaffected. See `scripts/build-frontend.mjs`.

## Documentation

- **User manual** — [docs/MANUAL.md](docs/MANUAL.md): interface tour,
  frame-by-frame workflow, tween vs. loop semantics, camera, export
  options, and the default keymap. The in-app Help dialog covers the
  same ground inside the app.
- **iPad support** — [docs/IPAD-GUIDE.md](docs/IPAD-GUIDE.md): what
  differs on iPad (input gestures, file sandbox, no sidecar processes,
  safe areas), what is already handled, and the Mac-day checklist.
- **Android support** — [docs/ANDROID-GUIDE.md](docs/ANDROID-GUIDE.md):
  the Rust side check-compiles for Android (verified from this repo);
  what's fixed, and the device/SDK checklist that remains.
- **QA checklist** — [docs/QA-CHECKLIST.md](docs/QA-CHECKLIST.md)
- **Preferences audit** — [docs/PREFERENCES.md](docs/PREFERENCES.md)
- **FFmpeg licensing** — [docs/FFMPEG-LICENSING.md](docs/FFMPEG-LICENSING.md)

## License

Pompedin is licensed under the **BSD 3-Clause License** — see
[LICENSE](LICENSE).

Distributed packages additionally bundle FFmpeg (GPLv3 build, invoked as a
separate process for MP4 export) and other third-party components under
their own licenses — see `src-tauri/bin/LICENSE-FFMPEG.txt`,
[docs/FFMPEG-LICENSING.md](docs/FFMPEG-LICENSING.md), and the in-app About
dialog.

## Project Structure

```
pompedin/
├── package.json
├── setup.sh                 # Copies unchanged JS from original project
├── src/                     # Frontend (served by Tauri webview)
│   ├── index.html
│   ├── style.css
│   └── js/
│       ├── 01-state.js      ★ Modified: adds VF.invoke() helper
│       ├── 02–17, 19, 21,   (unchanged — copied by setup.sh)
│       │   23, 27
│       ├── 18-export.js     ★ Modified: uses Tauri save dialog
│       ├── 20-project-io.js ★ Modified: uses Tauri invoke
│       ├── 22-ui-bindings.js★ Modified: togglePlay fix for audio
│       ├── 24-init.js       ★ Modified: loads brushes via invoke
│       ├── 25-audio.js      ★ Modified: base64 audio transport
│       └── 26-export-mp4.js ★ Modified: Tauri save dialog + invoke
└── src-tauri/               # Rust backend
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json
    └── src/
        ├── main.rs          # Entry point
        └── lib.rs           # All commands (replaces app.py)
```