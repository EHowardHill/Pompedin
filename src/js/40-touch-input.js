/**
 * Touch input layer for iPad / tablets (Phase: iPad groundwork).
 *
 * The canvas already has `touch-action: none` (style.css) and Paper.js
 * natively maps single-touch to tool events, so drawing with a finger or
 * Apple Pencil works out of the box — including pressure, which the
 * brush reads from PointerEvent.pressure (03-paper-setup.js).
 *
 * This module adds the three things a touch-first device needs that a
 * mouse setup gets elsewhere:
 *
 *   1. TWO-FINGER PAN + PINCH ZOOM on the canvas (capture phase) — the
 *      touch equivalents of middle-drag pan and wheel zoom in
 *      14-tool-camera.js, whose view math is mirrored exactly.
 *   2. LONG-PRESS → synthetic `contextmenu` — every right-click menu in
 *      the app (timeline, camera track, onion markers, switch dots)
 *      binds the standard `contextmenu` event, so one dispatcher makes
 *      them all work with touch. The canvas itself is excluded (a
 *      long-press there is a drawing gesture, not a menu request).
 *   3. Device detection — VF.isTouchDevice() / VF.isIpad() — used by
 *      the save flow (20-project-io.js) to bypass native save dialogs
 *      on iPad, where files go to the app's Documents folder instead
 *      (visible in the Files app).
 *
 * Everything here is a no-op on non-touch devices (nothing binds), and
 * in the Node test harness (detection returns false).
 *
 * Known limitation (documented in docs/IPAD-GUIDE.md): landing a second
 * finger mid-stroke freezes the in-progress stroke (its touchmove
 * events are captured by the gesture) instead of cancelling it cleanly.
 */
