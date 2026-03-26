(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    function syncLayerState() {
        var l = VF.AL();
        if (!l || !VF.pLayers[l.id]) return;

        var res = VF.getResolvedFrame(l, S.tl.frame);
        var targetFrame = res ? res.keyFrame : S.tl.frame;

        if (l.type === 'vector') {
            // FIX (Bug #7): serPL now temporarily resets the layer matrix
            // to Identity before exporting, then restores it. This ensures
            // children are serialized in their own local coordinate space,
            // preventing the "matrix baking" accumulation loop.
            l.frames[targetFrame] = VF.serPL(VF.pLayers[l.id]);
        } else if (l.type === 'image') {
            // Image rasters track their own local matrices, independent 
            // of the parent layer's transform, so this avoids the baking loop naturally.
            var r = VF.pLayers[l.id].children.find(function (c) { return c.className === 'Raster'; });
            l.frames[targetFrame] = r ? { matrix: r.matrix.values } : [];
        }
    }

    VF.syncLayerState = syncLayerState;

    /**
     * Create a JSON snapshot of S.layers, stripping the `cache` field
     * which contains canvas DOM elements that cannot survive JSON roundtrip.
     * Leaving them in causes `new P.Raster({ canvas: undefined })` on
     * restore → Paper.js "t.addEventListener is not a function" TypeError,
     * which silently empties the layer and poisons redo snapshots.
     */
    function snapshotLayers() {
        S.layers.forEach(function (l) { l.cache = {}; });
        return JSON.stringify(S.layers);
    }

    VF.saveHistory = function () {
        syncLayerState();
        VF.undoStack.push(snapshotLayers());
        if (VF.undoStack.length > VF.MAX_HISTORY) VF.undoStack.shift();
        VF.redoStack = [];
        VF._isDirty = true; // Mark as unsaved
    };

    VF.restoreSnapshot = function (snapStr) {
        var P = getP();
        if (!snapStr) return;
        S.layers = JSON.parse(snapStr);

        /* Reinitialize caches — the parsed objects are plain JSON,
           any canvas references are gone. */
        S.layers.forEach(function (l) { l.cache = {}; });

        Object.values(VF.pLayers).forEach(function (pl) { pl.remove(); });
        for (var k in VF.pLayers) delete VF.pLayers[k];

        S.layers.forEach(function (l) {
            var pl = new P.Layer(); pl.name = 'L' + l.id;
            VF.pLayers[l.id] = pl;
        });

        if (!S.layers.find(function (l) { return l.id === S.activeId; })) {
            S.activeId = S.layers[0] ? S.layers[0].id : 1;
        }

        VF.uiLayers();
        VF.uiTimeline();
        VF.render();
    };

    VF.execUndo = function () {
        if (VF.undoStack.length === 0) return;
        syncLayerState();
        VF.redoStack.push(snapshotLayers());
        var snap = VF.undoStack.pop();
        VF.restoreSnapshot(snap);
        VF._isDirty = true; // State changed
        VF.toast("Undo");
    };

    VF.execRedo = function () {
        if (VF.redoStack.length === 0) return;
        syncLayerState();
        VF.undoStack.push(snapshotLayers());
        var snap = VF.redoStack.pop();
        VF.restoreSnapshot(snap);
        VF._isDirty = true; // State changed
        VF.toast("Redo");
    };

    $('#btn-undo').on('click', VF.execUndo);
    $('#btn-redo').on('click', VF.execRedo);

})();