'use strict';

/**
 * Regression tests for the performance caches added in the 2026-09
 * optimization pass. Each cache must invalidate on every user action
 * that could change its result — a missed invalidation is a rendering
 * bug or (worse) silent data corruption:
 *
 *   tween cache (04-serialization.js)  → keyframe add/delete/move,
 *     frame data replacement, tween toggle, undo/redo restore
 *   sorted-keys cache (01-state.js)    → key add/delete/rename
 *   onion skin cache (07-render.js)    → opacity change, data change,
 *     explicit clear (project load / new project)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./harness');

function pathJSON(x, strokeWidth) {
    return JSON.stringify({
        className: 'Path',
        segments: [
            { point: { x: x, y: 0 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } }
        ],
        strokeWidth: strokeWidth
    });
}

function makeTweenLayer() {
    return {
        id: 1, name: 'L1', type: 'vector',
        vis: true, opacity: 1, z: 0,
        frames: { 0: [pathJSON(0, 2)], 10: [pathJSON(100, 10)] },
        tweens: { 0: true }, transforms: {}, loops: {},
        cache: {}, parentId: null
    };
}

/* ── tween cache ─────────────────────────────────────────── */

test('tween cache: repeat resolution returns the memoized result', () => {
    const VF = loadCore();
    const l = makeTweenLayer();

    const r1 = VF.getResolvedFrame(l, 5);
    const r2 = VF.getResolvedFrame(l, 5);
    assert.strictEqual(r1, r2, 'second call must hit the cache (same object)');
});

test('tween cache: replacing frame data invalidates', () => {
    const VF = loadCore();
    const l = makeTweenLayer();

    const r1 = VF.getResolvedFrame(l, 5);

    // User draws on key 0 → saveFrame writes a fresh array
    l.frames[0] = [pathJSON(20, 2)];

    const r2 = VF.getResolvedFrame(l, 5);
    assert.notStrictEqual(r2, r1, 'cache must miss after data replacement');
    const parsed = JSON.parse(r2.data[0]);
    assert.ok(Math.abs(parsed.segments[0].point.x - 60) < 1e-9, 'recomputed from new key');
});

test('tween cache: inserting a keyframe between the pair invalidates', () => {
    const VF = loadCore();
    const l = makeTweenLayer();

    const r1 = VF.getResolvedFrame(l, 5);
    assert.ok(Math.abs(JSON.parse(r1.data[0]).segments[0].point.x - 50) < 1e-9);

    l.frames[7] = [pathJSON(28, 2)];   // new key between 0 and 10

    const r2 = VF.getResolvedFrame(l, 5);
    assert.notStrictEqual(r2, r1, 'next key changed → must recompute');
    // Now tweening 0 → 7 at t = 5/7: x = 0 + (28 - 0) * 5/7 = 20
    const parsed = JSON.parse(r2.data[0]);
    assert.ok(Math.abs(parsed.segments[0].point.x - 20) < 1e-9);
});

test('tween cache: a keyframe MOVE (same array, new key) invalidates', () => {
    const VF = loadCore();
    const l = makeTweenLayer();

    const r1 = VF.getResolvedFrame(l, 5);

    // Move key 0 → 2 the way the timeline does it (16-timeline.js):
    // the same data array lands under a new key AND the tween flag
    // moves with it.
    const arr = l.frames[0];
    delete l.frames[0];
    l.frames[2] = arr;
    delete l.tweens[0];
    l.tweens[2] = true;

    const r2 = VF.getResolvedFrame(l, 5);
    assert.notStrictEqual(r2, r1, 'prev changed → must recompute');
    // t is now (5-2)/(10-2) = 0.375: x = 0 + 100 * 0.375 = 37.5
    const parsed = JSON.parse(r2.data[0]);
    assert.ok(Math.abs(parsed.segments[0].point.x - 37.5) < 1e-9);
});

test('tween cache: toggling the tween off bypasses the cache entirely', () => {
    const VF = loadCore();
    const l = makeTweenLayer();

    VF.getResolvedFrame(l, 5);          // populate the cache

    l.tweens = {};                      // tween disabled at runtime

    const r = VF.getResolvedFrame(l, 5);
    assert.strictEqual(r.isTween, undefined, 'no tween → raw previous key');
    assert.strictEqual(r.keyFrame, 0);
    assert.strictEqual(r.data, l.frames[0]);
});

