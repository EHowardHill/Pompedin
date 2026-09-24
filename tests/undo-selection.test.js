'use strict';

/**
 * Regression tests for undo/redo × canvas-selection interaction.
 *
 * The brush tool auto-selects the stroke it just committed (08-tool-brush.js
 * pushes its segments into VF.selSegments). Undo/redo rebuilds every paper
 * layer from the snapshot (05-history.js restoreSnapshot), which destroys
 * the live items — but the selection array and the on-canvas gizmo
 * (drawn on fgLayer, which is NOT rebuilt) used to survive, leaving a
 * "select rectangle" floating over artwork that no longer exists and
 * selSegments pointing at dead items.
 *
 * These tests simulate the brush stroke flow at the data level (exactly
 * what the tool handlers do: saveHistory → mutate pl → saveFrame →
 * select the committed stroke) and assert the history + selection
 * invariants.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { installStubs } = require('./harness');

const SRC = path.join(__dirname, '..', 'src', 'js');
const FakePaper = require('./fake-paper');

/* Layer stand-in with the (de)serialization surface serPL/desPL need. */
class TestLayer extends FakePaper.Layer {
    constructor() { super(); this.name = ''; }
    importJSON(str) {
        const g = new FakePaper.Group();
        const item = g.importJSON(str);
        if (item) this.children.push(item);
        return item;
    }
    addChild(c) { this.children.push(c); }
    removeChildren() { this.children = []; }
    activate() { }
}

function loadCore() {
    installStubs();
    // Fresh VF (01-state.js resets window.VF).
    (0, eval)(fs.readFileSync(path.join(SRC, '01-state.js'), 'utf8'));
    global.VF.P = Object.assign({}, FakePaper, { Layer: TestLayer });
    (0, eval)(fs.readFileSync(path.join(SRC, '04-serialization.js'), 'utf8'));
    (0, eval)(fs.readFileSync(path.join(SRC, '05-history.js'), 'utf8'));

    // UI functions restoreSnapshot calls — not under test.
    global.VF.render = function () { };
    global.VF.uiLayers = function () { };
    global.VF.uiTimeline = function () { };
    global.VF.isFolder = function (l) { return !!(l && l.kind === 'folder'); };
    return global.VF;
}

