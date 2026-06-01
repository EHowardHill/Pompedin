(function () {
    "use strict";
    var S = VF.S;

    VF.isFolder = function (l) { return l && l.type === 'folder'; };
    VF.getItem = function (id) { return S.layers.find(function (l) { return l.id === id; }); };
    VF.drawableCount = function () { return S.layers.filter(function (l) { return !VF.isFolder(l); }).length; };

    // Children of a parent (null = root), ascending z (back -> front)
    VF.childrenOf = function (parentId) {
        parentId = parentId || null;
        return S.layers
            .filter(function (l) { return (l.parentId || null) === parentId; })
            .sort(function (a, b) { return a.z - b.z; });
    };

    VF.reindexSiblings = function (parentId) {
        VF.childrenOf(parentId).forEach(function (s, i) { s.z = i; });
    };

    VF.isDescendant = function (maybeChildId, ancestorId) {
        var n = VF.getItem(maybeChildId);
        while (n && n.parentId != null) {
            if (n.parentId === ancestorId) return true;
            n = VF.getItem(n.parentId);
        }
        return false;
    };

    // Drawable layers only, back-to-front, respecting nesting (NOT collapse — collapse is UI only)
    VF.flattenDrawables = function () {
        var out = [];
        (function walk(parentId) {
            VF.childrenOf(parentId).forEach(function (item) {
                if (VF.isFolder(item)) walk(item.id);
                else out.push(item);
            });
        })(null);
        return out;
    };

    // Folders + layers, top-first, for the panel & timeline (respects collapse)
    VF.visibleTree = function () {
        var out = [];
        (function walk(parentId, depth) {
            VF.childrenOf(parentId).slice().sort(function (a, b) { return b.z - a.z; })
                .forEach(function (item) {
                    out.push({ item: item, depth: depth });
                    if (VF.isFolder(item) && !item.collapsed) walk(item.id, depth + 1);
                });
        })(null, 0);
        return out;
    };

    /* ── SWITCH RESOLUTION ── */
    VF.getSwitchChild = function (folder, f) {
        var kids = VF.childrenOf(folder.id);
        if (kids.length === 0) return null;
        var topDefault = kids[kids.length - 1].id;
        var sw = folder.switch && folder.switch.frames;
        if (!sw) return topDefault;
        var keys = Object.keys(sw).map(Number).sort(function (a, b) { return a - b; });
        if (keys.length === 0) return topDefault;
        var chosen = sw[keys[0]];
        for (var i = 0; i < keys.length; i++) {
            if (keys[i] <= f) chosen = sw[keys[i]]; else break;
        }
        return kids.find(function (k) { return k.id === chosen; }) ? chosen : topDefault;
    };

    VF.activeSwitchChildId = function (folder) { return VF.getSwitchChild(folder, S.tl.frame); };

    VF.setSwitch = function (folder, frame, childId) {
        if (!folder.switch) folder.switch = { frames: {} };
        folder.switch.frames[frame] = childId;
    };
    VF.delSwitch = function (folder, frame) {
        if (folder.switch && folder.switch.frames) delete folder.switch.frames[frame];
    };

    // When a switch-child layer becomes active, make it the visible pick at
    // the current frame so the user never draws onto a hidden child.
    VF.syncActiveSwitchPick = function (id) {
        var l = VF.getItem(id);
        if (!l || VF.isFolder(l)) return;
        var parent = l.parentId != null ? VF.getItem(l.parentId) : null;
        if (!parent || parent.kind !== 'switch') return;
        if (VF.getSwitchChild(parent, S.tl.frame) === id) return; // already visible
        VF.saveHistory();
        VF.setSwitch(parent, S.tl.frame, id);
    };

    // When the active layer belongs to a switch folder, keep the active
    // layer in sync with whichever child the switch displays at frame f.
    // Scrubbing or playing always lands the artist on the drawing they see.
    VF.followSwitchOnFrame = function (f) {
        var active = VF.getItem(S.activeId);
        if (!active || VF.isFolder(active)) return false;
        var parent = active.parentId != null ? VF.getItem(active.parentId) : null;
        if (!parent || parent.kind !== 'switch') return false;
        var pick = VF.getSwitchChild(parent, f);
        if (pick == null || pick === S.activeId) return false;
        S.activeId = pick;
        VF.selSegments = [];
        if (VF.clearHandles) VF.clearHandles();
        return true;
    };

    // True if a layer's own vis is on but a switch ancestor isn't picking it
    // at frame f (so it's hidden purely by the switch, not by a vis toggle).
    VF.isHiddenBySwitch = function (l, f) {
        if (!l || VF.isFolder(l) || !l.vis) return false;
        var node = l, parent = node.parentId != null ? VF.getItem(node.parentId) : null;
        while (parent) {
            if (parent.kind === 'switch' && VF.getSwitchChild(parent, f) !== node.id) return true;
            node = parent;
            parent = node.parentId != null ? VF.getItem(node.parentId) : null;
        }
        return false;
    };

    // Renderable at frame f: self visible + all ancestors visible + active in any switch ancestor
    VF.isLayerRenderable = function (l, f) {
        if (VF.isFolder(l) || !l.vis) return false;
        var node = l, parent = node.parentId != null ? VF.getItem(node.parentId) : null;
        while (parent) {
            if (!parent.vis) return false;
            if (parent.kind === 'switch' && VF.getSwitchChild(parent, f) !== node.id) return false;
            node = parent;
            parent = node.parentId != null ? VF.getItem(node.parentId) : null;
        }
        return true;
    };

    // Cumulative opacity multiplier from all folder ancestors of a drawable.
    // Folders from older projects may lack `opacity` → treated as 1 (fully opaque).
    VF.ancestorOpacity = function (l) {
        var mult = 1;
        var parent = (l && l.parentId != null) ? VF.getItem(l.parentId) : null;
        while (parent) {
            if (VF.isFolder(parent)) {
                mult *= (parent.opacity != null ? parent.opacity : 1);
            }
            parent = parent.parentId != null ? VF.getItem(parent.parentId) : null;
        }
        return mult;
    };

    /* ── CREATION ── */
    VF.resolveNewParent = function () {
        var a = VF.getItem(S.activeId);
        if (!a) return null;
        return VF.isFolder(a) ? a.id : (a.parentId || null);
    };

    VF.addFolder = function (name, kind) {
        VF.saveHistory();
        var id = S.nextId++;
        var parentId = VF.resolveNewParent();
        var sib = VF.childrenOf(parentId);
        var maxZ = sib.length ? Math.max.apply(null, sib.map(function (s) { return s.z; })) : -1;
        var f = {
            id: id, type: 'folder', kind: (kind === 'switch' ? 'switch' : 'normal'),
            name: name || ((kind === 'switch' ? 'Switch ' : 'Folder ') + id),
            vis: true, z: maxZ + 1, parentId: parentId, collapsed: false, colorTag: 'none',
            opacity: 1
        };
        if (f.kind === 'switch') f.switch = { frames: {} };
        S.layers.push(f);
        S.activeId = id;
        VF.uiLayers(); VF.uiTimeline();
        return f;
    };

    /* ── TIMELINE ROW HELPERS ── */
    VF.buildSwitchRow = function (folder) {
        var max = S.tl.max, cur = S.tl.frame, cells = '';
        var sw = (folder.switch && folder.switch.frames) || {};
        for (var i = 0; i < max; i++) {
            var cc = i === cur ? ' cur' : '';
            var has = sw[i] !== undefined;
            var content = '';
            if (has) {
                var child = VF.getItem(sw[i]);
                var title = child ? child.name : '(missing)';
                content = '<div class="tl-sw-dot" data-f="' + i + '" data-l="' + folder.id + '" title="' + title + '"></div>';
            }
            cells += '<div class="tl-cell' + cc + '" data-f="' + i + '" data-l="' + folder.id + '" style="position:relative">' + content + '</div>';
        }
        return '<div class="tl-row tl-switch-row" data-l="' + folder.id + '">' + cells + '</div>';
    };

    VF.buildFolderRow = function (folder) {
        var max = S.tl.max, cur = S.tl.frame, cells = '';
        for (var i = 0; i < max; i++) {
            cells += '<div class="tl-cell' + (i === cur ? ' cur' : '') + '" data-f="' + i + '" data-l="' + folder.id + '"></div>';
        }
        return '<div class="tl-row tl-folder-row" data-l="' + folder.id + '">' + cells + '</div>';
    };

    /* ── BUTTONS + SWITCH-DOT INTERACTION ── */
    $(document).ready(function () {
        $('#btn-newfolder').on('click', function () { VF.addFolder(null, 'normal'); VF.render(); });
        $('#btn-newswitch').on('click', function () { VF.addFolder(null, 'switch'); VF.render(); });

        $('#tl-rows').on('click', '.tl-sw-dot', function (e) {
            e.stopPropagation();
            VF.goFrame(+$(this).closest('.tl-cell').data('f'));
        });
        $('#tl-rows').on('contextmenu', '.tl-sw-dot', function (e) {
            e.preventDefault(); e.stopPropagation();
            var f = +$(this).closest('.tl-cell').data('f');
            var folder = VF.getItem(+$(this).closest('.tl-cell').data('l'));
            if (folder) {
                VF.saveHistory(); VF.delSwitch(folder, f);
                VF.render(); VF.uiTimeline(); VF.toast('Switch key removed');
            }
        });
    });

})();