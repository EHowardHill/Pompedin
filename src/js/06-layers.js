(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    VF.addLayer = function (name, type) {
        var P = getP();
        VF.saveHistory();
        var id = S.nextId++;
        var maxZ = S.layers.length > 0 ? Math.max.apply(null, S.layers.map(function (l) { return l.z; })) : -1;

        var l = {
            id: id, name: name || ('Layer ' + id), type: type || 'vector',
            vis: true, opacity: 1, z: maxZ + 1, frames: {},
            tweens: {}, transforms: {}, loops: {}, /* ── NEW: Transform & Loop pool ── */
            imgData: null, cache: {},
            blendMode: 'normal',
            locked: false,
            reference: false,
            colorTag: 'none',
            wobble: {
                enabled: false,
                offset: 3,
                scale: 1.0,
                stroke: true,
                fill: true,
                perFrame: true
            }
        };
        S.layers.push(l);
        S.activeId = id;
        var pl = new P.Layer(); pl.name = 'L' + id;
        VF.pLayers[id] = pl;
        VF.uiLayers(); VF.uiTimeline();
        return l;
    };

    VF.delLayer = function (id) {
        if (S.layers.length <= 1) return;
        VF.saveHistory();
        S.layers = S.layers.filter(function (l) { return l.id !== id; });
        if (VF.pLayers[id]) { VF.pLayers[id].remove(); delete VF.pLayers[id]; }
        if (S.activeId === id) S.activeId = S.layers[0].id;
        VF.uiLayers(); VF.uiTimeline(); VF.render();
    };

    VF.dupLayer = function (id) {
        VF.saveHistory();
        var src = S.layers.find(function (l) { return l.id === id; });
        if (!src) return;
        var dup = VF.addLayer(src.name + ' copy', src.type);
        for (var k in src.frames) {
            dup.frames[k] = JSON.parse(JSON.stringify(src.frames[k]));
        }
        dup.opacity = src.opacity;
        dup.imgData = src.imgData;
        dup.tweens = src.tweens ? JSON.parse(JSON.stringify(src.tweens)) : {};
        dup.transforms = src.transforms ? JSON.parse(JSON.stringify(src.transforms)) : {};
        dup.loops = src.loops ? JSON.parse(JSON.stringify(src.loops)) : {};
        dup.blendMode = src.blendMode || 'normal';
        dup.locked = false;
        dup.reference = src.reference || false;
        dup.colorTag = src.colorTag || 'none';
        dup.wobble = src.wobble
            ? JSON.parse(JSON.stringify(src.wobble))
            : { enabled: false, offset: 3, scale: 1.0, stroke: true, fill: true, perFrame: true };
        VF.render(); VF.uiTimeline();
    };

})();