function pathJSON(x, strokeWidth) {
    return JSON.stringify({
        className: 'Path',
        segments: [
            { point: { x: x, y: 0 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
            { point: { x: x + 10, y: 10 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } }
        ],
        strokeWidth: strokeWidth
    });
}

/** Build the app state the way init() + a drawn stroke leave it. */
function setup(VF) {
    const layer = {
        id: 1, name: 'L1', type: 'vector', vis: true, opacity: 1, z: 0,
        frames: {}, tweens: {}, transforms: {}, loops: {}, cache: {}, parentId: null
    };
    VF.S.layers = [layer];
    VF.S.activeId = 1;
    const pl = new TestLayer();
    VF.pLayers[1] = pl;

    // Selection bookkeeping the real tools maintain.
    VF.clearHandles = function () { VF._handlesCleared = true; };

    return { layer, pl };
}

/** Simulate one brush stroke exactly as 08-tool-brush.js does. */
function drawStroke(VF, pl, x, select) {
    VF.saveHistory();                       // onMouseDown
    var json = pathJSON(x, 4);
    const g = new FakePaper.Group();
    const item = g.importJSON(json);
    // The real Paper items carry seg.path/parent back-references that the
    // fake's naive dehydrator can't walk — pin serialization to the source.
    item.exportJSON = function () { return json; };
    item.parent = pl;
    pl.addChild(item);                      // stroke committed
    if (select !== false) {                  // onMouseUp auto-select
        item.segments.forEach(function (s) { s.path = item; });
        VF.selSegments = item.segments.slice();
    }
    VF.saveFrame();
    return item;
}

test('undo removes the just-drawn brush stroke (data level)', () => {
    const VF = loadCore();
    const ctx = setup(VF);

    drawStroke(VF, ctx.pl, 0);

    assert.strictEqual(VF.S.layers[0].frames[0].length, 1, 'stroke saved to frame data');

    VF.execUndo();

    assert.strictEqual(VF.S.layers[0].frames[0].length, 0,
        'undo must restore the pre-stroke frame data');
});

test('undo after drawing clears the selection and gizmo (no ghost rectangle)', () => {
    const VF = loadCore();
    const ctx = setup(VF);

    drawStroke(VF, ctx.pl, 0);
    assert.ok(VF.selSegments.length > 0, 'brush auto-selects the new stroke');

    VF.execUndo();

    assert.strictEqual(VF.selSegments.length, 0,
        'restoreSnapshot rebuilds all paper items — stale segment refs must be dropped');
    assert.ok(VF._handlesCleared, 'the on-canvas selection gizmo must be cleared');
    assert.strictEqual(VF.selectMode, 'object', 'vertex mode cannot survive an undo');
});

test('redo after undo also clears the selection (no ghost rectangle)', () => {
    const VF = loadCore();
    const ctx = setup(VF);

    drawStroke(VF, ctx.pl, 0);
    VF.execUndo();
    VF._handlesCleared = false;

    VF.execRedo();

    assert.strictEqual(VF.S.layers[0].frames[0].length, 1, 'redo restores the stroke data');
    assert.strictEqual(VF.selSegments.length, 0, 'redo rebuilds items — selection must reset');
    assert.ok(VF._handlesCleared, 'the selection gizmo must be cleared on redo');
});

test('two strokes: one undo removes only the last stroke', () => {
    const VF = loadCore();
    const ctx = setup(VF);

    drawStroke(VF, ctx.pl, 0);          // stroke A
    drawStroke(VF, ctx.pl, 30);         // stroke B

    assert.strictEqual(VF.S.layers[0].frames[0].length, 2);

    VF.execUndo();

    assert.strictEqual(VF.S.layers[0].frames[0].length, 1,
        'undo after two strokes removes exactly the last one');
    assert.strictEqual(VF.selSegments.length, 0);
});

test('undo with an empty stack still gives feedback (toast) instead of silence', () => {
    const VF = loadCore();
    setup(VF);

    let toasted = null;
    VF.toast = function (msg) { toasted = msg; };

    VF.execUndo();
    assert.ok(toasted, 'empty undo stack must not be silent — user gets no signal otherwise');

    toasted = null;
    VF.execRedo();
    assert.ok(toasted, 'empty redo stack must not be silent either');
});

test('rebuilding the active layer from data drops the selection (timeline deletes)', () => {
    const VF = loadCore();
    const ctx = setup(VF);

    drawStroke(VF, ctx.pl, 0);
    assert.ok(VF.selSegments.length > 0);

    // What a timeline keyframe delete/paste does: the frame data changes
    // behind the tool's back, then loadFrame rebuilds the active layer's
    // paper items from the new data. The old items are destroyed.
    VF.S.layers[0].frames[0] = [];
    VF._handlesCleared = false;

    VF.loadFrame(1, 0);

    assert.strictEqual(VF.selSegments.length, 0,
        'a rebuild destroys the selected items — the selection must not survive them');
    assert.ok(VF._handlesCleared, 'the gizmo must go with it');
});

test('unchanged content keeps the selection (skip path does not over-clear)', () => {
    const VF = loadCore();
    const ctx = setup(VF);

    drawStroke(VF, ctx.pl, 0);
    VF._handlesCleared = false;

    // Re-render with identical data (e.g. camera move, opacity change) —
    // loadFrame skips the rebuild, so the selection stays valid.
    VF.loadFrame(1, 0);

    assert.strictEqual(VF.selSegments.length, 2,
        'items are untouched — the selection must survive');
    assert.ok(!VF._handlesCleared, 'no gizmo clear when nothing was rebuilt');
});
