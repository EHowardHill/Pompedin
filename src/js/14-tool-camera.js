(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    var cvs = VF.cvs;
    var tCam = new (getP()).Tool(); tCam.name = 'cam';
    VF.tCam = tCam;

    var lastScreenPt = null;

    // 1. Capture the initial screen coordinate when the drag starts
    tCam.onMouseDown = function (e) {
        var P = getP();
        lastScreenPt = new P.Point(e.event.clientX, e.event.clientY);
    };

    tCam.onMouseDrag = function (e) {
        var P = getP();
        var currentScreenPt = new P.Point(e.event.clientX, e.event.clientY);

        if (S.tool === 'pan') {
            // Using viewToProject ensures panning perfectly tracks the mouse even when rotated
            var pLast = VF.view.viewToProject(lastScreenPt);
            var pCur = VF.view.viewToProject(currentScreenPt);
            VF.view.center = VF.view.center.subtract(pCur.subtract(pLast));

        } else if (S.tool === 'zoom') {
            var screenDelta = lastScreenPt ? currentScreenPt.subtract(lastScreenPt) : new P.Point(0, 0);
            var f = 1 + screenDelta.y * -0.006;
            VF.view.zoom = Math.max(.05, Math.min(16, VF.view.zoom * f));

        } else if (S.tool === 'rotate-view') {
            // Calculate angle change relative to the center of the screen
            var rect = cvs.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;

            var a1 = Math.atan2(lastScreenPt.y - cy, lastScreenPt.x - cx);
            var a2 = Math.atan2(currentScreenPt.y - cy, currentScreenPt.x - cx);
            var deltaDeg = (a2 - a1) * (180 / Math.PI);

            // Handle math wraparound
            if (deltaDeg > 180) deltaDeg -= 360;
            if (deltaDeg < -180) deltaDeg += 360;

            VF.view.rotate(deltaDeg, VF.view.center);
            VF.viewRotation = (VF.viewRotation || 0) + deltaDeg;
        }

        lastScreenPt = currentScreenPt;
        VF.updateInfo();
        VF.drawBorder();
    };

    // Scroll-wheel zoom (works with mouse and pen/touch trackpads)
    cvs.addEventListener('wheel', function (e) {
        var P = getP();
        e.preventDefault();

        var rect = cvs.getBoundingClientRect();
        var mousePt = new P.Point(e.clientX - rect.left, e.clientY - rect.top);
        var viewPt = VF.view.viewToProject(mousePt);

        var f = e.deltaY > 0 ? 0.9 : 1.1;
        var newZoom = Math.max(.05, Math.min(16, VF.view.zoom * f));

        VF.view.zoom = newZoom;
        VF.view.center = VF.view.center.add(viewPt.subtract(VF.view.viewToProject(mousePt)));

        VF.updateInfo(); VF.drawBorder();
    }, { passive: false });

    // ═══════════════════════════════════════════════════
    //  Global Panning (Middle-Click OR Pen Side Button)
    // ═══════════════════════════════════════════════════
    var isMiddlePanning = false, middlePanStart = null;

    $(cvs).on('pointerdown', function (e) {
        var P = getP();
        var ev = e.originalEvent;
        if (ev.button === 2 || (ev.pointerType === 'pen' && ev.button === 5)) {
            e.preventDefault();
            isMiddlePanning = true;
            middlePanStart = new P.Point(ev.clientX, ev.clientY);
            cvs.style.cursor = 'grab';
        }
    });

    $(window).on('pointermove', function (e) {
        var P = getP();
        if (isMiddlePanning && middlePanStart) {
            var ev = e.originalEvent;
            var currentPt = new P.Point(ev.clientX, ev.clientY);

            var pLast = VF.view.viewToProject(middlePanStart);
            var pCur = VF.view.viewToProject(currentPt);
            VF.view.center = VF.view.center.subtract(pCur.subtract(pLast));

            middlePanStart = currentPt;
            VF.updateInfo();
            VF.drawBorder();
        }
    });

    $(window).on('pointerup', function (e) {
        var ev = e.originalEvent;
        if (isMiddlePanning && (ev.button === 2 || ev.pointerType === 'pen')) {
            isMiddlePanning = false;
            VF.setTool(S.tool);
        }
    });

    $(cvs).on('contextmenu', function (e) {
        e.preventDefault();
    });

    // ═══════════════════════════════════════════════════
    //  Global Drag to Zoom (Ctrl+Left OR Middle-Click)
    //  Works globally regardless of the active tool.
    //  Drag up/right = zoom in, down/left = zoom out, 
    //  anchored at the pointer's initial position.
    // ═══════════════════════════════════════════════════
    var isCtrlZooming = false;
    var ctrlZoomStart = null;
    var ctrlZoomAnchor = null;   // project-space anchor point
    var ctrlZoomScreenAnchor = null;

    $(cvs).on('pointerdown', function (e) {
        var ev = e.originalEvent;

        // Trigger on Ctrl+LeftClick OR Middle-Click (button 1)
        var isCtrlLeft = ev.button === 0 && (ev.ctrlKey || ev.metaKey);
        var isMiddle = ev.button === 1;

        if (!isCtrlLeft && !isMiddle) return;

        // Don't interfere if pan is already active
        if (isMiddlePanning) return;

        var P = getP();
        e.preventDefault();
        ev.stopPropagation && ev.stopPropagation();

        isCtrlZooming = true;
        ctrlZoomStart = new P.Point(ev.clientX, ev.clientY);

        // Remember the project-space point under the cursor so we can
        // keep it visually stable while zooming (anchor zoom).
        var rect = cvs.getBoundingClientRect();
        var viewPt = new P.Point(ev.clientX - rect.left, ev.clientY - rect.top);
        ctrlZoomAnchor = VF.view.viewToProject(viewPt);
        ctrlZoomScreenAnchor = viewPt;

        cvs.style.cursor = 'zoom-in';
        cvs.setPointerCapture(ev.pointerId);
    });

    $(window).on('pointermove', function (e) {
        if (!isCtrlZooming) return;

        var P = getP();
        var ev = e.originalEvent;
        var currentPt = new P.Point(ev.clientX, ev.clientY);

        var dx = currentPt.x - ctrlZoomStart.x;
        var dy = currentPt.y - ctrlZoomStart.y;
        ctrlZoomStart = currentPt;

        // Drag Right or Up = Zoom In. Drag Left or Down = Zoom Out.
        var delta = dx - dy;
        var f = 1 + delta * 0.006;
        var newZoom = Math.max(0.05, Math.min(16, VF.view.zoom * f));
        VF.view.zoom = newZoom;

        // Re-anchor: keep the original project point under the ORIGINAL cursor position
        if (ctrlZoomAnchor && ctrlZoomScreenAnchor) {
            var currentProjectPt = VF.view.viewToProject(ctrlZoomScreenAnchor);
            VF.view.center = VF.view.center.add(ctrlZoomAnchor.subtract(currentProjectPt));
        }

        cvs.style.cursor = delta >= 0 ? 'zoom-in' : 'zoom-out';
        VF.updateInfo();
        VF.drawBorder();
    });

    $(window).on('pointerup', function (e) {
        if (!isCtrlZooming) return;
        var ev = e.originalEvent;

        // Only release if the button lifted is Left (0) or Middle (1)
        if (ev.button !== 0 && ev.button !== 1) return;

        isCtrlZooming = false;
        ctrlZoomStart = null;
        ctrlZoomAnchor = null;
        ctrlZoomScreenAnchor = null;

        try { cvs.releasePointerCapture(ev.pointerId); } catch (_) { }
        VF.setTool(S.tool);   // restores the correct cursor
    });

    // ═══════════════════════════════════════════════════
    //  Fit to Screen — Zoom so the full canvas is visible
    //  with a small margin, centered in the viewport.
    // ═══════════════════════════════════════════════════
    VF.fitToScreen = function () {
        var P = getP();
        var canvasEl = document.getElementById('main-canvas');
        if (!canvasEl) return;

        if (VF.viewRotation) {
            VF.view.rotate(-VF.viewRotation, VF.view.center);
            VF.viewRotation = 0;
        }

        var viewW = canvasEl.clientWidth;
        var viewH = canvasEl.clientHeight;
        var margin = 40; // px padding on each side

        var scaleX = (viewW - margin * 2) / S.canvas.w;
        var scaleY = (viewH - margin * 2) / S.canvas.h;
        var newZoom = Math.max(0.05, Math.min(16, Math.min(scaleX, scaleY)));

        VF.view.zoom = newZoom;
        VF.view.center = new P.Point(S.canvas.w / 2, S.canvas.h / 2);

        VF.updateInfo();
        VF.drawBorder();
    };

})();