(function () {
    "use strict";

    /* ── Device detection ──────────────────────────────────── */

    function isTouchDevice() {
        try {
            return ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
        } catch (e) {
            return false;
        }
    }

    // Modern iPadOS presents a desktop-like Safari UA; the reliable
    // recipe is "Mac UA + multi-touch" or an explicit iPad/iPhone UA.
    function isIpad() {
        try {
            var ua = navigator.userAgent;
            return /iPad|iPhone|iPod/.test(ua) ||
                (/Mac/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
        } catch (e) {
            return false;
        }
    }

    function isAndroid() {
        try {
            return /Android/.test(navigator.userAgent);
        } catch (e) {
            return false;
        }
    }

    /** True inside any Tauri mobile build (iPad or Android):
     *  native save dialogs are unavailable / unreliable there, so the
     *  save flow falls back to the Documents folder. */
    function isMobileApp() {
        return isIpad() || isAndroid();
    }

    VF.isTouchDevice = isTouchDevice;
    VF.isIpad = isIpad;
    VF.isAndroid = isAndroid;
    VF.isMobileApp = isMobileApp;

    /* ── Pure helpers (unit-tested in tests/touch-input.test.js) ── */

    /** Distance between two touch points. */
    VF._gestureDist = function (a, b) {
        var dx = a.clientX - b.clientX;
        var dy = a.clientY - b.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    /** Midpoint between two touch points (screen coords). */
    VF._gestureMid = function (a, b) {
        return {
            clientX: (a.clientX + b.clientX) / 2,
            clientY: (a.clientY + b.clientY) / 2
        };
    };

    /* ── Gesture installation ───────────────────────────────── */

    function install() {
        var cvs = VF.cvs;
        if (!cvs) return;

        /* Two-finger pan + pinch zoom (canvas-local math mirrors the
           wheel zoom in 14-tool-camera.js: zoom about the gesture
           midpoint, pan by midpoint movement). */
        var gesture = null;   // { lastMid: canvas-local Point, lastDist: number }

        function localPoint(t) {
            var rect = cvs.getBoundingClientRect();
            return { x: t.clientX - rect.left, y: t.clientY - rect.top };
        }

        cvs.addEventListener('touchstart', function (e) {
            cancelLongPress();
            if (e.touches.length !== 2) { gesture = null; return; }
            // Own the gesture: block Paper.js tool handling and any
            // system behavior for these touches.
            e.preventDefault();
            e.stopPropagation();
            var m = VF._gestureMid(e.touches[0], e.touches[1]);
            gesture = {
                lastMid: localPoint(m),
                lastDist: VF._gestureDist(e.touches[0], e.touches[1])
            };
        }, { capture: true, passive: false });

        cvs.addEventListener('touchmove', function (e) {
            if (!gesture || e.touches.length !== 2) return;
            e.preventDefault();
            e.stopPropagation();

            var P = VF.P;
            var m = VF._gestureMid(e.touches[0], e.touches[1]);
            var mid = localPoint(m);
            var dist = VF._gestureDist(e.touches[0], e.touches[1]);

            // 1) Pan: keep the project point under the moving midpoint
            //    (same formula as middle-drag pan in 14-tool-camera.js).
            var pLast = VF.view.viewToProject(new P.Point(gesture.lastMid.x, gesture.lastMid.y));
            var pCur = VF.view.viewToProject(new P.Point(mid.x, mid.y));
            VF.view.center = VF.view.center.subtract(pCur.subtract(pLast));

            // 2) Zoom: scale by the distance ratio, keeping the project
            //    point under the midpoint fixed on screen (same formula
            //    as wheel zoom in 14-tool-camera.js).
            if (gesture.lastDist > 0 && dist > 0) {
                var f = dist / gesture.lastDist;
                var newZoom = Math.max(0.05, Math.min(16, VF.view.zoom * f));
                var anchorProj = VF.view.viewToProject(new P.Point(mid.x, mid.y));
                VF.view.zoom = newZoom;
                VF.view.center = VF.view.center.add(anchorProj.subtract(
                    VF.view.viewToProject(new P.Point(mid.x, mid.y))));
            }

            gesture.lastMid = mid;
            gesture.lastDist = dist;

            if (VF.updateInfo) VF.updateInfo();
            if (VF.drawBorder) VF.drawBorder();
        }, { capture: true, passive: false });

        function endGesture(e) {
            if (gesture && e.touches.length < 2) gesture = null;
        }
        cvs.addEventListener('touchend', endGesture, { capture: true, passive: true });
        cvs.addEventListener('touchcancel', endGesture, { capture: true, passive: true });

        /* Long-press → synthetic contextmenu (10px movement tolerance,
           500ms hold). Makes every existing `contextmenu` binding work
           on touch: timeline cells, camera keys, onion markers, switch
           dots. Excluded surfaces: the canvas (long-presses there are
           drawing) and any element already marked data-no-longpress. */
        var lpTimer = null;
        var lpStart = null;

        function cancelLongPress() {
            if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
            lpStart = null;
        }
        VF._cancelLongPress = cancelLongPress;

        function isLongPressExcluded(target) {
            if (!target || !target.closest) return false;
            return !!target.closest('#main-canvas, [data-no-longpress]');
        }

        document.addEventListener('touchstart', function (e) {
            cancelLongPress();
            if (e.touches.length !== 1) return;
            if (isLongPressExcluded(e.target)) return;

            var t = e.touches[0];
            lpStart = { x: t.clientX, y: t.clientY, target: e.target };
            lpTimer = setTimeout(function () {
                if (!lpStart) return;
                var synthetic = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: lpStart.x,
                    clientY: lpStart.y
                });
                var target = lpStart.target;
                cancelLongPress();
                target.dispatchEvent(synthetic);
            }, 500);
        }, { capture: true, passive: true });

        document.addEventListener('touchmove', function (e) {
            if (!lpStart) return;
            var t = e.touches[0];
            if (Math.abs(t.clientX - lpStart.x) > 10 || Math.abs(t.clientY - lpStart.y) > 10) {
                cancelLongPress();
            }
        }, { capture: true, passive: true });

        document.addEventListener('touchend', cancelLongPress, { capture: true, passive: true });
        document.addEventListener('touchcancel', cancelLongPress, { capture: true, passive: true });
    }

    // Bind only on real touch devices — a complete no-op on desktop.
    if (isTouchDevice()) install();

})();
