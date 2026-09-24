/**
 * i18n — the single home for user-visible strings (Phase 5).
 *
 * English is the source language. Every string added from Phase 5 on
 * lives in the STRINGS table below and is used through VF.t(key, params).
 * New locales are added by appending a table to STRINGS — VF.t falls
 * back to English for any missing key, so partial translations are safe.
 *
 * Migration rule for existing surfaces: when a file is touched, move its
 * user-visible literals into this table and route them through VF.t.
 * Static HTML adopts via data-i18n / data-i18n-tip attributes (applied
 * by VF.applyI18n at startup; missing keys leave existing content
 * untouched, so adoption is incremental).
 *
 * Loads after 01-state.js (needs window.VF) and before the UI modules.
 */
(function () {
    "use strict";

    var LOCALE_KEY = 'pompedin_locale';

    var STRINGS = {
        en: {
            /* ── Left toolbar tooltips (data-i18n-tip pattern) ── */
            'tip.tool.select': 'Select / Edit Vertices (T)',
            'tip.tool.brush': 'Brush (F)',
            'tip.tool.lasso': 'Lasso Select (G)',
            'tip.tool.eraser': 'Eraser (E)',
            'tip.tool.fill': 'Paint Bucket (P)',
            'tip.tool.hide-edge': 'Hide Edge (H)',
            'tip.tool.translate': 'Translate Layer (M)',
            'tip.tool.rotate': 'Rotate Layer (R)',
            'tip.tool.scale': 'Scale Layer (S)',
            'tip.tool.camera': 'Camera Tool (4)',
            'tip.tool.zoom': 'Zoom (Z / Scroll)',
            'tip.tool.rotate-view': 'Rotate Workspace (8)',
            'tip.tool.resetview': 'Reset View (Home)',
            'tip.tool.fitscreen': 'Fit to Screen (Shift+Home / Ctrl+0)',

            /* ── Timeline transport buttons (keep in sync with
                  DEFAULT_KEYMAP in 36-shortcuts.js: F5 New Frame,
                  F6 Duplicate, Shift+F5 Delete, Space Play) ── */
            'tip.btn.prev': 'Previous Frame (←)',
            'tip.btn.play': 'Play / Pause (Space)',
            'tip.btn.next': 'Next Frame (→)',
            'tip.btn.newframe': 'New Frame (F5)',
            'tip.btn.dupframe': 'Duplicate Frame (F6)',
            'tip.btn.delframe': 'Delete Frame (Shift+F5)',

            /* ── Ribbon: Info group ── */
            'ribbon.shortcuts': 'Keyboard Shortcuts',
            'tip.shortcuts': 'View and remap keyboard shortcuts',

            /* ── Getting Started card ── */
            'gs.title': 'Welcome to Pompedin',
            'gs.intro': 'A frame-by-frame vector animation studio. Here is the 30-second path to your first animation:',
            'gs.step1': 'Pick the Brush (F) and draw on the canvas',
            'gs.step2': 'Press F6 to duplicate the frame, then edit the copy',
            'gs.step3': 'Press Space to play your frames',
            'gs.step4': 'Save with Ctrl+S — rolling backups are kept next to your project automatically',
            'gs.hint': 'The Help dialog (top right) re-opens this card, and the Keys button lists every shortcut.',
            'gs.close': 'Start Drawing',

            /* ── Export presets ── */
            'preset.canvas': 'Canvas',
            'preset.yt1080': 'YouTube 1080p',
            'preset.yt4k': 'YouTube 4K',
            'preset.webgif': 'Web GIF',
            'toast.presetApplied': 'Preset applied: {name} ({w}×{h})',
            'toast.presetCanvas': 'Export preset: canvas resolution',

            /* ── iPad / touch ── */
            'toast.savedToDocuments': 'Saved to Documents: {name}'
        }
    };

    var locale = 'en';
    try {
        var saved = localStorage.getItem(LOCALE_KEY);
        if (saved && STRINGS[saved]) locale = saved;
    } catch (e) { /* storage unavailable — stay on English */ }

    /**
     * Translate a key, interpolating {name} params.
     * Missing keys return the key itself — always visible, never a crash.
     */
    VF.t = function (key, params) {
        var s = (STRINGS[locale] && STRINGS[locale][key] !== undefined)
            ? STRINGS[locale][key]
            : STRINGS.en[key];
        if (s === undefined) return key;
        if (params) {
            Object.keys(params).forEach(function (k) {
                s = s.split('{' + k + '}').join(String(params[k]));
            });
        }
        return s;
    };

    VF.setLocale = function (l) {
        if (!STRINGS[l]) return false;
        locale = l;
        try { localStorage.setItem(LOCALE_KEY, l); } catch (e) { }
        VF.applyI18n();
        return true;
    };

    VF.getLocale = function () { return locale; };
    VF.locales = Object.keys(STRINGS);

    /**
     * Apply table strings to static HTML:
     *   data-i18n="key"     → element text
     *   data-i18n-tip="key" → data-tip + aria-label (if not already set)
     */
    VF.applyI18n = function () {
        $('[data-i18n]').each(function () {
            var s = VF.t($(this).data('i18n'));
            if (s !== $(this).data('i18n')) $(this).text(s);
        });
        $('[data-i18n-tip]').each(function () {
            var key = $(this).data('i18nTip');
            var s = VF.t(key);
            if (s !== key) {
                $(this).attr('data-tip', s);
                if (!$(this).attr('aria-label')) $(this).attr('aria-label', s);
            }
        });
    };
})();
