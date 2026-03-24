(function () {
    "use strict";

    var S = VF.S;
    VF._isDraggingTimeline = false;
    VF.tlSelection = [];

    VF.uiFrameDisp = function () {
        $('#frame-disp').text((S.tl.frame + 1) + ' / ' + S.tl.max);
    };

    VF.goFrame = function (f) {
        VF.saveFrame();
        VF.selSegments = [];
        VF.clearHandles();
        S.tl.frame = Math.max(0, Math.min(f, S.tl.max - 1));

        VF.render();
        VF.updateTimelineState();

        // Only trigger the short scrubbing snippet if the timeline is paused
        if (!S.tl.playing && window.VF.playFrameAudio) {
            VF.playFrameAudio(S.tl.frame);
        }
    };

    var playReqId = null;
    var animStartTime = 0;

    VF.togglePlay = function () {
        if (S.tl.playing) {
            // Pause playback
            cancelAnimationFrame(playReqId);
            S.tl.playing = false;
            $('#btn-play').text('▶');
            if (window.VF.stopAudio) VF.stopAudio();
        } else {
            // Start playback
            S.tl.playing = true;
            $('#btn-play').text('⏸');

            var fps = S.tl.fps;
            var maxFrames = S.tl.max;
            var A = VF.audio || {};

            // Kick off audio and reset our hardware clocks
            if (window.VF.startAudioPlayback) VF.startAudioPlayback(S.tl.frame);
            animStartTime = performance.now() - (S.tl.frame * (1000 / fps));

            function loop() {
                if (!S.tl.playing) return;

                var expectedFrame = 0;

                // Sync to hardware AudioContext clock if playing, else high-res performance timer
                if (A.buffer && A.isPlaying && A.ctx) {
                    var elapsedSec = A.ctx.currentTime - A.startTime + A.startOffset;
                    expectedFrame = Math.floor(elapsedSec * fps);
                } else {
                    var elapsedMs = performance.now() - animStartTime;
                    expectedFrame = Math.floor(elapsedMs / (1000 / fps));
                }

                // Handle looping logic
                if (expectedFrame >= maxFrames) {
                    expectedFrame = 0;
                    if (A.buffer && A.isPlaying && window.VF.startAudioPlayback) {
                        // Restart audio, which inherently resets A.startTime for the next loop
                        VF.startAudioPlayback(0);
                    } else {
                        // Reset the fallback timer
                        animStartTime = performance.now();
                    }
                }

                // Only render if the clock has crossed into a new frame boundary
                if (expectedFrame !== S.tl.frame) {
                    VF.goFrame(expectedFrame);

                    // Idle cache the upcoming frame
                    var nextN = expectedFrame + 1 >= maxFrames ? 0 : expectedFrame + 1;
                    requestIdleCallback(function () {
                        S.layers.forEach(function (layer) {
                            if (layer.id !== S.activeId && layer.type === 'vector' && layer.vis) {
                                var res = VF.getResolvedFrame(layer, nextN);
                                if (res && (!layer.cache || !layer.cache[res.keyFrame])) {
                                    VF.loadFrame(layer.id, nextN);
                                }
                            }
                        });
                    });
                }

                // Call the next browser repaint
                playReqId = requestAnimationFrame(loop);
            }

            playReqId = requestAnimationFrame(loop);
        }
    };

    VF.uiPlayhead = function () {
        var cellW = 18;
        var playheadX = S.tl.frame * cellW;

        // Move the visual yellow line
        $('#tl-playhead').css('left', (playheadX + 9) + 'px');

        // Auto-scroll the timeline container to follow the playhead
        var $scroll = $('#tl-scroll');
        if ($scroll.length === 0) return;

        var scrollLeft = $scroll.scrollLeft();
        var viewWidth = $scroll.width();

        // If playhead goes past the right edge...
        if (playheadX + cellW > scrollLeft + viewWidth) {
            // Page the timeline forward, leaving a 2-frame buffer on the left
            $scroll.scrollLeft(playheadX - (cellW * 2));
        }
        // If playhead jumps back past the left edge (e.g., when the animation loops back to 0)
        else if (playheadX < scrollLeft) {
            $scroll.scrollLeft(Math.max(0, playheadX - (cellW * 2)));
        }
    };

    VF.updateTimelineState = function () {
        // Move the yellow playhead line
        VF.uiPlayhead();

        // Update the UI text counter
        VF.uiFrameDisp();

        // Move the blue highlight class to the correct column of cells
        $('.tl-cell.cur').removeClass('cur');
        $('.tl-cell[data-f="' + S.tl.frame + '"]').addClass('cur');

        // Manage the hardware-accelerated audio waveform highlight
        var $audioHi = $('#audio-cur-highlight');
        if ($audioHi.length === 0) {
            $audioHi = $('<div id="audio-cur-highlight" style="position: absolute; top: 0; bottom: 0; width: 18px; background: rgba(74, 111, 255, 0.25); pointer-events: none; z-index: 5;"></div>');
            $('#tl-audio-row').append($audioHi);
        }
        $audioHi.css('left', (S.tl.frame * 18) + 'px');
    };

    VF.uiTimeline = function () {
        if (VF._isDraggingTimeline) return;

        var max = S.tl.max, cur = S.tl.frame;
        var audioFrames = (VF.audio && VF.audio.waveformData) ? VF.audio.waveformData.length : 0;
        var displayMax = Math.max(max, audioFrames);

        var rh = '';
        for (var i = 0; i < displayMax; i++) {
            var lb = (i % 5 === 0) ? (i + 1) : ((i + 1) % 2 === 0 ? '·' : '');
            var isOOB = i >= max ? ' opacity: 0.4;' : '';
            rh += '<div class="tl-rc" data-f="' + i + '" style="' + isOOB + '">' + lb + '</div>';
        }
        $('#tl-ruler').html(rh);

        var TAG_COLORS = VF.TAG_COLORS || {};
        var lh = '';

        // NEW: Inject a 16px spacer to perfectly mirror the timeline ruler on the right
        lh += '<div style="height: 16px; position: sticky; top: 0; background: var(--bg-panel); z-index: 11; border-bottom: 1px solid var(--border);"></div>';

        // Audio goes first to match #tl-audio-row sitting above #tl-rows
        lh += '<div class="tl-audio-label"><i class="fa-solid fa-music"></i> Audio</div>';
        if (VF.buildCameraTimelineLabel) lh += VF.buildCameraTimelineLabel();

        [].concat(S.layers).sort(function (a, b) { return b.z - a.z; }).forEach(function (l) {
            var icon = l.type === 'image' ? '🖼 ' : '';
            var tag = l.colorTag || 'none';
            var tagStyle = tag !== 'none' && TAG_COLORS[tag] ? ' data-tag="' + tag + '" style="--tag-color:' + TAG_COLORS[tag] + '"' : '';

            // Frame keys track
            lh += '<div class="tl-llbl"' + tagStyle + '>' + icon + l.name + '</div>';
            // Tween transforms track
            lh += '<div class="tl-llbl" style="background:var(--bg-hover); padding-left:20px; font-size:9px; color:var(--text-dim); border-left: 3px solid transparent">↳ Transform</div>';
        });
        $('#tl-labels').html(lh);

        var rows = '';
        if (VF.buildCameraTimelineRow) rows += VF.buildCameraTimelineRow();
        [].concat(S.layers).sort(function (a, b) { return b.z - a.z; }).forEach(function (l) {

            // Frame Cells
            var cells = '';
            var activeKey = null;
            for (var i = 0; i < max; i++) {
                var cc = i === cur ? ' cur' : '';
                var isKey = l.frames[i] !== undefined;
                if (isKey) activeKey = i;
                var content = '';
                if (isKey) {
                    var twCls = (l.tweens && l.tweens[i]) ? ' tween' : '';
                    // Check if this node is in our selection array
                    var selCls = VF.tlSelection.find(function (s) { return s.f === i && s.l === l.id && s.type === 'draw'; }) ? ' tl-selected' : '';
                    content = '<div class="tl-dot keyframe' + twCls + selCls + '" data-f="' + i + '" data-l="' + l.id + '"></div>';
                } else if (activeKey !== null) {
                    content = '<div class="tl-exposure"></div>';
                }
                cells += '<div class="tl-cell' + cc + '" data-f="' + i + '" data-l="' + l.id + '" style="position:relative">' + content + '</div>';
            }
            rows += '<div class="tl-row" data-l="' + l.id + '">' + cells + '</div>';

            // Transform / Tween Cells
            if (!l.transforms) l.transforms = {};
            var tCells = '';
            for (var i = 0; i < max; i++) {
                var cc = i === cur ? ' cur' : '';
                var isTKey = l.transforms[i] !== undefined;
                var tSelCls = VF.tlSelection.find(function (s) { return s.f === i && s.l === l.id && s.type === 'transform'; }) ? ' tl-selected' : '';
                var content = isTKey ? '<div class="tl-dot keyframe tween' + tSelCls + '" data-f="' + i + '" data-l="' + l.id + '" data-type="transform" style="background:var(--success); border-color:var(--success); transform:rotate(0); border-radius:1px; width:6px; height:6px; left:5px; top:6px;"></div>' : '';
                tCells += '<div class="tl-cell' + cc + '" data-f="' + i + '" data-l="' + l.id + '" data-type="transform" style="position:relative">' + content + '</div>';
            }
            rows += '<div class="tl-row" data-l="' + l.id + '" data-type="transform" style="background:var(--bg-hover)">' + tCells + '</div>';
        });
        $('#tl-rows').html(rows);

        $('#tl-grid').css('min-width', (displayMax * 18) + 'px');
        VF.uiPlayhead();

        if (VF.renderAudioWaveform) VF.renderAudioWaveform();

        // Calculate and apply the scroll offset
        VF.syncTimelineScrollbar();
    };

    // Dynamically pad the left labels so its scroll limit perfectly matches the right grid
    VF.syncTimelineScrollbar = function () {
        var scrollEl = document.getElementById('tl-scroll');
        if (!scrollEl) return;

        // Calculate if the horizontal scrollbar is present, and how tall it is
        var hScrollHeight = scrollEl.offsetHeight - scrollEl.clientHeight;

        // Apply it as bottom padding to the labels container
        $('#tl-labels').css('padding-bottom', hScrollHeight + 'px');
    };

    var ctxL = null, ctxF = null, ctxType = null;

    function showCtx(x, y, l, f, type) {
        ctxL = l; ctxF = f; ctxType = type || 'draw';

        var $menu = $('#dot-ctx');
        $menu.css({ left: -9999, top: -9999, display: 'block' });

        // Selectively show options depending on track
        if (ctxType === 'transform') {
            $menu.find('.ctx-i').show();
            $menu.find('[data-act="toggle-loop"], [data-act="toggle-tween"], [data-act="insert-frame"], [data-act="remove-frame"], [data-act="clear-exposure"]').hide();
        } else {
            $menu.find('.ctx-i').show();
        }

        var mw = $menu.outerWidth();
        var mh = $menu.outerHeight();
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var pad = 4;

        if (x + mw + pad > vw) x = vw - mw - pad;
        if (y + mh + pad > vh) y = vh - mh - pad;

        if (x < pad) x = pad;
        if (y < pad) y = pad;

        $menu.css({ left: x, top: y });
    }

    $(document).ready(function () {
        var $tlRows = $('#tl-rows');
        var $tlRuler = $('#tl-ruler');
        var $dotCtx = $('#dot-ctx');

        $tlRows.on('click', '.tl-cell', function (e) {
            if (_wasMarqueeDragging) return; // Block click if we just finished drawing a selection box
            if (e.button !== 0) return;

            var f = +$(this).data('f');
            var l = $(this).data('l'); // can be '__camera' or layer ID
            var type = $(this).data('type') || 'draw';
            var $dot = $(this).find('.tl-dot');

            // Shift+Click: 2D Range Select across layers and frames
            if (e.shiftKey && VF.tlSelection.length > 0) {
                var lastSel = VF.tlSelection[VF.tlSelection.length - 1];

                var minF = Math.min(lastSel.f, f);
                var maxF = Math.max(lastSel.f, f);

                // Find the index of lastSel.l and current l in the rendered DOM order
                var $rows = $('.tl-row');
                var r1 = $rows.index($('.tl-row[data-l="' + lastSel.l + '"]').filter(function () { return ($(this).data('type') || 'draw') === lastSel.type }));
                var r2 = $rows.index($('.tl-row[data-l="' + l + '"]').filter(function () { return ($(this).data('type') || 'draw') === type }));

                if (r1 > -1 && r2 > -1) {
                    var minR = Math.min(r1, r2);
                    var maxR = Math.max(r1, r2);

                    for (var r = minR; r <= maxR; r++) {
                        var $row = $rows.eq(r);
                        var rl = $row.data('l');
                        var rtype = $row.data('type') || 'draw';

                        for (var frame = minF; frame <= maxF; frame++) {
                            // Verify keyframe exists
                            var isValid = false;
                            if (rl === '__camera') {
                                isValid = VF.S.camera && VF.S.camera.frames[frame] !== undefined;
                            } else {
                                var lyr = VF.S.layers.find(function (x) { return x.id === rl; });
                                if (lyr) {
                                    if (rtype === 'transform') isValid = lyr.transforms && lyr.transforms[frame] !== undefined;
                                    else isValid = lyr.frames[frame] !== undefined;
                                }
                            }

                            if (isValid) {
                                var existing = VF.tlSelection.findIndex(function (s) { return s.f === frame && s.l === rl && s.type === rtype; });
                                if (existing === -1) VF.tlSelection.push({ f: frame, l: rl, type: rtype });
                            }
                        }
                    }
                    VF.uiTimeline();
                }
                return;
            }

            // Ctrl/Cmd+Click: Toggle Selection
            if (e.ctrlKey || e.metaKey) {
                if ($dot.length === 0) return;
                var selIdx = VF.tlSelection.findIndex(function (s) { return s.f === f && s.l === l && s.type === type; });
                if (selIdx > -1) {
                    VF.tlSelection.splice(selIdx, 1);
                    $dot.removeClass('tl-selected');
                } else {
                    VF.tlSelection.push({ f: f, l: l, type: type });
                    $dot.addClass('tl-selected');
                }
                return;
            }

            // Normal Click: Single select or clear
            if ($(e.target).hasClass('tl-dot')) {
                VF.tlSelection = [{ f: f, l: l, type: type }];
                $('.tl-dot').removeClass('tl-selected');
                $dot.addClass('tl-selected');
            } else {
                VF.tlSelection = [];
                $('.tl-dot').removeClass('tl-selected');
            }

            VF.goFrame(f);
        });

        $tlRuler.on('click', '.tl-rc', function (e) {
            if (e.button !== 0) return;
            VF.goFrame(+$(this).data('f'));
        });

        $tlRows.on('contextmenu', '.tl-cell', function (e) {
            e.preventDefault(); e.stopPropagation();
            var cellL = $(this).data('l');
            if (cellL === '__camera') return; // Handled by camera's own context menu
            S.tl.frame = +$(this).data('f');
            VF.render(); VF.uiPlayhead();
            showCtx(e.clientX, e.clientY, +cellL, +$(this).data('f'), $(this).data('type'));
        });

        $(document).on('click', function () { $dotCtx.hide(); });

        $dotCtx.on('click', '.ctx-i', function () {
            var act = $(this).data('act');
            if (ctxL === '__camera') { $dotCtx.hide(); return; }
            var layer = S.layers.find(function (x) { return x.id === ctxL; });
            if (!layer) return;

            var res = VF.getResolvedFrame(layer, ctxF);
            if (!layer.cache) layer.cache = {};

            if (act === 'copy-frame') {
                if (ctxType === 'transform') {
                    var t = VF.getLayerTransform(layer, ctxF);
                    S.clipTransform = Object.assign({}, t);
                    VF.toast('Transform keyframe copied');
                } else {
                    S.clip = res && res.data ? JSON.parse(JSON.stringify(res.data)) : null;
                    VF.toast(S.clip ? 'Keyframe copied' : 'Blank frame copied');
                }
            } else {
                if (layer.locked && act !== 'copy-frame') {
                    VF.toast('Layer is locked');
                    $dotCtx.hide();
                    return;
                }

                VF.saveHistory();

                if (act === 'toggle-loop') {
                    if (res && res.data) res.data._loop = !res.data._loop;
                }
                else if (act === 'toggle-tween') {
                    if (layer.frames[ctxF] === undefined) return;
                    if (!layer.tweens) layer.tweens = {};
                    layer.tweens[ctxF] = !layer.tweens[ctxF];
                    layer.cache = {};
                    VF.toast(layer.tweens[ctxF] ? 'Tweening enabled' : 'Tweening disabled');
                }
                else if (act === 'delete-keyframe') {
                    if (ctxType === 'transform') {
                        if (layer.transforms && layer.transforms[ctxF] !== undefined) {
                            delete layer.transforms[ctxF];
                            VF.render(); VF.uiTimeline();
                        }
                    } else {
                        if (layer.frames[ctxF] !== undefined) {
                            delete layer.frames[ctxF];
                            delete layer.cache[ctxF];
                            if (ctxF === S.tl.frame) VF.loadFrame(layer.id, S.tl.frame);
                        }
                    }
                }
                else if (act === 'clear-exposure') {
                    layer.frames[ctxF] = [];
                    delete layer.cache[ctxF];
                    if (ctxF === S.tl.frame) VF.loadFrame(layer.id, S.tl.frame);
                }
                else if (act === 'paste-frame') {
                    if (ctxType === 'transform') {
                        if (S.clipTransform) {
                            if (!layer.transforms) layer.transforms = {};
                            layer.transforms[ctxF] = Object.assign({}, S.clipTransform);
                        }
                    } else {
                        layer.frames[ctxF] = S.clip ? JSON.parse(JSON.stringify(S.clip)) : [];
                        delete layer.cache[ctxF];
                    }
                }
                else if (act === 'insert-frame') {
                    layer.cache = {};
                    for (var i = S.tl.max - 1; i > ctxF; i--) {
                        if (layer.frames[i - 1] !== undefined) {
                            layer.frames[i] = layer.frames[i - 1];
                        } else {
                            delete layer.frames[i];
                        }
                    }
                    delete layer.frames[ctxF];
                }
                else if (act === 'remove-frame') {
                    layer.cache = {};
                    for (var i2 = ctxF; i2 < S.tl.max - 1; i2++) {
                        if (layer.frames[i2 + 1] !== undefined) {
                            layer.frames[i2] = layer.frames[i2 + 1];
                        } else {
                            delete layer.frames[i2];
                        }
                    }
                    delete layer.frames[S.tl.max - 1];
                }
            }
            VF.render();
            VF.uiTimeline();
            $dotCtx.hide();
        });

        // ── Drag Core (Keyframes & Marquee) ──
        var tlDrag = null;
        var marqueeDrag = null;
        var _wasMarqueeDragging = false;

        $tlRows.on('pointerdown', '.tl-dot.keyframe', function (e) {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            var $cell = $(this).closest('.tl-cell');
            var type = $(this).data('type') || 'draw';
            var f = +$cell.data('f');
            var l = $cell.data('l');
            if (l !== '__camera') l = +l;

            // If clicked node isn't in selection, select it exclusively
            var inSel = VF.tlSelection.find(function (s) { return s.f === f && s.l === l && s.type === type; });
            if (!inSel) {
                VF.tlSelection = [{ f: f, l: l, type: type }];
                $('.tl-dot').removeClass('tl-selected');
                $(this).addClass('tl-selected');
            }

            tlDrag = {
                f: f,
                l: l,
                type: type,
                el: $(this),
                startX: e.clientX,
                startY: e.clientY,
                isDragging: false,
                ghost: null,
                targetCell: null,
                invalid: false,
                selection: VF.tlSelection.slice()
            };
        });

        $tlRows.on('pointerdown', function (e) {
            if (e.button !== 0) return;
            if ($(e.target).closest('.tl-dot').length) return; // Handled by tlDrag
            if ($(e.target).closest('.tl-rc, #tl-ruler').length) return; // Handled by ruler

            e.preventDefault();

            var gridRect = $('#tl-grid')[0].getBoundingClientRect();
            var scrollLeft = $('#tl-scroll').scrollLeft();
            var scrollTop = $('#tl-scroll').scrollTop();

            var baseSelection = [];
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                baseSelection = VF.tlSelection.slice();
            } else {
                VF.tlSelection = [];
                $('.tl-dot').removeClass('tl-selected');
            }

            marqueeDrag = {
                startXGlobal: e.clientX,
                startYGlobal: e.clientY,
                gridX: e.clientX - gridRect.left,
                gridY: e.clientY - gridRect.top,
                isDragging: false,
                $box: $('#tl-marquee'),
                baseSelection: baseSelection,
                rowsInfo: []
            };

            // Pre-calculate row vertical bounds for extreme performance
            $('.tl-row').each(function () {
                var r = this.getBoundingClientRect();
                marqueeDrag.rowsInfo.push({
                    top: r.top,
                    bottom: r.bottom,
                    l: $(this).data('l'),
                    type: $(this).data('type') || 'draw'
                });
            });
        });

        $(window).on('pointermove', function (e) {

            // ── MARQUEE DRAG ──
            if (marqueeDrag) {
                var mdx = e.clientX - marqueeDrag.startXGlobal;
                var mdy = e.clientY - marqueeDrag.startYGlobal;

                if (!marqueeDrag.isDragging) {
                    if (Math.abs(mdx) > 4 || Math.abs(mdy) > 4) {
                        marqueeDrag.isDragging = true;
                        VF._isDraggingTimeline = true;
                        if (marqueeDrag.$box.length === 0) {
                            marqueeDrag.$box = $('<div id="tl-marquee" class="tl-marquee"></div>').appendTo('#tl-grid');
                        }
                        marqueeDrag.$box.show();
                    }
                }

                if (marqueeDrag.isDragging) {
                    var gridRect = $('#tl-grid')[0].getBoundingClientRect();
                    var curGridX = e.clientX - gridRect.left;
                    var curGridY = e.clientY - gridRect.top;

                    var left = Math.min(marqueeDrag.gridX, curGridX);
                    var top = Math.min(marqueeDrag.gridY, curGridY);
                    var width = Math.abs(curGridX - marqueeDrag.gridX);
                    var height = Math.abs(curGridY - marqueeDrag.gridY);

                    marqueeDrag.$box.css({ left: left, top: top, width: width, height: height });

                    var mLeft = Math.min(e.clientX, marqueeDrag.startXGlobal);
                    var mRight = Math.max(e.clientX, marqueeDrag.startXGlobal);
                    var mTop = Math.min(e.clientY, marqueeDrag.startYGlobal);
                    var mBottom = Math.max(e.clientY, marqueeDrag.startYGlobal);

                    var fStart = Math.max(0, Math.floor((mLeft - gridRect.left) / 18));
                    var fEnd = Math.max(0, Math.floor((mRight - gridRect.left) / 18));

                    var tempSelection = marqueeDrag.baseSelection.slice();

                    for (var i = 0; i < marqueeDrag.rowsInfo.length; i++) {
                        var r = marqueeDrag.rowsInfo[i];
                        // If vertical bounds intersect
                        if (r.bottom > mTop && r.top < mBottom) {
                            for (var f = fStart; f <= fEnd; f++) {
                                var isValid = false;
                                if (r.l === '__camera') {
                                    isValid = VF.S.camera && VF.S.camera.frames[f] !== undefined;
                                } else {
                                    var lyr = VF.S.layers.find(function (x) { return x.id === r.l; });
                                    if (lyr) {
                                        if (r.type === 'transform') isValid = lyr.transforms && lyr.transforms[f] !== undefined;
                                        else isValid = lyr.frames[f] !== undefined;
                                    }
                                }

                                if (isValid) {
                                    var exists = tempSelection.find(function (s) { return s.f === f && s.l === r.l && s.type === r.type; });
                                    if (!exists) tempSelection.push({ f: f, l: r.l, type: r.type });
                                }
                            }
                        }
                    }

                    VF.tlSelection = tempSelection;
                    $('.tl-dot').removeClass('tl-selected');
                    VF.tlSelection.forEach(function (sel) {
                        var qType = sel.type === 'transform' ? '[data-type="transform"]' : ':not([data-type="transform"])';
                        $('.tl-row[data-l="' + sel.l + '"]' + qType + ' .tl-cell[data-f="' + sel.f + '"] .tl-dot').addClass('tl-selected');
                    });
                }
            }

            // ── NODE DRAG ──
            if (!tlDrag) return;

            if (!tlDrag.isDragging) {
                var dist = Math.abs(e.clientX - tlDrag.startX) + Math.abs(e.clientY - tlDrag.startY);
                if (dist > 4) {
                    tlDrag.isDragging = true;
                    VF._isDraggingTimeline = true;

                    tlDrag.ghost = tlDrag.el.clone().css({
                        position: 'fixed',
                        pointerEvents: 'none',
                        zIndex: 9999,
                        opacity: 0.9,
                        transform: 'rotate(45deg) scale(1.3)'
                    }).appendTo('body');

                    $('.tl-selected').css('opacity', '0.2');
                }
            }

            if (tlDrag.isDragging) {
                tlDrag.ghost.css({ left: e.clientX - 4, top: e.clientY - 4 });
                $('.tl-cell').css('background', '');

                tlDrag.ghost.hide();
                var target = document.elementFromPoint(e.clientX, e.clientY);
                tlDrag.ghost.show();

                var $targetCell = $(target).closest('.tl-cell');

                if ($targetCell.length) {
                    var tType = $targetCell.data('type') || 'draw';
                    if (tType !== tlDrag.type) $targetCell = $();
                }

                if ($targetCell.length) {
                    var tf = +$targetCell.data('f');
                    var tl = $targetCell.data('l');
                    if (tl !== '__camera') tl = +tl;

                    if (tf !== tlDrag.f || tl !== tlDrag.l) {
                        var df = tf - tlDrag.f;
                        var dl = 0;

                        var sortedLayers = [].concat(S.layers).sort(function (a, b) { return b.z - a.z; });
                        if (tl !== '__camera' && tlDrag.l !== '__camera') {
                            var srcIdx = sortedLayers.findIndex(function (x) { return x.id === tlDrag.l; });
                            var tgtIdx = sortedLayers.findIndex(function (x) { return x.id === tl; });
                            dl = tgtIdx - srcIdx;
                        }

                        var collision = false;
                        var oob = false;

                        // Check collision and bounds for ALL selected dragged nodes
                        for (var i = 0; i < tlDrag.selection.length; i++) {
                            var sel = tlDrag.selection[i];
                            if (sel.l === '__camera' && tl !== '__camera') { collision = true; break; }
                            if (sel.l !== '__camera' && tl === '__camera') { collision = true; break; }

                            var newF = sel.f + df;
                            if (newF < 0 || newF >= S.tl.max) { oob = true; break; }

                            var newL = sel.l;
                            if (sel.l !== '__camera') {
                                var selIdx = sortedLayers.findIndex(function (x) { return x.id === sel.l; });
                                var newIdx = selIdx + dl;
                                if (newIdx < 0 || newIdx >= sortedLayers.length) { oob = true; break; }
                                newL = sortedLayers[newIdx].id;
                            }

                            // Verify collision against non-selected existing keys
                            var inSel = tlDrag.selection.find(function (s) { return s.f === newF && s.l === newL && s.type === sel.type; });
                            if (!inSel) {
                                if (newL === '__camera') {
                                    if (S.camera && S.camera.frames && S.camera.frames[newF] !== undefined) { collision = true; break; }
                                } else {
                                    var layer = S.layers.find(function (x) { return x.id === newL; });
                                    if (layer) {
                                        if (sel.type === 'transform') {
                                            if (layer.transforms && layer.transforms[newF] !== undefined) { collision = true; break; }
                                        } else {
                                            if (layer.frames && layer.frames[newF] !== undefined) { collision = true; break; }
                                        }
                                    }
                                }
                            }
                        }

                        if (collision || oob) {
                            $targetCell.css('background', 'rgba(218, 42, 0, 0.2)'); // Invalid red
                            tlDrag.targetCell = null;
                            tlDrag.invalid = true;
                        } else {
                            $targetCell.css('background', 'var(--bg-active)');
                            tlDrag.targetCell = { f: tf, l: tl };
                            tlDrag.dropDelta = { df: df, dl: dl };
                            tlDrag.invalid = false;
                        }
                    } else {
                        tlDrag.targetCell = null;
                        tlDrag.invalid = false;
                    }
                } else {
                    tlDrag.targetCell = null;
                    tlDrag.invalid = false;
                }
            }
        });

        $(window).on('pointerup', function (e) {

            // ── CLEAR MARQUEE ──
            if (marqueeDrag) {
                if (marqueeDrag.isDragging) {
                    marqueeDrag.$box.hide();
                    VF._isDraggingTimeline = false;
                    _wasMarqueeDragging = true;
                    // Reset barrier shortly after to allow normal clicks again
                    setTimeout(function () { _wasMarqueeDragging = false; }, 50);
                }
                marqueeDrag = null;
            }

            // ── CLEAR NODE DRAG ──
            if (!tlDrag) return;

            if (!tlDrag.isDragging) {
                VF.goFrame(tlDrag.f);
            } else {
                if (tlDrag.targetCell && !tlDrag.invalid) {
                    VF.saveHistory();
                    var sortedLayers = [].concat(S.layers).sort(function (a, b) { return b.z - a.z; });
                    var df = tlDrag.dropDelta.df;
                    var dl = tlDrag.dropDelta.dl;

                    var moves = [];

                    // 1. Extract all original data to avoid mid-process overwrite destruction
                    tlDrag.selection.forEach(function (sel) {
                        var newF = sel.f + df;
                        var newL = sel.l;
                        if (sel.l !== '__camera') {
                            var selIdx = sortedLayers.findIndex(function (x) { return x.id === sel.l; });
                            newL = sortedLayers[selIdx + dl].id;
                        }

                        var data = null;
                        if (sel.l === '__camera') {
                            data = S.camera.frames[sel.f];
                            delete S.camera.frames[sel.f];
                        } else {
                            var lyr = S.layers.find(function (x) { return x.id === sel.l; });
                            if (sel.type === 'transform') {
                                data = lyr.transforms[sel.f];
                                delete lyr.transforms[sel.f];
                            } else {
                                data = lyr.frames[sel.f];
                                delete lyr.frames[sel.f];
                                if (lyr.cache) delete lyr.cache[sel.f];
                            }
                        }
                        moves.push({ f: newF, l: newL, type: sel.type, data: data });
                    });

                    // 2. Place all extracted data into new slots
                    var newSelection = [];
                    moves.forEach(function (m) {
                        if (m.l === '__camera') {
                            if (!S.camera) S.camera = { frames: {} };
                            S.camera.frames[m.f] = m.data;
                        } else {
                            var lyr = S.layers.find(function (x) { return x.id === m.l; });
                            if (m.type === 'transform') {
                                if (!lyr.transforms) lyr.transforms = {};
                                lyr.transforms[m.f] = m.data;
                            } else {
                                lyr.frames[m.f] = m.data;
                                if (lyr.cache) delete lyr.cache[m.f];
                            }
                        }
                        newSelection.push({ f: m.f, l: m.l, type: m.type });
                    });

                    VF.tlSelection = newSelection;
                    S.tl.frame = tlDrag.targetCell.f;

                    // Reload active frame for all layers since underlying data shifted
                    S.layers.forEach(function (lyr) {
                        VF.loadFrame(lyr.id, S.tl.frame);
                    });
                }

                $('.tl-cell').css('background', '');
                $('.tl-selected').css('opacity', '1');
                if (tlDrag.ghost) tlDrag.ghost.remove();

                VF._isDraggingTimeline = false;
                VF.uiTimeline();
                VF.render();
            }

            tlDrag = null;
        });

        // ── SYNC TIMELINE LABELS & ROWS ──
        var $tlLabels = $('#tl-labels');
        var $tlScroll = $('#tl-scroll');

        // Sync vertical scrolling so the rows and labels never decouple
        $tlScroll.on('scroll', function () {
            $tlLabels.scrollTop($(this).scrollTop());
        });

        // Allow scrolling the timeline when hovering over the label area
        $tlLabels.on('wheel', function (e) {
            var currentScroll = $tlScroll.scrollTop();
            $tlScroll.scrollTop(currentScroll + e.originalEvent.deltaY);
            e.preventDefault();
        });

        $(window).on('resize', function () {
            if (VF.syncTimelineScrollbar) VF.syncTimelineScrollbar();
        });
    });

})();