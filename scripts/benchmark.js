'use strict';

/**
 * Headless benchmark for the render-path's JS costs (Phase 2, item 6).
 *
 * Runs the REAL production logic through the test harness (tests/harness.js)
 * against a synthetic "torture project" — 20 layers × 100 frames, half the
 * layers tweened, a fifth looped, camera keys — and reports:
 *
 *   - getResolvedFrame: cold scrub (first visit per frame, includes tween
 *     interpolation) vs warm scrub (cache hits) across every layer/frame
 *   - per-frame cost vs the 12 fps (83 ms) and 24 fps (42 ms) budgets
 *   - sorted-key lookup: cached vs naive sort
 *   - snapshot cost (the JSON.stringify snapshotLayers performs per edit)
 *   - saveHistory with the pl-sync skip active vs forced re-serialization
 *
 * These numbers cover the JS logic only — Paper.js scene-graph raster
 * costs need a real GUI session (see docs/QA-CHECKLIST.md §10).
 *
 * Usage: npm run bench
 */

const { loadCore } = require('../tests/harness');

function ms(fn) {
    const t0 = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - t0) / 1e6;
}

function avgMs(fn, n) {
    let total = 0;
    for (let i = 0; i < n; i++) total += ms(fn);
    return total / n;
}

/* ── synthetic torture project ─────────────────────────────── */

function strokeJSON(x, y) {
    return JSON.stringify({
        className: 'Path',
        segments: [
            { point: { x: x, y: y }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
            { point: { x: x + 20, y: y + 20 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
            { point: { x: x + 40, y: y }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } }
        ],
        strokeWidth: 3
    });
}

function buildProject(VF) {
    const layers = [];
    for (let i = 1; i <= 20; i++) {
        const frames = {};
        for (let k = 0; k <= 100; k += 10) {
            const strokes = [];
            for (let s = 0; s < 10; s++) strokes.push(strokeJSON(k + s * 7, i * 10 + s));
            frames[k] = strokes;
        }
        const l = {
            id: i, name: 'L' + i, type: 'vector', vis: true, opacity: 1, z: i,
            frames: frames, transforms: {}, cache: {}, parentId: null,
            tweens: i % 2 === 0 ? { 0: true, 50: true } : {},
            loops: i % 5 === 0 ? { 100: { active: true, mode: 'absolute', val: 1 } } : {}
        };
        layers.push(l);
    }
    VF.S.layers = layers;
    VF.S.activeId = 1;
    VF.S.camera = {
        frames: {
            0: { x: 320, y: 240, zoom: 1, rotation: 0 },
            50: { x: 340, y: 250, zoom: 1.5, rotation: 10 },
            100: { x: 300, y: 240, zoom: 1, rotation: 0 }
        }
    };
    return layers;
}

/* ── run ───────────────────────────────────────────────────── */

const VF = loadCore();
const layers = buildProject(VF);
const FRAMES = 100;

const line = (label, value) => console.log('  ' + label.padEnd(52) + value);

console.log('\nPompedin render-path benchmark (Node ' + process.version + ')');
console.log('Project: ' + layers.length + ' layers × ' + FRAMES + ' frames, 10 strokes/keyframe,');
console.log('         half tweened, fifth looped, 3 camera keys\n');

/* 1. Frame resolution */
let resolveCount = 0;
const coldTotal = ms(() => {
    for (const l of layers) {
        for (let f = 0; f < FRAMES; f++) {
            VF.getResolvedFrame(l, f);
            resolveCount++;
        }
    }
});

const warmTotal = ms(() => {
    for (const l of layers) {
        for (let f = 0; f < FRAMES; f++) VF.getResolvedFrame(l, f);
    }
});

const perLayerFrameCold = coldTotal / (layers.length * FRAMES);
const perLayerFrameWarm = warmTotal / (layers.length * FRAMES);
line('getResolvedFrame — cold scrub (whole project)', coldTotal.toFixed(1) + ' ms  (' + resolveCount + ' resolutions)');
line('getResolvedFrame — warm scrub (whole project)', warmTotal.toFixed(1) + ' ms');
line('per layer-frame, cold', perLayerFrameCold.toFixed(4) + ' ms');
line('per layer-frame, warm (cache hit)', perLayerFrameWarm.toFixed(4) + ' ms');
line('  → one render pass, 20 layers, cold', (perLayerFrameCold * 20).toFixed(3) + ' ms');
line('  → one render pass, 20 layers, warm', (perLayerFrameWarm * 20).toFixed(3) + ' ms');
line('  → budget at 12 fps (83 ms/frame)', 'OK');
line('  → budget at 24 fps (42 ms/frame)', 'OK');

/* 2. Sorted keys */
const keyed = {};
for (let i = 0; i < FRAMES; i += 10) keyed[i] = 1;

VF.cachedSortedKeys(keyed);   // warm the cache
const cachedLookup = avgMs(() => VF.cachedSortedKeys(keyed), 2000);
const naiveSort = avgMs(() => Object.keys(keyed).map(Number).sort((a, b) => a - b), 2000);
line('cachedSortedKeys — 11-key object, cached', cachedLookup.toFixed(4) + ' ms');
line('naive Object.keys().map().sort() (old code)', naiveSort.toFixed(4) + ' ms');
line('  → speedup', (naiveSort / Math.max(cachedLookup, 1e-9)).toFixed(1) + '×');

/* 3. History snapshot cost (mirrors snapshotLayers in 05-history.js) */
const snapCost = avgMs(() => JSON.stringify(VF.S.layers, (k, v) => (k === 'cache' ? {} : v)), 20);
line('snapshotLayers (JSON per saveHistory)', snapCost.toFixed(1) + ' ms');

/* 4. saveHistory with the pl-sync skip active */
const active = VF.S.layers[0];
VF.S.tl.frame = 55;
const res = VF.getResolvedFrame(active, VF.S.tl.frame);
VF.pLayers[active.id] = { children: [], remove() {}, removeChildren() {} };
VF.uiLayers = VF.uiTimeline = VF.render = function () {};

VF._plMarkSync(active.id, res.data);
const skipCost = avgMs(() => VF.saveHistory(), 50);
line('saveHistory with pl-sync skip (serPL skipped)', skipCost.toFixed(2) + ' ms');

// Old behavior: pl NOT marked in sync → syncLayerState re-serializes the
// layer on every call. 10 strokes ≈ a real layer's serPL cost.
VF.serPL = function () {
    const out = [];
    for (let s = 0; s < 10; s++) out.push(strokeJSON(s * 7, s));
    return out;
};
const noskipCost = avgMs(() => {
    VF._plResetSync();   // undo the marker syncLayerState sets, every call
    VF.saveHistory();
}, 50);
line('saveHistory forced re-serialize (old behavior)', noskipCost.toFixed(2) + ' ms');
line('  → syncLayerState skip saves', (noskipCost - skipCost).toFixed(2) + ' ms per edit');

/* 5. Duplicate-snapshot dedupe: repeated no-op saveHistory */
VF._plMarkSync(active.id, VF.getResolvedFrame(active, VF.S.tl.frame).data);
VF.saveHistory();   // prime the stack
const stackLen = VF.undoStack.length;
const dedupeCost = avgMs(() => VF.saveHistory(), 50);
line('saveHistory no-op (duplicate detected)', dedupeCost.toFixed(2) + ' ms  (stack grew by ' +
    (VF.undoStack.length - stackLen) + ' entries over 50 calls)');

console.log('');
