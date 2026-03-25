(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    /* ═══════════════════════════════════════════════════
       CAMERA STATE
       ═══════════════════════════════════════════════════
       Each keyframe stores { x, y, zoom, rotation }.
         x, y      — center point the camera looks at
         zoom      — 1 = 100%, 2 = 200% (zoomed in)
         rotation  — degrees

       The on-canvas rectangle is the INVERSE viewport:
         rect center  = cam center
         rect size    = canvasSize / zoom   (zoom in → rect shrinks)
         rect angle   = cam rotation
       ═══════════════════════════════════════════════════ */

    function defaultCam() {
        return { x: S.canvas.w / 2, y: S.canvas.h / 2, zoom: 1, rotation: 0 };
    }

    if (!S.camera) S.camera = { frames: {} };

    /* ═══════════════════════════════════════════════════
       INTERPOLATION  (linear between keyframes)
       ═══════════════════════════════════════════════════ */

    VF.getCameraAtFrame = function (frame) {
        var cam = S.camera;
        if (!cam || !cam.frames) return defaultCam();

        var keys = Object.keys(cam.frames).map(Number).sort(function (a, b) { return a - b; });
        if (keys.length === 0) return defaultCam();
        if (keys.length === 1) return $.extend({}, cam.frames[keys[0]]);

        if (frame <= keys[0]) return $.extend({}, cam.frames[keys[0]]);
        if (frame >= keys[keys.length - 1]) return $.extend({}, cam.frames[keys[keys.length - 1]]);

        var prev = keys[0], next = keys[1];
        for (var i = 0; i < keys.length - 1; i++) {
            if (frame >= keys[i] && frame <= keys[i + 1]) {
                prev = keys[i]; next = keys[i + 1]; break;
            }
        }

        var t = (next === prev) ? 0 : (frame - prev) / (next - prev);
        var a = cam.frames[prev], b = cam.frames[next];

        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            zoom: a.zoom + (b.zoom - a.zoom) * t,
            rotation: a.rotation + (b.rotation - a.rotation) * t
        };
    };

    VF.hasCameraKeyframes = function () {
        return S.camera && S.camera.frames && Object.keys(S.camera.frames).length > 0;
    };

    /* ═══════════════════════════════════════════════════
       KEYFRAME MANAGEMENT
       ═══════════════════════════════════════════════════ */

    VF.setCameraKey = function (frame, camState) {
        if (!S.camera) S.camera = { frames: {} };
        S.camera.frames[frame] = camState || defaultCam();
        VF._isDirty = true;
        VF.uiTimeline();
    };

    VF.delCameraKey = function (frame) {
        if (S.camera && S.camera.frames) {
            delete S.camera.frames[frame];
            VF._isDirty = true;
            VF.uiTimeline();
        }
    };

    /* ═══════════════════════════════════════════════════
       GEOMETRY HELPERS
       ═══════════════════════════════════════════════════ */

    var DEG = Math.PI / 180;

    function rotPt(px, py, cx, cy, deg) {
        var r = deg * DEG;
        var cos = Math.cos(r), sin = Math.sin(r);
        var dx = px - cx, dy = py - cy;
        return { x: dx * cos - dy * sin + cx, y: dx * sin + dy * cos + cy };
    }

    function camToRect(cam) {
        var hw = (S.canvas.w / cam.zoom) / 2;
        var hh = (S.canvas.h / cam.zoom) / 2;
        return { cx: cam.x, cy: cam.y, hw: hw, hh: hh, rot: cam.rotation };
    }

    function rectToCam(cx, cy, hw, hh, rot) {
        return {
            x: cx, y: cy,
            zoom: Math.max(0.05, S.canvas.w / (hw * 2)),
            rotation: rot
        };
    }

    function getCorners(r) {
        return [
            rotPt(r.cx - r.hw, r.cy - r.hh, r.cx, r.cy, r.rot), /* TL */
            rotPt(r.cx + r.hw, r.cy - r.hh, r.cx, r.cy, r.rot), /* TR */
            rotPt(r.cx + r.hw, r.cy + r.hh, r.cx, r.cy, r.rot), /* BR */
            rotPt(r.cx - r.hw, r.cy + r.hh, r.cx, r.cy, r.rot)  /* BL */
        ];
    }

    /* ═══════════════════════════════════════════════════
       CAMERA OVERLAY — visible rectangle + gizmo handles
       ═══════════════════════════════════════════════════
       Active tool: full gizmo (corners, rotation, body).
       Other tool + keyframes exist: subtle dashed outline.
       ═══════════════════════════════════════════════════ */

    VF._cameraItems = [];
    VF._camHandles = [];

    VF.renderCameraOverlay = function () {
        VF._cameraItems.forEach(function (it) { try { it.remove(); } catch (_) { } });
        VF._cameraItems = [];
        VF._camHandles = [];

        if (VF._exporting) return;

        var hasKeys = VF.hasCameraKeyframes();
        var isCamTool = S.tool === 'camera';

        if (!hasKeys && !isCamTool) return;

        var P = getP();
        var cam = VF.getCameraAtFrame(S.tl.frame);
        var r = camToRect(cam);
        var z = VF.view.zoom;
        var corners = getCorners(r);

        VF.fgLayer.activate();

        var COL = '#ff3366';

        /* ── Viewport polygon ── */
        var poly = new P.Path({
            segments: corners.map(function (c) { return [c.x, c.y]; }),
            closed: true,
            strokeColor: COL,
            strokeWidth: (isCamTool ? 2 : 1.2) / z,
            dashArray: isCamTool ? null : [8 / z, 5 / z],
            fillColor: isCamTool ? 'rgba(255, 51, 102, 0.02)' : null
        });
        poly._isH = true;
        VF._cameraItems.push(poly);

        /* ── Center crosshair ── */
        var arm = 10 / z;
        [
            [[r.cx - arm, r.cy], [r.cx + arm, r.cy]],
            [[r.cx, r.cy - arm], [r.cx, r.cy + arm]]
        ].forEach(function (pts) {
            var ln = new P.Path.Line({
                from: pts[0], to: pts[1],
                strokeColor: COL, strokeWidth: 1 / z, opacity: 0.6
            });
            ln._isH = true; VF._cameraItems.push(ln);
        });

        /* ── Info label ── */
        var isNonDefault =
            Math.abs(cam.x - S.canvas.w / 2) > 0.5 ||
            Math.abs(cam.y - S.canvas.h / 2) > 0.5 ||
            Math.abs(cam.zoom - 1) > 0.01 ||
            Math.abs(cam.rotation) > 0.1;

        if (isNonDefault && !S.tl.playing) {
            var lbl = new P.PointText({
                point: [corners[0].x + 6 / z, corners[0].y - 6 / z],
                content: '\u{1F3A5} ' + Math.round(cam.zoom * 100) + '%  ' +
                    (Math.round(cam.rotation * 10) / 10) + '\u00B0',
                fontSize: 10 / z, fillColor: COL,
                fontFamily: 'Inter, sans-serif'
            });
            lbl._isH = true; VF._cameraItems.push(lbl);
        }

        /* ── Gizmo handles (camera tool only, not during playback) ── */
        if (isCamTool && !S.tl.playing) {

            /* Body drag area — reuse the polygon */
            VF._camHandles.push({ item: poly, type: 'pan', cursor: 'move' });

            /* Corner handles — aspect-locked scale */
            var HS = 8 / z;
            var anchorOf = [2, 3, 0, 1];
            var cursors = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'];

            corners.forEach(function (c, i) {
                var sq = new P.Path.Rectangle({
                    point: [c.x - HS / 2, c.y - HS / 2], size: [HS, HS],
                    fillColor: '#fff', strokeColor: COL, strokeWidth: 1.2 / z
                });
                sq.rotate(r.rot, new P.Point(c.x, c.y));
                sq._isH = true;
                VF._cameraItems.push(sq);
                VF._camHandles.push({
                    item: sq, type: 'scale',
                    corner: i, anchor: anchorOf[i],
                    cursor: cursors[i]
                });
            });

            /* Rotation handle — circle above top center */
            var topMid = {
                x: (corners[0].x + corners[1].x) / 2,
                y: (corners[0].y + corners[1].y) / 2
            };
            var rotDist = 28 / z;
            var dx = topMid.x - r.cx, dy = topMid.y - r.cy;
            var len = Math.sqrt(dx * dx + dy * dy) || 1;
            var rotPosX = topMid.x + (dx / len) * rotDist;
            var rotPosY = topMid.y + (dy / len) * rotDist;

            var rotArm = new P.Path.Line({
                from: [topMid.x, topMid.y], to: [rotPosX, rotPosY],
                strokeColor: COL, strokeWidth: 1 / z
            });
            rotArm._isH = true; VF._cameraItems.push(rotArm);

            var rotCircle = new P.Path.Circle({
                center: [rotPosX, rotPosY], radius: 6 / z,
                fillColor: COL, strokeColor: '#fff', strokeWidth: 1.2 / z
            });
            rotCircle._isH = true; VF._cameraItems.push(rotCircle);
            VF._camHandles.push({ item: rotCircle, type: 'rotate', cursor: 'crosshair' });
        }

        if (VF.pLayers[S.activeId]) VF.pLayers[S.activeId].activate();
    };


    /* ═══════════════════════════════════════════════════
       CAMERA TOOL  — gizmo-style interaction
       ═══════════════════════════════════════════════════
         Drag body         → pan camera
         Drag corner       → scale (aspect-locked)
         Drag rot circle   → rotate
       Same interaction pattern as the Select tool gizmo.
       ═══════════════════════════════════════════════════ */

    var tCamera = new (getP()).Tool(); tCamera.name = 'camera-tool';
    VF.tCamera = tCamera;

    var drag = null;

    function hitCamHandle(pt) {
        var handles = VF._camHandles;
        for (var i = handles.length - 1; i >= 0; i--) {
            var h = handles[i];
            if (h.type === 'pan') continue;
            if (h.item.contains && h.item.contains(pt)) return h;
        }
        for (var j = 0; j < handles.length; j++) {
            if (handles[j].type === 'pan' && handles[j].item.contains && handles[j].item.contains(pt))
                return handles[j];
        }
        return null;
    }

    tCamera.onMouseDown = function (e) {
        if (VF.isPanInput(e.event)) return;
        if (S.tool !== 'camera') return;

        var hit = hitCamHandle(e.point);
        if (!hit) { drag = null; return; }

        if (!VF.hasCameraKeyframes()) {
            VF.setCameraKey(S.tl.frame, defaultCam());
            VF.render();
            /* Re-hit-test after overlay is rebuilt */
            hit = hitCamHandle(e.point);
            if (!hit) { drag = null; return; }
        }

        VF.saveHistory();

        var cam = VF.getCameraAtFrame(S.tl.frame);
        var r = camToRect(cam);
        var corners = getCorners(r);

        drag = {
            type: hit.type,
            startMouse: e.point.clone(),
            origCam: $.extend({}, cam),
            origRect: $.extend({}, r),
            origCorners: corners
        };

        if (hit.type === 'scale') {
            drag.anchorIdx = hit.anchor;
            drag.anchor = corners[hit.anchor];
            drag.dragCorner = corners[hit.corner];
            drag.origDist = Math.sqrt(
                Math.pow(drag.dragCorner.x - drag.anchor.x, 2) +
                Math.pow(drag.dragCorner.y - drag.anchor.y, 2)
            );
        }

        if (hit.type === 'rotate') {
            drag.startAngle = Math.atan2(
                e.point.y - r.cy, e.point.x - r.cx
            ) / DEG;
        }
    };

    tCamera.onMouseDrag = function (e) {
        if (!drag) return;
        if (VF.isPanInput(e.event)) return;

        var o = drag.origRect;
        var oc = drag.origCam;
        var ns;

        if (drag.type === 'pan') {
            var dx = e.point.x - drag.startMouse.x;
            var dy = e.point.y - drag.startMouse.y;
            ns = rectToCam(o.cx + dx, o.cy + dy, o.hw, o.hh, o.rot);
        }
        else if (drag.type === 'scale') {
            var curDist = Math.sqrt(
                Math.pow(e.point.x - drag.anchor.x, 2) +
                Math.pow(e.point.y - drag.anchor.y, 2)
            );
            var scale = drag.origDist > 0.01 ? curDist / drag.origDist : 1;
            scale = Math.max(0.05, Math.min(20, scale));

            var newHW = o.hw * scale;
            var newHH = o.hh * scale;
            var newCX = drag.anchor.x + (o.cx - drag.anchor.x) * scale;
            var newCY = drag.anchor.y + (o.cy - drag.anchor.y) * scale;
            ns = rectToCam(newCX, newCY, newHW, newHH, o.rot);
        }
        else if (drag.type === 'rotate') {
            var curAngle = Math.atan2(
                e.point.y - o.cy, e.point.x - o.cx
            ) / DEG;
            var delta = curAngle - drag.startAngle;
            if (e.event.shiftKey) delta = Math.round(delta / 15) * 15;
            ns = rectToCam(o.cx, o.cy, o.hw, o.hh, oc.rotation + delta);
        }

        if (ns) {
            VF.setCameraKey(S.tl.frame, ns);
            VF.renderCameraOverlay();
            VF.updateCameraUI();
            VF.drawBorder();
            VF.view.update();
        }
    };

    tCamera.onMouseUp = function () {
        drag = null;
        VF.render();
    };

    tCamera.onMouseMove = function (e) {
        if (S.tool !== 'camera') return;
        var hit = hitCamHandle(e.point);
        VF.cvs.style.cursor = hit ? (hit.cursor || 'move') : 'default';
    };


    /* ═══════════════════════════════════════════════════
       EXPORT HELPERS
       ═══════════════════════════════════════════════════ */

    VF.setupCameraForExport = function (frame) {
        if (!VF.hasCameraKeyframes()) return null;
        var P = getP();
        var cam = VF.getCameraAtFrame(frame);
        VF.view.center = new P.Point(cam.x, cam.y);
        VF.view.zoom = cam.zoom;
        VF.view.update();
        return cam;
    };

    VF.captureWithCamera = function (cam, srcCvs, ectx, dw, dh) {
        if (!cam || Math.abs(cam.rotation) < 0.01) {
            ectx.drawImage(srcCvs, 0, 0, srcCvs.width, srcCvs.height, 0, 0, dw, dh);
        } else {
            ectx.save();
            ectx.translate(dw / 2, dh / 2);
            ectx.rotate(-cam.rotation * DEG);
            var absRad = Math.abs(cam.rotation % 360) * DEG;
            var cover = Math.abs(Math.cos(absRad)) + Math.abs(Math.sin(absRad)) * (dh / dw);
            cover = Math.max(1, Math.min(cover, 1.5));
            ectx.scale(cover, cover);
            ectx.translate(-dw / 2, -dh / 2);
            ectx.drawImage(srcCvs, 0, 0, srcCvs.width, srcCvs.height, 0, 0, dw, dh);
            ectx.restore();
        }
    };


    /* ═══════════════════════════════════════════════════
       TIMELINE ROW
       ═══════════════════════════════════════════════════ */

    VF.buildCameraTimelineRow = function () {
        if (!S.camera) S.camera = { frames: {} };
        var max = S.tl.max, cur = S.tl.frame, cells = '';
        for (var i = 0; i < max; i++) {
            var cc = i === cur ? ' cur' : '';
            var hasKey = S.camera.frames[i] !== undefined;
            var selCls = hasKey && VF.tlSelection.find(function (s) { return s.f === i && s.l === '__camera'; }) ? ' tl-selected' : '';
            var content = hasKey
                ? '<div class="tl-dot keyframe cam-dot' + selCls + '" data-f="' + i + '"></div>'
                : '';
            cells += '<div class="tl-cell' + cc + '" data-f="' + i + '" data-l="__camera" style="position:relative">' + content + '</div>';
        }
        return '<div class="tl-row tl-cam-row" data-l="__camera">' + cells + '</div>';
    };

    VF.buildCameraTimelineLabel = function () {
        return '<div class="tl-llbl tl-cam-label"><i class="fa-solid fa-video" style="font-size:9px;margin-right:3px"></i>Camera</div>';
    };


    /* ═══════════════════════════════════════════════════
       CONTEXT MENU
       ═══════════════════════════════════════════════════ */

    VF._camCtxFrame = null;

    $(document).ready(function () {
        var $camCtx = $('<div class="ctx" id="cam-ctx" style="display:none">' +
            '<div class="ctx-i" data-act="cam-set-key">Set Camera Key</div>' +
            '<div class="ctx-i" data-act="cam-del-key">Delete Camera Key</div>' +
            '<hr style="margin:4px 0;border:none;border-top:1px solid var(--border)">' +
            '<div class="ctx-i" data-act="cam-reset-key">Reset to Default</div>' +
            '<div class="ctx-i" data-act="cam-clear-all" style="color:var(--warning)">Clear All Camera Keys</div>' +
            '</div>').appendTo('body');

        $(document).on('contextmenu', '.tl-cam-row .tl-cell', function (e) {
            e.preventDefault(); e.stopPropagation();
            VF._camCtxFrame = +$(this).data('f');
            S.tl.frame = VF._camCtxFrame;
            VF.render(); VF.uiPlayhead(); VF.updateCameraUI();
            var $m = $camCtx.css({ left: -9999, top: -9999, display: 'block' });
            var mw = $m.outerWidth(), mh = $m.outerHeight();
            var px = Math.min(e.clientX, window.innerWidth - mw - 4);
            var py = Math.min(e.clientY, window.innerHeight - mh - 4);
            $m.css({ left: Math.max(4, px), top: Math.max(4, py) });
        });

        $(document).on('click', '.tl-cam-row .tl-cell', function (e) {
            if (e.button !== 0 || $(e.target).hasClass('tl-dot')) return;
            VF.goFrame(+$(this).data('f'));
        });

        $(document).on('click', function () { $camCtx.hide(); });

        $camCtx.on('click', '.ctx-i', function () {
            var act = $(this).data('act'), f = VF._camCtxFrame;
            if (f == null) return;
            VF.saveHistory();
            if (act === 'cam-set-key') {
                VF.setCameraKey(f, VF.getCameraAtFrame(f));
                VF.toast('Camera key set at frame ' + (f + 1));
            } else if (act === 'cam-del-key') {
                VF.delCameraKey(f);
                VF.toast('Camera key removed');
            } else if (act === 'cam-reset-key') {
                VF.setCameraKey(f, defaultCam());
                VF.toast('Camera reset at frame ' + (f + 1));
            } else if (act === 'cam-clear-all') {
                S.camera = { frames: {} };
                VF.uiTimeline();
                VF.toast('All camera keys cleared');
            }
            VF.render(); VF.updateCameraUI(); $camCtx.hide();
        });
    });


    /* ═══════════════════════════════════════════════════
       UI — Ribbon & Sync
       ═══════════════════════════════════════════════════ */

    VF.updateCameraUI = function () {
        var cam = VF.getCameraAtFrame(S.tl.frame);
        $('#cam-x').val(Math.round(cam.x * 10) / 10);
        $('#cam-y').val(Math.round(cam.y * 10) / 10);
        $('#cam-zoom').val(Math.round(cam.zoom * 100));
        $('#cam-rot').val(Math.round(cam.rotation * 10) / 10);
        var hasKey = S.camera && S.camera.frames && S.camera.frames[S.tl.frame] !== undefined;
        $('#btn-cam-setkey').css('color', hasKey ? 'var(--success)' : 'var(--accent)');
    };

    $(document).ready(function () {
        $('#btn-cam-setkey').on('click', function () {
            VF.saveHistory();
            VF.setCameraKey(S.tl.frame, VF.getCameraAtFrame(S.tl.frame));
            VF.updateCameraUI(); VF.render();
            VF.toast('Camera key set at frame ' + (S.tl.frame + 1));
        });
        $('#btn-cam-delkey').on('click', function () {
            if (S.camera && S.camera.frames && S.camera.frames[S.tl.frame] !== undefined) {
                VF.saveHistory(); VF.delCameraKey(S.tl.frame);
                VF.render(); VF.updateCameraUI();
                VF.toast('Camera key removed');
            }
        });
        $('#btn-cam-reset').on('click', function () {
            VF.saveHistory(); VF.setCameraKey(S.tl.frame, defaultCam());
            VF.render(); VF.updateCameraUI();
            VF.toast('Camera reset to default');
        });
        $('#btn-cam-clear-all').on('click', function () {
            if (!VF.hasCameraKeyframes()) return;
            VF.saveHistory(); S.camera = { frames: {} };
            VF.uiTimeline(); VF.render(); VF.updateCameraUI();
            VF.toast('All camera keys cleared');
        });

        function applyCamInputs() {
            VF.saveHistory();
            VF.setCameraKey(S.tl.frame, {
                x: parseFloat($('#cam-x').val()) || S.canvas.w / 2,
                y: parseFloat($('#cam-y').val()) || S.canvas.h / 2,
                zoom: Math.max(0.05, Math.min(20, (parseFloat($('#cam-zoom').val()) || 100) / 100)),
                rotation: parseFloat($('#cam-rot').val()) || 0
            });
            VF.render();
        }
        $('#cam-x, #cam-y, #cam-zoom, #cam-rot').on('change', applyCamInputs);
        $('#cam-x, #cam-y, #cam-zoom, #cam-rot').on('keydown keyup keypress', function (e) { e.stopPropagation(); });

        VF._goFrameHooks.push(VF.updateCameraUI);
        setTimeout(VF.updateCameraUI, 100);
    });

})();