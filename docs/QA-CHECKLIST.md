# Pompedin — Release QA Checklist

Run through every item before shipping a release build. The checklist is
organized so one pass covers one area at a time; tick each box. Anything
that fails blocks the release.

**Build under test:** `npm run build` on the release commit
**Platform(s):** run the Platform-specific section on each supported OS
**Project files:** keep a "torture project" (20+ layers, 100+ frames,
tweens, loops, camera keys, texture brushes, image layers, folders,
audio) for sections 2–6.

## 1. Launch & First-Run

- [ ] App opens without console errors (devtools on release build)
- [ ] CSP regression check (Phase 3): with the tightened CSP, verify
      brushes load (data: URLs), FontAwesome icons render, audio plays,
      and MP4/PNG export works — a silent CSP violation appears as a
      console error
- [ ] Fresh data dir: no crash-recovery prompt appears
- [ ] Fresh data dir: the Getting Started card appears once; it does NOT
      appear on the second launch; Help → Getting Started re-opens it
- [ ] The Keys (shortcuts) ribbon button opens the remapping panel;
      remapping a key works and survives restart
- [ ] Window title shows "Pompedin — Untitled"
- [ ] Seeded "Layer 1" exists and is active
- [ ] Canvas centered; pan (middle-drag) and zoom (scroll) work
- [ ] Brush folder toast/behavior: refresh brush list works

## 2. Drawing & Tools

- [ ] Freehand brush stroke renders at correct size/color
- [ ] Texture brush stroke renders and re-serializes (deselect + reselect frame)
- [ ] Pressure mode (if pen available) varies stroke width
- [ ] Eraser removes stroke parts; undo restores them
- [ ] Fill tool fills a closed shape
- [ ] Select tool: click-drag moves a stroke; vertex editing works
- [ ] Transform tool: rotate/scale a selection; undo restores
- [ ] Hide-edge tool works on opaque canvas background
- [ ] Every tool: one no-op click on a **tweened** frame does NOT create a
      keyframe (timeline shows no new key) — this is the Phase 0 regression
- [ ] Drawing on a tweened frame DOES create a keyframe when you really draw

## 3. Timeline, Tweens & Loops

- [ ] Frame navigation (arrow keys, timeline click, scrub) updates canvas
- [ ] Add keyframe / clear keyframe / duplicate frame work
- [ ] Tween between two keys interpolates during scrub and playback
- [ ] Loop (relative + absolute) rewinds correctly during playback
- [ ] **Drag-move a keyframe that has a tween/loop marker**: marker follows
      the key, no console error (Phase 1 regression fix)
- [ ] Copy/paste frame; cut works for layer AND camera keyframes
- [ ] Onion skins: before/after show, opacity slider updates them, isolate
      mode restricts to active layer, tint colors correct (green = future,
      blue = past)
- [ ] Playback at 12 fps stays smooth with onion skins OFF during play

## 4. Layers & Organization

- [ ] Add/duplicate/delete layer; delete blocked on last layer
- [ ] Duplicating a layer needs exactly ONE undo to reverse
- [ ] Visibility toggle is undoable and marks the project dirty
- [ ] Opacity slider: drag once = one undo step
- [ ] Folders: nest layers, collapse, reorder via drag
- [ ] Switch folders: pick child per frame; scrubbing follows the switch
- [ ] Blend modes apply; layer settings modal round-trips (wobble, etc.)
- [ ] Z-order changes reflect immediately on canvas

## 5. Camera & Effects

- [ ] Camera tool: pan/zoom/rotate gizmos; keys appear on timeline
- [ ] Camera interpolates between keys during playback
- [ ] Grain overlay: toggle + amount; consistent across frames
- [ ] Wobble: stroke/fill jitter per-frame and static seeds both work
- [ ] Layer transform keys (translate/rotate/scale) tween correctly

## 6. Audio & Export

- [ ] Import audio; waveform shows; play/pause syncs with timeline
- [ ] Audio survives project save/load round-trip
- [ ] PNG export: transparent background correct when enabled
- [ ] PNG sequence export: frame count and naming correct
- [ ] MP4 export completes; plays in a system player; audio included
- [ ] Export with camera keys uses the camera path
- [ ] Cancel an export mid-way; app stays responsive after

## 7. Project I/O & Data Safety (Phase 0 regression suite)

- [ ] Save (Ctrl+S), Save As, load round-trip: layers, tweens, loops,
      camera, audio, cfg all survive
- [ ] Save 4× and check `project.json.bak1`–`.bak3` exist next to the file
- [ ] Corrupt a project file (truncate it) → Open offers the backup
- [ ] Corrupt the file AND all backups → Open shows a clear error, app stable
- [ ] Open a project saved by a NEWER formatVersion → clear "update the app"
      message (can be simulated by hand-editing formatVersion up)
- [ ] Loading a project clears old undo history (undo after load does NOT
      resurrect the previous project)
- [ ] Kill the process (task manager) while dirty → relaunch offers the
      autosave; restore works; restored project is marked dirty/untitled
- [ ] Clean exit (with and without unsaved changes) → NO recovery prompt
      on next launch
- [ ] Autosave doesn't fight a manual save (save while autosave toast-adjacent)

## 8. Undo/RedO Drill (all tools)

- [ ] For each tool (brush, eraser, fill, select, transform, camera):
      make an edit → Ctrl+Z reverses it → Ctrl+Y (or Shift+Z) redoes it
- [ ] Undo depth reaches MAX_HISTORY (30) without visible slowdown
- [ ] Undo immediately after app start does NOT empty the project
      (Phase 0 regression)

## 9. Platform-Specific (run per OS)

- [ ] **Windows**: installer runs clean; SmartScreen shows unsigned warning
      (expected until Phase 3 signing) but install proceeds
- [ ] **macOS**: app launches; NOTARIZATION warning expected until signed
- [ ] **Linux**: AppImage runs; FFmpeg sidecar found (export works)
- [ ] HiDPI: move window between monitors with different DPI — raster caches
      invalidate (layers don't blur), UI stays crisp
- [ ] Long path/filename project saves fine
- [ ] Project with non-ASCII name/layer names saves and loads

## 10. Android (once the SDK/device checklist in docs/ANDROID-GUIDE.md runs)

- [ ] App launches on device/emulator; touch drawing works (finger + stylus pressure if available)
- [ ] Two-finger pan + pinch zoom on the canvas; long-press opens the timeline context menus
- [ ] Save works (writes to the app documents dir — no dialog) and reloads
- [ ] Image/audio import — verify against `content://` URIs (the one known unknown; see guide §2)
- [ ] MP4 export completes via the MediaCodec plugin (video + audio case)
- [ ] APK/AAB size is small (bundled frontend — no FontAwesome source trees)

---

## 11. Performance Smoke (informal, record numbers)

- [ ] Torture project: scrub playback frame time feels < 50 ms/frame
- [ ] With onion skins on, drawing latency feels unchanged vs onions off
- [ ] Save time on torture project < 2 s
- [ ] Export 24 frames × 1080p completes without UI freeze

---

*Add a dated pass/fail note below for each release:*

| Date | Version | OS | Tester | Result | Notes |
|------|---------|----|--------|--------|-------|
|      |         |    |        |        |       |
