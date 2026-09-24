'use strict';

/**
 * Mouse-gesture tests.
 *
 * The wheel normalization (_wheelNotches) is the tricky part of the
 * pointer input layer: discrete mouse wheels fire one large delta per
 * notch (~120px on Windows, DOM_DELTA_LINE on Firefox) while trackpads
 * fire many small deltas. One notch must equal exactly one action (one
 * frame scrub, one field step) — no trackpad spam, no accumulated
 * remainder jumps. _nudgeValue/_stepDecimals back the number-field
 * adjustments (wheel over field, right-drag in field).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./harness');

/* ── wheel notch normalization ────────────────────────────── */

test('wheel: a discrete mouse notch (120px, Windows) is exactly one notch', () => {
    const VF = loadCore();
    const r = VF._wheelNotches(0, 120, 0);
    assert.strictEqual(r.notches, 1);
    assert.strictEqual(r.acc, 0, 'no remainder may build up across notches');

    // Ten notches in a row must stay exactly ten
    let n = 0;
    for (let i = 0; i < 10; i++) n += VF._wheelNotches(0, 120, 0).notches;
    assert.strictEqual(n, 10);
});

test('wheel: Firefox line mode (3 lines per notch) is one notch', () => {
    const VF = loadCore();
    const r = VF._wheelNotches(0, 3, 1);   // DOM_DELTA_LINE × 40 = 120
    assert.strictEqual(r.notches, 1);
    assert.strictEqual(r.acc, 0);
});

test('wheel: negative deltas scrub backwards', () => {
    const VF = loadCore();
    assert.strictEqual(VF._wheelNotches(0, -120, 0).notches, -1);
    assert.strictEqual(VF._wheelNotches(0, -3, 1).notches, -1);
});

test('wheel: trackpad deltas accumulate to whole notches', () => {
    const VF = loadCore();
    // 30px per event — none of these is a notch on its own
    let acc = 0, notches = 0;
    for (let i = 0; i < 3; i++) {
        const r = VF._wheelNotches(acc, 30, 0);
        acc = r.acc; notches += r.notches;
    }
    assert.strictEqual(notches, 0);
    assert.strictEqual(acc, 90, 'partial travel is kept between events');

    // Fourth event crosses the threshold → exactly one notch
    const r = VF._wheelNotches(acc, 30, 0);
    assert.strictEqual(r.notches, 1);
    assert.strictEqual(r.acc, 20, 'remainder carries over, not lost');
});

test('wheel: trackpad direction reversal does not double-fire', () => {
    const VF = loadCore();
    let acc = VF._wheelNotches(0, 80, 0).acc;      // 80 saved up
    let r = VF._wheelNotches(acc, -80, 0);        // ...and taken back
    assert.strictEqual(r.notches, 0);
    assert.strictEqual(r.acc, 0);
});

test('wheel: fast flick (large delta) snaps without remainders', () => {
    const VF = loadCore();
    const r = VF._wheelNotches(50, 350, 0);       // trackpad flick
    assert.strictEqual(r.notches, 4);            // treated as one discrete event: round(400/100)
    assert.strictEqual(r.acc, 0);

    // Symmetric: a backwards flick scrubs exactly as many frames
    const back = VF._wheelNotches(50, -350, 0);
    assert.strictEqual(back.notches, -4);
});

/* ── number field nudging ─────────────────────────────────── */

test('nudge: steps by the field step and clamps to min/max', () => {
    const VF = loadCore();
    assert.strictEqual(VF._nudgeValue(4, 1, 1, 1, 60), 5);      // brush size up
    assert.strictEqual(VF._nudgeValue(4, -1, 1, 1, 60), 3);
    assert.strictEqual(VF._nudgeValue(60, 1, 1, 1, 60), 60, 'max clamp');
    assert.strictEqual(VF._nudgeValue(1, -5, 1, 1, 60), 1, 'min clamp');
    assert.strictEqual(VF._nudgeValue(0, 2, 0.5, NaN, NaN), 1, 'fractional steps');
});

test('nudge: missing min/max mean unbounded', () => {
    const VF = loadCore();
    assert.strictEqual(VF._nudgeValue(0, -100, 1, NaN, NaN), -100);
});

test('stepDecimals: precision follows the step attribute', () => {
    const VF = loadCore();
    assert.strictEqual(VF._stepDecimals(1), 0);
    assert.strictEqual(VF._stepDecimals(0.5), 1);
    assert.strictEqual(VF._stepDecimals('0.25'), 2);
    assert.strictEqual(VF._stepDecimals(5), 0);
});
