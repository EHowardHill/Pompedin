'use strict';

/**
 * Phase 4 regression tests: the selection-style / new-stroke-defaults
 * separation (CHANGES.md #6).
 *
 * The old implementation copied the selected item's properties straight
 * into S.cfg and tried to restore the brush defaults afterwards — any
 * path that missed the restore leaked the selection's properties into
 * new-stroke defaults (selecting a stroke-only shape turned Fill off
 * for the NEXT freehand stroke).
 *
 * The contract now: selection reads/writes live in VF.selStyle and
 * NEVER touch S.cfg. Drawing always reads S.cfg.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./harness');

function fakeColor(hex) {
    return { toCSS: function () { return hex; } };
}

/** A stroke-only shape: has a stroke, no fill — the exact #6 scenario. */
function strokeOnlyItem() {
    return {
        className: 'Path',
        strokeWidth: 7,
        strokeColor: fakeColor('#112233'),
        fillColor: null,
        data: {}
    };
}

function setupSelection(VF, item) {
    VF.S.tool = 'select';
    VF.S.activeId = 1;
    VF.S.layers = [{
        id: 1, name: 'L1', type: 'vector', vis: true, opacity: 1, z: 0,
        frames: { 0: ['x'] }, tweens: {}, transforms: {}, loops: {},
        cache: {}, parentId: null
    }];
    VF.pLayers[1] = { children: [], remove() {}, removeChildren() {} };
    VF.S.tl.frame = 0;

    VF.selSegments = [{}];              // hasSelection() → true
    VF.getSelectedItems = function () { return [item]; };
    VF.uiLayers = VF.uiTimeline = VF.render = function () {};
}

test('selStyle: selecting a stroke-only shape never touches S.cfg', () => {
    const VF = loadCore();
    setupSelection(VF, strokeOnlyItem());

    // The user's brush defaults BEFORE selecting anything:
    const before = {
        brushSize: VF.S.cfg.brushSize,
        strokeCol: VF.S.cfg.strokeCol,
        autoStroke: VF.S.cfg.autoStroke,
        fillCol: VF.S.cfg.fillCol,
        autoFill: VF.S.cfg.autoFill,
        tex: VF.S.cfg.tex
    };

    VF.syncUIFromSelection();

    // CHANGES.md #6 regression: Fill must NOT be turned off for new strokes.
    assert.strictEqual(VF.S.cfg.autoFill, before.autoFill, 'S.cfg.autoFill must be untouched');
    assert.strictEqual(VF.S.cfg.autoStroke, before.autoStroke);
    assert.strictEqual(VF.S.cfg.brushSize, before.brushSize);
    assert.strictEqual(VF.S.cfg.strokeCol, before.strokeCol);
    assert.strictEqual(VF.S.cfg.fillCol, before.fillCol);
    assert.strictEqual(VF.S.cfg.tex, before.tex);

    // …but the SELECTION context reflects the selected item:
    assert.ok(VF.selStyle, 'selection context exists');
    assert.strictEqual(VF.selStyle.brushSize, 7, 'selection shows the item\'s stroke width');
    assert.strictEqual(VF.selStyle.strokeCol, '#112233');
    assert.strictEqual(VF.selStyle.autoStroke, true);
    assert.strictEqual(VF.selStyle.autoFill, false, 'the item has no fill — selection context shows that');
});

test('selStyle: clearing the selection drops the context, defaults intact', () => {
    const VF = loadCore();
    setupSelection(VF, strokeOnlyItem());

    VF.syncUIFromSelection();
    assert.ok(VF.selStyle);

    VF.getSelectedItems = function () { return []; };
    VF.syncUIFromSelection();

    assert.strictEqual(VF.selStyle, null, 'selection context cleared');
    // S.cfg was never touched, so nothing needed "restoring":
    assert.ok(VF.S.cfg.autoStroke !== undefined);
});

test('selStyle: clearSelStyle is a no-op when nothing is selected', () => {
    const VF = loadCore();
    assert.strictEqual(VF.selStyle, null);
    VF.clearSelStyle();   // must not throw
    assert.strictEqual(VF.selStyle, null);
});

test('selStyle: enableFill on the selection uses the SELECTION color, not S.cfg', () => {
    const VF = loadCore();
    const item = strokeOnlyItem();
    setupSelection(VF, item);

    VF.S.cfg.fillCol = '#cfg-color';
    VF.syncUIFromSelection();          // selStyle.fillCol = '#4a6fff' (default cfg color at load)
    VF.selStyle.fillCol = '#sel-color';

    const applied = VF.applyPropertyToSelection('enableFill', true);
    assert.strictEqual(applied, true);
    assert.strictEqual(item.fillColor, '#sel-color',
        'filling the selection must use the selection context color');
    assert.strictEqual(VF.S.cfg.fillCol, '#cfg-color', 'S.cfg untouched');
});

test('selStyle: enableStroke on the selection uses the SELECTION color', () => {
    const VF = loadCore();
    const item = {
        className: 'Path', strokeWidth: 3, strokeColor: null, fillColor: fakeColor('#abc'),
        data: {}
    };
    setupSelection(VF, item);

    VF.syncUIFromSelection();          // selStyle.strokeCol = '#000000' default
    VF.selStyle.strokeCol = '#sel-stroke';

    VF.applyPropertyToSelection('enableStroke', true);
    assert.strictEqual(item.strokeColor, '#sel-stroke');
});

test('selStyle: brushSize edits while selecting go to selStyle (apply), not S.cfg', () => {
    const VF = loadCore();
    const item = strokeOnlyItem();
    setupSelection(VF, item);
    VF.syncUIFromSelection();

    // Simulate the ribbon handler routing (22-ui-bindings.js):
    VF.selStyle.brushSize = 12;
    VF.applyPropertyToSelection('brushSize', 12);

    assert.strictEqual(item.strokeWidth, 12, 'selection stroke width changed');
    assert.strictEqual(VF.S.cfg.brushSize, 4, 'default brush size untouched');
});
