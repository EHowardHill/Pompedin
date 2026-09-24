'use strict';

/**
 * Core logic tests: frame resolution (fast / loop / tween), camera and
 * layer-transform interpolation, switch resolution, cached sorted keys,
 * and the tolerant frame-data comparator.
 *
 * These run the REAL production code (src/js) loaded through the
 * harness, with a Paper.js stand-in.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./harness');

/* ── helpers ─────────────────────────────────────────────── */

function makeLayer(VF, extra) {
    const l = {
        id: 1, name: 'L1', type: 'vector',
        vis: true, opacity: 1, z: 0,
        frames: {}, tweens: {}, transforms: {}, loops: {},
        cache: {}, parentId: null
    };
    return Object.assign(l, extra || {});
}

function pathJSON(x, strokeWidth) {
    return JSON.stringify({
        className: 'Path',
        segments: [
            { point: { x: x, y: 0 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
            { point: { x: x, y: 100 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } }
        ],
        strokeWidth: strokeWidth
    });
}

/* ── cachedSortedKeys ────────────────────────────────────── */

test('cachedSortedKeys: empty and missing inputs', () => {
    const VF = loadCore();
    assert.deepStrictEqual(VF.cachedSortedKeys(null), []);
    assert.deepStrictEqual(VF.cachedSortedKeys(undefined), []);
    assert.deepStrictEqual(VF.cachedSortedKeys({}), []);
});

test('cachedSortedKeys: numeric (not lexicographic) order', () => {
    const VF = loadCore();
    const obj = { 10: 1, 2: 1, 1: 1, 33: 1, 4: 1 };
    assert.deepStrictEqual(VF.cachedSortedKeys(obj), [1, 2, 4, 10, 33]);
});

test('cachedSortedKeys: repeated calls hit the cache (same array)', () => {
    const VF = loadCore();
    const obj = { 3: 1, 1: 1, 2: 1 };
    const a = VF.cachedSortedKeys(obj);
    const b = VF.cachedSortedKeys(obj);
    assert.strictEqual(a, b, 'expected the identical cached array');
});

test('cachedSortedKeys: invalidates on key add', () => {
    const VF = loadCore();
    const obj = { 1: 1, 2: 1 };
    VF.cachedSortedKeys(obj);
    obj[5] = 1;
    assert.deepStrictEqual(VF.cachedSortedKeys(obj), [1, 2, 5]);
});

test('cachedSortedKeys: invalidates on key delete', () => {
    const VF = loadCore();
    const obj = { 1: 1, 2: 1, 3: 1 };
    VF.cachedSortedKeys(obj);
    delete obj[2];
    assert.deepStrictEqual(VF.cachedSortedKeys(obj), [1, 3]);
});

test('cachedSortedKeys: invalidates on key RENAME that preserves the count', () => {
    // The move-keyframe case: delete one key, add another in the same
    // tick — a naive count-based check would return the stale sort.
    const VF = loadCore();
    const obj = { 1: 1, 2: 1, 3: 1 };
    VF.cachedSortedKeys(obj);
    delete obj[2];
    obj[4] = 1;   // same count, different key set
    assert.deepStrictEqual(VF.cachedSortedKeys(obj), [1, 3, 4]);
});

/* ── getResolvedFrame: fast path ─────────────────────────── */

test('getResolvedFrame: null for missing/empty frames', () => {
    const VF = loadCore();
    const l = makeLayer(VF);
    assert.strictEqual(VF.getResolvedFrame(l, 0), null);

    l.frames = {};
    assert.strictEqual(VF.getResolvedFrame(l, 0), null);
});

test('getResolvedFrame: exact keyframe returns the raw data by reference', () => {
    const VF = loadCore();
    const l = makeLayer(VF, { frames: { 0: ['a'], 5: ['b'], 10: ['c'] } });

    const r0 = VF.getResolvedFrame(l, 5);
    assert.strictEqual(r0.keyFrame, 5);
    assert.strictEqual(r0.data, l.frames[5], 'must be the stored array, not a copy');
    assert.strictEqual(r0.isTween, undefined);
});

test('getResolvedFrame: between keyframes without tween shows previous key', () => {
    const VF = loadCore();
    const l = makeLayer(VF, { frames: { 0: ['a'], 10: ['b'] } });

    const r = VF.getResolvedFrame(l, 7);
    assert.strictEqual(r.keyFrame, 0);
    assert.strictEqual(r.data, l.frames[0]);
});

test('getResolvedFrame: before the first keyframe resolves to null', () => {
    const VF = loadCore();
    const l = makeLayer(VF, { frames: { 5: ['a'] } });
    assert.strictEqual(VF.getResolvedFrame(l, 3), null);
});

/* ── getResolvedFrame: loop resolution ───────────────────── */

test('getResolvedFrame: relative loop rewinds into the past', () => {
    const VF = loadCore();
    const l = makeLayer(VF, {
        frames: { 0: ['A'], 5: ['B'] },
        loops: { 5: { active: true, mode: 'relative', val: 2 } }
    });

    const r = VF.getResolvedFrame(l, 6);
    assert.strictEqual(r.isLoop, true);
    assert.strictEqual(r.keyFrame, 6);
    assert.strictEqual(r.loopSource, 3, 'elapsed=1 → target = startRel(3) + 0');
    assert.strictEqual(r.data, l.frames[0], 'frame 3 resolves to key 0');
});

test('getResolvedFrame: absolute loop targets a fixed span', () => {
    const VF = loadCore();
    const l = makeLayer(VF, {
        frames: { 0: ['A'], 5: ['B'] },
        loops: { 5: { active: true, mode: 'absolute', val: 1 } }
    });

    const r = VF.getResolvedFrame(l, 7);
    assert.strictEqual(r.isLoop, true);
    assert.strictEqual(r.loopSource, 2, 'loopLen=5, elapsed=2 → 1 + (1 % 5)');
    assert.strictEqual(r.data, l.frames[0]);
});

/* ── getResolvedFrame: vector tween (fake Paper.js) ──────── */

test('getResolvedFrame: vector tween lerps segments and strokeWidth', () => {
    const VF = loadCore();
    const l = makeLayer(VF, {
        frames: { 0: [pathJSON(0, 2)], 10: [pathJSON(100, 10)] },
        tweens: { 0: true }
    });

    const r = VF.getResolvedFrame(l, 5);
    assert.strictEqual(r.isTween, true);
    assert.strictEqual(r.keyFrame, 5);

    const parsed = JSON.parse(r.data[0]);
    assert.ok(Math.abs(parsed.segments[0].point.x - 50) < 1e-9, 'x lerped to 50');
    assert.ok(Math.abs(parsed.segments[1].point.x - 50) < 1e-9);
    assert.ok(Math.abs(parsed.strokeWidth - 6) < 1e-9, 'strokeWidth lerped to 6');
});

test('getResolvedFrame: texture-stroke tween lerps pressure points', () => {
    const VF = loadCore();
    const s0 = JSON.stringify({
        __texStroke: true, tex: 't', col: '#000', size: 4,
        pressurePoints: [{ x: 0, y: 0, angle: 0, width: 4 }]
    });
    const s1 = JSON.stringify({
        __texStroke: true, tex: 't', col: '#000', size: 8,
        pressurePoints: [{ x: 100, y: 40, angle: 90, width: 8 }]
    });
    const l = makeLayer(VF, { frames: { 0: [s0], 10: [s1] }, tweens: { 0: true } });

    const r = VF.getResolvedFrame(l, 5);
    const parsed = JSON.parse(r.data[0]);
    assert.strictEqual(parsed.__texStroke, true);
    assert.ok(Math.abs(parsed.size - 6) < 1e-9);
    assert.ok(Math.abs(parsed.pressurePoints[0].x - 50) < 1e-9);
    assert.ok(Math.abs(parsed.pressurePoints[0].y - 20) < 1e-9);
    assert.ok(Math.abs(parsed.pressurePoints[0].angle - 45) < 1e-9);
});

test('getResolvedFrame: mismatched stroke counts fall back to the previous key', () => {
    const VF = loadCore();
    const l = makeLayer(VF, {
        frames: { 0: [pathJSON(0, 2)], 10: [pathJSON(100, 10), pathJSON(100, 10)] },
        tweens: { 0: true }
    });

    const r = VF.getResolvedFrame(l, 5);
    assert.strictEqual(r.keyFrame, 0, 'lengths differ → no tween');
    assert.strictEqual(r.data, l.frames[0]);
});

/* ── getResolvedFrame: image tween ───────────────────────── */

test('getResolvedFrame: image tween lerps the matrix', () => {
    const VF = loadCore();
    const l = makeLayer(VF, {
        type: 'image',
        frames: { 0: { matrix: [1, 0, 0, 1, 0, 0] }, 10: { matrix: [1, 0, 0, 1, 100, 50] } },
        tweens: { 0: true }
    });

    const r = VF.getResolvedFrame(l, 5);
    assert.strictEqual(r.isTween, true);
    const m = r.data.matrix;
    assert.ok(Math.abs(m[4] - 50) < 1e-9, 'tx lerped to 50');
    assert.ok(Math.abs(m[5] - 25) < 1e-9, 'ty lerped to 25');
});

/* ── getLayerTransform ───────────────────────────────────── */

test('getLayerTransform: defaults when there are no transforms', () => {
    const VF = loadCore();
    const l = makeLayer(VF);
    assert.deepStrictEqual(VF.getLayerTransform(l, 5), {
        x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0
    });
});

test('getLayerTransform: single key and clamping', () => {
    const VF = loadCore();
    const l = makeLayer(VF, {
        transforms: { 5: { x: 10, y: 20, scaleX: 2, scaleY: 3, rotation: 45 } }
    });

    assert.deepStrictEqual(VF.getLayerTransform(l, 0), l.transforms[5], 'below → first key');
    assert.deepStrictEqual(VF.getLayerTransform(l, 99), l.transforms[5], 'above → last key');
});

test('getLayerTransform: interpolates between keys', () => {
    const VF = loadCore();
    const l = makeLayer(VF, {
        transforms: {
            0: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
            10: { x: 100, y: 40, scaleX: 3, scaleY: 5, rotation: 90 }
        }
    });

    const t = VF.getLayerTransform(l, 5);
    assert.ok(Math.abs(t.x - 50) < 1e-9);
    assert.ok(Math.abs(t.y - 20) < 1e-9);
    assert.ok(Math.abs(t.scaleX - 2) < 1e-9);
    assert.ok(Math.abs(t.scaleY - 3) < 1e-9);
    assert.ok(Math.abs(t.rotation - 45) < 1e-9);
});

/* ── getCameraAtFrame ─────────────────────────────────────── */

test('getCameraAtFrame: default camera with no keyframes', () => {
    const VF = loadCore();
    VF.S.canvas = { w: 640, h: 480 };
    const cam = VF.getCameraAtFrame(0);
    assert.strictEqual(cam.x, 320);
    assert.strictEqual(cam.y, 240);
    assert.strictEqual(cam.zoom, 1);
    assert.strictEqual(cam.rotation, 0);
});

test('getCameraAtFrame: single key is used everywhere', () => {
    const VF = loadCore();
    VF.S.camera = { frames: { 5: { x: 10, y: 20, zoom: 2, rotation: 30 } } };
    const cam = VF.getCameraAtFrame(100);
    assert.deepStrictEqual(cam, { x: 10, y: 20, zoom: 2, rotation: 30 });
});

test('getCameraAtFrame: interpolation and clamping', () => {
    const VF = loadCore();
    VF.S.camera = {
        frames: {
            0: { x: 0, y: 0, zoom: 1, rotation: 0 },
            10: { x: 100, y: 50, zoom: 3, rotation: 90 }
        }
    };

    const mid = VF.getCameraAtFrame(5);
    assert.ok(Math.abs(mid.x - 50) < 1e-9);
    assert.ok(Math.abs(mid.zoom - 2) < 1e-9);
    assert.ok(Math.abs(mid.rotation - 45) < 1e-9);

    const before = VF.getCameraAtFrame(-5);
    assert.strictEqual(before.x, 0, 'below first key clamps');
    const after = VF.getCameraAtFrame(99);
    assert.strictEqual(after.x, 100, 'above last key clamps');
});

/* ── getSwitchChild (folder switch resolution) ───────────── */

function switchFixture(VF) {
    VF.S.layers = [
        { id: 9, name: 'sw', type: 'folder', kind: 'switch', parentId: null, z: 0,
            switch: { frames: { 0: 2, 5: 3 } } },
        { id: 2, name: 'a', type: 'vector', parentId: 9, z: 0, frames: {} },
        { id: 3, name: 'b', type: 'vector', parentId: 9, z: 1, frames: {} }
    ];
    return VF.S.layers[0];
}

test('getSwitchChild: picks the active child per frame', () => {
    const VF = loadCore();
    const folder = switchFixture(VF);

    assert.strictEqual(VF.getSwitchChild(folder, 0), 2, 'explicit pick at 0');
    assert.strictEqual(VF.getSwitchChild(folder, 5), 3, 'explicit pick at 5');
    assert.strictEqual(VF.getSwitchChild(folder, 3), 2, 'between keys → earlier pick');
    assert.strictEqual(VF.getSwitchChild(folder, 99), 3, 'after last key → last pick');
});

test('getSwitchChild: falls back to the top child without switch keys', () => {
    const VF = loadCore();
    const folder = switchFixture(VF);
    folder.switch = { frames: {} };

    assert.strictEqual(VF.getSwitchChild(folder, 0), 3, 'top-default = highest z child');
});

test('getSwitchChild: empty folder yields null', () => {
    const VF = loadCore();
    VF.S.layers = [
        { id: 9, name: 'sw', type: 'folder', kind: 'switch', parentId: null, z: 0,
            switch: { frames: { 0: 2 } } }
    ];
    assert.strictEqual(VF.getSwitchChild(VF.S.layers[0], 0), null);
});

/* ── dataMatches (tolerant comparator) ───────────────────── */

test('dataMatches: identical data matches', () => {
    const VF = loadCore();
    const a = [pathJSON(10, 2), pathJSON(20, 4)];
    assert.strictEqual(VF._dataMatches(a, a.slice()), true);
});

test('dataMatches: float drift is tolerated (the no-op click case)', () => {
    const VF = loadCore();
    const withDrift = pathJSON(0.1, 2).replace('0.1', '0.1000000000000001');
    const a = [pathJSON(0.1, 2)];
    const b = [withDrift];
    assert.notStrictEqual(a[0], b[0]);
    assert.strictEqual(VF._dataMatches(a, b), true);
});

test('dataMatches: drift inside NESTED JSON strings is tolerated (pathJSON payloads)', () => {
    const VF = loadCore();
    const outer = JSON.stringify({
        __texStroke: true, tex: 't', size: 4,
        pathJSON: pathJSON(0.1, 2)
    });
    const drifted = outer.replace('0.1', '0.1000000000000001');
    assert.strictEqual(VF._dataMatches([outer], [drifted]), true);
});

test('dataMatches: genuinely different data does not match', () => {
    const VF = loadCore();
    assert.strictEqual(VF._dataMatches([pathJSON(0, 2)], [pathJSON(500, 2)]), false);
    assert.strictEqual(VF._dataMatches([pathJSON(0, 2)], [pathJSON(0, 2), pathJSON(1, 2)]), false);
});

test('dataMatches: matrix objects compare with tolerance (image layers)', () => {
    const VF = loadCore();
    const a = { matrix: [1, 0, 0, 1, 10.0000001, 5] };
    const b = { matrix: [1, 0, 0, 1, 10, 5] };
    assert.strictEqual(VF._dataMatches(a, b), true);
    assert.strictEqual(VF._dataMatches({ matrix: [1, 0, 0, 1, 10, 5] }, { matrix: [1, 0, 0, 1, 80, 5] }), false);
});
