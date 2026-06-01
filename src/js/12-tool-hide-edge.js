(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    var tHideEdge = new (getP()).Tool(); tHideEdge.name = 'hideEdge';
    VF.tHideEdge = tHideEdge;

    /* ── Drag state ── */
    var historySaved = false;
    var touchedItems = new Set();   // dedup keys to avoid double-processing during drag
    var feedbackItems = [];         // transient highlight items
    var hideCount = 0;
    var revealCount = 0;
    var gestureMode = null;         // 'hide' | 'reveal' — locked on first hit per gesture

    /* ── Helpers ── */

    /** Get the canvas background color (what the overlay should match). */
    function getBgColor() {
        if (VF.wsPrefs && !VF.wsPrefs.canvasBgTransparent && VF.wsPrefs.canvasBgColor) {
            return VF.wsPrefs.canvasBgColor;
        }
        return '#ffffff';
    }

    /** Clean up transient feedback highlights. */
    function clearFeedback() {
        feedbackItems.forEach(function (item) {
            try { item.remove(); } catch (_) { }
        });
        feedbackItems = [];
    }

    /**
     * Core: hit-test at a point.
     * - If a hidden-edge overlay is hit → reveal it (remove the overlay).
     * - If a normal stroke is hit → hide the curve segment under the cursor.
     * The gesture mode is locked on the first hit per mouseDown→mouseUp cycle.
     * Returns true if something was processed.
     */
    function processEdgeAt(pt) {
        var P = getP();
        var pl = VF.pLayers[S.activeId];
        if (!pl) return false;

        var hit = pl.hitTest(pt, {
            stroke: true,
            fill: true,
            tolerance: Math.max(8, S.cfg.brushSize) / VF.view.zoom
        });

        if (!hit || !hit.item) return false;

        var hitItem = hit.item;
        var isOverlay = hitItem.data && hitItem.data.isHiddenEdge;

        /* ── Lock gesture mode on first hit ── */
        if (gestureMode === null) {
            gestureMode = isOverlay ? 'reveal' : 'hide';
        }

        /* ── REVEAL MODE: remove hidden-edge overlays ── */
        if (gestureMode === 'reveal') {
            if (!isOverlay) return false;

            /* Deduplicate by item id */
            var revealKey = 'r:' + hitItem.id;
            if (touchedItems.has(revealKey)) return false;
            touchedItems.add(revealKey);

            if (!historySaved) { VF.saveHistory(); historySaved = true; }

            /* Brief green highlight before removal so user sees what was restored */
            VF.fgLayer.activate();
            var z = VF.view.zoom;
            var revealHL = hitItem.clone({ insert: true });
            revealHL._isH = true;

            // Reset blendMode to normal in case the hit item was a destination-out mask
            revealHL.blendMode = 'normal';

            revealHL.strokeColor = new P.Color(0.2, 0.8, 0.4, 0.7);
            revealHL.strokeWidth = (hitItem.strokeWidth + 4) / z;
            revealHL.dashArray = [5 / z, 3 / z];
            feedbackItems.push(revealHL);
            if (VF.pLayers[S.activeId]) VF.pLayers[S.activeId].activate();

            hitItem.remove();
            revealCount++;
            return true;
        }

        /* ── HIDE MODE: create bg-colored overlay or eraser mask ── */
        if (hit.type !== 'stroke' || !hit.location) return false;
        if (isOverlay) return false;

        var curve = hit.location.curve;
        if (!curve) return false;

        var path = curve.path;
        if (!path) return false;

        var curveKey = 'h:' + path.id + ':' + curve.index;
        if (touchedItems.has(curveKey)) return false;
        touchedItems.add(curveKey);

        if (!historySaved) { VF.saveHistory(); historySaved = true; }

        /* Find top-level insertion target (handles groups / texture strokes) */
        var insertTarget = path;
        while (insertTarget.parent && insertTarget.parent !== pl) {
            insertTarget = insertTarget.parent;
        }

        // Check workspace transparency
        var isTransparent = VF.wsPrefs && VF.wsPrefs.canvasBgTransparent;
        var bgColor = getBgColor();

        var overlay = new P.Path();
        overlay.add(new P.Segment(curve.point1, null, curve.handle1));
        overlay.add(new P.Segment(curve.point2, curve.handle2, null));

        overlay.strokeCap = 'round';
        overlay.strokeWidth = Math.max(path.strokeWidth + 3, path.strokeWidth * 1.3);
        overlay.data = { isHiddenEdge: true };

        // Apply destination-out blending if transparent, otherwise use standard background painting
        if (isTransparent) {
            overlay.strokeColor = '#000000'; // Color doesn't matter, opacity does
            overlay.blendMode = 'destination-out';
        } else {
            overlay.strokeColor = bgColor;
        }

        overlay.insertAbove(insertTarget);

        /* Brief orange highlight */
        VF.fgLayer.activate();
        var z2 = VF.view.zoom;
        var highlight = overlay.clone({ insert: true });
        highlight._isH = true;

        // Reset blendMode so the highlight is actually visible
        highlight.blendMode = 'normal';

        highlight.strokeColor = new P.Color(1, 0.5, 0.2, 0.6);
        highlight.strokeWidth = (path.strokeWidth + 6) / z2;
        highlight.dashArray = [6 / z2, 4 / z2];
        feedbackItems.push(highlight);
        if (VF.pLayers[S.activeId]) VF.pLayers[S.activeId].activate();

        hideCount++;
        return true;
    }

    /* ═══════════════════════════════════════════════════
       MOUSE DOWN — single click hides the edge under cursor
       ═══════════════════════════════════════════════════ */
    tHideEdge.onMouseDown = function (e) {
        if (VF.isPanInput(e.event)) return;
        if (VF.isLocked && VF.isLocked()) { VF.toast('Layer is locked'); return; }
        if (S.tool !== 'hide-edge') return;

        /* Reset drag state */
        historySaved = false;
        touchedItems.clear();
        clearFeedback();
        hideCount = 0;
        revealCount = 0;
        gestureMode = null;

        processEdgeAt(e.point);
    };

    /* ═══════════════════════════════════════════════════
       MOUSE DRAG — paint across a stroke to hide multiple edges
       ═══════════════════════════════════════════════════ */
    tHideEdge.onMouseDrag = function (e) {
        if (VF.isPanInput(e.event)) return;
        if (S.tool !== 'hide-edge') return;

        processEdgeAt(e.point);
    };

    /* ═══════════════════════════════════════════════════
       MOUSE UP — commit and clean up
       ═══════════════════════════════════════════════════ */
    tHideEdge.onMouseUp = function (e) {
        if (VF.isPanInput(e.event)) return;

        var total = hideCount + revealCount;
        if (total > 0) {
            VF.saveFrame();
            if (hideCount > 0 && revealCount === 0) {
                VF.toast(hideCount + ' edge' + (hideCount > 1 ? 's' : '') + ' hidden');
            } else if (revealCount > 0 && hideCount === 0) {
                VF.toast(revealCount + ' edge' + (revealCount > 1 ? 's' : '') + ' revealed');
            } else {
                VF.toast(hideCount + ' hidden, ' + revealCount + ' revealed');
            }
        }

        /* Fade out the highlights */
        var items = feedbackItems.slice();
        feedbackItems = [];
        setTimeout(function () {
            items.forEach(function (item) {
                try { item.remove(); } catch (_) { }
            });
        }, 350);

        historySaved = false;
        touchedItems.clear();
        hideCount = 0;
        revealCount = 0;
        gestureMode = null;
    };

})();