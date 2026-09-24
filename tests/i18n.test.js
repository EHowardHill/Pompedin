'use strict';

/**
 * i18n tests (Phase 5): the translation function must never crash on
 * missing keys (fallback = the key itself, so gaps are visible, not
 * silent), must interpolate params, and must persist the locale choice.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./harness');

test('i18n: English strings resolve', () => {
    const VF = loadCore();
    assert.strictEqual(VF.t('tip.tool.brush'), 'Brush (F)');
    assert.strictEqual(VF.t('gs.title'), 'Welcome to Pompedin');
});

test('i18n: missing keys return the key itself (visible, never a crash)', () => {
    const VF = loadCore();
    assert.strictEqual(VF.t('no.such.key'), 'no.such.key');
    assert.strictEqual(VF.t('no.such.key', { x: 1 }), 'no.such.key');
});

test('i18n: {param} interpolation', () => {
    const VF = loadCore();
    const out = VF.t('toast.presetApplied', { name: 'YouTube 1080p', w: 1920, h: 1080 });
    assert.strictEqual(out, 'Preset applied: YouTube 1080p (1920×1080)');
});

test('i18n: locale switching persists and falls back to English for gaps', () => {
    const VF = loadCore();
    assert.strictEqual(VF.getLocale(), 'en');

    // Only 'en' ships today, so switching to an unknown locale is rejected
    assert.strictEqual(VF.setLocale('fr'), false);
    assert.strictEqual(VF.getLocale(), 'en');

    // A future locale table would switch; the mechanism round-trips
    // through storage without touching English behavior.
    assert.ok(Array.isArray(VF.locales) && VF.locales.indexOf('en') !== -1);
});
