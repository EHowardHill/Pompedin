(function () {
    "use strict";

    var S = VF.S;

    var TAG_COLORS = {
        none: 'transparent',
        red: '#ef4444',
        orange: '#f97316',
        yellow: '#eab308',
        green: '#22c55e',
        blue: '#3b82f6',
        purple: '#a855f7',
        pink: '#ec4899'
    };

    VF.TAG_COLORS = TAG_COLORS;
    VF._isDraggingLayer = false; // Freeze flag

    VF.uiLayers = function () {
        if (VF._isDraggingLayer) return;

        var h = '';
        var sorted = [].concat(S.layers).sort(function (a, b) { return b.z - a.z; });
        sorted.forEach(function (l) {
            if (VF.ensureLayerSettings) VF.ensureLayerSettings(l);

            var s = l.id === S.activeId ? ' sel' : '';
            var vis = l.vis ? '◉' : '○';
            var ico = l.type === 'image' ? '🖼' : '✎';

            var tagColor = TAG_COLORS[l.colorTag] || 'transparent';
            var borderStyle = tagColor !== 'transparent'
                ? 'border-left:3px solid ' + tagColor + ';'
                : 'border-left:3px solid transparent;';

            var badges = '';
            if (l.locked) badges += '<span class="lyr-badge lyr-badge-lock" title="Locked">🔒</span>';
            if (l.reference) badges += '<span class="lyr-badge lyr-badge-ref" title="Reference">📐</span>';
            if (l.wobble && l.wobble.enabled) badges += '<span class="lyr-badge lyr-badge-wobble" title="Wobble active">〰</span>';
            if (l.blendMode && l.blendMode !== 'normal') {
                badges += '<span class="lyr-badge lyr-badge-blend" title="Blend: ' + l.blendMode + '">' +
                    l.blendMode.charAt(0).toUpperCase() + '</span>';
            }

            h += '<div class="layer-item' + s + '" data-id="' + l.id + '" style="' + borderStyle + '">' +
                '<button class="vbtn" data-id="' + l.id + '">' + vis + '</button>' +
                '<span style="font-size:11px;opacity:.6">' + ico + '</span>' +
                '<span class="lyr-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + l.name + '</span>' +
                '<span class="lyr-badges">' + badges + '</span>' +
                '<button class="vbtn lyr-settings-btn" data-id="' + l.id + '" title="Layer Settings">⚙</button>' +
                '</div>';
        });
        $('#layers-list').html(h);

        var al = VF.AL();
        if (al) {
            $('#rng-opacity').val(al.opacity * 100);
            $('#v-opacity').val(Math.round(al.opacity * 100));
        }

        var lockEl = document.getElementById('lock-indicator');
        if (lockEl) {
            if (al && al.locked) lockEl.classList.add('visible');
            else lockEl.classList.remove('visible');
        }
    };

    $(document).ready(function () {
        var $list = $('#layers-list');

        // Double-click layer to open settings
        $list.on('dblclick', '.layer-item', function (e) {
            // Ignore the double click if the user is clicking the visibility toggle or other buttons
            if ($(e.target).closest('.vbtn').length) return;

            e.stopPropagation();
            var id = +$(this).data('id');
            VF.openLayerSettings(id);
        });

        // Settings gear button
        $list.on('click', '.lyr-settings-btn', function (e) {
            e.stopPropagation();
            VF.openLayerSettings(+$(this).data('id'));
        });

        // Visibility toggle
        $list.on('click', '.vbtn:not(.lyr-settings-btn)', function (e) {
            e.stopPropagation();
            var l = S.layers.find(function (x) { return x.id === +$(this).data('id'); }.bind(this));
            if (l) { l.vis = !l.vis; VF.uiLayers(); VF.render(); }
        });

        // ═══════════════════════════════════════════════════
        //  CUSTOM POINTER-BASED DRAG ENGINE
        //
        //  FIX: Added setPointerCapture() to ensure pen/stylus
        //  drag events are reliably received even when the pointer
        //  moves outside the originating element. Also handles
        //  pointercancel (fired by pen palm rejection, system
        //  gesture interception, etc.) to prevent ghost drags.
        // ═══════════════════════════════════════════════════
        var layerDrag = null;
        var lastLyrClickTime = 0;
        var lastLyrClickId = null;

        $list.on('pointerdown', '.layer-item', function (e) {
            if (e.button !== 0 || $(e.target).closest('.vbtn, .lyr-name-input, .lyr-settings-btn').length) return;

            var id = +$(this).data('id');
            var now = Date.now();

            // Detect double-click manually because preventDefault() blocks native dblclick
            if (lastLyrClickId === id && (now - lastLyrClickTime) < 400 && $(e.target).closest('.lyr-name').length) {
                e.preventDefault();
                lastLyrClickTime = 0; // Reset
                $(e.target).closest('.lyr-name').trigger('dblclick');
                return;
            }

            lastLyrClickTime = now;
            lastLyrClickId = id;

            e.preventDefault();

            // FIX: Capture the pointer on the originating element so that
            // pointermove/pointerup events continue to fire reliably even
            // when using a pen/stylus that leaves the element bounds.
            var pointerId = e.pointerId;
            var rawEl = this; // the .layer-item DOM element
            try { rawEl.setPointerCapture(pointerId); } catch (_) { }

            layerDrag = {
                id: id,
                el: $(this),
                rawEl: rawEl,          // FIX: store for releasePointerCapture
                pointerId: pointerId,  // FIX: store for releasePointerCapture
                startX: e.clientX,
                startY: e.clientY,
                isDragging: false,
                ghost: null,
                targetId: null
            };
        });

        $(window).on('pointermove', function (e) {
            if (!layerDrag) return;

            if (!layerDrag.isDragging) {
                var dist = Math.abs(e.clientX - layerDrag.startX) + Math.abs(e.clientY - layerDrag.startY);
                if (dist > 5) {
                    layerDrag.isDragging = true;
                    VF._isDraggingLayer = true;

                    layerDrag.ghost = layerDrag.el.clone().css({
                        position: 'fixed',
                        top: layerDrag.el.offset().top,
                        left: layerDrag.el.offset().left,
                        width: layerDrag.el.outerWidth(),
                        opacity: 0.8,
                        pointerEvents: 'none',
                        zIndex: 9999,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                        background: 'var(--bg-panel)'
                    }).appendTo('body');

                    layerDrag.el.css('opacity', '0.3');
                }
            }

            if (layerDrag.isDragging) {
                layerDrag.ghost.css({
                    top: e.clientY - (layerDrag.ghost.outerHeight() / 2),
                    left: e.clientX - 20
                });

                $('.layer-item').removeClass('drag-top drag-bot');

                layerDrag.ghost.hide();
                var target = document.elementFromPoint(e.clientX, e.clientY);
                layerDrag.ghost.show();

                var $targetItem = $(target).closest('.layer-item');
                if ($targetItem.length && $targetItem.data('id') !== layerDrag.id) {

                    // Calculate if we are hovering the top or bottom half of the target
                    var rect = $targetItem[0].getBoundingClientRect();
                    var relY = e.clientY - rect.top;
                    var insertBelow = relY >= rect.height / 2;

                    if (insertBelow) {
                        $targetItem.addClass('drag-bot');
                    } else {
                        $targetItem.addClass('drag-top');
                    }

                    layerDrag.targetId = +$targetItem.data('id');
                    layerDrag.insertBelow = insertBelow;
                } else {
                    layerDrag.targetId = null;
                }
            }
        });

        /**
         * FIX: Shared cleanup function used by both pointerup and pointercancel.
         * Ensures ghost elements are removed and state is reset regardless of
         * how the pointer interaction ends (normal lift, pen leave, palm reject, etc.)
         */
        function finishLayerDrag(e) {
            if (!layerDrag) return;

            // FIX: Release pointer capture
            try { layerDrag.rawEl.releasePointerCapture(layerDrag.pointerId); } catch (_) { }

            if (!layerDrag.isDragging) {
                // It was just a click! Perform layer selection.
                S.activeId = layerDrag.id;
                VF.selSegments = [];
                VF.clearHandles();
                VF.uiLayers();
                VF.render();
            } else {
                // It was a drag. Perform the layer reorder.
                if (layerDrag.targetId && layerDrag.targetId !== layerDrag.id) {
                    VF.saveHistory();
                    var sorted2 = [].concat(S.layers).sort(function (a, b) { return b.z - a.z; });
                    var srcIdx = sorted2.findIndex(function (x) { return x.id === layerDrag.id; });
                    var tgtIdx = sorted2.findIndex(function (x) { return x.id === layerDrag.targetId; });

                    if (srcIdx > -1 && tgtIdx > -1) {
                        var moved = sorted2.splice(srcIdx, 1)[0];
                        sorted2.splice(tgtIdx, 0, moved);
                        var len = sorted2.length;
                        sorted2.forEach(function (l, i) { l.z = len - 1 - i; });
                    }
                }

                /* Keep the dragged layer as the active layer after reorder. */
                S.activeId = layerDrag.id;

                // Cleanup UI
                layerDrag.el.css('opacity', '1');
                $('.layer-item').css('background', '');
                $('.layer-item').removeClass('drag-top drag-bot');
                if (layerDrag.ghost) layerDrag.ghost.remove();

                VF._isDraggingLayer = false;
                VF.uiLayers();
                VF.render();
                VF.uiTimeline();
            }
            layerDrag = null;
        }

        $(window).on('pointerup', finishLayerDrag);

        // FIX: Handle pointercancel — fired when the browser/OS cancels a
        // pointer interaction mid-drag. Common with pen input due to palm
        // rejection, system gesture interception, or the pen leaving the
        // digitizer's detection range. Without this, the drag state gets
        // stuck: the ghost element remains visible and layerDrag is never
        // cleared, causing the layer panel to freeze (VF._isDraggingLayer
        // stays true, blocking uiLayers() refreshes).
        $(window).on('pointercancel', function (e) {
            if (!layerDrag) return;

            // Release pointer capture
            try { layerDrag.rawEl.releasePointerCapture(layerDrag.pointerId); } catch (_) { }

            // Clean up without committing the reorder (the drag was cancelled)
            if (layerDrag.isDragging) {
                layerDrag.el.css('opacity', '1');
                $('.layer-item').css('background', '');
                $('.layer-item').removeClass('drag-top drag-bot');
                if (layerDrag.ghost) layerDrag.ghost.remove();
                VF._isDraggingLayer = false;
                VF.uiLayers();
            } else {
                // If we hadn't started dragging yet, just select the layer
                S.activeId = layerDrag.id;
                VF.selSegments = [];
                VF.clearHandles();
                VF.uiLayers();
                VF.render();
            }

            layerDrag = null;
        });
    });

})();