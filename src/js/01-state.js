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

    VF.smoothTol = function () { return [0, 0.5, 2, 5, 10, 22][VF.S.cfg.smooth] || 5; };

    VF.isPanInput = function (ev) {
        return ev.button === 2 || (ev.pointerType === 'pen' && ev.button === 5);
    };

    VF.toast = function (msg) {
        const el = $('<div class="toast-msg">').text(msg).appendTo('body');
        setTimeout(() => el.fadeOut(300, () => el.remove()), 2200);
    };

})();
