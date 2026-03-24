(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    var curPath = null, drawing = false;
    var pressureGroup = null;
    var pressurePoints = [];
    var lastPoint = null;

    /* ── Real-time texture preview state ── */
    var texPreview = null;
    var fillPreview = null;
    var lastTexPreviewTime = 0;
    var pressureGuidePath = null;

    function getTexPreviewInterval() {
        return (VF.wsPrefs && VF.wsPrefs.tabletMode === 'legacy') ? 140 : 80;
    }

    /* ── Stable seed: decided once at mouseDown ── */
    var strokeSeed = 0;

    /* ═══════════════════════════════════════════════════
           PEN INPUT OPTIMIZATION
           ═══════════════════════════════════════════════════ */
    var lastAddedPoint = null;

    // Dynamically adjust the distance threshold based on the tablet setting
    function getMinPointDist() {
        if (VF.wsPrefs && VF.wsPrefs.tabletMode === 'legacy') return 3.5; // Drop spammy Wintab points
        return 1.5; // Smooth standard tracking for Windows Ink
    }

    function isTooClose(pt) {
        if (!lastAddedPoint) return false;
        var dx = pt.x - lastAddedPoint.x;
        var dy = pt.y - lastAddedPoint.y;
        var limit = getMinPointDist();
        return (dx * dx + dy * dy) < (limit * limit);
    }

    var tBrush = new (getP()).Tool(); tBrush.name = 'brush';
    VF.tBrush = tBrush;

    function clearTexPreview() {
        if (texPreview) { texPreview.remove(); texPreview = null; }
        if (fillPreview) { fillPreview.remove(); fillPreview = null; }
    }

    function renderTexPreview() {
        var P = getP();
        var pl = VF.pLayers[S.activeId];
        if (!pl) return;
        clearTexPreview();

        var texCol = S.cfg.strokeCol;

        if (S.cfg.pressure) {
            if (pressurePoints.length < 2) return;

            if (S.cfg.autoFill) {
                fillPreview = new P.Path({
                    fillColor: S.cfg.fillCol,
                    strokeColor: null,
                    closed: true,
                    opacity: 0.6,
                    insert: false
                });
                pressurePoints.forEach(function (p) {
                    fillPreview.add(p.point.clone());
                });
                fillPreview.simplify(VF.smoothTol());
                pl.addChild(fillPreview);
            }

            var ptsCopy = pressurePoints.map(function (p) {
                return { point: p.point.clone(), angle: p.angle, width: p.width };
            });

            texPreview = VF.renderPressureTextureRibbon(
                ptsCopy,
                S.cfg.tex,
                texCol,
                S.cfg.brushSize,
                {
                    seed: strokeSeed,
                    rot: S.cfg.brushRotation,
                    angJit: S.cfg.brushAngleJitter,
                    posJit: S.cfg.brushPosJitter
                }
            );

            if (texPreview) {
                pl.addChild(texPreview);
                if (pressureGuidePath) pressureGuidePath.visible = S.cfg.showBrushGuide; // <-- Change to dynamic check
            } else if (pressureGuidePath) {
                pressureGuidePath.visible = true; // Always true if preview isn't ready
            }
        } else {
            if (!curPath || curPath.length < 0.5) return;

            if (S.cfg.autoFill) {
                var fillClone = curPath.clone({ insert: false });
                fillClone.closePath();
                fillClone.simplify(VF.smoothTol());
                fillClone.strokeColor = null;
                fillClone.strokeWidth = 0;
                fillClone.fillColor = S.cfg.fillCol;
                fillClone.opacity = 0.6;
                fillPreview = fillClone;
                pl.addChild(fillPreview);
            }

            var clonePath = curPath.clone({ insert: false });
            clonePath.simplify(VF.smoothTol());

            texPreview = VF.renderTextureRibbon(
                clonePath,
                curPath.data._pendingTex,
                texCol,
                S.cfg.brushSize,
                {
                    seed: strokeSeed,
                    rot: S.cfg.brushRotation,
                    angJit: S.cfg.brushAngleJitter,
                    posJit: S.cfg.brushPosJitter
                }
            );

            if (texPreview) {
                pl.addChild(texPreview);
                curPath.visible = S.cfg.showBrushGuide; // <-- Change to dynamic check
            } else {
                curPath.visible = true; // Always true if preview isn't ready
            }
        }
    }

    /* ═══════════════════════════════════════════════════
       MOUSE DOWN
       ═══════════════════════════════════════════════════ */
    tBrush.onMouseDown = function (e) {
        var P = getP();
        if (VF.isPanInput(e.event)) return;
        if (VF.isLocked && VF.isLocked()) { VF.toast('Layer is locked'); return; }
        if (S.tl.playing) VF.togglePlay();
        if (S.tool !== 'brush') return;
        var l = VF.AL(); if (!l || l.type !== 'vector') return;
        var pl = VF.pLayers[l.id]; if (!pl) return;

        // Convert project/camera space point to the layer's local transformed space
        var localPt = pl.globalToLocal(e.point);

        VF.saveHistory();

        VF.selSegments = [];
        VF.clearHandles();

        pl.activate();

        drawing = true;
        lastTexPreviewTime = 0;
        clearTexPreview();
        lastAddedPoint = null;

        strokeSeed = Date.now() | 0;

        var strokeCol = S.cfg.autoStroke ? S.cfg.strokeCol : null;
        var usingTex = S.cfg.tex !== 'none' && VF.baseBrushes[S.cfg.tex];

        if (S.cfg.pressure) {
            pressureGroup = new P.Group();
            pressurePoints = [];
            lastPoint = localPt.clone();

            var col = S.cfg.autoStroke ? S.cfg.strokeCol : '#1e1e24';
            var w = Math.max(0.5, S.cfg.brushSize * VF.currentPressure);

            if (usingTex) {
                pressureGuidePath = new P.Path({
                    strokeColor: col,
                    strokeWidth: 2, // Thicker center-line guide
                    opacity: 0.35,
                    strokeCap: 'round'
                });
                pressureGuidePath.add(localPt.clone());
                pressureGroup.addChild(pressureGuidePath);
            } else {
                var dot = new P.Path.Circle({
                    center: localPt.clone(), radius: w / 2,
                    fillColor: col
                });
                pressureGroup.addChild(dot);
            }

            pressurePoints.push({ point: localPt.clone(), angle: 0, width: w });
            lastAddedPoint = localPt.clone();
        } else {
            curPath = new P.Path({
                strokeWidth: S.cfg.brushSize,
                strokeCap: 'round', strokeJoin: 'round',
                strokeColor: strokeCol,
                fillColor: S.cfg.autoFill ? S.cfg.fillCol : null,
            });
            if (usingTex) {
                curPath.opacity = 0.25;
                curPath.data._pendingTex = S.cfg.tex;
                curPath.data._pendingCol = strokeCol;
            }
            curPath.add(localPt.clone());
            lastAddedPoint = localPt.clone();
        }
    };

    tBrush.onMouseDrag = function (e) {
        var P = getP();
        if (!drawing) return;

        var pl = VF.pLayers[S.activeId];
        var localPt = pl ? pl.globalToLocal(e.point) : e.point;

        /* ── Distance throttle: skip points that are too close ── */
        if (isTooClose(localPt)) return;

        var usingTex = S.cfg.tex !== 'none' && VF.baseBrushes[S.cfg.tex];

        if (S.cfg.pressure && pressureGroup) {
            var col = S.cfg.autoStroke ? S.cfg.strokeCol : '#1e1e24';
            var w = Math.max(0.5, S.cfg.brushSize * VF.currentPressure);

            if (usingTex) {
                if (pressureGuidePath) pressureGuidePath.add(localPt.clone());
            } else {
                var seg = new P.Path.Line({
                    from: lastPoint, to: localPt.clone(),
                    strokeWidth: w,
                    strokeCap: 'round',
                    strokeColor: col
                });
                pressureGroup.addChild(seg);
            }

            var delta = localPt.subtract(lastPoint);
            var angle = delta.length > 0.5 ? delta.angle : (pressurePoints.length > 0 ? pressurePoints[pressurePoints.length - 1].angle : 0);
            pressurePoints.push({ point: localPt.clone(), angle: angle, width: w });
            lastPoint = localPt.clone();
            lastAddedPoint = localPt.clone();

            if (usingTex) {
                var now = Date.now();
                if (now - lastTexPreviewTime >= getTexPreviewInterval()) {
                    lastTexPreviewTime = now;
                    renderTexPreview();
                }
            }
        } else if (curPath) {
            curPath.add(localPt.clone());
            lastAddedPoint = localPt.clone();

            if (usingTex) {
                var now2 = Date.now();
                if (now2 - lastTexPreviewTime >= getTexPreviewInterval()) {
                    lastTexPreviewTime = now2;
                    renderTexPreview();
                }
            }
        }
    };

    tBrush.onMouseUp = function (e) {
        if (!drawing) return;
        drawing = false;
        var P = getP();
        var usingTex = S.cfg.tex !== 'none' && VF.baseBrushes[S.cfg.tex];
        var pl = VF.pLayers[S.activeId];

        var localPt = pl ? pl.globalToLocal(e.point) : e.point;

        clearTexPreview();
        if (pressureGuidePath) { pressureGuidePath.remove(); pressureGuidePath = null; }

        lastAddedPoint = null;
        var committed = [];

        if (S.cfg.pressure && pressureGroup) {
            if (pressurePoints.length > 0) {
                var lastPP = pressurePoints[pressurePoints.length - 1];
                var distToEnd = localPt.getDistance(lastPP.point);
                if (distToEnd > 0.1) {
                    var wEnd = Math.max(0.5, S.cfg.brushSize * VF.currentPressure);
                    var deltaEnd = localPt.subtract(lastPP.point);
                    var angleEnd = deltaEnd.length > 0.5 ? deltaEnd.angle : lastPP.angle;
                    pressurePoints.push({ point: localPt.clone(), angle: angleEnd, width: wEnd });

                    if (!usingTex) {
                        var col = S.cfg.autoStroke ? S.cfg.strokeCol : '#1e1e24';
                        var segEnd = new P.Path.Line({
                            from: lastPoint, to: localPt.clone(),
                            strokeWidth: wEnd,
                            strokeCap: 'round',
                            strokeColor: col
                        });
                        pressureGroup.addChild(segEnd);
                    }
                    lastPoint = localPt.clone();
                }
            }

            if (usingTex && pressurePoints && pressurePoints.length > 0) {
                var texCol = S.cfg.strokeCol;
                pressureGroup.remove();

                if (S.cfg.autoFill && pressurePoints.length > 1) {
                    var fillPath = new P.Path({
                        fillColor: S.cfg.fillCol,
                        strokeColor: null,
                        closed: true,
                        insert: false
                    });
                    pressurePoints.forEach(function (p) {
                        fillPath.add(p.point.clone());
                    });
                    fillPath.simplify(VF.smoothTol());
                    if (pl) { pl.addChild(fillPath); committed.push(fillPath); }
                }

                var texGroup = VF.renderPressureTextureRibbon(
                    pressurePoints,
                    S.cfg.tex,
                    texCol,
                    S.cfg.brushSize,
                    {
                        seed: strokeSeed,
                        rot: S.cfg.brushRotation,
                        angJit: S.cfg.brushAngleJitter,
                        posJit: S.cfg.brushPosJitter
                    }
                );

                if (texGroup && pl) { pl.addChild(texGroup); committed.push(texGroup); }
            } else {
                committed.push(pressureGroup);
            }
            VF.saveFrame(); VF.uiTimeline();
            pressureGroup = null;
            pressurePoints = [];

        } else if (curPath) {
            var lastSeg = curPath.lastSegment;
            if (lastSeg && localPt.getDistance(lastSeg.point) > 0.1) {
                curPath.add(localPt.clone());
            }

            curPath.visible = true;
            curPath.opacity = 1;

            if (S.cfg.autoFill && !usingTex) curPath.closePath();

            // Post-stroke smoothing for Legacy Mode to round out dropped points
            if (VF.wsPrefs && VF.wsPrefs.tabletMode === 'legacy') {
                curPath.smooth({ type: 'continuous', factor: 0.4 });
            }

            curPath.simplify(VF.smoothTol());

            if (usingTex && curPath.data._pendingTex) {
                var texName = curPath.data._pendingTex;
                var texCol2 = S.cfg.strokeCol;

                if (S.cfg.autoFill) {
                    var fillClone = curPath.clone({ insert: false });
                    fillClone.closePath();
                    fillClone.strokeColor = null;
                    fillClone.strokeWidth = 0;
                    fillClone.fillColor = S.cfg.fillCol;
                    if (pl) { pl.addChild(fillClone); committed.push(fillClone); }
                }

                var texGroup2 = VF.renderTextureRibbon(
                    curPath,
                    texName,
                    texCol2,
                    S.cfg.brushSize,
                    {
                        seed: strokeSeed,
                        rot: S.cfg.brushRotation,
                        angJit: S.cfg.brushAngleJitter,
                        posJit: S.cfg.brushPosJitter
                    }
                );

                if (texGroup2 && pl) {
                    pl.addChild(texGroup2);
                    committed.push(texGroup2);
                } else {
                    curPath.remove();
                }
            } else {
                committed.push(curPath);
            }
            VF.saveFrame(); VF.uiTimeline();
            curPath = null;
        }

        VF.selSegments = [];
        VF.clearHandles();
        committed.forEach(function (item) {
            if (item.segments) {
                item.segments.forEach(function (seg) { VF.selSegments.push(seg); });
            } else if (item.children) {
                item.children.forEach(function (child) {
                    if (child.segments) {
                        child.segments.forEach(function (seg) { VF.selSegments.push(seg); });
                    }
                });
            }
        });
        if (VF.selSegments.length > 0) VF.showHandles();

        if (pl) pl.activate();
    };

})();