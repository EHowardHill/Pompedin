(function () {
    "use strict";
    var S = VF.S;

    var TAG_COLORS = {
        none: 'transparent', red: '#ef4444', orange: '#f97316', yellow: '#eab308',
        green: '#22c55e', blue: '#3b82f6', purple: '#a855f7', pink: '#ec4899'
    };
    VF.TAG_COLORS = TAG_COLORS;
    VF._isDraggingLayer = false;

    VF.uiLayers = function () {
        if (VF._isDraggingLayer) return;
        var h = '';
        VF.visibleTree().forEach(function (n) {
            var l = n.item, ind = n.depth * 14;
            var sel = l.id === S.activeId ? ' sel' : '';
            var tagColor = TAG_COLORS[l.colorTag] || 'transparent';
            var bl = 'border-left:3px solid ' + (tagColor !== 'transparent' ? tagColor : 'transparent') + ';';

            if (VF.isFolder(l)) {
                var caret = l.collapsed ? '▸' : '▾';
                var fic = l.kind === 'switch' ? '⇄' : '📁';
                var kindBadge = l.kind === 'switch'
                    ? '<span class="lyr-badge" title="Switch folder">SW</span>' : '';
                var fOp = (l.opacity != null ? l.opacity : 1);
                if (fOp < 0.995) {
                    kindBadge += '<span class="lyr-badge" title="Group opacity">' + Math.round(fOp * 100) + '%</span>';
                }
                h += '<div class="layer-item layer-folder' + sel + '" data-id="' + l.id + '" style="' + bl + 'padding-left:' + ind + 'px">' +
                    '<button class="vbtn lyr-caret" data-id="' + l.id + '" title="Collapse">' + caret + '</button>' +
                    '<button class="vbtn lyr-vis" data-id="' + l.id + '">' + (l.vis ? '◉' : '○') + '</button>' +
                    '<span style="font-size:11px;opacity:.7">' + fic + '</span>' +
                    '<span class="lyr-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">' + l.name + '</span>' +
                    '<span class="lyr-badges">' + kindBadge + '</span>' +
                    '<button class="vbtn lyr-settings-btn" data-id="' + l.id + '" title="Settings">⚙</button>' +
                    '</div>';
                return;
            }

            if (VF.ensureLayerSettings) VF.ensureLayerSettings(l);
            var ico = l.type === 'image' ? '🖼' : '✎';
            var parent = l.parentId != null ? VF.getItem(l.parentId) : null;
            var inSwitch = parent && parent.kind === 'switch';
            var isActiveChild = inSwitch && VF.activeSwitchChildId(parent) === l.id;
            var vis = inSwitch ? (isActiveChild ? '◉' : '○') : (l.vis ? '◉' : '○');
            var dim = inSwitch && !isActiveChild ? 'opacity:.45;' : '';

            var badges = '';
            if (l.locked) badges += '<span class="lyr-badge lyr-badge-lock" title="Locked">🔒</span>';
            if (l.reference) badges += '<span class="lyr-badge lyr-badge-ref" title="Reference">📐</span>';
            if (l.wobble && l.wobble.enabled) badges += '<span class="lyr-badge lyr-badge-wobble" title="Wobble">〰</span>';
            if (l.blendMode && l.blendMode !== 'normal') badges += '<span class="lyr-badge lyr-badge-blend" title="Blend: ' + l.blendMode + '">' + l.blendMode.charAt(0).toUpperCase() + '</span>';

            h += '<div class="layer-item' + sel + '" data-id="' + l.id + '" style="' + bl + 'padding-left:' + (ind + 14) + 'px;' + dim + '">' +
                '<button class="vbtn lyr-vis' + (inSwitch ? ' lyr-switch-pick' : '') + '" data-id="' + l.id + '">' + vis + '</button>' +
                '<span style="font-size:11px;opacity:.6">' + ico + '</span>' +
                '<span class="lyr-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + l.name + '</span>' +
                '<span class="lyr-badges">' + badges + '</span>' +
                '<button class="vbtn lyr-settings-btn" data-id="' + l.id + '" title="Settings">⚙</button>' +
                '</div>';
        });
        $('#layers-list').html(h);

        var al = VF.AL();
        if (al) {
            var op = (al.opacity != null ? al.opacity : 1) * 100;
            $('#rng-opacity').val(op);
            $('#v-opacity').val(Math.round(op));
        }
        var lockEl = document.getElementById('lock-indicator');
        if (lockEl) {
            if (al && al.locked) lockEl.classList.add('visible'); else lockEl.classList.remove('visible');
        }
    };

    $(document).ready(function () {
        var $list = $('#layers-list');

        $list.on('click', '.lyr-caret', function (e) {
            e.stopPropagation();
            var l = VF.getItem(+$(this).data('id'));
            if (l) { l.collapsed = !l.collapsed; VF.uiLayers(); VF.uiTimeline(); }
        });

        $list.on('dblclick', '.layer-item', function (e) {
            if ($(e.target).closest('.vbtn').length) return;
            e.stopPropagation();
            VF.openLayerSettings(+$(this).data('id'));
        });

        $list.on('click', '.lyr-settings-btn', function (e) {
            e.stopPropagation();
            VF.openLayerSettings(+$(this).data('id'));
        });

        // Visibility / switch-pick
        $list.on('click', '.lyr-vis', function (e) {
            e.stopPropagation();
            var l = VF.getItem(+$(this).data('id')); if (!l) return;
            var parent = l.parentId != null ? VF.getItem(l.parentId) : null;
            VF.saveHistory();
            if (!VF.isFolder(l) && parent && parent.kind === 'switch') {
                VF.setSwitch(parent, S.tl.frame, l.id);   // pick this child at this frame…
                S.activeId = l.id;                          // …and make it the working layer
                VF.selSegments = []; VF.clearHandles();
            } else {
                l.vis = !l.vis;
            }
            VF.uiLayers(); VF.uiTimeline(); VF.render();
        });

        /* ── NESTED DRAG ── */
        function isFolderEl($el) { return $el.hasClass('layer-folder'); }

        function applyDrop(dragId, targetId, where) {
            var dragged = VF.getItem(dragId), target = VF.getItem(targetId);
            if (!dragged || !target || dragId === targetId) return false;
            if (where === 'inside' && !VF.isFolder(target)) where = 'below';
            var newParent = (where === 'inside') ? target.id : (target.parentId || null);
            if (newParent === dragId) return false;
            if (VF.isFolder(dragged) && newParent != null && VF.isDescendant(newParent, dragId)) return false;

            VF.saveHistory();
            dragged.parentId = newParent;
            var sibs = VF.childrenOf(newParent)
                .filter(function (s) { return s.id !== dragId; })
                .sort(function (a, b) { return b.z - a.z; }); // top-first
            var idx;
            if (where === 'inside') idx = 0;
            else {
                var ti = sibs.findIndex(function (s) { return s.id === targetId; });
                if (ti < 0) ti = 0;
                idx = (where === 'above') ? ti : ti + 1;
            }
            sibs.splice(idx, 0, dragged);
            var nn = sibs.length;
            sibs.forEach(function (s, i) { s.z = nn - 1 - i; });
            return true;
        }

        var drag = null, lastClickT = 0, lastClickId = null;

        $list.on('pointerdown', '.layer-item', function (e) {
            if (e.button !== 0 || $(e.target).closest('.vbtn, .lyr-name-input').length) return;
            var id = +$(this).data('id'), now = Date.now();
            if (lastClickId === id && now - lastClickT < 400 && $(e.target).closest('.lyr-name').length) {
                e.preventDefault(); lastClickT = 0;
                $(e.target).closest('.lyr-name').trigger('dblclick'); return;
            }
            lastClickT = now; lastClickId = id;
            e.preventDefault();
            try { this.setPointerCapture(e.pointerId); } catch (_) { }
            drag = { id: id, el: $(this), raw: this, pid: e.pointerId, startX: e.clientX, startY: e.clientY, on: false, ghost: null, target: null, where: null };
        });

        $(window).on('pointermove', function (e) {
            if (!drag) return;
            if (!drag.on && Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 5) {
                drag.on = true; VF._isDraggingLayer = true;
                drag.ghost = drag.el.clone().css({
                    position: 'fixed', top: drag.el.offset().top, left: drag.el.offset().left,
                    width: drag.el.outerWidth(), opacity: .8, pointerEvents: 'none', zIndex: 9999,
                    boxShadow: '0 4px 12px rgba(0,0,0,.3)', background: 'var(--bg-panel)'
                }).appendTo('body');
                drag.el.css('opacity', '.3');
            }
            if (!drag.on) return;
            drag.ghost.css({ top: e.clientY - drag.ghost.outerHeight() / 2, left: e.clientX - 20 });
            $('.layer-item').removeClass('drag-top drag-bot drag-into');
            drag.ghost.hide();
            var $t = $(document.elementFromPoint(e.clientX, e.clientY)).closest('.layer-item');
            drag.ghost.show();
            drag.target = null; drag.where = null;
            if ($t.length && +$t.data('id') !== drag.id) {
                var r = $t[0].getBoundingClientRect(), rel = (e.clientY - r.top) / r.height;
                drag.target = +$t.data('id');
                if (isFolderEl($t)) { drag.where = rel < 0.33 ? 'above' : 'inside'; }
                else { drag.where = rel < 0.5 ? 'above' : 'below'; }
                $t.addClass(drag.where === 'inside' ? 'drag-into' : (drag.where === 'above' ? 'drag-top' : 'drag-bot'));
            }
        });

        function finish(e) {
            if (!drag) return;
            try { drag.raw.releasePointerCapture(drag.pid); } catch (_) { }
            if (!drag.on) {
                S.activeId = drag.id; VF.selSegments = []; VF.clearHandles();
                VF.syncActiveSwitchPick(drag.id);
                VF.uiLayers(); VF.render();
            } else {
                if (drag.target != null && drag.where) applyDrop(drag.id, drag.target, drag.where);
                S.activeId = drag.id;
                VF.syncActiveSwitchPick(drag.id);
                drag.el.css('opacity', '1');
                $('.layer-item').removeClass('drag-top drag-bot drag-into');
                if (drag.ghost) drag.ghost.remove();
                VF._isDraggingLayer = false;
                VF.uiLayers(); VF.render(); VF.uiTimeline();
            }
            drag = null;
        }
        $(window).on('pointerup', finish);
        $(window).on('pointercancel', function () {
            if (!drag) return;
            try { drag.raw.releasePointerCapture(drag.pid); } catch (_) { }
            if (drag.on) {
                drag.el.css('opacity', '1');
                $('.layer-item').removeClass('drag-top drag-bot drag-into');
                if (drag.ghost) drag.ghost.remove();
                VF._isDraggingLayer = false; VF.uiLayers();
            }
            drag = null;
        });
    });
})();