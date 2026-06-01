(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    VF.addLayer = function (name, type) {
        var P = getP();
        VF.saveHistory();
        var id = S.nextId++;

        var parentId = VF.resolveNewParent ? VF.resolveNewParent() : null;
        var sib = VF.childrenOf ? VF.childrenOf(parentId) : S.layers;
        var maxZ = sib.length > 0 ? Math.max.apply(null, sib.map(function (l) { return l.z; })) : -1;

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
        var item = VF.getItem(id); if (!item) return;
        if (!VF.isFolder(item) && VF.drawableCount() <= 1) { VF.toast('Need at least one layer'); return; }
        VF.saveHistory();
        if (VF.isFolder(item)) {
            VF.childrenOf(id).forEach(function (c) { c.parentId = item.parentId || null; });
            VF.reindexSiblings(item.parentId || null);
        }
        S.layers = S.layers.filter(function (l) { return l.id !== id; });
        if (VF.pLayers[id]) { VF.pLayers[id].remove(); delete VF.pLayers[id]; }
        if (S.activeId === id) {
            var d = S.layers.find(function (l) { return !VF.isFolder(l); });
            S.activeId = d ? d.id : (S.layers[0] ? S.layers[0].id : 1);
        }
        VF.uiLayers(); VF.uiTimeline(); VF.render();
    };

    VF.dupLayer = function (id) {
        var src = VF.getItem(id); if (!src) return;
        VF.saveHistory();
        var idMap = {};
        function deepCopy(orig, newParentId, isTop) {
            var nid = S.nextId++;
            idMap[orig.id] = nid;
            var copy = JSON.parse(JSON.stringify(orig));
            copy.id = nid; copy.parentId = newParentId; copy.cache = {};
            if (isTop) copy.name = orig.name + ' copy';
            S.layers.push(copy);
            if (!VF.isFolder(copy)) {
                var pl = new (VF.P).Layer(); pl.name = 'L' + nid; VF.pLayers[nid] = pl;
            } else {
                VF.childrenOf(orig.id).forEach(function (c) { deepCopy(c, nid, false); });
                if (copy.kind === 'switch' && copy.switch && copy.switch.frames) {
                    Object.keys(copy.switch.frames).forEach(function (k) {
                        var oc = copy.switch.frames[k];
                        if (idMap[oc] !== undefined) copy.switch.frames[k] = idMap[oc];
                    });
                }
            }
            return copy;
        }
        var top = deepCopy(src, src.parentId || null, true);
        top.z = src.z + 0.5;                  // slot just above the original
        VF.reindexSiblings(src.parentId || null);
        S.activeId = top.id;
        VF.render(); VF.uiLayers(); VF.uiTimeline();
    };

})();