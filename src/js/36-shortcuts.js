(function () {
    "use strict";

    var S = VF.S;

    var STORAGE_KEY = 'pompedin_keymap';

    /* ── Shared helpers ── */
    function navLayer(dir) {
        var sorted = [].concat(S.layers).sort(function (a, b) { return b.z - a.z; });
        var curIdx = sorted.findIndex(function (l) { return l.id === S.activeId; });
        if (curIdx === -1) return;
        var nextIdx = curIdx + dir;
        if (nextIdx < 0 || nextIdx >= sorted.length) return;
        S.activeId = sorted[nextIdx].id;
        if (VF.syncActiveSwitchPick) VF.syncActiveSwitchPick(S.activeId);
        VF.selSegments = [];
        VF.clearHandles();
        VF.uiLayers();
        VF.render();
    }

    function toggleSym(axis) {
        if (axis === 'H') {
            S.cfg.symmetryH = !S.cfg.symmetryH;
            $('#tgl-sym-h').toggleClass('on', S.cfg.symmetryH);
            VF.render();
            VF.toast('Horizontal symmetry ' + (S.cfg.symmetryH ? 'ON' : 'OFF'));
        } else {
            S.cfg.symmetryV = !S.cfg.symmetryV;
            $('#tgl-sym-v').toggleClass('on', S.cfg.symmetryV);
            VF.render();
            VF.toast('Vertical symmetry ' + (S.cfg.symmetryV ? 'ON' : 'OFF'));
        }
    }

    /* ── Action registry: id → { label, group, run } ── */
    var ACTIONS = {
        /* Tools — mapped to the nearest Moho tool */
        'tool-select': { label: 'Select / Edit (Transform Points)', group: 'Tools', run: function () { VF.setTool('select'); } },
        'tool-brush': { label: 'Brush (Freehand)', group: 'Tools', run: function () { VF.setTool('brush'); } },
        'tool-lasso': { label: 'Lasso (Select Points)', group: 'Tools', run: function () { VF.setTool('lasso'); } },
        'tool-eraser': { label: 'Eraser', group: 'Tools', run: function () { VF.setTool('eraser'); } },
        'tool-fill': { label: 'Fill (Paint Bucket)', group: 'Tools', run: function () { VF.setTool('fill'); } },
        'tool-hide-edge': { label: 'Hide Edge', group: 'Tools', run: function () { VF.setTool('hide-edge'); } },
        'tool-translate': { label: 'Translate Layer (Transform Layer)', group: 'Tools', run: function () { VF.setTool('translate'); } },
        'tool-rotate': { label: 'Rotate Layer', group: 'Tools', run: function () { VF.setTool('rotate'); } },
        'tool-scale': { label: 'Scale Layer', group: 'Tools', run: function () { VF.setTool('scale'); } },
        'tool-camera': { label: 'Camera (Track Camera)', group: 'Tools', run: function () { VF.setTool('camera'); } },
        'tool-zoom': { label: 'Zoom Workspace', group: 'Tools', run: function () { VF.setTool('zoom'); } },
        'tool-rotate-view': { label: 'Rotate Workspace', group: 'Tools', run: function () { VF.setTool('rotate-view'); } },
        'eyedropper': { label: 'Eyedropper (Stroke)', group: 'Tools', run: function () { VF.pickScreenColor('#clr-stroke'); } },

        /* Playback / Frame-by-Frame */
        'play': { label: 'Play / Stop', group: 'Playback', run: function () { VF.togglePlay(); } },
        'next-frame': { label: 'Forward (Next Frame)', group: 'Playback', run: function () { VF.goFrame(S.tl.frame + 1); } },
        'prev-frame': { label: 'Back (Previous Frame)', group: 'Playback', run: function () { VF.goFrame(S.tl.frame - 1); } },
        'blank-key': { label: 'New Frame', group: 'Playback', run: function () { $('#btn-add-blank').click(); } },
        'dup-key': { label: 'Duplicate Frame', group: 'Playback', run: function () { $('#btn-add-dup').click(); } },
        'del-key': { label: 'Delete Frame', group: 'Playback', run: function () { $('#btn-del-node').click(); } },

        /* Layers (Pompedin extra — Moho selects layers via panel) */
        'layer-up': { label: 'Select Layer Above', group: 'Layers', run: function () { navLayer(-1); } },
        'layer-down': { label: 'Select Layer Below', group: 'Layers', run: function () { navLayer(1); } },

        /* View */
        'reset-view': { label: 'Reset View', group: 'View', run: function () { if (VF.resetView) VF.resetView(); } },
        'fit-screen': { label: 'View All (Fit to Screen)', group: 'View', run: function () { if (VF.fitToScreen) VF.fitToScreen(); } },

        /* Canvas toggles */
        'toggle-grid': { label: 'Grid', group: 'Canvas', run: function () { S.cfg.showGrid = !S.cfg.showGrid; $('#tgl-show-grid').toggleClass('on', S.cfg.showGrid); VF.render(); } },
        'toggle-onion': { label: 'Onion Skins', group: 'Canvas', run: function () { S.cfg.onion = !S.cfg.onion; $('#tgl-onion').toggleClass('on', S.cfg.onion); VF.render(); } },
        'sym-h': { label: 'H Symmetry  (Pompedin extra)', group: 'Canvas', run: function () { toggleSym('H'); } },
        'sym-v': { label: 'V Symmetry  (Pompedin extra)', group: 'Canvas', run: function () { toggleSym('V'); } }
    };

    /* ── Moho Pro 13.5 default bindings (⌘→Ctrl, ⌥→Alt) ── */
    var DEFAULT_KEYMAP = {
        'tool-select': 't',          // Moho: Transform Points
        'tool-brush': 'f',           // Moho: Freehand
        'tool-lasso': 'g',           // Moho: Select Points (group)
        'tool-eraser': 'e',          // Moho: Eraser
        'tool-fill': 'p',            // Moho: Paint Bucket
        'tool-hide-edge': 'h',       // Moho: Hide Edge
        'tool-translate': 'm',       // Moho: Transform Layer
        'tool-rotate': 'r',          // no Moho layer-rotate key
        'tool-scale': 's',           // no Moho layer-scale key
        'tool-camera': '4',          // Moho: Track Camera
        'tool-zoom': 'z',            // no Moho workspace-zoom tool key
        'tool-rotate-view': '8',     // Moho: Rotate Workspace
        'eyedropper': 'l',           // Moho: Eyedropper

        'play': 'space',             // Moho: Play / Stop
        'next-frame': 'arrowright',  // Moho: Forward
        'prev-frame': 'arrowleft',   // Moho: Back
        'blank-key': 'f5',           // Moho: New Frame
        'dup-key': 'f6',             // Moho: Duplicate Frame
        'del-key': 'shift+f5',       // Moho: Delete Frame

        'layer-up': 'arrowup',
        'layer-down': 'arrowdown',

        'reset-view': 'home',        // Moho: Reset View
        'fit-screen': 'shift+home',  // Moho: View All
        'toggle-grid': 'ctrl+g',     // Moho: Grid
        'toggle-onion': 'ctrl+l',    // Moho: Enable Onion Skins

        'sym-h': 'shift+h',
        'sym-v': 'shift+v'
    };

    /* Combos owned elsewhere — never reassignable from the editor. */
    var RESERVED = [
        'escape', 'delete', 'backspace',
        'ctrl+z', 'ctrl+y', 'ctrl+s', 'ctrl+shift+s',
        'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+a'
    ];

    var keymap = {};
    var comboToAction = {};

    function rebuildReverse() {
        comboToAction = {};
        Object.keys(keymap).forEach(function (a) {
            var c = keymap[a];
            if (c) comboToAction[c] = a;
        });
    }

    function loadKeymap() {
        keymap = $.extend({}, DEFAULT_KEYMAP);
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var o = JSON.parse(raw);
                Object.keys(o).forEach(function (a) { if (ACTIONS[a]) keymap[a] = o[a]; });
            }
        } catch (_) { }
        rebuildReverse();
    }

    function saveKeymap() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(keymap)); } catch (_) { }
    }

    function comboFromEvent(e) {
        var k = (e.key || '').toLowerCase();
        if (k === ' ' || k === 'spacebar') k = 'space';
        if (k === 'control' || k === 'shift' || k === 'alt' || k === 'meta') return null;
        var parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('ctrl');
        if (e.altKey) parts.push('alt');
        if (e.shiftKey) parts.push('shift');
        parts.push(k);
        return parts.join('+');
    }

    function pretty(combo) {
        if (!combo) return '—';
        return combo.split('+').map(function (p) {
            switch (p) {
                case 'ctrl': return 'Ctrl';
                case 'shift': return 'Shift';
                case 'alt': return 'Alt';
                case 'arrowleft': return '←';
                case 'arrowright': return '→';
                case 'arrowup': return '↑';
                case 'arrowdown': return '↓';
                case 'enter': return 'Enter';
                case 'space': return 'Space';
                case 'home': return 'Home';
                default: return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
            }
        }).join('+');
    }

    /* ── Public API consumed by 23-keyboard.js ── */
    VF.shortcuts = {
        handle: function (e) {
            var combo = comboFromEvent(e);
            if (!combo) return false;
            var action = comboToAction[combo];
            if (!action || !ACTIONS[action]) return false;
            e.preventDefault();
            ACTIONS[action].run();
            return true;
        },
        get: function (action) { return keymap[action] || null; },
        getMap: function () { return $.extend({}, keymap); }
    };

    /* ═══════════════════════════════════════════════════
       REMAPPING MODAL
       ═══════════════════════════════════════════════════ */
    var $modal = null;
    var listeningAction = null;

    function injectStyles() {
        if (document.getElementById('sc-styles')) return;
        var css =
            '#sc-list .sc-group-title{font-size:10px;text-transform:uppercase;letter-spacing:.8px;' +
            'color:var(--text-dim);font-weight:700;margin:14px 0 6px}' +
            '#sc-list .sc-group-title:first-child{margin-top:0}' +
            '.sc-row{display:flex;align-items:center;justify-content:space-between;gap:10px;' +
            'padding:4px 4px;border-radius:5px}' +
            '.sc-row:hover{background:var(--bg-hover)}' +
            '.sc-label{font-size:11px;color:var(--text-secondary)}' +
            '.sc-key{min-width:90px;text-align:center;font-size:10px;font-weight:600;' +
            'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
            'background:var(--bg-darkest);border:1px solid var(--border);border-radius:4px;' +
            'color:var(--text-primary);padding:3px 8px;cursor:pointer;transition:border-color .1s}' +
            '.sc-key:hover{border-color:var(--accent)}' +
            '.sc-key.listening{border-color:var(--accent);color:var(--accent);' +
            'background:var(--accent-dim);font-weight:700}';
        var s = document.createElement('style');
        s.id = 'sc-styles';
        s.textContent = css;
        document.head.appendChild(s);
    }

    function buildModal() {
        injectStyles();

        var groups = {};
        Object.keys(ACTIONS).forEach(function (a) {
            var g = ACTIONS[a].group;
            (groups[g] = groups[g] || []).push(a);
        });

        var order = ['Tools', 'Playback', 'Layers', 'View', 'Canvas'];

        var html = '<div class="mo-box" style="min-width:460px;max-width:540px;max-height:82vh;display:flex;flex-direction:column">';
        html += '<div class="mo-title">Keyboard Shortcuts <span style="font-size:10px;font-weight:400;color:var(--text-dim)">— Default layout</span></div>';
        html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:12px;line-height:1.5">' +
            'Click a shortcut, then press the key or combination you want. ' +
            'Press <kbd>Esc</kbd> to cancel. Conflicting bindings are cleared automatically.</div>';
        html += '<div id="sc-list" style="flex:1;overflow-y:auto;padding-right:6px">';
        order.forEach(function (g) {
            if (!groups[g]) return;
            html += '<div class="sc-group-title">' + g + '</div>';
            groups[g].forEach(function (a) {
                html += '<div class="sc-row" data-action="' + a + '">' +
                    '<span class="sc-label">' + ACTIONS[a].label + '</span>' +
                    '<button class="sc-key" data-action="' + a + '"></button>' +
                    '</div>';
            });
        });
        html += '</div>';
        html += '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:16px">' +
            '<button class="btn" id="sc-reset">Reset to Defaults</button>' +
            '<button class="btn btn-p" id="sc-close">Done</button>' +
            '</div>';
        html += '</div>';

        $modal = $('<div id="modal-shortcuts" class="mo-ov" style="display:none;z-index:120"></div>').html(html);
        $('body').append($modal);

        $modal.on('click', function (e) { if (e.target === this) closeModal(); });
        $modal.on('click', '#sc-close', closeModal);
        $modal.on('click', '#sc-reset', function () {
            keymap = $.extend({}, DEFAULT_KEYMAP);
            rebuildReverse(); saveKeymap(); refresh();
            VF.toast('Shortcuts reset to defaults');
        });
        $modal.on('click', '.sc-key', function () {
            stopListening();
            listeningAction = $(this).data('action');
            $(this).addClass('listening').text('Press a key…');
        });

        refresh();
    }

    function refresh() {
        if (!$modal) return;
        $modal.find('.sc-key').each(function () {
            var a = $(this).data('action');
            $(this).removeClass('listening').text(pretty(keymap[a]));
        });
    }

    function stopListening() {
        listeningAction = null;
        if ($modal) $modal.find('.sc-key').removeClass('listening');
        refresh();
    }

    function assign(action, combo) {
        if (RESERVED.indexOf(combo) !== -1) {
            VF.toast('"' + pretty(combo) + '" is reserved and can\'t be reassigned');
            return false;
        }
        Object.keys(keymap).forEach(function (a) {
            if (a !== action && keymap[a] === combo) keymap[a] = null;
        });
        keymap[action] = combo;
        rebuildReverse();
        saveKeymap();
        VF.toast('Bound ' + ACTIONS[action].label + ' → ' + pretty(combo));
        return true;
    }

    function openModal() {
        if (!$modal) buildModal();
        refresh();
        $modal.css('display', 'flex');
    }

    function closeModal() {
        stopListening();
        if ($modal) $modal.hide();
    }

    document.addEventListener('keydown', function (e) {
        if (!$modal || !$modal.is(':visible')) return;
        e.stopPropagation();

        if (listeningAction) {
            e.preventDefault();
            if (e.key === 'Escape') { stopListening(); return; }
            var combo = comboFromEvent(e);
            if (combo) { assign(listeningAction, combo); stopListening(); }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
    }, true);

    /* ── Init ── */
    loadKeymap();

    $(document).ready(function () {
        if ($('#btn-edit-shortcuts').length === 0 && $('#tab-workspace').length) {
            $('#tab-workspace').append(
                '<div class="div-v-ribbon"></div>' +
                '<div class="ribbon-group">' +
                '<div class="ribbon-row">' +
                '<button class="tb tb-wide" id="btn-edit-shortcuts" data-tip="Remap keyboard shortcuts">' +
                '<i class="fa-solid fa-keyboard" style="margin-right:4px"></i> Shortcuts</button>' +
                '</div>' +
                '<div class="ribbon-group-label">Keyboard</div>' +
                '</div>'
            );
        }
        $(document).on('click', '#btn-edit-shortcuts', openModal);
    });

})();