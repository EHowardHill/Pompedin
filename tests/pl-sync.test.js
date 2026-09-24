'use strict';

/**
 * Phase 2 pl-sync regression tests: the paper-layer sync markers that let
 * loadFrame / syncLayerState skip redundant rebuilds.
 *
 * A missed skip is only a performance issue; a WRONG skip would show
 * stale canvas content or lose edits — these tests pin the rules:
 *
 *   - loadFrame rebuilds when the resolved data reference differs
 *   - loadFrame skips when the paper layer already shows that data
 *   - saveFrame marks the layer in sync (pl IS the source of the data)
 *   - the raster-cache path re-marks against its cache entry, so a layer
 *     going inactive → active always rebuilds from data
 *   - syncLayerState skips re-serialization when already in sync
 *   - saveHistory drops duplicate snapshots
 *   - restoreSnapshot resets all markers (paper layers are recreated)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./harness');

function pathJSON(x) {
    return JSON.stringify({
        className: 'Path',
        segments: [{ point: { x: x, y: 0 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } }],
        strokeWidth: 2
    });
}

function setupActiveLayer(VF, frames) {
    const l = {
        id: 1, name: 'L1', type: 'vector', vis: true, opacity: 1, z: 0,
        frames: frames, tweens: {}, transforms: {}, loops: {},
        cache: {}, parentId: null
    };
    VF.S.layers = [l];
    VF.S.activeId = 1;
    VF.S.tl.frame = 0;

    // UI plumbing that only the full app provides:
    VF.uiLayers = function () {};
    VF.uiTimeline = function () {};
    VF.render = function () {};

    const calls = { desPL: 0, serPL: 0, removeChildren: 0 };
    VF.desPL = function (pl, data) { calls.desPL++; };
    VF.serPL = function (pl) { calls.serPL++; return [pathJSON(999)]; };

    const pl = {
        children: [],
        remove() {},
        removeChildren() { calls.removeChildren++; pl.children.length = 0; }
    };
    VF.pLayers[1] = pl;

    return { l, pl, calls };
}

/* ── marker primitives ────────────────────────────────────── */

test('pl-sync: mark / check / reset', () => {
    const VF = loadCore();
    const ref = ['a'];
    assert.strictEqual(VF._plSynced(1, ref), false, 'unknown layer is never synced');
    VF._plMarkSync(1, ref);
    assert.strictEqual(VF._plSynced(1, ref), true);
    assert.strictEqual(VF._plSynced(1, ['a']), false, 'content equality is NOT enough — identity is the contract');
    VF._plMarkSync(1, null);
    assert.strictEqual(VF._plSynced(1, null), true, 'null (empty frame) is trackable too');
    VF._plResetSync();
    assert.strictEqual(VF._plSynced(1, null), false);
});

/* ── loadFrame skips for the ACTIVE layer ─────────────────── */

test('loadFrame: rebuilds once, then skips while data is unchanged', () => {
    const VF = loadCore();
    const { calls } = setupActiveLayer(VF, { 0: [pathJSON(5)] });

    VF.loadFrame(1, 0);
    assert.strictEqual(calls.desPL, 1);
    assert.strictEqual(calls.removeChildren, 1);

    // Second render of the same frame — nothing changed:
    VF.loadFrame(1, 0);
    assert.strictEqual(calls.desPL, 1, 'synced → skip the rebuild');
    assert.strictEqual(calls.removeChildren, 1, 'skip must not even clear the layer');

    // Scrubbing a NON-keyframe that resolves to the same data:
    VF.loadFrame(1, 3);
    assert.strictEqual(calls.desPL, 1, 'same resolved data ref → still skipped');
});

test('loadFrame: rebuilds when the resolved data reference changes', () => {
    const VF = loadCore();
    const { l, calls } = setupActiveLayer(VF, { 0: [pathJSON(5)], 10: [pathJSON(50)] });

    VF.loadFrame(1, 0);
    assert.strictEqual(calls.desPL, 1);

    VF.loadFrame(1, 10);
    assert.strictEqual(calls.desPL, 2, 'different keyframe → rebuild');

    // Someone pastes new content into the current key (fresh array):
    l.frames[10] = [pathJSON(77)];
    VF.loadFrame(1, 10);
    assert.strictEqual(calls.desPL, 3, 'data replaced wholesale → rebuild');
});

