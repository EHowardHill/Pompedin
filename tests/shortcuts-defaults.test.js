'use strict';

/**
 * Default keymap tests.
 *
 * Pins the default bindings (F5 New Frame, F6 Duplicate Frame,
 * Shift+F5 Delete Frame, Spacebar Play/Stop, Home Reset View, T/G/F
 * tools) and keeps the tooltip strings in sync with the keymap.
 *
 * The timeline button tooltips once drifted from the keymap (the New
 * Frame button said "F6", Duplicate said "F7", Play said "Enter") —
 * these tests pin the keymap AND the tooltip strings so a future edit
 * can't reintroduce that class of bug silently.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { installStubs, loadScript } = require('./harness');

function loadShortcuts() {
    installStubs();
    loadScript('01-state.js');        // fresh VF / S
    loadScript('01b-i18n.js');        // VF.t + tooltip string table
    loadScript('36-shortcuts.js');    // VF.shortcuts + DEFAULT_KEYMAP
    return global.VF;
}

test('default keymap: frame-by-frame keys (F5/F6/Shift+F5)', () => {
    const VF = loadShortcuts();
    assert.strictEqual(VF.shortcuts.get('blank-key'), 'f5',
        'New Frame = F5');
    assert.strictEqual(VF.shortcuts.get('dup-key'), 'f6',
        'Duplicate Frame = F6');
    assert.strictEqual(VF.shortcuts.get('del-key'), 'shift+f5',
        'Delete Frame = Shift+F5');
});

test('default keymap: playback and navigation keys', () => {
    const VF = loadShortcuts();
    assert.strictEqual(VF.shortcuts.get('play'), 'space',
        'Spacebar = play/stop the animation');
    assert.strictEqual(VF.shortcuts.get('prev-frame'), 'arrowleft');
    assert.strictEqual(VF.shortcuts.get('next-frame'), 'arrowright');
    assert.strictEqual(VF.shortcuts.get('reset-view'), 'home',
        'Home = reset the view');
});

test('default keymap: primary tool keys (T/G/F)', () => {
    const VF = loadShortcuts();
    assert.strictEqual(VF.shortcuts.get('tool-select'), 't');
    assert.strictEqual(VF.shortcuts.get('tool-lasso'), 'g');
    assert.strictEqual(VF.shortcuts.get('tool-brush'), 'f');
});

test('timeline button tooltips state the keys the keymap actually uses', () => {
    const VF = loadShortcuts();

    // The i18n table is the source for the tooltips applied at startup —
    // each must name the very key DEFAULT_KEYMAP binds, not a stale one.
    assert.ok(VF.t('tip.btn.newframe').indexOf('(F5)') !== -1,
        'New Frame button tip must say F5 (was "Blank Key (F6)" once)');
    assert.ok(VF.t('tip.btn.dupframe').indexOf('(F6)') !== -1,
        'Duplicate button tip must say F6 (was "F7" once)');
    assert.ok(VF.t('tip.btn.delframe').indexOf('(Shift+F5)') !== -1,
        'Delete button tip must say Shift+F5');
    assert.ok(VF.t('tip.btn.play').indexOf('(Space)') !== -1,
        'Play button tip must say Space (was "(Enter)" once)');

    // Cross-check tip against the live keymap values, so remapping the
    // DEFAULT_KEYMAP without updating the tips fails here too.
    assert.ok(VF.t('tip.btn.newframe').indexOf(
        '(' + VF.shortcuts.get('blank-key').toUpperCase() + ')') !== -1);
    assert.ok(VF.t('tip.btn.dupframe').indexOf(
        '(' + VF.shortcuts.get('dup-key').toUpperCase() + ')') !== -1);
});

test('Enter is reserved (hardcoded deselect)', () => {
    const VF = loadShortcuts();
    // RESERVED lives module-privately; the observable contract is that
    // the table's playback/frame actions never claim plain 'enter'
    // (it is owned by the deselect handler in 23-keyboard.js).
    const map = VF.shortcuts.getMap();
    Object.keys(map).forEach(function (action) {
        assert.notStrictEqual(map[action], 'enter',
            action + ' must not bind plain Enter — it is reserved for deselect');
    });
});
