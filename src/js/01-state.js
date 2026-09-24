(function () {
    "use strict";

    if (!window.requestIdleCallback) {
        window.requestIdleCallback = function (cb) { return setTimeout(cb, 1); };
        window.cancelIdleCallback = function (id) { clearTimeout(id); };
    }

    window.VF = {};

    VF.S = {
        canvas: { w: 640, h: 480 },
        tl: { frame: 0, max: 24, fps: 12, playing: false },
        layers: [],
        activeId: null,
        nextId: 1,
        currentProjectPath: null,
        clip: null,
        cfg: {
            autoStroke: true,
            autoFill: false,
            brushSize: 4,
            brushSpacing: 50,
            brushRotation: 0,
            brushAngleJitter: 100,
            brushPosJitter: 0,
            showBrushGuide: true,
            smooth: 3,
            strokeCol: '#000000',
            fillCol: '#4a6fff',
            tex: 'none',
            onion: false,
            onionIsolate: false,
            pressure: false,
            grain: false,
            grainAmt: 10
        },
        onions: [
            { rel: true, val: -1, op: 16, top: false },
            { rel: true, val: 1, op: 10, top: false }
        ],
        tool: 'select',
        audioData: null,
        audioFilename: null,
        camera: { frames: {} }
    };

    VF.AL = function () { return VF.S.layers.find(l => l.id === VF.S.activeId); };

    VF.baseBrushes = {};
    VF.tintedCanvasCache = {};
    VF.pLayers = {};   // id -> paper.Layer

    // Shared mutable refs for cross-module access
    VF.selSegments = [];
    VF.selHandles = [];
    VF.undoStack = [];
    VF.redoStack = [];
    VF.MAX_HISTORY = 30;

    // Saved-project format version. Files without the stamp are treated
    // as version 1. Bump this when the save structure changes and add a
    // matching migration step in migrateState() (20-project-io.js).
    VF.FORMAT_VERSION = 1;
    VF.currentPressure = 1.0;
    VF._isDirty = false;

    /**
     * Returns a tinted canvas element.
     * The brush PNG's opaque pixels are recolored to hexColor.
     */
    VF.getTintedCanvas = function (filename, hexColor) {
        if (!VF.baseBrushes[filename]) return null;
        const key = filename + '_' + hexColor;
        if (VF.tintedCanvasCache[key]) return VF.tintedCanvasCache[key];

        const img = VF.baseBrushes[filename];
        const c = document.createElement('canvas');
        c.width = img.width || 64;
        c.height = img.height || 64;
        const ctx = c.getContext('2d');

        ctx.drawImage(img, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = hexColor;
        ctx.fillRect(0, 0, c.width, c.height);

        VF.tintedCanvasCache[key] = c;
        return c;
    };

    /**
     * Simple seeded PRNG (mulberry32).
     */
    VF.seededRandom = function (seed) {
        let t = (seed | 0) + 0x6D2B79F5;
        return function () {
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };

    /* ── PERFORMANCE: cached sorted numeric-key lists ──
       Per-render hot paths (frame resolution, layer transforms, camera
       interpolation, switch resolution) all sort the numeric keys of a
       keyed object on every call. The sorted list is cached per object;
       an order-independent int32 hash of the key set detects any
       added/removed/moved key and invalidates the cached sort. */
    var _sortedKeysWM = new WeakMap();
    VF.cachedSortedKeys = function (obj) {
        if (!obj) return [];
        var h = 0;
        for (var k in obj) h = (Math.imul(h, 31) + (+k + 1)) | 0;
        var hit = _sortedKeysWM.get(obj);
        if (hit && hit.h === h) return hit.keys;
        var keys = Object.keys(obj).map(Number).sort(function (a, b) { return a - b; });
        _sortedKeysWM.set(obj, { h: h, keys: keys });
        return keys;
    };

    VF.smoothTol = function () { return [0, 0.5, 2, 5, 10, 22][VF.S.cfg.smooth] || 5; };

    /* ── Wheel helpers (unit-tested in tests/mouse-gestures.test.js) ──
    
       Mouse wheels send one big delta per notch (~120px on Windows,
       deltaMode=lines on Firefox); trackpads send many small deltas.
       _wheelNotches normalizes both into whole "notches" so one notch
       equals one action (one frame scrub, one field step), without
       trackpad spam or lost remainders. */
    VF._wheelNotches = function (acc, deltaY, deltaMode) {
        // Normalize line/page modes to pixel scale
        var dy = deltaY;
        if (deltaMode === 1) dy = deltaY * 40;      // DOM_DELTA_LINE
        else if (deltaMode === 2) dy = deltaY * 800; // DOM_DELTA_PAGE

        var THRESH = 100;   // pixels of travel per notch
        var acc2 = acc + dy;

        // A discrete mouse notch arrives as one large delta — snap it to
        // exactly one notch so remainders never build up into jumps.
        // (Symmetric rounding: a backwards flick must scrub as many
        // frames as a forwards one.)
        if (Math.abs(dy) >= THRESH) {
            var n = Math.round(Math.abs(dy) / THRESH);
            return { acc: 0, notches: dy > 0 ? n : -n };
        }

        // Trackpad: accumulate until a full notch has been travelled
        var notches = 0;
        while (acc2 >= THRESH) { acc2 -= THRESH; notches++; }
        while (acc2 <= -THRESH) { acc2 += THRESH; notches--; }
        return { acc: acc2, notches: notches };
    };

    /* Nudge a numeric field value by `steps` × step, clamped to min/max,
       rounded to the step's decimal precision. min/max of NaN mean
       "unbounded" (missing attributes). */
    VF._nudgeValue = function (cur, steps, step, min, max) {
        var v = cur + steps * step;
        if (isFinite(min)) v = Math.max(min, v);
        if (isFinite(max)) v = Math.min(max, v);
        return v;
    };

    /* Decimal places implied by a step value ("0.5" → 1, "1" → 0). */
    VF._stepDecimals = function (step) {
        var s = String(step);
        var dot = s.indexOf('.');
        return dot === -1 ? 0 : s.length - dot - 1;
    };

    VF.isPanInput = function (ev) {
        return ev.button === 2 || (ev.pointerType === 'pen' && ev.button === 5);
    };

    VF.toast = function (msg) {
        const el = $('<div class="toast-msg">').text(msg).appendTo('body');
        setTimeout(() => el.fadeOut(300, () => el.remove()), 2200);
    };

    /* ── Central error reporting ──
       Every non-trivial catch routes through here instead of failing
       silently: the error is always logged, and the user gets a toast
       (rate-limited to one per context per 5 s so a loop of failures
       can't spam the UI). Defensive catches where failure is expected
       (pointer capture, best-effort cleanup, …) may stay silent. */
    var _lastErrorReport = {};
    VF.reportError = function (context, err) {
        try { console.error('[' + context + ']', err); } catch (_) { }
        var now = Date.now();
        if (_lastErrorReport[context] && now - _lastErrorReport[context] < 5000) return;
        _lastErrorReport[context] = now;
        VF.toast('Something went wrong (' + context + ') — details in the console');
    };

})();
