I went through all 35 JS modules, the CSS, and the Rust top-to-bottom. This is static reading — I can't run it — but several of these I traced through carefully enough to be confident they reproduce. Ordered by how much they'd actually hurt.

## Serious (data loss / corruption)

**1. Undo immediately after launch (or after New Project) empties the project.**
`init()` in `24-init.js` calls `VF.addLayer('Layer 1','vector')`, and `addLayer` (`06-layers.js`) calls `VF.saveHistory()` *before* pushing the new layer — so it snapshots the empty `S.layers` state. The undo stack therefore starts with one entry: a zero-layer project. One Ctrl+Z at startup restores it, `restoreSnapshot` sets `S.activeId = 1` (a layer that doesn't exist), and now `VF.AL()` returns `undefined`, so the brush/eraser/etc. silently no-op (`if (!l ...) return;`) — the canvas is dead until you make a new layer. The New Project handler in `20-project-io.js` does `VF.undoStack = []` and then immediately `addLayer(...)`, re-seeding the same empty snapshot, so it has the identical bug. Fix: clear `undoStack`/`redoStack` *after* the initial `addLayer`, or skip history on the very first layer.

**2. Clicking with Select/Eraser/Transform on a tweened or looped in-between frame bakes it into a hard keyframe.**
`goFrame()` (`16-timeline.js`) carefully guards against persisting derived frames (`var derived = res && (res.isTween || res.isLoop); if (!derived ...) VF.saveFrame();`). But the tool `onMouseUp` handlers don't share that guard — `tSelect.onMouseUp` falls through to `else { VF.saveFrame(); }` on *any* click (even a no-op selection click), `tEraser.onMouseUp` always calls `saveFrame()`, and `tXform.onMouseUp` likewise. And `saveFrame()` itself (`04-serialization.js`) only checks `!res.isTween`, not `isLoop`. So: navigate to an interpolated in-between frame, click once → `serPL` of the tweened/looped drawing gets written to `l.frames[currentFrame]`, creating a keyframe and breaking the tween/loop. It's silent and trivially easy to trigger. Fix: give `saveFrame()` the same derived-frame guard `goFrame()` uses (bail out when the current frame resolves to a tween/loop and nothing was actually drawn).

## Moderate

**3. `saveHistory()` wipes every layer's render cache on each call.** `snapshotLayers()` (`05-history.js`) does `S.layers.forEach(l => l.cache = {})` on the *live* objects, not just the serialized copy. Since `saveHistory()` fires at the start of essentially every edit, every brush stroke invalidates the rasterized cache of all inactive layers, forcing re-rasterization on the next render. Correctness is fine; it's a steady performance tax that'll show up with many layers. You only need to strip caches from the JSON copy, not mutate the originals.

**4. `dupLayer()` creates two undo entries.** It calls `VF.saveHistory()` and then `VF.addLayer(...)`, which calls `saveHistory()` again (`06-layers.js`). Duplicating a layer needs two undos to fully reverse, and the first undo lands on a near-identical state. (Importing an image is fine — it only goes through `addLayer` once.)

**5. Layer opacity and visibility changes aren't undoable and don't mark the doc dirty.** The opacity sliders (`22-ui-bindings.js`) and the visibility `.vbtn` toggle (`17-layers-ui.js`) mutate `l.opacity` / `l.vis` directly with no `saveHistory()` and no `VF._isDirty = true`. So they can't be undone, and if you change only those and close, the unsaved-changes prompt won't fire (you'd lose them unless autosave happened to run). Z-order, blend mode, and layer-settings changes *do* save history correctly, so these two are the odd ones out.

**6. Selecting an object silently rewrites your brush settings.** `syncUIFromSelection` (`30-selection-sync.js`) copies the selected item's stroke/fill/size/color/texture into `S.cfg` and the ribbon toggles — including setting `S.cfg.autoFill = false` when the selected item has no fill. Those are the same globals the brush reads for *new* strokes, so selecting a stroke-only shape turns your Fill toggle off, and your next freehand stroke comes out unfilled. Defensible as "match the selection for editing," but it leaks into new-stroke defaults, which is surprising.

## Cosmetic / minor

**7. Hide-edge looks broken on transparent canvases.** `getBgColor()` in `12-tool-hide-edge.js` returns `#ffffff` when the canvas is transparent, so "hidden" edges become opaque white overlays — which then show up as white streaks in a transparent PNG/sequence export instead of erasing cleanly.

**8. Canvas guides drift when the active layer has a transform.** In the render override (`33-tools-advanced.js`), `guideGroup` is created with `new Group()` *after* `_origRender()` has activated the active drawing layer, so the group is parented to that layer and inherits its transform matrix — then gets the camera transform applied on top. With an untransformed layer (the default) it's invisible, but keyframe a layer translate/rotate/scale and the grid/safe-zone/center guides slide off with it. Activating `fgLayer` before creating the group fixes it.

**9. Dead code in the color handlers.** `22-ui-bindings.js` does `$('#sw-stroke').css('background', ...)` and `$('#sw-fill')...`, but there are no `#sw-stroke`/`#sw-fill` elements in the HTML (the swatches are the `<input type="color">` themselves). Harmless no-ops.

**10. Old projects can load with undefined config fields.** The `33-tools-advanced.js` defaults (`symmetryHPos`, `showGrid`, `guideOpacity`, etc.) run once at script load. On project load (`20-project-io.js`) `S.cfg = state.cfg || S.cfg` replaces the whole object, so a project saved by an earlier build lacking those keys leaves them `undefined` — e.g. `$('#rng-guide-opacity').val(undefined)`. Projects saved by the current build round-trip fine; only older/foreign files are affected. Re-applying the defaults after load would harden it.

**11. Ctrl+X won't cut camera keyframes.** In `23-keyboard.js`, the timeline cut path explicitly `return`s on `sel.l === '__camera'`, but Ctrl+C copies camera keys and Delete removes them. Just an inconsistency.

**12. Stale shortcut letters in the left-toolbar tooltips.** Carrying over from the Moho remap: the `data-tip` strings in `index.html` still say `Brush (B)`, `Paint Bucket (G)`, `Select / Edit Vertices (V)`, `Camera (C)`, `Zoom (Z / Scroll)`, etc., which no longer match the defaults (F, P, T, 4…). Cosmetic, but it's user-facing and wrong now.

If you want, I can turn the top two into actual patches — they're both small, surgical fixes (a couple of lines in `saveFrame` and in the init/new-project flow) and they're the only ones in here that can quietly corrupt a user's animation.