test('loadFrame: switching the active layer forces a rebuild', () => {
    const VF = loadCore();
    const { l, calls } = setupActiveLayer(VF, { 0: [pathJSON(5)] });

    VF.loadFrame(1, 0);            // active → rebuild #1
    assert.strictEqual(calls.desPL, 1);
    assert.strictEqual(VF._plSynced(1, l.frames[0]), true);

    // Another layer becomes active; layer 1 goes down the raster-cache
    // path, which re-marks sync against its cache entry — not the data.
    const other = { id: 2, type: 'vector', frames: { 0: [] }, cache: {} };
    VF.S.layers.push(other);
    VF.pLayers[2] = { children: [], remove() {}, removeChildren() {} };
    VF.S.activeId = 2;
    VF.loadFrame(1, 0);
    assert.strictEqual(VF._plSynced(1, l.frames[0]), false,
        'the raster path must not leave a data-marker in place');

    // Switch back: the data marker no longer matches → must rebuild.
    VF.S.activeId = 1;
    const before = calls.desPL;
    VF.loadFrame(1, 0);
    assert.strictEqual(calls.desPL, before + 1, 'coming back active must rebuild from data');
});

/* ── saveFrame marks the layer in sync ────────────────────── */

test('saveFrame: marks the paper layer in sync with what it wrote', () => {
    const VF = loadCore();
    const { l } = setupActiveLayer(VF, { 0: [pathJSON(5)] });

    VF.loadFrame(1, 0);          // pl rebuilt from l.frames[0]
    const before = l.frames[0];

    VF.saveFrame();              // serPL → writes a NEW array
    const after = l.frames[0];
    assert.notStrictEqual(after, before, 'saveFrame replaces the data wholesale');
    assert.strictEqual(VF._plSynced(1, after), true,
        'pl IS the source of the new data — must be marked synced');

    // And the next render skips the rebuild:
    let rebuilt = false;
    VF.desPL = function () { rebuilt = true; };
    VF.loadFrame(1, 0);
    assert.strictEqual(rebuilt, false, 'render right after saveFrame must not rebuild');
});

/* ── syncLayerState / history ─────────────────────────────── */

test('syncLayerState: skips serPL when the layer is already in sync', () => {
    const VF = loadCore();
    const { l, calls } = setupActiveLayer(VF, { 0: [pathJSON(5)] });

    VF.loadFrame(1, 0);
    const dataBefore = l.frames[0];

    VF.saveHistory();   // syncLayerState should skip: pl is in sync
    assert.strictEqual(calls.serPL, 0, 'no re-serialization needed');
    assert.strictEqual(l.frames[0], dataBefore, 'stored data untouched');

    // Force out of sync → syncLayerState re-serializes:
    VF._plResetSync();
    VF.saveHistory();
    assert.strictEqual(calls.serPL, 1, 'out of sync → serPL must run');
    assert.notStrictEqual(l.frames[0], dataBefore);
});

test('saveHistory: duplicate snapshots are not pushed', () => {
    const VF = loadCore();
    const { l } = setupActiveLayer(VF, { 0: [pathJSON(5)] });

    VF.loadFrame(1, 0);
    VF.saveHistory();
    const len1 = VF.undoStack.length;

    VF.saveHistory();   // nothing changed since the last snapshot
    assert.strictEqual(VF.undoStack.length, len1, 'identical state → no new entry');

    l.name = 'renamed';
    VF.saveHistory();
    assert.strictEqual(VF.undoStack.length, len1 + 1, 'real change → new entry');
});

/* ── restoreSnapshot resets markers ────────────────────────── */

test('restoreSnapshot: clears all sync markers (paper layers recreated)', () => {
    const VF = loadCore();
    const { l } = setupActiveLayer(VF, { 0: [pathJSON(5)] });

    VF.loadFrame(1, 0);
    assert.strictEqual(VF._plSynced(1, l.frames[0]), true);

    VF.restoreSnapshot(JSON.stringify(VF.S.layers));
    assert.strictEqual(Object.keys(VF._plSync).length, 0,
        'all pLayers are new objects — every marker must be dropped');

    // Repopulated paper layers come back empty → loadFrame rebuilds:
    VF.pLayers[1] = { children: [], remove() {}, removeChildren() {} };
    let rebuilt = false;
    VF.desPL = function () { rebuilt = true; };
    VF.loadFrame(1, 0);
    assert.strictEqual(rebuilt, true);
});