test('tween cache: loop config change resolves differently', () => {
    const VF = loadCore();
    const l = {
        id: 1, name: 'L1', type: 'vector', vis: true, opacity: 1, z: 0,
        frames: { 0: [pathJSON(0, 2)], 5: [pathJSON(50, 2)] },
        tweens: {}, loops: { 5: { active: true, mode: 'absolute', val: 4 } },
        transforms: {}, cache: {}, parentId: null
    };

    // f=6, elapsed=1, loopLen=5-4+1=2 → targetF = 4 + (0 % 2) = 4 → key 0
    const r1 = VF.getResolvedFrame(l, 6);
    assert.strictEqual(r1.loopSource, 4);

    // Loop settings edited in the modal → brand-new config object
    l.loops[5] = { active: true, mode: 'absolute', val: 0 };

    // loopLen=5-0+1=6 → targetF = 0 + (0 % 6) = 0 → key 0, but via a
    // different source frame
    const r2 = VF.getResolvedFrame(l, 6);
    assert.strictEqual(r2.loopSource, 0, 'new loop config must be picked up');
});

test('tween cache: undo/redo restore (fresh layer objects) recomputes', () => {
    const VF = loadCore();
    const l = makeTweenLayer();

    const r1 = VF.getResolvedFrame(l, 5);

    // History restore: S.layers is replaced by JSON-parsed copies —
    // new object identity, so the WeakMap-keyed cache must miss.
    const restored = JSON.parse(JSON.stringify(l));
    assert.notStrictEqual(restored, l);

    const r2 = VF.getResolvedFrame(restored, 5);
    assert.notStrictEqual(r2, r1, 'new layer object → cache dropped');

    // ...but the recomputed result must be identical in value
    assert.deepStrictEqual(
        r2.data.map(function (s) { return JSON.parse(s); }),
        r1.data.map(function (s) { return JSON.parse(s); })
    );
});

/* ── sorted-keys cache (via getResolvedFrame resolution) ──── */

test('sorted-keys cache: keyframe move changes resolution', () => {
    const VF = loadCore();
    const l = makeTweenLayer();
    delete l.tweens;   // plain keyframes only

    // f=5 resolves to key 0
    assert.strictEqual(VF.getResolvedFrame(l, 5).keyFrame, 0);

    // Move key 0 → 2 (rename with count preserved elsewhere)
    const arr = l.frames[0];
    delete l.frames[0];
    l.frames[2] = arr;

    assert.strictEqual(VF.getResolvedFrame(l, 5).keyFrame, 2,
        'resolution must see the moved key');
});

/* ── onion skin cache ────────────────────────────────────── */

test('onion cache: reusable while opacity and data are unchanged', () => {
    const VF = loadCore();
    const key = '1|0|4|0';
    const dataRef = [pathJSON(0, 2)];
    const group = { marker: 'group' };

    VF._onionCache.set(key, { op: 0.16, dataRef: dataRef, group: group });

    assert.strictEqual(VF._onionCacheReusable(key, 0.16, dataRef), group);
});

test('onion cache: opacity change forces a rebuild', () => {
    const VF = loadCore();
    const key = '1|0|4|0';
    const dataRef = [pathJSON(0, 2)];

    VF._onionCache.set(key, { op: 0.16, dataRef: dataRef, group: { marker: 1 } });

    assert.strictEqual(VF._onionCacheReusable(key, 0.5, dataRef), null,
        'user dragged the onion opacity slider');
});

test('onion cache: new frame data (edited keyframe) forces a rebuild', () => {
    const VF = loadCore();
    const key = '1|0|4|0';
    const dataRef = [pathJSON(0, 2)];

    VF._onionCache.set(key, { op: 0.16, dataRef: dataRef, group: { marker: 1 } });

    const editedData = [pathJSON(42, 2)];   // saveFrame always writes a NEW array
    assert.strictEqual(VF._onionCacheReusable(key, 0.16, editedData), null);
});

test('onion cache: unknown key is a miss', () => {
    const VF = loadCore();
    assert.strictEqual(VF._onionCacheReusable('nope|0|4|0', 0.16, []), null);
});

test('onion cache: project load / new project clears it', () => {
    const VF = loadCore();
    const key = '1|0|4|0';
    const dataRef = [pathJSON(0, 2)];

    VF._onionCache.set(key, { op: 0.16, dataRef: dataRef, group: { marker: 1 } });
    VF.clearOnionCache();

    assert.strictEqual(VF._onionCacheReusable(key, 0.16, dataRef), null);
    assert.strictEqual(VF._onionCache.size, 0);
});
