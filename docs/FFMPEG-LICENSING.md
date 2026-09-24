# FFmpeg Distribution & Licensing Audit

**Audit date:** 2026-09-23 · **Auditor:** automated release-engineering pass
(Phase 3, TASKS.md) · **Status:** documented, one follow-up open (macOS pin)

Pompedin bundles FFmpeg as a Tauri sidecar (`externalBin: bin/ffmpeg` in
`tauri.conf.json`) for MP4 export. This audit records *what* is shipped,
*which license* applies, and *what obligations* follow from that.

## What is shipped, per platform

| Platform | Binary | Source | Pinned & verified? |
|---|---|---|---|
| Windows x64 | `bin/ffmpeg-x86_64-pc-windows-msvc.exe` (96.4 MB) | gyan.dev "essentials" | **Yes** — `ffmpeg -version` reports `2026-03-09-git-9b7439c31b-essentials_build-www.gyan.dev`, gcc 15.2.0 (MSYS2) |
| macOS ARM | `bin/ffmpeg-aarch64-apple-darwin` (59.7 MB) | evermeet.cx | **Partial** — source per About dialog; run `ffmpeg -version` on a Mac and record it below (follow-up) |
| Linux | *(none bundled)* | system package manager (`apt`/`dnf`/`pacman`) | Runtime expectation; `mp4_render` falls back to `ffmpeg` on PATH with an actionable error message if missing |

Sidecar resolution lives in `mp4_render` (`src-tauri/src/lib.rs`): Linux uses
`app.shell().command("ffmpeg")`; Windows/macOS use `app.shell().sidecar("ffmpeg")`.

## License determination

FFmpeg core is LGPL-2.1+, **but** the shipped binaries are GPL builds:

- Windows binary config (from `-version` output): `--enable-gpl
  --enable-version3 --enable-libx264 …` → **GPLv3**. libx264 alone is GPL;
  `--enable-gpl`/`--enable-version3` make it explicit.
- macOS evermeet.cx builds ship libx264 → treat as **GPL** until the pinned
  build's `-version` config is recorded. Do not assume LGPL.

### Why the app itself can stay BSD-3-Clause

FFmpeg runs as a **separate process** communicating over pipes/argv — not
linked into the binary. This is the "mere aggregation" carve-out (GPLv3 §5):
the combined distribution contains two independent programs. Pompedin's own
code remains BSD-3-Clause; the FFmpeg binary remains GPL.

This is the same position taken by many commercial tools that shell out to a
bundled GPL ffmpeg. It is broadly accepted but not litigation-tested; if the
project ever wants zero GPL exposure, the alternatives are:

1. Ship an **LGPL-only ffmpeg build** (no `--enable-gpl`, no libx264 → but then
   no hardware-agnostic h.264 encode; would need e.g. `--enable-libopenh264`
   which is BSD-licensed) — build it per-platform in CI.
2. Don't bundle at all: ask the user to install ffmpeg (the current Linux
   behavior) — loses out-of-the-box export.

## Distribution obligations checklist (GPLv3, for each bundled binary)

- [x] The binary is unmodified from the upstream build (no repackaging) —
      keep verifying on every binary refresh.
- [x] License text shipped next to the app: `bin/LICENSE-FFMPEG.txt` is
      bundled via `bundle.resources` and the About dialog links sources.
- [x] Written offer / source pointers for the *exact* build (gyan.dev and
      evermeet.cx publish their build scripts; LICENSE-FFMPEG.txt lists
      them and offers source on request).
- [ ] **Follow-up:** record the macOS binary's exact version + config
      (`ffmpeg -version` output) in the table above, and in
      `LICENSE-FFMPEG.txt`, at the next binary refresh.
- [ ] **Follow-up (nice-to-have):** pin binaries by checksum in CI so a
      refreshed binary can't ship without re-running this audit.

## Binary refresh procedure

1. Download the new build from gyan.dev (Windows) / evermeet.cx (macOS).
2. Replace the file in `src-tauri/bin/` keeping the Tauri sidecar naming
   convention: `ffmpeg-<target-triple>[.exe]`.
3. Run `ffmpeg -version`, record the version + configuration line in the
   table above and in `bin/LICENSE-FFMPEG.txt`.
4. Confirm `--enable-gpl` (and libx264) status hasn't changed — if it ever
   becomes LGPL-only, update LICENSE-FFMPEG.txt and this document.
5. Smoke-test an MP4 export on that platform.

## Linux notes

No binary ships for Linux; users install from their package manager
(distro builds are typically LGPL or GPL depending on flags — that's the
distro's obligation, not Pompedin's). The error message in `mp4_render`
guides users to install it. CI release builds for Linux therefore need
**no** sidecar (the `tauri build` matrix note in
`.github/workflows/ci.yml` about missing platform binaries applies to
Windows/macOS only if the committed binaries are absent).
