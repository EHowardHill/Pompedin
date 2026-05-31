(function () {
    "use strict";

    var S = VF.S;
    var CELL = 18;

    var onionDrag = null;
    var _onionWasDragging = false;
    var onionCtxIdx = null;

    /* ═══════════════════════════════════════════════════
       MARKER RENDER  — one marker per rule, on its resolved frame
       ═══════════════════════════════════════════════════ */
    VF.renderOnionMarkers = function () {
        var $row = $('#tl-onion-row');
        if (!$row.length) return;

        var f = S.tl.frame, max = S.tl.max;
        $row.toggleClass('off', !S.cfg.onion);
        $('.tl-onion-label').toggleClass('on', !!S.cfg.onion);

        var html = '<div class="tl-onion-cur" style="left:' + (f * CELL) + 'px"></div>';

        (S.onions || []).forEach(function (sk, i) {
            var targetF = sk.rel ? (f + sk.val) : (sk.val - 1);
            var oob = targetF < 0 || targetF >= max || targetF === f;
            var clampF = Math.max(0, Math.min(max - 1, targetF));
            var isFuture = sk.rel ? (sk.val > 0) : ((sk.val - 1) > f);

            // marker opacity reflects the rule's onion opacity (live wheel feedback)
            var op = Math.max(1, Math.min(100, sk.op));
            var solid = oob ? 0.3 : (0.45 + (op / 100) * 0.55);

            var cls = 'tl-onion-mk ' + (isFuture ? 'future' : 'past') +
                (sk.rel ? '' : ' abs') +
                (sk.top ? ' above' : '') +
                (oob ? ' oob' : '');

            var tip = (sk.rel
                ? 'Relative ' + (sk.val > 0 ? '+' : '') + sk.val
                : 'Absolute frame ' + sk.val) +
                ' · ' + op + '% · ' + (sk.top ? 'Above art' : 'Below art') +
                '  —  drag to move · wheel to fade · right-click for options';

            html += '<div class="' + cls + '" data-idx="' + i + '" title="' + tip + '" ' +
                'style="left:' + (clampF * CELL + CELL / 2) + 'px;opacity:' + solid.toFixed(2) + '"></div>';
        });

        $row.html(html);
    };

    /* ═══════════════════════════════════════════════════
       Keep markers fresh on timeline rebuild + frame change,
       and inject the sticky "Onion" label into the label column.
       ═══════════════════════════════════════════════════ */
    var _origUiTimeline = VF.uiTimeline;
    VF.uiTimeline = function () {
        _origUiTimeline.apply(this, arguments);
        if (VF._isDraggingTimeline) return;

        $('#tl-labels .tl-onion-label').remove();
        var $spacer = $('#tl-labels').children().first(); // 16px ruler spacer
        $('<div class="tl-onion-label"><i class="fa-solid fa-eye"></i> Onion</div>')
            .insertAfter($spacer);

        VF.renderOnionMarkers();
    };

    var _origUpdateTL = VF.updateTimelineState;
    VF.updateTimelineState = function () {
        _origUpdateTL.apply(this, arguments);
        VF.renderOnionMarkers();
    };

    /* ═══════════════════════════════════════════════════
       Context menu
       ═══════════════════════════════════════════════════ */
    function showOnionCtx($menu, x, y) {
        $menu.css({ left: -9999, top: -9999, display: 'block' });
        var mw = $menu.outerWidth(), mh = $menu.outerHeight(), pad = 4;
        if (x + mw + pad > window.innerWidth) x = window.innerWidth - mw - pad;
        if (y + mh + pad > window.innerHeight) y = window.innerHeight - mh - pad;
        $menu.css({ left: Math.max(pad, x), top: Math.max(pad, y) });
    }

    $(document).ready(function () {

        /* Inject the bar once, right under the ruler */
        if ($('#tl-onion-row').length === 0) {
            $('<div id="tl-onion-row" class="tl-onion-row"></div>').insertAfter('#tl-ruler');
        }
        var $row = $('#tl-onion-row');

        /* Context menu element */
        var $oCtx = $('<div class="ctx" id="onion-ctx" style="display:none">' +
            '<div class="ctx-i" data-act="above">Show Above Art</div>' +
            '<div class="ctx-i" data-act="below">Show Below Art</div>' +
            '<hr style="margin:4px 0;border:none;border-top:1px solid var(--border)">' +
            '<div class="ctx-i" data-act="abs">Make Absolute</div>' +
            '<div class="ctx-i" data-act="rel">Make Relative</div>' +
            '<hr style="margin:4px 0;border:none;border-top:1px solid var(--border)">' +
            '<div class="ctx-i" data-act="remove" style="color:var(--warning)">Remove Onion Skin</div>' +
            '</div>').appendTo('body');

        /* ── Add: click an empty frame in the bar ── */
        $row.on('click', function (e) {
            if (_onionWasDragging) return;
            if ($(e.target).closest('.tl-onion-mk').length) return;

            var rect = this.getBoundingClientRect();
            var frame = Math.max(0, Math.min(S.tl.max - 1,
                Math.floor((e.clientX - rect.left) / CELL)));

            if (frame === S.tl.frame) { VF.toast('Onion must target a different frame'); return; }

            var val = frame - S.tl.frame; // relative offset
            if (S.onions.find(function (s) { return s.rel && s.val === val; })) {
                VF.toast('Onion skin already exists for that offset'); return;
            }
            S.onions.push({ rel: true, val: val, op: 20, top: false });
            VF.renderOnionMarkers();
            if (VF.renderOnionUI) VF.renderOnionUI();
            VF.render();
            VF.toast('Onion skin added');
        });

        /* ── Drag: retarget a marker ── */
        $row.on('pointerdown', '.tl-onion-mk', function (e) {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            onionDrag = { idx: +$(this).data('idx'), startX: e.clientX, moved: false };
        });

        $(window).on('pointermove.onion', function (e) {
            if (!onionDrag) return;
            if (!onionDrag.moved && Math.abs(e.clientX - onionDrag.startX) > 3) onionDrag.moved = true;
            if (!onionDrag.moved) return;

            var sk = S.onions[onionDrag.idx];
            if (!sk) return;

            var rect = document.getElementById('tl-onion-row').getBoundingClientRect();
            var frame = Math.max(0, Math.min(S.tl.max - 1,
                Math.floor((e.clientX - rect.left) / CELL)));

            var newVal = sk.rel ? (frame - S.tl.frame) : (frame + 1);
            if (sk.rel && newVal === 0) return; // can't point a relative rule at itself

            if (sk.val !== newVal) {
                sk.val = newVal;
                VF.renderOnionMarkers();
                if (VF.renderOnionUI) VF.renderOnionUI();
                VF.render();
            }
        });

        $(window).on('pointerup.onion', function () {
            if (!onionDrag) return;
            if (onionDrag.moved) {
                _onionWasDragging = true;
                setTimeout(function () { _onionWasDragging = false; }, 50);
            }
            onionDrag = null;
        });

        /* ── Wheel: fade a marker's opacity ── */
        $row.on('wheel', '.tl-onion-mk', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var sk = S.onions[+$(this).data('idx')];
            if (!sk) return;
            var delta = ((e.originalEvent || e).deltaY < 0) ? 5 : -5;
            sk.op = Math.max(1, Math.min(100, sk.op + delta));
            VF.renderOnionMarkers();
            if (VF.renderOnionUI) VF.renderOnionUI();
            VF.render();
        });

        /* ── Right-click: options ── */
        $row.on('contextmenu', function (e) { e.preventDefault(); }); // empty area
        $row.on('contextmenu', '.tl-onion-mk', function (e) {
            e.preventDefault();
            e.stopPropagation();
            onionCtxIdx = +$(this).data('idx');
            var sk = S.onions[onionCtxIdx];
            // show only the relevant convert/position items
            $oCtx.find('[data-act="above"]').toggle(!sk.top);
            $oCtx.find('[data-act="below"]').toggle(!!sk.top);
            $oCtx.find('[data-act="abs"]').toggle(!!sk.rel);
            $oCtx.find('[data-act="rel"]').toggle(!sk.rel);
            showOnionCtx($oCtx, e.clientX, e.clientY);
        });

        $oCtx.on('click', '.ctx-i', function () {
            var act = $(this).data('act');
            var sk = S.onions[onionCtxIdx];
            if (sk) {
                if (act === 'above') sk.top = true;
                else if (act === 'below') sk.top = false;
                else if (act === 'abs' && sk.rel) { sk.val = (S.tl.frame + sk.val) + 1; sk.rel = false; }
                else if (act === 'rel' && !sk.rel) { sk.val = (sk.val - 1) - S.tl.frame; sk.rel = true; }
                else if (act === 'remove') S.onions.splice(onionCtxIdx, 1);

                VF.renderOnionMarkers();
                if (VF.renderOnionUI) VF.renderOnionUI();
                VF.render();
            }
            $oCtx.hide();
        });
        $(document).on('click', function () { $oCtx.hide(); });

        /* ── Label toggles master onion (kept in sync with ribbon #tgl-onion) ── */
        $(document).on('click', '.tl-onion-label', function (e) {
            e.stopPropagation();
            S.cfg.onion = !S.cfg.onion;
            $('#tgl-onion').toggleClass('on', S.cfg.onion);
            VF.renderOnionMarkers();
            VF.render();
        });
        $('#tgl-onion').on('click', function () { VF.renderOnionMarkers(); });

        /* ── Keep the bar in sync with edits made from the ribbon menu ── */
        $('#onion-ribbon-list').on('input change click', function () {
            setTimeout(VF.renderOnionMarkers, 0);
        });
        $('#btn-add-onion').on('click', function () {
            setTimeout(VF.renderOnionMarkers, 0);
        });

        VF.renderOnionMarkers();
    });

})();