# Web Build & NGINX Deployment

Pompedin ships from one codebase to two targets:

- **Desktop** — the Tauri app (unchanged; Rust backend via IPC)
- **Web** — the same `src/` frontend served statically by any web server
  (e.g. NGINX on Ubuntu, from `/var/www/Pompedin`)

No backend server is required for the web build. Everything runs in the
browser through the platform abstraction layer, `VF.platform`
(`src/js/01a-platform.js`), which selects an adapter at startup:

| | Tauri adapter | Web adapter |
|---|---|---|
| Project Save/Open | native dialogs + Rust file I/O | File System Access picker, or prompt/download + file-input fallbacks |
| Autosave & crash recovery | `<data-dir>/projects/autosave.json` + `.bak1–3` | OPFS `projects/autosave.json` + `.bak1–3` (same rotation) |
| PNG / GIF / spritesheet export | save dialog + `export_png` | save picker, or download |
| PNG sequence export | folder dialog + per-file `export_png` | `showDirectoryPicker` (Chromium), or paced downloads |
| Image / audio import | dialog + Rust base64 read | picker / file input, read locally |
| Confirm prompts | native `dialog.ask` | `window.confirm` |
| Crash reports | `<data-dir>/crash-reports/` | localStorage log (About → Crash Reports downloads it) |
| Brushes | user-managed folder in the data dir | shipped set in `assets/brushes/` |
| MP4 export | FFmpeg sidecar / native plugin | **not supported** — toast points to the desktop app |

## Feature status on the web

Everything except MP4 export works in a browser. Browser-specific notes:

- **Chrome / Edge / other Chromium browsers** — best experience: real
  save/open pickers, folder export, OPFS autosave.
- **Firefox / Safari** — no File System Access API: saves become
  downloads, opens use a file-input, projects keep autosaving to OPFS.
- **HTTPS (or localhost) is required** — OPFS and the File System Access
  API are only available in secure contexts. Behind plain HTTP on a
  LAN IP, autosave and pickers will be disabled; the app still runs.

## Build

```bash
npm run build:frontend
```

produces `src-dist/` — a self-contained, minified copy of the app
(`index.html`, one JS bundle, CSS, `lib/`, `assets/` including the
`assets/brushes/` set). This is the same bundle the desktop release
build uses, so it can never drift from the Tauri app.

For quick local testing without a build:

```bash
npm run serve        # serves src/ unbundled on http://localhost:1420
```

## Deploy to Ubuntu + NGINX

On the server, once per machine:

```bash
sudo apt install nginx
```

There are two ways to get `src-dist/` onto the box. Either way, point
nginx at **`src-dist/`** — never at the repo checkout itself, or the
server would ship `.git/`, sources, and tests over HTTP.

### Option A — clone and build on the server

The repo needs Node (v18+) to build, but nothing at runtime:

```bash
cd /var/www/Pompedin
npm install               # build deps (esbuild); not part of the clone
npm run build:frontend
```

`node_modules/` is gitignored, so a fresh clone always needs
`npm install` first — the build fails with `ERR_MODULE_NOT_FOUND:
Cannot find package 'esbuild'` otherwise. If npm's allow-scripts policy
blocks esbuild's postinstall (npm ≥ 11) and the build then complains
about a missing esbuild binary, run
`node node_modules/esbuild/install.js` once and re-run the build.

Future updates:

```bash
git pull && npm install && npm run build:frontend
```

### Option B — build anywhere, ship only the bundle

From a machine with the repo (no Node needed on the server):

```bash
npm run build:frontend
rsync -av --delete src-dist/ user@server:/var/www/Pompedin/
```

With this layout the nginx `root` below becomes
`/var/www/Pompedin` (the bundle directory itself).

### Server block

`/etc/nginx/sites-available/pompedin` (Option A layout — adjust
`root` for Option B as noted above):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name pompedin.example.com;

    root /var/www/Pompedin/src-dist;
    index index.html;

    # Never serve dotfiles (.git, .gitignore, …) if the root ever
    # changes to a repo checkout
    location ~ /\. {
        deny all;
        return 404;
    }

    # Serve real files; everything else 404s (single-page app, no routes)
    location / {
        try_files $uri $uri/ =404;
    }

    # The HTML shell must always be fresh so bundle deploys take effect
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    # Fingerprint-free asset names: cache politely, not aggressively
    location ~* \.(js|css|png|svg|ico|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public";
    }

    gzip on;
    gzip_comp_level 5;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/pompedin /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### HTTPS

Because browser storage and file pickers require a secure context,
put the site behind TLS before sharing it beyond localhost — e.g.
`sudo certbot --nginx -d pompedin.example.com` (certbot edits the
block above to add the certificate and redirect).

## Adding brushes to the web build

Drop PNGs into `src/assets/brushes/` and list them in
`src/assets/brushes/manifest.json`:

```json
{
    "brushes": ["Cinemint Brush.png", "My Brush.png"]
}
```

Then rebuild (`npm run build:frontend`). Desktop users are unaffected —
the web manifest is only read by the web adapter.

## Under the hood (for contributors)

- `src/js/01a-platform.js` — `VF.platform`: adapter selection
  (`window.__TAURI__` present → Tauri, else web), plus both adapters.
- App code never touches `window.__TAURI__` anymore except in two
  capability-gated spots: the MP4 pipeline (`26-export-mp4.js`) and
  window-close interception (`24-init.js`).
- `VF.platform.capabilities` flags feature availability
  (`mp4Export`, `windowClose`, `brushFolder`, `autosave`).
- Web autosave mirrors the Rust data-safety layer: rotate `.bak1–3`
  before writing, JSON-serialized the same way. Crash recovery at
  startup works identically through `loadProjectFile`/`clearAutosave`.
- On web, a successful disk save clears the autosave (the desktop
  equivalent of clearing it on clean app exit), and a `beforeunload`
  guard warns about unsaved work when closing the tab.

## Future work

- **MP4 export in the browser** — the natural fit is WebCodecs
  (`VideoEncoder`) plus an MP4 muxer, or `ffmpeg.wasm` (the latter
  would require cross-origin isolation headers: COOP/COEP). The
  platform interface already isolates this behind
  `capabilities.mp4Export`, so it can be added without touching
  call sites.
- **Persisting save handles across sessions** — `FileSystemFileHandle`
  is structured-cloneable into IndexedDB, which would let Ctrl+S
  keep writing to the same file after a page reload (Chromium only).
