(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    var tEraser = new (getP()).Tool(); tEraser.name = 'eraser';
    VF.tEraser = tEraser;

    var tEraserSaved = false;

    /* ── Helper: collect all segments belonging to an item tree ── */
    function collectItemSegments(item) {
        var segs = [];
        if (item.segments) {
            item.segments.forEach(function (seg) { segs.push(seg); });
        }
        if (item.children) {
            item.children.forEach(function (child) {
                collectItemSegments(child).forEach(function (seg) { segs.push(seg); });
            });
        }
        return segs;
    }

    function eraseAt(pt) {
        var pl = VF.pLayers[S.activeId]; if (!pl) return;
        var tol = Math.max(S.cfg.brushSize, 6);
        var hit = VF.getValidHit(pt, pl, tol);

        if (hit && hit.item && !hit.item._isH) {
            if (!tEraserSaved) {
                VF.saveHistory();
                tEraserSaved = true;
            }
            var target = hit.item;
            var cursor = target;
            while (cursor && cursor !== pl) {
                if (cursor.data && cursor.data.isTextureStroke) {
                    target = cursor;
                    break;
                }
                if (cursor.parent && cursor.parent !== pl && cursor.parent.className === 'Group') {
                    target = cursor.parent;
                    cursor = cursor.parent;
                } else {
                    break;
                }
            }

            /* Remove stale segment references from VF.selSegments
               before destroying the item. This prevents crashes when
               the select tool later tries to operate on deleted segments. */
            if (VF.selSegments.length > 0) {
                var deadSegs = new Set();
                collectItemSegments(target).forEach(function (seg) { deadSegs.add(seg); });
                if (deadSegs.size > 0) {
                    VF.selSegments = VF.selSegments.filter(function (seg) {
                        return !deadSegs.has(seg);
                    });
                }
            }

            target.remove();
            VF.view.update();
        }
    }

    tEraser.onMouseDown = function (e) {
        if (VF.isPanInput(e.event)) return;
        if (VF.isLocked && VF.isLocked()) { VF.toast('Layer is locked'); return; }
        tEraserSaved = false;
        if (S.tool === 'eraser') eraseAt(e.point);
    };

    tEraser.onMouseDrag = function (e) {
        if (VF.isPanInput(e.event)) return;
        if (S.tool === 'eraser') eraseAt(e.point);
    };

    tEraser.onMouseUp = function (e) {
        if (VF.isPanInput(e.event)) return;

        /* Refresh handles after erasing to prevent ghost gizmos */
        if (VF.selSegments.length > 0) {
            VF.showHandles();
        } else {
            VF.clearHandles();
        }

        VF.saveFrame();
        VF.render();
    };

})();
