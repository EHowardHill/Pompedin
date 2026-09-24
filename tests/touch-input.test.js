'use strict';

/**
 * Touch-input layer tests (iPad groundwork): the detection helpers must
 * be safe in non-browser environments (Node harness → false), and the
 * gesture math helpers must be exact — they drive pinch-zoom.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./harness');

test('touch: detection is false in non-touch environments and never throws', () => {
    const VF = loadCore();
    assert.strictEqual(VF.isTouchDevice(), false, 'Node harness has no touch');
    assert.strictEqual(VF.isIpad(), false);
    assert.strictEqual(VF.isAndroid(), false);
    assert.strictEqual(VF.isMobileApp(), false, 'no mobile platform in the harness');
    // Repeated calls are stable (safe to call from any guard)
    assert.strictEqual(VF.isIpad(), false);
});

test('touch: gesture midpoint math', () => {
    const VF = loadCore();
    const mid = VF._gestureMid(
        { clientX: 100, clientY: 50 },
        { clientX: 200, clientY: 100 }
    );
    assert.strictEqual(mid.clientX, 150);
    assert.strictEqual(mid.clientY, 75);
});

test('touch: gesture distance math', () => {
    const VF = loadCore();
    const d = VF._gestureDist(
        { clientX: 0, clientY: 0 },
        { clientX: 30, clientY: 40 }
    );
    assert.strictEqual(d, 50);   // 3-4-5 triangle
    assert.strictEqual(VF._gestureDist({ clientX: 5, clientY: 5 }, { clientX: 5, clientY: 5 }), 0);
});

test('touch: gesture helpers handle degenerate input (identical points)', () => {
    const VF = loadCore();
    const mid = VF._gestureMid({ clientX: 7, clientY: 9 }, { clientX: 7, clientY: 9 });
    assert.deepStrictEqual(mid, { clientX: 7, clientY: 9 });
});
