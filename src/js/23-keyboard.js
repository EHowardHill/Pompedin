(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    var spaceHeld = false;
    var preSpaceTool = null;

    /* ── Item clipboard (separate from frame clipboard S.clip) ── */
    VF.itemClip = null;

    /* ═══════════════════════════════════════════════════
       Collect unique top-level layer children that own
       the currently selected segments.
       ═══════════════════════════════════════════════════ */
    VF.getSelectedItems = function () {
        var pl = VF.pLayers[S.activeId];
        if (!pl) return [];

        var items = [];
        var seen = new Set();

        VF.selSegments.forEach(function (seg) {
            if (!seg.path) return;

            var item = seg.path;
            while (item.parent && item.parent !== pl) {
                item = item.parent;
            }
            if (item.parent === pl && !item._isH && !seen.has(item.id)) {
                seen.add(item.id);
                items.push(item);
            }
        });

        return items;
    };

    /* ═══════════════════════════════════════════════════
       Serialize a single top-level item
       ═══════════════════════════════════════════════════ */
    VF.serItem = function (c) {
        var P = getP();
        if (c._isH) return null;

        if (c.data && c.data.isTextureStroke) {
            var customData = {
                __texStroke: true,
                tex: c.data.tex,
                col: c.data.strokeCol,
                size: c.data.brushSize,
                seed: c.data.seed || 0,
                rot: c.data.rot || 0,
                angJit: c.data.angJit !== undefined ? c.data.angJit : 100,
                posJit: c.data.posJit || 0
            };

            var mat = c.matrix;
            var decomp = mat.decompose();

            if (c.data.pressurePoints) {
                customData.pressurePoints = c.data.pressurePoints.map(function (p) {
                    var mappedPt = mat.transform(new P.Point(p.x, p.y));
                    return {
                        x: mappedPt.x,
                        y: mappedPt.y,
                        angle: p.angle,
                        width: p.width * decomp.scaling.x
                    };
                });
            } else {
                var guide = c.children ? Array.from(c.children).find(
                    function (ch) { return ch.data && ch.data.isGuide; }
                ) : null;
                if (guide) {
                    var gClone = guide.clone({ insert: false });
                    gClone.transform(mat);
                    gClone.visible = true;
                    customData.pathJSON = gClone.exportJSON();
                }
            }
            return JSON.stringify(customData);
        }

        if (c.className === 'Path' || c.className === 'CompoundPath' ||
            c.className === 'Shape' || c.className === 'Group') {
            var clone = c.clone({ insert: false });
            return clone.exportJSON();
        }

        return null;
    };

    /* ═══════════════════════════════════════════════════
       Deserialize a single item
       ═══════════════════════════════════════════════════ */
    VF.desItem = function (pl, jsonStr) {
        var P = getP();
        try {
            var parsed = null;
            try { parsed = JSON.parse(jsonStr); } catch (_) { parsed = null; }

            if (parsed && parsed.__texStroke) {
                if (parsed.pressurePoints && parsed.pressurePoints.length > 0) {
                    var pts = parsed.pressurePoints.map(function (p) {
                        return {
                            point: new P.Point(p.x, p.y),
                            angle: p.angle,
                            width: p.width
                        };
                    });
                    var grp = VF.renderPressureTextureRibbon(
                        pts, parsed.tex, parsed.col, parsed.size, {
                        seed: parsed.seed || 0,
                        rot: parsed.rot || 0,
                        angJit: parsed.angJit !== undefined ? parsed.angJit : 100,
                        posJit: parsed.posJit || 0
                    }
                    );
                    if (grp) pl.addChild(grp);
                    return grp;
                } else if (parsed.pathJSON) {
                    var tempGroup = new P.Group({ insert: false });
                    var guidePath = tempGroup.importJSON(parsed.pathJSON);
                    if (guidePath) {
                        guidePath.remove();
                        var grp2 = VF.renderTextureRibbon(
                            guidePath, parsed.tex, parsed.col, parsed.size, {
                            seed: parsed.seed || 0,
                            rot: parsed.rot || 0,
                            angJit: parsed.angJit !== undefined ? parsed.angJit : 100,
                            posJit: parsed.posJit || 0
                        }
                        );
                        if (grp2) pl.addChild(grp2);
                        tempGroup.remove();
                        return grp2;
                    }
                    tempGroup.remove();
                }
                return null;
            }

            return pl.importJSON(jsonStr);
        } catch (e) {
            return null;
        }
    };

    /* ═══════════════════════════════════════════════════
       COPY selected items
       ═══════════════════════════════════════════════════ */
    function copySelectedItems() {
        var items = VF.getSelectedItems();
        if (items.length === 0) return false;

        var serialized = [];
        items.forEach(function (item) {
            var s = VF.serItem(item);
            if (s) serialized.push(s);
        });

        if (serialized.length > 0) {
            VF.itemClip = serialized;
            VF.toast(serialized.length + ' item' + (serialized.length > 1 ? 's' : '') + ' copied');
            return true;
        }
        return false;
    }

    /* ═══════════════════════════════════════════════════
       CUT selected items (copy then remove)
       ═══════════════════════════════════════════════════ */
    function cutSelectedItems() {
        var items = VF.getSelectedItems();
        if (items.length === 0) return false;

        /* Check if layer is locked before cutting */
        if (VF.isLocked && VF.isLocked()) {
            VF.toast('Layer is locked');
            return false;
        }

        VF.saveHistory();

        var serialized = [];
        items.forEach(function (item) {
            var s = VF.serItem(item);
            if (s) serialized.push(s);
        });

        if (serialized.length > 0) {
            VF.itemClip = serialized;

            items.forEach(function (item) { item.remove(); });

            VF.selSegments = [];
            VF.clearHandles();
            if (VF.syncUIFromSelection) VF.syncUIFromSelection();
            VF.saveFrame();
            VF.uiTimeline();
            VF.render();
            VF.toast(serialized.length + ' item' + (serialized.length > 1 ? 's' : '') + ' cut');
            return true;
        }
        return false;
    }

    /* ═══════════════════════════════════════════════════
       PASTE items from item clipboard
       ═══════════════════════════════════════════════════ */
    function pasteItems() {
        if (!VF.itemClip || VF.itemClip.length === 0) return false;

        var pl = VF.pLayers[S.activeId];
        if (!pl) return false;

        /* Check if layer is locked before pasting */
        if (VF.isLocked && VF.isLocked()) {
            VF.toast('Layer is locked');
            return false;
        }

        VF.saveHistory();

        VF.selSegments = [];
        VF.clearHandles();

        var PASTE_OFFSET = 10;
        var P = getP();
        var pastedItems = [];

        VF.itemClip.forEach(function (jsonStr) {
            var item = VF.desItem(pl, jsonStr);
            if (item) {
                item.position = item.position.add(new P.Point(PASTE_OFFSET, PASTE_OFFSET));
                pastedItems.push(item);
            }
        });

        pastedItems.forEach(function (item) {
            if (item.segments) {
                item.segments.forEach(function (seg) {
                    VF.selSegments.push(seg);
                });
            } else if (item.children) {
                item.children.forEach(function (child) {
                    if (child.segments) {
                        child.segments.forEach(function (seg) {
                            VF.selSegments.push(seg);
                        });
                    }
                });
            }
        });

        VF.showHandles();
        VF.saveFrame();
        VF.uiTimeline();
        VF.toast(pastedItems.length + ' item' + (pastedItems.length > 1 ? 's' : '') + ' pasted');
        return true;
    }

    /* ═══════════════════════════════════════════════════
       KEYDOWN HANDLER
       ═══════════════════════════════════════════════════ */
    $(document).on('keydown', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

        // Track Alt-combo usage so a bare Alt tap can be distinguished from Alt+X
        if (e.altKey && e.key !== 'Alt') VF._altDirty = true;

        if (e.ctrlKey || e.metaKey) {
            if (e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) VF.execRedo(); else VF.execUndo(); return; }
            if (e.key.toLowerCase() === 'y') { e.preventDefault(); VF.execRedo(); return; }

            if (e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (e.shiftKey) VF.doSave('save-as');
                else VF.doSave('save');
                return;
            }

            /* Ctrl+0 — Fit to Screen */
            if (e.key === '0') {
                e.preventDefault();
                if (VF.fitToScreen) VF.fitToScreen();
                return;
            }

            if (e.key.toLowerCase() === 'x') {
                e.preventDefault();
                if (VF.selSegments.length > 0) {
                    cutSelectedItems();
                } else if (VF.tlSelection && VF.tlSelection.length > 0) {
                    // 1. Copy
                    var minF = Math.min.apply(null, VF.tlSelection.map(function (s) { return s.f; }));
                    var sortedLayers = VF.flattenDrawables
                        ? VF.flattenDrawables().slice().reverse()
                        : [].concat(S.layers).sort(function (a, b) { return b.z - a.z; });
                    var activeLIndex = sortedLayers.findIndex(function (lyr) { return lyr.id === S.activeId; });

                    S.clipNodes = [];
                    VF.tlSelection.forEach(function (sel) {
                        // Handle camera copy phase
                        if (sel.l === '__camera') {
                            if (S.camera && S.camera.frames && S.camera.frames[sel.f] !== undefined) {
                                S.clipNodes.push({
                                    fOffset: sel.f - minF, lOffset: '__camera', type: 'camera',
                                    data: JSON.parse(JSON.stringify(S.camera.frames[sel.f]))
                                });
                            }
                            return;
                        }

                        var lyr = S.layers.find(function (x) { return x.id === sel.l; });
                        var lIndex = sortedLayers.findIndex(function (x) { return x.id === sel.l; });
                        if (!lyr) return;
                        var data = sel.type === 'transform' ? (lyr.transforms ? lyr.transforms[sel.f] : null) : lyr.frames[sel.f];
                        if (data) {
                            S.clipNodes.push({
                                fOffset: sel.f - minF, lOffset: lIndex - activeLIndex, type: sel.type,
                                data: JSON.parse(JSON.stringify(data))
                            });
                        }
                    });

                    // 2. Delete
                    VF.saveHistory();
                    var reloadLayers = new Set();

                    VF.tlSelection.forEach(function (sel) {
                        // Handle camera delete phase
                        if (sel.l === '__camera') {
                            if (S.camera && S.camera.frames && S.camera.frames[sel.f] !== undefined) {
                                delete S.camera.frames[sel.f];
                            }
                            return;
                        }

                        var lyr = S.layers.find(function (x) { return x.id === sel.l; });
                        if (lyr && !lyr.locked) {
                            if (sel.type === 'transform' && lyr.transforms) delete lyr.transforms[sel.f];
                            else if (lyr.frames[sel.f] !== undefined) {
                                delete lyr.frames[sel.f];
                                if (lyr.cache) delete lyr.cache[sel.f];
                                if (sel.f === S.tl.frame) reloadLayers.add(lyr.id);
                            }
                        }
                    });

                    reloadLayers.forEach(function (id) {
                        VF.loadFrame(id, S.tl.frame);
                    });

                    VF.toast(S.clipNodes.length + ' keyframes cut');
                    VF.tlSelection = [];
                    VF.render();
                    VF.uiTimeline();
                }
                return;
            }

            if (e.key.toLowerCase() === 'c') {
                e.preventDefault();
                if (VF.selSegments.length > 0) {
                    copySelectedItems();
                } else if (VF.tlSelection && VF.tlSelection.length > 0) {
                    // BULK TIMELINE COPY
                    var minF = Math.min.apply(null, VF.tlSelection.map(function (s) { return s.f; }));
                    var sortedLayers = VF.flattenDrawables
                        ? VF.flattenDrawables().slice().reverse()
                        : [].concat(S.layers).sort(function (a, b) { return b.z - a.z; });
                    var activeLIndex = sortedLayers.findIndex(function (lyr) { return lyr.id === S.activeId; });

                    S.clipNodes = [];
                    VF.tlSelection.forEach(function (sel) {
                        // Support copying camera frames
                        if (sel.l === '__camera') {
                            if (S.camera && S.camera.frames && S.camera.frames[sel.f] !== undefined) {
                                S.clipNodes.push({
                                    fOffset: sel.f - minF, lOffset: '__camera', type: 'camera',
                                    data: JSON.parse(JSON.stringify(S.camera.frames[sel.f]))
                                });
                            }
                            return;
                        }

                        var lyr = S.layers.find(function (x) { return x.id === sel.l; });
                        var lIndex = sortedLayers.findIndex(function (x) { return x.id === sel.l; });
                        if (!lyr) return;

                        var data = sel.type === 'transform' ? (lyr.transforms ? lyr.transforms[sel.f] : null) : lyr.frames[sel.f];
                        if (data) {
                            S.clipNodes.push({
                                fOffset: sel.f - minF,
                                lOffset: lIndex - activeLIndex,
                                type: sel.type,
                                data: JSON.parse(JSON.stringify(data))
                            });
                        }
                    });

                    S.clip = null; // Clear single clip to prevent context menu confusion
                    VF.toast(S.clipNodes.length + ' keyframes copied');
                } else {
                    // SINGLE FRAME COPY (Legacy)
                    var l = VF.AL();
                    if (l) {
                        var res = VF.getResolvedFrame(l, S.tl.frame);
                        S.clip = res && res.data ? JSON.parse(JSON.stringify(res.data)) : null;
                        S.clipNodes = null;
                        VF.toast(S.clip ? 'Frame copied' : 'Blank frame copied');
                    }
                }
                return;
            }

            if (e.key.toLowerCase() === 'v') {
                e.preventDefault();
                var inSelectTool = ['select', 'lasso', 'translate', 'rotate', 'scale'].indexOf(S.tool) !== -1;

                if (VF.itemClip && VF.itemClip.length > 0 && inSelectTool) {
                    pasteItems();
                } else if (S.clipNodes && S.clipNodes.length > 0) {
                    
                    // BULK TIMELINE PASTE
                    VF.saveHistory();
                    var sortedLayers = VF.flattenDrawables
                        ? VF.flattenDrawables().slice().reverse()
                        : [].concat(S.layers).sort(function (a, b) { return b.z - a.z; });
                    var activeLIndex = sortedLayers.findIndex(function (lyr) { return lyr.id === S.activeId; });
                    var pastedCount = 0;
                    var reloadLayers = new Set();

                    S.clipNodes.forEach(function (node) {
                        var targetF = S.tl.frame + node.fOffset;

                        // Dynamically extend timeline length if pasting past the end
                        while (targetF >= S.tl.max) {
                            S.tl.max++;
                            $('#pref-end, #in-endframe').val(S.tl.max);
                        }

                        if (node.lOffset === '__camera') {
                            if (!S.camera) S.camera = { frames: {} };
                            S.camera.frames[targetF] = JSON.parse(JSON.stringify(node.data));
                            pastedCount++;
                            return;
                        }

                        var targetLIndex = activeLIndex + node.lOffset;
                        if (targetLIndex >= 0 && targetLIndex < sortedLayers.length) {
                            var tgtLyr = sortedLayers[targetLIndex];
                            if (tgtLyr.locked) return;

                            if (node.type === 'transform') {
                                if (!tgtLyr.transforms) tgtLyr.transforms = {};
                                tgtLyr.transforms[targetF] = JSON.parse(JSON.stringify(node.data));
                            } else {
                                tgtLyr.frames[targetF] = JSON.parse(JSON.stringify(node.data));
                                if (tgtLyr.cache) delete tgtLyr.cache[targetF];
                                if (targetF === S.tl.frame) reloadLayers.add(tgtLyr.id);
                            }
                            pastedCount++;
                        }
                    });

                    reloadLayers.forEach(function (id) { VF.loadFrame(id, S.tl.frame); });

                    if (pastedCount > 0) {
                        VF.render();
                        VF.uiTimeline();
                        VF.toast(pastedCount + ' keyframes pasted');
                    }
                } else {
                    // SINGLE FRAME PASTE (Legacy)
                    var l2 = VF.AL();
                    if (l2) {
                        if (l2.locked) { VF.toast('Layer is locked'); return; }
                        VF.saveHistory();
                        l2.frames[S.tl.frame] = S.clip ? JSON.parse(JSON.stringify(S.clip)) : [];
                        if (!l2.cache) l2.cache = {};
                        delete l2.cache[S.tl.frame];
                        VF.render();
                        VF.uiTimeline();
                        VF.toast('Frame pasted');
                    }
                }
                return;
            }
        }

        var k = e.key.toLowerCase();

        /* ── Alt key — Eyedropper ──
                   Left Alt  (location 1) → pick Stroke color
                   Right Alt (location 2) → pick Fill color
                   Plain Alt (location 0, e.g. some keyboards) → Stroke */
        if (e.key === 'Alt') {
            e.preventDefault();
            if (!e.repeat) VF._altLocation = e.location;
            return;
        }
        // Any non-Alt key while Alt is held means it's a combo (Alt+Tab etc.) —
        // mark dirty so keyup won't open the eyedropper.
        if (e.altKey) VF._altDirty = true;

        /* ── Bracket keys — Stroke size ──
           [  = decrease,  ]  = increase
           Hold Shift for larger steps (×5) */
        if (e.key === '[' || e.key === ']') {
            e.preventDefault();
            var step = e.shiftKey ? 5 : 1;
            var newSize = S.cfg.brushSize + (e.key === ']' ? step : -step);
            newSize = Math.max(1, Math.min(60, newSize));
            S.cfg.brushSize = newSize;
            $('#rng-brush').val(newSize);
            $('#v-brush').val(newSize);
            if (VF.hasSelection && VF.hasSelection()) {
                VF.applyPropertyToSelection('brushSize', newSize);
            }
            return;
        }

        /* ── Space pan-hold stays hardcoded (needs keyup tracking) ── */
        if (e.key === ' ') {
            spaceHeld = false;
            VF.setTool(preSpaceTool || 'brush');
            preSpaceTool = null;
        }

        /* ── Remappable actions: tools, playback, frame/layer nav, symmetry ── */
        if (VF.shortcuts && VF.shortcuts.handle(e)) return;

        if (k === 'escape') {
            e.preventDefault();
            if (VF.selectMode === 'vertex') {
                VF.exitVertexMode();
            } else if (VF.selSegments.length > 0) {
                VF.selSegments = [];
                VF.clearHandles();
                if (VF.syncUIFromSelection) VF.syncUIFromSelection();
            }
        }
        else if (k === 'delete' || k === 'backspace') {
            if (VF.selSegments.length > 0) {
                /* Canvas Item Deletion */
                if (VF.isLocked && VF.isLocked()) {
                    VF.toast('Layer is locked');
                    return;
                }
                VF.saveHistory();
                var items = VF.getSelectedItems();
                console.log('Deleting items:', items.map(function (it) { return it.className + ' (children: ' + (it.children ? it.children.length : 0) + ')'; }));
                items.forEach(function (item) { item.remove(); });
                VF.selSegments = [];
                VF.clearHandles();
                if (VF.syncUIFromSelection) VF.syncUIFromSelection();
                VF.saveFrame();
                VF.uiTimeline();
                VF.render();
            } else if (VF.tlSelection && VF.tlSelection.length > 0) {
                /* Timeline Node Deletion */
                VF.saveHistory();
                var reloadLayers = new Set();
                var deletedCount = 0;

                VF.tlSelection.forEach(function (sel) {
                    if (sel.l === '__camera') {
                        if (S.camera && S.camera.frames && S.camera.frames[sel.f] !== undefined) {
                            delete S.camera.frames[sel.f];
                            deletedCount++;
                        }
                        return;
                    }

                    var lyr = S.layers.find(function (x) { return x.id === sel.l; });
                    if (lyr && !lyr.locked) {
                        if (sel.type === 'transform' && lyr.transforms && lyr.transforms[sel.f] !== undefined) {
                            delete lyr.transforms[sel.f];
                            deletedCount++;
                        } else if (lyr.frames[sel.f] !== undefined) {
                            delete lyr.frames[sel.f];
                            if (lyr.cache) delete lyr.cache[sel.f];
                            if (sel.f === S.tl.frame) reloadLayers.add(lyr.id);
                            deletedCount++;
                        }
                    }
                });

                // Reload the exposed frames for any layers we just punched a hole in
                reloadLayers.forEach(function (id) {
                    VF.loadFrame(id, S.tl.frame);
                });

                if (deletedCount > 0) {
                    VF.toast(deletedCount + ' keyframe(s) deleted');
                } else {
                    VF.toast('Target layers are locked');
                }

                VF.tlSelection = [];
                VF.render();
                VF.uiTimeline();
            }
        }
    });

    $(document).on('keyup', function (e) {
        if (e.key === ' ') {
            spaceHeld = false;
            VF.setTool(preSpaceTool || 'brush');
            preSpaceTool = null;
        }
        if (e.key === 'Alt') {
            // Only open the eyedropper for a clean Alt tap (no combo like Alt+Tab)
            if (!VF._altDirty) {
                if (VF._altLocation === 2) VF.pickScreenColor('#clr-fill');
                else VF.pickScreenColor('#clr-stroke');
            }
            VF._altDirty = false;
        }
    });

})();