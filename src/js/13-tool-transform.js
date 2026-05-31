(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    var tXform = new (getP()).Tool(); tXform.name = 'xform';
    VF.tXform = tXform;
    var xOrigin = null;
    var tXformSaved = false;
    var dragTransform = null;

    var TEX_REBUILD_INTERVAL = 80;
    var lastRebuildTime = 0;
    var pendingTexGroups = new Set();

    function projectDeltaToLocal(delta, pl) {
        if (!pl || !pl.matrix) return delta;
        return pl.globalToLocal(delta).subtract(
            pl.globalToLocal(new (getP()).Point(0, 0))
        );
    }

    function collectTexGroups() {
        pendingTexGroups.clear();
        VF.selSegments.forEach(function (seg) {
            if (seg.path && seg.path.parent &&
                seg.path.parent.data && seg.path.parent.data.isTextureStroke) {
                pendingTexGroups.add(seg.path.parent);
            }
        });
    }

    function flushTexRebuilds() {
        if (pendingTexGroups.size === 0) return;
        var now = Date.now();
        if (now - lastRebuildTime < TEX_REBUILD_INTERVAL) return;
        lastRebuildTime = now;
        pendingTexGroups.forEach(function (grp) {
            VF.rebuildTextureRaster(grp);
        });
    }

    tXform.onMouseDown = function (e) {
        var P = getP();
        if (VF.isPanInput(e.event)) return;
        if (VF.isLocked && VF.isLocked()) { VF.toast('Layer is locked'); return; }
        tXformSaved = false;
        lastRebuildTime = 0;
        pendingTexGroups.clear();

        var pl = VF.pLayers[S.activeId]; if (!pl) return;

        if (VF.selSegments.length > 0) {
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            VF.selSegments.forEach(function (seg) {
                minX = Math.min(minX, seg.point.x); minY = Math.min(minY, seg.point.y);
                maxX = Math.max(maxX, seg.point.x); maxY = Math.max(maxY, seg.point.y);
            });
            xOrigin = new P.Point((minX + maxX) / 2, (minY + maxY) / 2);
            collectTexGroups();

            tXform.origSegs = [];
            VF.selSegments.forEach(function (seg) {
                tXform.origSegs.push({
                    seg: seg,
                    pt: seg.point.clone(),
                    hIn: seg.handleIn.clone(),
                    hOut: seg.handleOut.clone()
                });
            });

            var globalOrigin = pl.localToGlobal(xOrigin);
            tXform.startAngle = Math.atan2(e.point.y - globalOrigin.y, e.point.x - globalOrigin.x) * (180 / Math.PI);
            tXform.startDist = e.point.getDistance(globalOrigin);
        } else {
            var l = VF.AL();
            if (l) {
                if (!l.transforms) l.transforms = {};
                if (l.transforms[S.tl.frame] === undefined) {
                    l.transforms[S.tl.frame] = VF.getLayerTransform(l, S.tl.frame);
                    if (VF.uiTimeline) VF.uiTimeline();
                }
                dragTransform = Object.assign({}, l.transforms[S.tl.frame]);

                var cx = S.canvas.w / 2, cy = S.canvas.h / 2;
                var globalOrigin2 = new P.Point(cx + dragTransform.x, cy + dragTransform.y);
                tXform.startAngle = Math.atan2(e.point.y - globalOrigin2.y, e.point.x - globalOrigin2.x) * (180 / Math.PI);
                tXform.startDist = e.point.getDistance(globalOrigin2);
                tXform.origRotation = dragTransform.rotation;
                tXform.origScaleX = dragTransform.scaleX;
                tXform.origScaleY = dragTransform.scaleY;
            }
        }
    };

    tXform.onMouseDrag = function (e) {
        var P = getP();
        if (VF.isPanInput(e.event)) return;
        var pl = VF.pLayers[S.activeId]; if (!pl) return;

        if (!tXformSaved) {
            VF.saveHistory();
            tXformSaved = true;
        }

        if (VF.selSegments.length > 0) {
            if (S.tool === 'translate') {
                var localDelta = projectDeltaToLocal(e.delta, pl);
                VF.selSegments.forEach(function (seg) {
                    seg.point = seg.point.add(localDelta);
                });
                VF.getSelectedItems().forEach(function (item) {
                    if (item.data && item.data.isTextureStroke) {
                        VF.syncTextureGroup(item, 'translate', localDelta);
                    }
                });
            } else if (S.tool === 'rotate') {
                var globalOriginRot = pl.localToGlobal(xOrigin);
                var curAngle = Math.atan2(e.point.y - globalOriginRot.y, e.point.x - globalOriginRot.x) * (180 / Math.PI);
                var deltaAng = curAngle - tXform.startAngle;
                if (e.event.shiftKey) deltaAng = Math.round(deltaAng / 15) * 15;

                var rad = deltaAng * Math.PI / 180;
                var cos = Math.cos(rad), sin = Math.sin(rad);

                tXform.origSegs.forEach(function (orig) {
                    var dx = orig.pt.x - xOrigin.x, dy = orig.pt.y - xOrigin.y;
                    orig.seg.point = new P.Point(dx * cos - dy * sin + xOrigin.x, dx * sin + dy * cos + xOrigin.y);

                    var hInX = orig.hIn.x, hInY = orig.hIn.y;
                    orig.seg.handleIn = new P.Point(hInX * cos - hInY * sin, hInX * sin + hInY * cos);

                    var hOutX = orig.hOut.x, hOutY = orig.hOut.y;
                    orig.seg.handleOut = new P.Point(hOutX * cos - hOutY * sin, hOutX * sin + hOutY * cos);
                });
            } else if (S.tool === 'scale') {
                var globalOriginScale = pl.localToGlobal(xOrigin);
                var curDist = e.point.getDistance(globalOriginScale);
                var fac = tXform.startDist > 0.1 ? curDist / tXform.startDist : 1;
                if (e.event.shiftKey) fac = Math.round(fac * 10) / 10;

                tXform.origSegs.forEach(function (orig) {
                    var pt = orig.pt.subtract(xOrigin);
                    orig.seg.point = pt.multiply(fac).add(xOrigin);
                    orig.seg.handleIn = orig.hIn.multiply(fac);
                    orig.seg.handleOut = orig.hOut.multiply(fac);
                });
            }
            VF.showHandles();
            flushTexRebuilds();
        } else {
            var l = VF.AL();
            if (l && dragTransform) {
                if (S.tool === 'translate') {
                    // Safe native tracking, perfectly matches Canvas scale without jumping
                    dragTransform.x += e.delta.x;
                    dragTransform.y += e.delta.y;
                } else if (S.tool === 'rotate') {
                    var cx = S.canvas.w / 2, cy = S.canvas.h / 2;
                    var globalOrigin2 = new P.Point(cx + dragTransform.x, cy + dragTransform.y);
                    var curAngle2 = Math.atan2(e.point.y - globalOrigin2.y, e.point.x - globalOrigin2.x) * (180 / Math.PI);
                    var deltaAng2 = curAngle2 - tXform.startAngle;
                    if (e.event.shiftKey) deltaAng2 = Math.round(deltaAng2 / 15) * 15;
                    dragTransform.rotation = tXform.origRotation + deltaAng2;
                } else if (S.tool === 'scale') {
                    var cx3 = S.canvas.w / 2, cy3 = S.canvas.h / 2;
                    var globalOrigin3 = new P.Point(cx3 + dragTransform.x, cy3 + dragTransform.y);
                    var curDist2 = e.point.getDistance(globalOrigin3);
                    var fac2 = tXform.startDist > 0.1 ? curDist2 / tXform.startDist : 1;
                    if (e.event.shiftKey) fac2 = Math.round(fac2 * 10) / 10;
                    dragTransform.scaleX = tXform.origScaleX * fac2;
                    dragTransform.scaleY = tXform.origScaleY * fac2;
                }
                l.transforms[S.tl.frame] = Object.assign({}, dragTransform);
                VF.render();
            }
        }
    };

    tXform.onMouseUp = function (e) {
        if (VF.isPanInput(e.event)) return;

        if (VF.selSegments.length > 0) {
            var pl = VF.pLayers[S.activeId];
            if (pl) pl.children.forEach(VF.rebuildTextureRaster);
        }

        pendingTexGroups.clear();
        dragTransform = null;
        VF.saveFrame();
    };

})();