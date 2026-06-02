(function () {
    "use strict";

    var S = VF.S;

    $('#left-tools .tb[data-tool]').on('click', function () { VF.setTool($(this).data('tool')); });
    $('#btn-resetview').on('click', VF.resetView);
    $('#btn-fitscreen').on('click', function () { if (VF.fitToScreen) VF.fitToScreen(); });

    $('#tgl-pressure').on('click', function () {
        S.cfg.pressure = !S.cfg.pressure;
        $(this).toggleClass('on', S.cfg.pressure);
    });

    $('#tgl-stroke').on('click', function () {
        S.cfg.autoStroke = !S.cfg.autoStroke;
        $(this).toggleClass('on', S.cfg.autoStroke);
        if (VF.hasSelection && VF.hasSelection()) {
            VF.applyPropertyToSelection('enableStroke', S.cfg.autoStroke);
        }
    });
    $('#tgl-fill').on('click', function () {
        S.cfg.autoFill = !S.cfg.autoFill;
        $(this).toggleClass('on', S.cfg.autoFill);
        if (S.cfg.autoFill) { S.cfg.autoStroke = true; $('#tgl-stroke').addClass('on'); }
        if (VF.hasSelection && VF.hasSelection()) {
            VF.applyPropertyToSelection('enableFill', S.cfg.autoFill);
        }
    });
    $('#tgl-onion').on('click', function () {
        S.cfg.onion = !S.cfg.onion;
        $(this).toggleClass('on', S.cfg.onion);
        VF.render();
    });

    // Grain Bindings
    $('#tgl-grain').on('click', function () {
        S.cfg.grain = !S.cfg.grain;
        $(this).toggleClass('on', S.cfg.grain);
        VF.render();
    });
    $('#rng-grain').on('input', function () {
        S.cfg.grainAmt = +$(this).val();
        $('#v-grain').val(this.value);
        VF.render();
    });
    $('#v-grain').on('change input', function () {
        var val = Math.max(1, Math.min(100, +$(this).val() || 1));
        S.cfg.grainAmt = val;
        $('#rng-grain').val(val);
        VF.render();
    });

    // ── Brush Size (Selection-aware) ──
    $('#rng-brush').on('input', function () {
        S.cfg.brushSize = +$(this).val();
        $('#v-brush').val(this.value);
        if (VF.hasSelection && VF.hasSelection()) {
            VF.applyPropertyToSelection('brushSize', S.cfg.brushSize);
        }
    });
    $('#v-brush').on('change input', function () {
        var val = Math.max(1, Math.min(60, +$(this).val() || 1));
        S.cfg.brushSize = val; $('#rng-brush').val(val);
        if (VF.hasSelection && VF.hasSelection()) {
            VF.applyPropertyToSelection('brushSize', val);
        }
    });

    // ── Brush Spacing ──
    $('#rng-spacing').on('input', function () {
        S.cfg.brushSpacing = +$(this).val();
        $('#v-spacing').val(this.value);
    });
    $('#v-spacing').on('change input', function () {
        var val = Math.max(5, Math.min(200, +$(this).val() || 5));
        S.cfg.brushSpacing = val;
        $('#rng-spacing').val(val);
    });

    // ── Brush Dynamics ──
    $('#rng-rot').on('input', function () {
        S.cfg.brushRotation = +$(this).val();
        $('#v-rot').val(this.value);
    });
    $('#v-rot').on('change input', function () {
        var val = Math.max(-180, Math.min(180, +$(this).val() || 0));
        S.cfg.brushRotation = val; $('#rng-rot').val(val);
    });

    $('#rng-angjit').on('input', function () {
        S.cfg.brushAngleJitter = +$(this).val();
        $('#v-angjit').val(this.value);
    });
    $('#v-angjit').on('change input', function () {
        var val = Math.max(0, Math.min(100, +$(this).val() || 0));
        S.cfg.brushAngleJitter = val; $('#rng-angjit').val(val);
    });

    $('#rng-posjit').on('input', function () {
        S.cfg.brushPosJitter = +$(this).val();
        $('#v-posjit').val(this.value);
    });
    $('#v-posjit').on('change input', function () {
        var val = Math.max(0, Math.min(200, +$(this).val() || 0));
        S.cfg.brushPosJitter = val; $('#rng-posjit').val(val);
    });

    // ── Brush Guide Toggle ──
    $('#tgl-brush-guide').on('click', function () {
        S.cfg.showBrushGuide = !S.cfg.showBrushGuide;
        $(this).toggleClass('on', S.cfg.showBrushGuide);
    });

    var _opacityHistorySaved = false;

    $('#rng-opacity').on('pointerdown', function () { _opacityHistorySaved = false; });
    $('#v-opacity').on('focus', function () { _opacityHistorySaved = false; });

    $('#rng-opacity').on('input', function () {
        var l = VF.AL(); if (!l) return;

        // Save history once at the start of the drag
        if (!_opacityHistorySaved) {
            VF.saveHistory();
            _opacityHistorySaved = true;
        }

        l.opacity = +this.value / 100;
        $('#v-opacity').val(this.value);

        // Folders have no Paper.js layer — their opacity multiplies into
        // descendants, so a full re-render is required to apply it.
        if (VF.isFolder && VF.isFolder(l)) { VF.render(); return; }

        var pl = VF.pLayers[l.id];
        if (pl) {
            if (l.type === 'image') {
                pl.opacity = 1;
                pl.children.forEach(function (c) { c.opacity = l.opacity; });
            } else {
                pl.opacity = l.opacity;
            }
        }
        VF.view.update();
    });

    $('#v-opacity').on('change input', function () {
        var l = VF.AL(); if (!l) return;

        // Save history once at the start of typing/spinning
        if (!_opacityHistorySaved) {
            VF.saveHistory();
            _opacityHistorySaved = true;
        }

        var val = Math.max(0, Math.min(100, +$(this).val() || 0));
        l.opacity = val / 100;
        $('#rng-opacity').val(val);

        if (VF.isFolder && VF.isFolder(l)) { VF.render(); return; }

        var pl = VF.pLayers[l.id];
        if (pl) {
            if (l.type === 'image') {
                pl.opacity = 1;
                pl.children.forEach(function (c) { c.opacity = l.opacity; });
            } else {
                pl.opacity = l.opacity;
            }
        }
        VF.view.update();
    });

    // ── Stroke Color (Selection-aware) ──
    $('#clr-stroke').on('input', function () {
        S.cfg.strokeCol = this.value;
        if (VF.hasSelection && VF.hasSelection()) {
            VF.applyPropertyToSelection('strokeColor', this.value);
        }
    });

    // ── Fill Color (Selection-aware) ──
    $('#clr-fill').on('input', function () {
        S.cfg.fillCol = this.value;
        if (VF.hasSelection && VF.hasSelection()) {
            VF.applyPropertyToSelection('fillColor', this.value);
        }
    });

    // ── Texture (Selection-aware) ──
    $('#sel-tex').on('change', function () {
        S.cfg.tex = this.value;
        if (VF.hasSelection && VF.hasSelection()) {
            VF.applyPropertyToSelection('texture', this.value);
        }
    });

    /* ═══════════════════════════════════════════════════
       EYEDROPPER COLOR PICKER  (with AbortController)
       ═══════════════════════════════════════════════════
       - VF.pickScreenColor(target)  opens the picker
       - VF.abortEyeDropper()        cancels it early
       Abort is wired to canvas pointerdown so the picker
       closes automatically when a paint stroke begins.
       ═══════════════════════════════════════════════════ */

    VF._eyeDropperAbort = null;

    VF.pickScreenColor = function (targetInputId) {
        // Native screen picker (WebView2 / Windows only)
        if (window.EyeDropper) {
            VF.abortEyeDropper();
            var controller = new AbortController();
            VF._eyeDropperAbort = controller;
            new EyeDropper().open({ signal: controller.signal })
                .then(function (r) { VF._eyeDropperAbort = null; $(targetInputId).val(r.sRGBHex).trigger('input'); })
                .catch(function (e) { VF._eyeDropperAbort = null; if (e.name !== 'AbortError') console.log(e); });
            return;
        }

        // Fallback: one-shot canvas sample (macOS WKWebView / Linux WebKitGTK)
        var cvs = VF.cvs;
        VF.toast('Click the canvas to sample a color');
        cvs.style.cursor = 'crosshair';
        function sample(ev) {
            cvs.removeEventListener('pointerdown', sample, true);
            cvs.style.cursor = '';
            var rect = cvs.getBoundingClientRect();
            var x = Math.round((ev.clientX - rect.left) * (cvs.width / rect.width));
            var y = Math.round((ev.clientY - rect.top) * (cvs.height / rect.height));
            var d = cvs.getContext('2d').getImageData(x, y, 1, 1).data;
            var hex = '#' + [d[0], d[1], d[2]].map(function (n) {
                return ('0' + n.toString(16)).slice(-2);
            }).join('');
            $(targetInputId).val(hex).trigger('input');
            ev.preventDefault(); ev.stopPropagation();
        }
        cvs.addEventListener('pointerdown', sample, true);
    };

    VF.abortEyeDropper = function () {
        if (VF._eyeDropperAbort) {
            VF._eyeDropperAbort.abort();
            VF._eyeDropperAbort = null;
        }
    };

    /* Close the eyedropper whenever a canvas interaction begins
       (pointerdown fires for mouse, pen, and touch). */
    $(document).ready(function () {
        var cvs = document.getElementById('main-canvas');
        if (cvs) {
            cvs.addEventListener('pointerdown', function () {
                VF.abortEyeDropper();
            }, true);   // capture phase so it fires before Paper.js tools
        }
    });

    $('#btn-pick-stroke').on('click', function () { VF.pickScreenColor('#clr-stroke'); });
    $('#btn-pick-fill').on('click', function () { VF.pickScreenColor('#clr-fill'); });

    // Z-Order: Bring to Front / Push to Back
    $('#btn-zfront').on('click', function () {
        var items = VF.getSelectedItems();
        if (items.length === 0) { VF.toast('Select items first'); return; }
        if (VF.isLocked && VF.isLocked()) { VF.toast('Layer is locked'); return; }
        VF.saveHistory();
        items.forEach(function (item) { item.bringToFront(); });
        VF.saveFrame();
        VF.toast('Brought to front');
    });
    $('#btn-zback').on('click', function () {
        var items = VF.getSelectedItems();
        if (items.length === 0) { VF.toast('Select items first'); return; }
        if (VF.isLocked && VF.isLocked()) { VF.toast('Layer is locked'); return; }
        VF.saveHistory();
        items.reverse().forEach(function (item) { item.sendToBack(); });
        VF.saveFrame();
        VF.toast('Pushed to back');
    });

    $('#btn-play').on('click', function () { VF.togglePlay(); });
    $('#btn-next').on('click', function () { VF.goFrame(S.tl.frame + 1); });
    $('#btn-prev').on('click', function () { VF.goFrame(S.tl.frame - 1); });

    $('#btn-newlyr').on('click', function () { VF.addLayer(); VF.render(); });
    $('#btn-duplyr').on('click', function () { VF.dupLayer(S.activeId); });
    $('#btn-dellyr').on('click', function () { VF.delLayer(S.activeId); });
    $('#btn-imglyr').on('click', VF.importImg);
    $('#btn-export-png').on('click', VF.exportPNG);

    // ◆ Duplicate Keyframe
    $('#btn-add-dup').on('click', function () {
        var l = VF.AL(); if (!l) return;
        if (l.locked) { VF.toast('Layer is locked'); return; }

        VF.saveHistory();
        VF.saveFrame();

        var res = VF.getResolvedFrame(l, S.tl.frame);
        var dataToCopy = res && res.data ? JSON.parse(JSON.stringify(res.data)) : [];

        VF.selSegments = [];
        VF.clearHandles();

        // 1. If NO keyframe exists on the current frame, create it here and don't move.
        if (l.frames[S.tl.frame] === undefined) {
            l.frames[S.tl.frame] = dataToCopy;
            if (l.cache) delete l.cache[S.tl.frame];
        }
        // 2. If a keyframe ALREADY exists, move to the next frame.
        else {
            var targetF = S.tl.frame + 1;

            // If the target frame is already occupied, ripple-push the contiguous block forward
            if (l.frames[targetF] !== undefined) {
                var emptyF = targetF;
                // Find the next available empty slot
                while (l.frames[emptyF] !== undefined) {
                    emptyF++;
                }

                // Extend the timeline if the ripple pushes past the end
                if (emptyF >= S.tl.max) {
                    S.tl.max = emptyF + 1;
                    $('#pref-end, #in-endframe').val(S.tl.max);
                }

                // Shift the contiguous block to the right.
                // Loops and tweens are node-bound, so they ride along with their host frame.
                ['frames', 'loops', 'tweens'].forEach(function (m) {
                    var map = l[m]; if (!map) return;
                    for (var i = emptyF; i > targetF; i--) {
                        if (map[i - 1] !== undefined) map[i] = map[i - 1];
                        else delete map[i];
                    }
                });

                l.cache = {}; // Clear cache since frames were shifted
            } else if (targetF >= S.tl.max) {
                // If target is empty but past the timeline max, just extend the timeline
                S.tl.max = targetF + 1;
                $('#pref-end, #in-endframe').val(S.tl.max);
            }

            // Move the playhead and insert the duplicated data
            S.tl.frame = targetF;
            l.frames[S.tl.frame] = dataToCopy;
            if (l.cache) delete l.cache[S.tl.frame];

            // A freshly duplicated node starts clean — don't inherit a loop/tween
            // that the ripple may have shifted into this slot.
            if (l.loops) delete l.loops[S.tl.frame];
            if (l.tweens) delete l.tweens[S.tl.frame];
        }

        VF.render();
        VF.uiTimeline();

        if (!S.tl.playing && window.VF.playFrameAudio) {
            window.VF.playFrameAudio(S.tl.frame);
        }
    });

    // ◇ Blank Keyframe
    $('#btn-add-blank').on('click', function () {
        var l = VF.AL(); if (!l) return;
        if (l.locked) { VF.toast('Layer is locked'); return; }

        VF.saveHistory();
        VF.saveFrame();
        VF.selSegments = [];
        VF.clearHandles();

        // 1. If NO keyframe exists on the current frame, create it here and don't move.
        if (l.frames[S.tl.frame] === undefined) {
            l.frames[S.tl.frame] = [];
            if (l.cache) delete l.cache[S.tl.frame];
            if (VF.pLayers[l.id]) VF.pLayers[l.id].removeChildren();
        }
        // 2. If a keyframe ALREADY exists, move to the next frame.
        else {
            var targetF = S.tl.frame + 1;

            // If the target frame is already occupied, ripple-push the contiguous block forward
            if (l.frames[targetF] !== undefined) {
                var emptyF = targetF;
                // Find the next available empty slot
                while (l.frames[emptyF] !== undefined) {
                    emptyF++;
                }

                // Extend the timeline if the ripple pushes past the end
                if (emptyF >= S.tl.max) {
                    S.tl.max = emptyF + 1;
                    $('#pref-end, #in-endframe').val(S.tl.max);
                }

                // Shift the contiguous block to the right.
                // Loops and tweens are node-bound, so they ride along with their host frame.
                ['frames', 'loops', 'tweens'].forEach(function (m) {
                    var map = l[m]; if (!map) return;
                    for (var i = emptyF; i > targetF; i--) {
                        if (map[i - 1] !== undefined) map[i] = map[i - 1];
                        else delete map[i];
                    }
                });

                l.cache = {}; // Clear cache since frames were shifted
            } else if (targetF >= S.tl.max) {
                // If target is empty but past the timeline max, just extend the timeline
                S.tl.max = targetF + 1;
                $('#pref-end, #in-endframe').val(S.tl.max);
            }

            // Move the playhead and insert the blank keyframe
            S.tl.frame = targetF;
            l.frames[S.tl.frame] = [];
            if (l.cache) delete l.cache[S.tl.frame];
            if (VF.pLayers[l.id]) VF.pLayers[l.id].removeChildren();

            // A blank node is brand new — strip any loop/tween the ripple
            // may have shifted into this slot.
            if (l.loops) delete l.loops[S.tl.frame];
            if (l.tweens) delete l.tweens[S.tl.frame];
        }

        VF.render();
        VF.uiTimeline();

        if (!S.tl.playing && window.VF.playFrameAudio) {
            window.VF.playFrameAudio(S.tl.frame);
        }
    });

    // × Delete Keyframe
    $('#btn-del-node').on('click', function () {
        var l = VF.AL(); if (!l) return;
        if (l.locked) { VF.toast('Layer is locked'); return; }

        VF.saveHistory();
        if (l.frames[S.tl.frame] !== undefined) {
            delete l.frames[S.tl.frame];
            if (l.cache) delete l.cache[S.tl.frame];

            // The loop and tween belong to this node — removing the node
            // removes them, so they can't reactivate if a frame later
            // reoccupies this slot.
            if (l.loops) delete l.loops[S.tl.frame];
            if (l.tweens) delete l.tweens[S.tl.frame];

            // Reload resolved exposure to prevent saving a new blank frame
            VF.loadFrame(l.id, S.tl.frame);

            VF.render(); VF.uiTimeline();
        }
    });

    $('#chk-onion-isolate').on('change', function () {
        S.cfg.onionIsolate = $(this).is(':checked');
        VF.render();
    });

    /* ═══════════════════════════════════════════════════
       INLINE ONION SKIN CONTROLS  (ribbon-based)
       ═══════════════════════════════════════════════════ */

    function renderOnionUI() {
        var h = '';
        S.onions.forEach(function (sk, i) {
            h += '<div class="onion-rule-row" data-idx="' + i + '">' +
                '<select class="on-rel onion-sel">' +
                '<option value="true"' + (sk.rel ? ' selected' : '') + '>Relative</option>' +
                '<option value="false"' + (!sk.rel ? ' selected' : '') + '>Absolute</option>' +
                '</select>' +
                '<input type="number" class="on-val sm-in" value="' + sk.val + '">' +
                '<input type="range" class="on-op" min="1" max="100" value="' + sk.op + '">' +
                '<span class="on-op-label">' + sk.op + '%</span>' +
                '<select class="on-top onion-sel">' +
                '<option value="false"' + (!sk.top ? ' selected' : '') + '>Below</option>' +
                '<option value="true"' + (sk.top ? ' selected' : '') + '>Above</option>' +
                '</select>' +
                '<button class="tb on-del" style="width:18px;height:18px;font-size:12px;color:var(--warning);flex-shrink:0">×</button>' +
                '</div>';
        });

        if (S.onions.length === 0) {
            h = '<div style="font-size:10px;color:var(--text-dim);padding:8px 4px">No onion rules. Click "+ Add Rule" to add.</div>';
        }

        $('#onion-ribbon-list').html(h);

        $('.on-rel').on('change', function () {
            S.onions[$(this).closest('.onion-rule-row').data('idx')].rel = $(this).val() === 'true';
            VF.render();
        });
        $('.on-val').on('input', function () {
            S.onions[$(this).closest('.onion-rule-row').data('idx')].val = +$(this).val();
            VF.render();
        });
        $('.on-op').on('input', function () {
            var val = +$(this).val();
            var idx = $(this).closest('.onion-rule-row').data('idx');
            S.onions[idx].op = val;
            $(this).siblings('.on-op-label').text(val + '%');
            VF.render();
        });
        $('.on-top').on('change', function () {
            S.onions[$(this).closest('.onion-rule-row').data('idx')].top = $(this).val() === 'true';
            VF.render();
        });
        $('.on-del').on('click', function () {
            S.onions.splice($(this).closest('.onion-rule-row').data('idx'), 1);
            renderOnionUI();
            VF.render();
        });
    }

    VF.renderOnionUI = renderOnionUI;

    $('#btn-add-onion').on('click', function () {
        S.onions.push({ rel: true, val: -1, op: 20, top: false });
        renderOnionUI();
        VF.render();
    });

    renderOnionUI();

    // Ribbon Tab Switching
    $('.ribbon-tab').on('click', function () {
        $('.ribbon-tab').removeClass('active');
        $(this).addClass('active');
        $('.ribbon-panel').removeClass('active');
        $('#' + $(this).data('tab')).addClass('active');
        VF.fitCanvas();
    });

})();