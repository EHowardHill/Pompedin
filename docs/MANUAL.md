# Pompedin — User Manual

*For Pompedin 1.1.x. A short first-run tour is built into the app
(Help → Getting Started), and the Keys button opens a live, remappable
shortcut panel.*

## 1. The interface

- **Left toolbar** — the drawing tools (hover for names + shortcut keys).
- **Top ribbon** — project I/O, undo/redo, brush settings, onion skins,
  layers, timeline controls, export options, and the Info group
  (About / Help / Keys).
- **Timeline (bottom)** — one row per layer, one column per frame.
  Camera keys live on their own `__camera` track.
- **Layers panel (right)** — visibility, nesting into folders, opacity,
  blend mode, per-layer settings.

## 2. Frame-by-frame basics

A *keyframe* holds a layer's drawing for a frame. Between keyframes the
canvas keeps showing the previous key (like a traditional exposure
sheet).

- **Draw**: Brush (F) freehand; Fill (P) fills closed shapes; Eraser (E)
  removes; Hide Edge (H) masks individual curve segments.
- **New blank frame**: F5. **Duplicate the current frame**: F6 — the
  standard way to animate: draw, duplicate, adjust.
- **Navigate**: ← / → between frames, ↑ / ↓ between layers.
- **Play / stop**: Space. FPS and length are set in the timeline's
  timing inputs.
- Timeline context menu (right-click a key): copy/paste/cut, loop
  settings, toggle tween, delete, insert/remove frame.

## 3. Tweening and loops

**Tween** — right-click a keyframe → *Toggle Tween*. The layer then
interpolates smoothly from that keyframe to the next one (positions,
handles, stroke width, and texture-stroke pressure all lerp). Rules:

- Both keys' drawings must have the **same number of paths/segments**;
  otherwise the frame simply shows the earlier key.
- Editing anything on an in-between frame *creates* a new keyframe
  there; a no-op click never does.

**Loop** — right-click a keyframe → *Loop Settings*. Frames after that
key cycle through a span instead of holding:

- *Relative*: the span counts backwards from the loop key
  (length = the key's frame − value).
- *Absolute*: the span starts at the given frame and ends at the loop
  key.
- The loop at the latest key at-or-before the current frame wins.

## 4. Camera & layer transforms

- The **Camera tool (4)** frames the whole scene: drag the gizmo body to
  pan, corners to zoom, the outer circle to rotate. Each saved position
  is a key on the `__camera` track, interpolated during playback.
- **Per-layer transforms** (Translate M / Rotate R / Scale S) keyframe a
  transform *on one layer* — separate from the camera, so a character can
  move while the camera pans.

## 5. Layers, folders, switch folders

- Group layers in **folders**; reorder by dragging.
- A **switch folder** shows exactly one child per frame — pick the
  visible child by clicking its visibility dot, or set switch keys on
  the timeline. Useful for mouths, poses, angle changes.
- **Reference layers** are excluded from exports.
- Per-layer **wobble** adds hand-drawn jitter (per-frame or static seed).
- **Grain** overlays a film-grain texture across the canvas.

## 6. Onion skins

Toggle in the ribbon (Ctrl+L). Each skin is a neighboring frame shown
tinted — **blue = past, green = future** — at adjustable opacity. Skins
can be relative (±N frames) or absolute frame numbers, and *isolate*
mode shows onions only for the active layer. They are hidden during
playback and export.

## 7. Audio

Import an audio track (wav/mp3/ogg/flac/aac/m4a/webm); it shows as a
waveform on the timeline, plays with the animation, and is embedded in
saved projects. Volume syncs into MP4 exports.

## 8. Export

All exports honor the **From / To** range and **Scale** multiplier. The
**Preset** dropdown sets both in one click: Canvas, YouTube 1080p,
YouTube 4K (auto-fits while preserving aspect ratio), or Web GIF
(960 px, 128 colors + dithering).

- **PNG** — the current frame.
- **PNG sequence** — numbered per-frame files.
- **MP4** — H.264 + AAC; frames render off-screen and pipeline to the
  encoder. On Windows/macOS the bundled FFmpeg runs as a separate
  process (GPLv3 — see `docs/FFMPEG-LICENSING.md`); on Linux the
  system's `ffmpeg` package is used.
- **GIF** — with loop, dither, and color-count options.
- **Spritesheet** — frames tiled into one image.

Reference layers, onion skins, and guides never appear in exports.

## 9. Saving, backups, recovery

- **Ctrl+S** saves to the current path; **Ctrl+Shift+S** saves as.
- Every save is **atomic** (a crash mid-save can't corrupt the file) and
  keeps the **last three good writes** as `yourfile.json.bak1`–`.bak3`.
- **Autosave** runs every minute in the background.
- If the app is killed, the next launch offers to restore the autosave.
- If a project file is unreadable, the loader offers the newest backup.
- Old files keep loading; newer-format files explain what to do.

**Crash reports** (About → Crash Reports) are written *locally* —
nothing is ever sent anywhere unless you attach the file to a bug
report yourself.

## 10. Shortcuts

Open the **Keys** panel (ribbon → Keys) to view and remap every binding.
Defaults follow a Moho-like layout:

| Action | Key | Action | Key |
|---|---|---|---|
| Brush | F | Select | T |
| Eraser | E | Fill | P |
| Lasso | G | Hide Edge | H |
| Translate | M | Rotate | R |
| Scale | S | Camera | 4 |
| Zoom | Z | Rotate view | 8 |
| Eyedropper | L | Play/Stop | Space |
| Prev/Next frame | ← / → | Layer up/down | ↑ / ↓ |
| New frame | F5 | Duplicate frame | F6 |
| Delete frame | Shift+F5 | Reset view | Home |
| Fit to screen | Shift+Home | Grid | Ctrl+G |
| Onion skins | Ctrl+L | Symmetry H/V | Shift+H / Shift+V |

Reserved (not remappable): Ctrl+Z/Y/S/Shift+S/C/V/X/A, Esc, Delete.

## 11. Preferences & localization

- **Window size/position** are remembered across launches.
- **Theme, canvas background, tablet mode** persist locally.
- **Tool settings** (brush size, colors, …) live inside each project —
  loading a project restores its settings; a fresh launch starts from
  defaults.
- UI strings are being centralized for localization
  (`src/js/01b-i18n.js`); the chosen locale persists locally.
- Details: `docs/PREFERENCES.md`.
