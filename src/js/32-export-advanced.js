(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    /* ═══════════════════════════════════════════════════
       EXPORT OPTIONS STATE
       ═══════════════════════════════════════════════════ */
    VF.exportOpts = {
        gifLoop: true,
        gifColors: 256,
        gifDither: false
    };

    function getExportRange() {
        var from = Math.max(0, (+$('#export-from').val() || 1) - 1);
        var to = Math.min(S.tl.max - 1, (+$('#export-to').val() || S.tl.max) - 1);
        if (from > to) { var t = from; from = to; to = t; }
        return { from: from, to: to, count: to - from + 1 };
    }

    function getExportScale() {
        return +(($('#export-scale').val()) || 1);
    }

    /* ═══════════════════════════════════════════════════
       SHARED FRAME RENDERER
       Renders frames in a given range to off-screen
       canvases, handling all the Paper.js setup/teardown.
       ═══════════════════════════════════════════════════ */

    VF.renderExportFrames = function (onProgress) {
        var P = getP();
        var range = getExportRange();
        var scale = getExportScale();
        var fw = Math.round(S.canvas.w * scale);
        var fh = Math.round(S.canvas.h * scale);

        /* ── Save current state ── */
        var origFrame = S.tl.frame;
        var origZoom = VF.view.zoom;
        var origCenter = VF.view.center.clone();
        // Save workspace rotation
        var origRotation = VF.viewRotation || 0;

        /* ── Hide UI elements ── */
        VF.saveFrame();
        VF.clearHandles();

        var borderRect = VF.getBorderRect();
        var borderOutline = VF.getBorderOutline();

        var bgVisible = (VF.wsPrefs && !VF.wsPrefs.canvasBgTransparent);
        if (borderRect) borderRect.visible = bgVisible;
        if (borderOutline) borderOutline.visible = false;
        VF.onionLayerBg.visible = false;
        VF.onionLayerFg.visible = false;
        VF.fgLayer.visible = false;

        /* ── Hide reference layers ── */
        var hiddenRef = [];
        S.layers.forEach(function (l) {
            if (l.reference && l.vis) {
                var pl = VF.pLayers[l.id];
                if (pl) { pl.visible = false; hiddenRef.push(pl); }
            }
        });

        /* ── Hide wobble temp layers ── */
        var hiddenWobble = [];
        if (VF._wobbleTempLayers) {
            VF._wobbleTempLayers.forEach(function (tl) {
                if (tl.visible) { tl.visible = false; hiddenWobble.push(tl); }
            });
        }

        // Reset workspace rotation before rendering export frames
        if (origRotation) {
            VF.view.rotate(-origRotation, VF.view.center);
            VF.viewRotation = 0;
        }

        /* ── Set camera ── */
        VF.view.viewSize = new P.Size(S.canvas.w, S.canvas.h);
        VF.view.zoom = 1;
        VF.view.center = new P.Point(S.canvas.w / 2, S.canvas.h / 2);

        VF._exporting = true;

        var frames = [];
        var ec = document.createElement('canvas');
        ec.width = fw;
        ec.height = fh;
        var ectx = ec.getContext('2d');

        for (var i = range.from; i <= range.to; i++) {
            S.tl.frame = i;
            VF.render();

            /* ── Apply camera transform ── */
            var _cam = null;
            if (VF.hasCameraKeyframes && VF.hasCameraKeyframes()) {
                _cam = VF.getCameraAtFrame(i);
                VF.view.zoom = _cam.zoom * scale;
                VF.view.center = new P.Point(_cam.x, _cam.y);
            }

            VF.view.update();

            ectx.clearRect(0, 0, fw, fh);

            /* Opaque background for formats that need it */
            var bgCol = (VF.wsPrefs && !VF.wsPrefs.canvasBgTransparent)
                ? VF.wsPrefs.canvasBgColor : '#ffffff';
            ectx.fillStyle = bgCol;
            ectx.fillRect(0, 0, fw, fh);

            if (VF.captureWithCamera) {
                VF.captureWithCamera(_cam, VF.cvs, ectx, fw, fh);
            } else {
                ectx.drawImage(VF.cvs, 0, 0, VF.cvs.width, VF.cvs.height, 0, 0, fw, fh);
            }

            /* Copy to a fresh canvas for this frame */
            var fc = document.createElement('canvas');
            fc.width = fw;
            fc.height = fh;
            fc.getContext('2d').drawImage(ec, 0, 0);
            frames.push(fc);

            if (onProgress) onProgress(i - range.from + 1, range.count);
        }

        VF._exporting = false;

        /* ── Restore state ── */
        if (borderRect) borderRect.visible = true;
        if (borderOutline) borderOutline.visible = true;
        VF.onionLayerBg.visible = true;
        VF.onionLayerFg.visible = true;
        VF.fgLayer.visible = true;
        hiddenRef.forEach(function (pl) { pl.visible = true; });
        hiddenWobble.forEach(function (tl) { tl.visible = true; });

        S.tl.frame = origFrame;
        VF.fitCanvas();
        VF.view.zoom = origZoom;
        VF.view.center = origCenter;

        // Restore workspace rotation
        if (origRotation) {
            VF.view.rotate(origRotation, VF.view.center);
            VF.viewRotation = origRotation;
        }

        VF.render();
        VF.uiTimeline();

        return { frames: frames, width: fw, height: fh, range: range };
    };


    /* ═══════════════════════════════════════════════════
       SPRITESHEET EXPORT
       ═══════════════════════════════════════════════════ */

    VF.exportSpritesheet = function () {
        var cols = Math.max(1, +$('#export-sheet-cols').val() || 8);
        var pad = Math.max(0, +$('#export-sheet-pad').val() || 0);

        VF.toast('Rendering spritesheet...');

        /* Small delay so toast renders before heavy work */
        setTimeout(function () {
            var result = VF.renderExportFrames(null);
            var frames = result.frames;
            var fw = result.width;
            var fh = result.height;
            var count = frames.length;

            if (count === 0) { VF.toast('No frames to export'); return; }

            var rows = Math.ceil(count / cols);
            var sheetW = cols * (fw + pad) - pad;
            var sheetH = rows * (fh + pad) - pad;

            /* Cap at sane max (browsers struggle beyond ~16k) */
            if (sheetW > 16384 || sheetH > 16384) {
                VF.toast('Spritesheet too large — try fewer columns or smaller scale');
                return;
            }

            var sheet = document.createElement('canvas');
            sheet.width = sheetW;
            sheet.height = sheetH;
            var sctx = sheet.getContext('2d');

            /* Optional: fill with transparent/checkerboard */
            sctx.clearRect(0, 0, sheetW, sheetH);

            for (var i = 0; i < count; i++) {
                var col = i % cols;
                var row = Math.floor(i / cols);
                var x = col * (fw + pad);
                var y = row * (fh + pad);
                sctx.drawImage(frames[i], x, y);
            }

            var dataUrl = sheet.toDataURL('image/png');

            /* ── Save via Tauri dialog ── */
            if (window.__TAURI__) {
                var invoke = window.__TAURI__.core.invoke;
                var save = window.__TAURI__.dialog.save;

                save({
                    title: 'Export Spritesheet',
                    defaultPath: 'spritesheet_' + cols + 'x' + rows + '.png',
                    filters: [{ name: 'Image', extensions: ['png'] }]
                }).then(function (filePath) {
                    if (!filePath) return;
                    invoke('export_png', { image: dataUrl, path: filePath })
                        .then(function () {
                            VF.toast('Spritesheet saved! (' + cols + '×' + rows + ', ' + count + ' frames)');
                        })
                        .catch(function (err) { VF.toast('Export failed: ' + err); });
                }).catch(function (err) { console.error("Dialog error:", err); });
            } else {
                /* Fallback: browser download */
                downloadDataUrl(dataUrl, 'spritesheet.png');
            }
        }, 50);
    };


    /* ═══════════════════════════════════════════════════
       ┌─────────────────────────────────────────────────┐
       │           ANIMATED GIF ENCODER                  │
       │  Self-contained GIF89a encoder with:            │
       │  • Median-cut color quantization                │
       │  • Ordered dithering (optional)                 │
       │  • Standard LZW compression                     │
       │  • NETSCAPE2.0 looping extension                │
       └─────────────────────────────────────────────────┘
       ═══════════════════════════════════════════════════ */

    var GifEncoder = {};

    /* ── Byte buffer helper ── */
    function ByteBuffer() {
        this.data = [];
    }
    ByteBuffer.prototype.writeByte = function (b) { this.data.push(b & 0xFF); };
    ByteBuffer.prototype.writeShort = function (v) { this.data.push(v & 0xFF); this.data.push((v >> 8) & 0xFF); };
    ByteBuffer.prototype.writeBytes = function (arr) {
        for (var i = 0; i < arr.length; i++) this.data.push(arr[i] & 0xFF);
    };
    ByteBuffer.prototype.writeString = function (s) {
        for (var i = 0; i < s.length; i++) this.data.push(s.charCodeAt(i));
    };
    ByteBuffer.prototype.toUint8Array = function () { return new Uint8Array(this.data); };

    /* ── Median-Cut Color Quantizer ── */

    GifEncoder.quantize = function (pixels, maxColors) {
        if (maxColors < 2) maxColors = 2;
        if (maxColors > 256) maxColors = 256;

        var sampleStep = Math.max(1, Math.floor(pixels.length / (4 * 50000)));
        var colors = [];
        for (var i = 0; i < pixels.length; i += 4 * sampleStep) {
            colors.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
        }

        if (colors.length === 0) {
            var pal = [[0, 0, 0]];
            while (pal.length < maxColors) pal.push([0, 0, 0]);
            return { palette: pal, indexMap: null };
        }

        var boxes = [{ colors: colors }];

        function boxRange(box) {
            var rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
            for (var i = 0; i < box.colors.length; i++) {
                var c = box.colors[i];
                if (c[0] < rMin) rMin = c[0]; if (c[0] > rMax) rMax = c[0];
                if (c[1] < gMin) gMin = c[1]; if (c[1] > gMax) gMax = c[1];
                if (c[2] < bMin) bMin = c[2]; if (c[2] > bMax) bMax = c[2];
            }
            return {
                rRange: rMax - rMin, gRange: gMax - gMin, bRange: bMax - bMin,
                maxRange: Math.max(rMax - rMin, gMax - gMin, bMax - bMin),
                dim: (rMax - rMin >= gMax - gMin && rMax - rMin >= bMax - bMin) ? 0
                    : (gMax - gMin >= bMax - bMin) ? 1 : 2
            };
        }

        while (boxes.length < maxColors) {
            var bestIdx = -1, bestRange = -1;
            for (var b = 0; b < boxes.length; b++) {
                if (boxes[b].colors.length < 2) continue;
                var info = boxRange(boxes[b]);
                if (info.maxRange > bestRange) {
                    bestRange = info.maxRange;
                    bestIdx = b;
                }
            }
            if (bestIdx === -1 || bestRange === 0) break;

            var box = boxes[bestIdx];
            var dim = boxRange(box).dim;

            box.colors.sort(function (a, b) { return a[dim] - b[dim]; });
            var mid = Math.floor(box.colors.length / 2);

            boxes.splice(bestIdx, 1,
                { colors: box.colors.slice(0, mid) },
                { colors: box.colors.slice(mid) }
            );
        }

        var palette = boxes.map(function (box) {
            var r = 0, g = 0, b = 0, n = box.colors.length;
            for (var i = 0; i < n; i++) {
                r += box.colors[i][0]; g += box.colors[i][1]; b += box.colors[i][2];
            }
            return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
        });

        while (palette.length < maxColors) palette.push([0, 0, 0]);

        return { palette: palette };
    };

    GifEncoder.buildColorLookup = function (palette) {
        var cache = {};
        return function (r, g, b) {
            var key = (r << 16) | (g << 8) | b;
            if (cache[key] !== undefined) return cache[key];

            var bestDist = Infinity, bestIdx = 0;
            for (var i = 0; i < palette.length; i++) {
                var dr = r - palette[i][0];
                var dg = g - palette[i][1];
                var db = b - palette[i][2];
                var dist = dr * dr + dg * dg + db * db;
                if (dist < bestDist) { bestDist = dist; bestIdx = i; }
                if (dist === 0) break;
            }
            cache[key] = bestIdx;
            return bestIdx;
        };
    };

    var BAYER4 = [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5]
    ];

    GifEncoder.indexFrame = function (imageData, palette, dither) {
        var w = imageData.width, h = imageData.height;
        var px = imageData.data;
        var indices = new Uint8Array(w * h);
        var lookup = GifEncoder.buildColorLookup(palette);

        if (dither) {
            for (var y = 0; y < h; y++) {
                for (var x = 0; x < w; x++) {
                    var idx = (y * w + x) * 4;
                    var threshold = ((BAYER4[y & 3][x & 3] / 16) - 0.5) * 32;
                    var r = Math.max(0, Math.min(255, px[idx] + threshold));
                    var g = Math.max(0, Math.min(255, px[idx + 1] + threshold));
                    var b = Math.max(0, Math.min(255, px[idx + 2] + threshold));
                    indices[y * w + x] = lookup(r | 0, g | 0, b | 0);
                }
            }
        } else {
            for (var i = 0; i < w * h; i++) {
                var j = i * 4;
                indices[i] = lookup(px[j], px[j + 1], px[j + 2]);
            }
        }

        return indices;
    };

    GifEncoder.lzwEncode = function (indexStream, minCodeSize) {
        var clearCode = 1 << minCodeSize;
        var eoiCode = clearCode + 1;
        var codeSize = minCodeSize + 1;
        var nextCode = eoiCode + 1;
        var codeLimit = 1 << codeSize;

        var table = {};
        for (var i = 0; i < clearCode; i++) {
            table[String(i)] = i;
        }

        var bits = 0;
        var bitCount = 0;
        var byteBuffer = [];

        function writeBits(code, size) {
            bits |= (code << bitCount);
            bitCount += size;
            while (bitCount >= 8) {
                byteBuffer.push(bits & 0xFF);
                bits >>= 8;
                bitCount -= 8;
            }
        }

        function flushBits() {
            if (bitCount > 0) {
                byteBuffer.push(bits & 0xFF);
            }
            bits = 0;
            bitCount = 0;
        }

        function resetTable() {
            table = {};
            for (var i = 0; i < clearCode; i++) {
                table[String(i)] = i;
            }
            codeSize = minCodeSize + 1;
            nextCode = eoiCode + 1;
            codeLimit = 1 << codeSize;
        }

        writeBits(clearCode, codeSize);

        if (indexStream.length === 0) {
            writeBits(eoiCode, codeSize);
            flushBits();
            return byteBuffer;
        }

        var current = String(indexStream[0]);

        for (var p = 1; p < indexStream.length; p++) {
            var next = String(indexStream[p]);
            var combined = current + ',' + next;

            if (table[combined] !== undefined) {
                current = combined;
            } else {
                writeBits(table[current], codeSize);

                if (nextCode < 4096) {
                    table[combined] = nextCode++;
                    if (nextCode > codeLimit && codeSize < 12) {
                        codeSize++;
                        codeLimit = 1 << codeSize;
                    }
                } else {
                    writeBits(clearCode, codeSize);
                    resetTable();
                }
                current = next;
            }
        }

        writeBits(table[current], codeSize);
        writeBits(eoiCode, codeSize);
        flushBits();

        return byteBuffer;
    };

    GifEncoder.encode = function (frameCanvases, options) {
        var opts = options || {};
        var loop = opts.loop !== false;
        var maxColors = opts.colors || 256;
        var dither = opts.dither || false;
        var delay = opts.delay || 8;

        var w = frameCanvases[0].width;
        var h = frameCanvases[0].height;

        var allPixels = [];
        var frameImageData = [];

        for (var f = 0; f < frameCanvases.length; f++) {
            var ctx = frameCanvases[f].getContext('2d');
            var imgData = ctx.getImageData(0, 0, w, h);
            frameImageData.push(imgData);

            var step = Math.max(1, Math.floor(imgData.data.length / (4 * 20000)));
            for (var i = 0; i < imgData.data.length; i += 4 * step) {
                allPixels.push(imgData.data[i]);
                allPixels.push(imgData.data[i + 1]);
                allPixels.push(imgData.data[i + 2]);
                allPixels.push(255);
            }
        }

        var result = GifEncoder.quantize(new Uint8ClampedArray(allPixels), maxColors);
        var palette = result.palette;

        var palBits = 1;
        while ((1 << palBits) < palette.length) palBits++;
        var palSize = 1 << palBits;
        while (palette.length < palSize) palette.push([0, 0, 0]);

        var minCodeSize = Math.max(2, palBits);

        var buf = new ByteBuffer();

        buf.writeString('GIF89a');

        buf.writeShort(w);
        buf.writeShort(h);
        var packed = 0x80 | ((palBits - 1) & 7) | (((palBits - 1) & 7) << 4);
        buf.writeByte(packed);
        buf.writeByte(0);
        buf.writeByte(0);

        for (var c = 0; c < palSize; c++) {
            buf.writeByte(palette[c][0]);
            buf.writeByte(palette[c][1]);
            buf.writeByte(palette[c][2]);
        }

        if (loop) {
            buf.writeByte(0x21);
            buf.writeByte(0xFF);
            buf.writeByte(11);
            buf.writeString('NETSCAPE2.0');
            buf.writeByte(3);
            buf.writeByte(1);
            buf.writeShort(0);
            buf.writeByte(0);
        }

        for (var f2 = 0; f2 < frameCanvases.length; f2++) {
            buf.writeByte(0x21);
            buf.writeByte(0xF9);
            buf.writeByte(4);
            buf.writeByte(0x00);
            buf.writeShort(delay);
            buf.writeByte(0);
            buf.writeByte(0);

            buf.writeByte(0x2C);
            buf.writeShort(0);
            buf.writeShort(0);
            buf.writeShort(w);
            buf.writeShort(h);
            buf.writeByte(0);

            var indices = GifEncoder.indexFrame(frameImageData[f2], palette, dither);

            buf.writeByte(minCodeSize);
            var compressed = GifEncoder.lzwEncode(indices, minCodeSize);

            var pos = 0;
            while (pos < compressed.length) {
                var chunkSize = Math.min(255, compressed.length - pos);
                buf.writeByte(chunkSize);
                for (var b2 = 0; b2 < chunkSize; b2++) {
                    buf.writeByte(compressed[pos + b2]);
                }
                pos += chunkSize;
            }
            buf.writeByte(0);
        }

        buf.writeByte(0x3B);

        return buf.toUint8Array();
    };

    VF.GifEncoder = GifEncoder;


    /* ═══════════════════════════════════════════════════
       GIF EXPORT
       ═══════════════════════════════════════════════════ */

    VF.exportGIF = function () {
        var $btn = $('#btn-export-gif');
        var origText = $btn.html();
        $btn.prop('disabled', true).text('Rendering…');

        setTimeout(function () {
            try {
                var result = VF.renderExportFrames(function (done, total) {
                    $btn.text('Frame ' + done + '/' + total);
                });

                if (result.frames.length === 0) {
                    VF.toast('No frames to export');
                    $btn.prop('disabled', false).html(origText);
                    return;
                }

                $btn.text('Encoding GIF…');

                setTimeout(function () {
                    try {
                        var delayCs = Math.round(100 / S.tl.fps);

                        var gifBytes = GifEncoder.encode(result.frames, {
                            loop: VF.exportOpts.gifLoop,
                            colors: +(($('#export-gif-colors').val()) || 256),
                            dither: VF.exportOpts.gifDither,
                            delay: delayCs
                        });

                        var binary = '';
                        for (var i = 0; i < gifBytes.length; i++) {
                            binary += String.fromCharCode(gifBytes[i]);
                        }
                        var dataUrl = 'data:image/gif;base64,' + btoa(binary);

                        if (window.__TAURI__) {
                            var invoke = window.__TAURI__.core.invoke;
                            var save = window.__TAURI__.dialog.save;

                            save({
                                title: 'Export Animated GIF',
                                defaultPath: 'animation.gif',
                                filters: [{ name: 'GIF Image', extensions: ['gif'] }]
                            }).then(function (filePath) {
                                if (!filePath) {
                                    $btn.prop('disabled', false).html(origText);
                                    return;
                                }
                                invoke('export_png', { image: dataUrl, path: filePath })
                                    .then(function () {
                                        VF.toast('GIF exported! (' + result.frames.length + ' frames)');
                                    })
                                    .catch(function (err) { VF.toast('Export failed: ' + err); })
                                    .finally(function () {
                                        $btn.prop('disabled', false).html(origText);
                                    });
                            }).catch(function () {
                                $btn.prop('disabled', false).html(origText);
                            });
                        } else {
                            downloadDataUrl(dataUrl, 'animation.gif');
                            $btn.prop('disabled', false).html(origText);
                        }
                    } catch (err) {
                        console.error('GIF encode error:', err);
                        VF.toast('GIF encoding failed: ' + err.message);
                        $btn.prop('disabled', false).html(origText);
                    }
                }, 30);

            } catch (err) {
                console.error('GIF render error:', err);
                VF.toast('GIF export failed: ' + err.message);
                $btn.prop('disabled', false).html(origText);
            }
        }, 50);
    };


    /* ═══════════════════════════════════════════════════
       EXPORT SEQUENCE (Individual PNG frames)
       ═══════════════════════════════════════════════════ */

    VF.exportSequence = function () {
        if (!window.__TAURI__) { VF.toast('Requires Tauri desktop'); return; }

        var invoke = window.__TAURI__.core.invoke;
        var openDialog = window.__TAURI__.dialog.open;

        openDialog({
            title: 'Choose folder for PNG sequence',
            directory: true
        }).then(function (folder) {
            if (!folder) return;

            var $btn = $('#btn-export-seq');
            var origText = $btn.html();
            $btn.prop('disabled', true).text('Rendering…');

            setTimeout(function () {
                var result = VF.renderExportFrames(function (done, total) {
                    $btn.text('Frame ' + done + '/' + total);
                });

                var padLen = String(result.range.to + 1).length;

                (function saveNext(i) {
                    if (i >= result.frames.length) {
                        VF.toast('Sequence exported (' + result.frames.length + ' frames)');
                        $btn.prop('disabled', false).html(origText);
                        return;
                    }

                    var frameNum = String(result.range.from + i + 1);
                    while (frameNum.length < padLen) frameNum = '0' + frameNum;
                    var filename = 'frame_' + frameNum + '.png';
                    var path = folder + '/' + filename;
                    if (folder.indexOf('\\') > -1) path = folder + '\\' + filename;

                    var dataUrl = result.frames[i].toDataURL('image/png');

                    invoke('export_png', { image: dataUrl, path: path })
                        .then(function () { saveNext(i + 1); })
                        .catch(function (err) {
                            VF.toast('Failed at frame ' + frameNum + ': ' + err);
                            $btn.prop('disabled', false).html(origText);
                        });
                })(0);
            }, 50);
        }).catch(function (err) {
            console.error('Dialog error:', err);
        });
    };


    /* ═══════════════════════════════════════════════════
       BROWSER DOWNLOAD FALLBACK
       ═══════════════════════════════════════════════════ */

    function downloadDataUrl(dataUrl, filename) {
        var a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }


    /* ═══════════════════════════════════════════════════
       UI BINDINGS
       ═══════════════════════════════════════════════════ */

    $(document).ready(function () {

        function syncExportRange() {
            var $to = $('#export-to');
            if (+$to.val() > S.tl.max || +$to.val() < 1) {
                $to.val(S.tl.max);
            }
            var $from = $('#export-from');
            if (+$from.val() > S.tl.max) $from.val(1);
        }
        syncExportRange();

        $('#pref-end').on('change', syncExportRange);

        $('#export-from, #export-to, #export-sheet-cols, #export-sheet-pad')
            .on('keydown keyup keypress', function (e) { e.stopPropagation(); });

        $('#tgl-gif-loop').on('click', function () {
            VF.exportOpts.gifLoop = !VF.exportOpts.gifLoop;
            $(this).toggleClass('on', VF.exportOpts.gifLoop);
        });

        $('#tgl-gif-dither').on('click', function () {
            VF.exportOpts.gifDither = !VF.exportOpts.gifDither;
            $(this).toggleClass('on', VF.exportOpts.gifDither);
        });

        $('#btn-export-sheet').on('click', VF.exportSpritesheet);
        $('#btn-export-gif').on('click', VF.exportGIF);
        $('#btn-export-seq').on('click', VF.exportSequence);
    });

})();