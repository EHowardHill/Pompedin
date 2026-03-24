(function () {
    "use strict";

    var S = VF.S, P;

    // P (paper) isn't available yet; lazy-bind on first call
    function getP() { if (!P) P = VF.P; return P; }

    /* ═══════════════════════════════════════════════════
       GLOBAL SCRATCH CANVAS (For high-performance compositing)
       ═══════════════════════════════════════════════════ */
    VF._scratchTileCvs = document.createElement('canvas');
    VF._scratchTileCtx = VF._scratchTileCvs.getContext('2d', { willReadFrequently: true });

    /**
         * TEXTURE RIBBON RENDERER
         */
    VF.renderTextureRibbon = function (guidePath, texFilename, color, brushSize, extraData) {
        var P = getP();
        var tc = VF.getTintedCanvas(texFilename, color);
        if (!tc || guidePath.length < 0.5) return null;

        var texW = tc.width, texH = tc.height;
        var pathLen = guidePath.length;

        var texScale = brushSize / texH;
        var scaledW = texW * texScale;

        var seed = (extraData && extraData.seed !== undefined) ? extraData.seed : (Date.now() ^ (pathLen * 1000) | 0);
        var rot = (extraData && extraData.rot !== undefined) ? extraData.rot : (VF.S.cfg.brushRotation || 0);
        var angJit = (extraData && extraData.angJit !== undefined) ? extraData.angJit : (VF.S.cfg.brushAngleJitter !== undefined ? VF.S.cfg.brushAngleJitter : 100);
        var posJit = (extraData && extraData.posJit !== undefined) ? extraData.posJit : (VF.S.cfg.brushPosJitter || 0);

        var rand = VF.seededRandom(seed);
        var baseAngle = rot * Math.PI / 180;

        var posJitLimit = brushSize * (posJit / 100);
        var pad = brushSize * 1.5 + posJitLimit + 4; // Expand padding for jitter

        var b = guidePath.bounds;
        var x0 = b.x - pad, y0 = b.y - pad;
        var cw = Math.ceil(b.width + pad * 2);
        var ch = Math.ceil(b.height + pad * 2);

        // Pre-calculate scattered points
        var pointsData = [];
        var blotStep = Math.max(1, brushSize * (VF.S.cfg.brushSpacing / 100) || 0.5);

        for (var d2 = 0; d2 <= pathLen; d2 += blotStep) {
            var clampD = Math.min(d2, pathLen);
            var pt2 = guidePath.getPointAt(clampD);
            if (!pt2) continue;

            var currentAngle = baseAngle + (rand() - 0.5) * 2 * (angJit / 100) * Math.PI;
            var offsetX = (rand() - 0.5) * 2 * posJitLimit;
            var offsetY = (rand() - 0.5) * 2 * posJitLimit;

            pointsData.push({
                x: pt2.x - x0 + offsetX,
                y: pt2.y - y0 + offsetY,
                angle: currentAngle
            });
        }

        // ── Canvas 1 (MASK) ──
        var maskCvs = document.createElement('canvas');
        maskCvs.width = Math.max(cw, 1);
        maskCvs.height = Math.max(ch, 1);
        var maskCtx = maskCvs.getContext('2d');

        if (posJit === 0) {
            // Smooth continuous line mask for clean strokes
            maskCtx.lineCap = 'round';
            maskCtx.lineJoin = 'round';
            maskCtx.lineWidth = brushSize;
            maskCtx.strokeStyle = '#fff';
            maskCtx.beginPath();
            var maskStep = Math.max(2, pathLen / 250);
            for (var d = 0; d <= pathLen; d += maskStep) {
                var pt = guidePath.getPointAt(Math.min(d, pathLen));
                if (d === 0) maskCtx.moveTo(pt.x - x0, pt.y - y0);
                else maskCtx.lineTo(pt.x - x0, pt.y - y0);
            }
            maskCtx.stroke();
        } else {
            // Scattered circle mask to accommodate jitter
            maskCtx.fillStyle = '#fff';
            maskCtx.beginPath();
            for (var i = 0; i < pointsData.length; i++) {
                var pd = pointsData[i];
                maskCtx.moveTo(pd.x, pd.y);
                maskCtx.arc(pd.x, pd.y, brushSize / 2, 0, Math.PI * 2);
            }
            maskCtx.fill();
        }

        // ── Canvas 2 (BLOTS) ──
        var tileCvs = VF._scratchTileCvs;
        var tileCtx = VF._scratchTileCtx;
        if (tileCvs.width < maskCvs.width) tileCvs.width = maskCvs.width;
        if (tileCvs.height < maskCvs.height) tileCvs.height = maskCvs.height;

        tileCtx.clearRect(0, 0, maskCvs.width, maskCvs.height);
        tileCtx.imageSmoothingEnabled = (texScale > 0.5);

        for (var j = 0; j < pointsData.length; j++) {
            var pd2 = pointsData[j];
            tileCtx.save();
            tileCtx.translate(pd2.x, pd2.y);
            tileCtx.rotate(pd2.angle);
            tileCtx.drawImage(tc, -scaledW / 2, -brushSize / 2, scaledW, brushSize);
            tileCtx.restore();
        }

        // ── Combine ──
        maskCtx.globalCompositeOperation = 'source-in';
        maskCtx.drawImage(tileCvs, 0, 0, maskCvs.width, maskCvs.height, 0, 0, maskCvs.width, maskCvs.height);

        var raster = new P.Raster({ canvas: maskCvs, insert: false });
        if (raster.bounds.width && Math.abs(raster.bounds.width - cw) > 0.01) {
            raster.scale(cw / raster.bounds.width);
        }
        raster.position = new P.Point(x0 + cw / 2, y0 + ch / 2);

        var group = new P.Group();
        group.data = {
            isTextureStroke: true,
            tex: texFilename,
            strokeCol: color,
            brushSize: brushSize,
            seed: seed,
            rot: rot,
            angJit: angJit,
            posJit: posJit
        };
        if (extraData) Object.assign(group.data, extraData);

        var guide = guidePath.clone({ insert: false });
        guide.visible = false;
        guide.data = { isGuide: true };
        group.addChild(guide);
        group.addChild(raster);

        guidePath.remove();
        return group;
    };

    /**
     * PRESSURE TEXTURE RIBBON
     */
    VF.renderPressureTextureRibbon = function (points, texFilename, color, brushSize, extraData) {
        var P = getP();
        var tc = VF.getTintedCanvas(texFilename, color);
        if (!tc || points.length < 2) return null;

        var texW = tc.width, texH = tc.height;

        var tempPath = new P.Path({ insert: false });
        points.forEach(function (p) { tempPath.add(new P.Point(p.point.x, p.point.y)); });

        if (VF.wsPrefs && VF.wsPrefs.tabletMode === 'legacy') {
            tempPath.smooth({ type: 'continuous', factor: 0.4 });
        }
        tempPath.simplify(VF.smoothTol());

        var pathLen = tempPath.length;
        if (pathLen < 0.5) { tempPath.remove(); return null; }

        var seed = (extraData && extraData.seed !== undefined) ? extraData.seed : (Date.now() ^ (pathLen * 1000) | 0);
        var rot = (extraData && extraData.rot !== undefined) ? extraData.rot : (VF.S.cfg.brushRotation || 0);
        var angJit = (extraData && extraData.angJit !== undefined) ? extraData.angJit : (VF.S.cfg.brushAngleJitter !== undefined ? VF.S.cfg.brushAngleJitter : 100);
        var posJit = (extraData && extraData.posJit !== undefined) ? extraData.posJit : (VF.S.cfg.brushPosJitter || 0);

        var rand = VF.seededRandom(seed);
        var baseAngle = rot * Math.PI / 180;

        var widths = points.map(function (p) { return p.width; });
        function getWidthAt(d) {
            var t = (d / pathLen) * (widths.length - 1);
            var i = Math.floor(t);
            var f = t - i;
            var w0 = widths[Math.min(i, widths.length - 1)];
            var w1 = widths[Math.min(i + 1, widths.length - 1)];
            return w0 + (w1 - w0) * f;
        }

        var maxW = Math.max.apply(null, widths.concat([brushSize]));
        var posJitLimit = maxW * (posJit / 100);
        var pad = maxW * 1.5 + posJitLimit + 4; // Expanded padding for jitter

        var b = tempPath.bounds;
        var x0 = b.x - pad, y0 = b.y - pad;
        var cw = Math.ceil(b.width + pad * 2);
        var ch = Math.ceil(b.height + pad * 2);

        // Pre-calculate scattered points
        var pointsData = [];
        var avgW = widths.reduce(function (a, v) { return a + v; }, 0) / widths.length;
        var blotStep = Math.max(1, avgW * (VF.S.cfg.brushSpacing / 100) || 0.5);

        for (var d2 = 0; d2 <= pathLen; d2 += blotStep) {
            var clampD = Math.min(d2, pathLen);
            var pt2 = tempPath.getPointAt(clampD);
            if (!pt2) continue;

            var w2 = getWidthAt(clampD);
            var currentAngle = baseAngle + (rand() - 0.5) * 2 * (angJit / 100) * Math.PI;
            var localPosJitLimit = w2 * (posJit / 100); // Scale jitter to pen pressure width
            var offsetX = (rand() - 0.5) * 2 * localPosJitLimit;
            var offsetY = (rand() - 0.5) * 2 * localPosJitLimit;

            pointsData.push({
                x: pt2.x - x0 + offsetX,
                y: pt2.y - y0 + offsetY,
                angle: currentAngle,
                w: w2
            });
        }

        // ── Canvas 1 (MASK) ──
        var maskCvs = document.createElement('canvas');
        maskCvs.width = Math.max(cw, 1);
        maskCvs.height = Math.max(ch, 1);
        var maskCtx = maskCvs.getContext('2d');

        maskCtx.fillStyle = '#fff';
        maskCtx.beginPath();
        for (var i = 0; i < pointsData.length; i++) {
            var pd = pointsData[i];
            maskCtx.moveTo(pd.x, pd.y);
            maskCtx.arc(pd.x, pd.y, pd.w / 2, 0, Math.PI * 2);
        }
        maskCtx.fill();

        // ── Canvas 2 (BLOTS) ──
        var tileCvs = VF._scratchTileCvs;
        var tileCtx = VF._scratchTileCtx;
        if (tileCvs.width < maskCvs.width) tileCvs.width = maskCvs.width;
        if (tileCvs.height < maskCvs.height) tileCvs.height = maskCvs.height;
        tileCtx.clearRect(0, 0, maskCvs.width, maskCvs.height);

        var texScale = avgW / texH;
        tileCtx.imageSmoothingEnabled = (texScale > 0.5);

        for (var j = 0; j < pointsData.length; j++) {
            var pd2 = pointsData[j];
            var scaledWLocal = texW * (pd2.w / texH);

            tileCtx.save();
            tileCtx.translate(pd2.x, pd2.y);
            tileCtx.rotate(pd2.angle);
            tileCtx.drawImage(tc, -scaledWLocal / 2, -pd2.w / 2, scaledWLocal, pd2.w);
            tileCtx.restore();
        }

        // ── Combine ──
        maskCtx.globalCompositeOperation = 'source-in';
        maskCtx.drawImage(tileCvs, 0, 0, maskCvs.width, maskCvs.height, 0, 0, maskCvs.width, maskCvs.height);

        var raster = new P.Raster({ canvas: maskCvs, insert: false });
        if (raster.bounds.width && Math.abs(raster.bounds.width - cw) > 0.01) {
            raster.scale(cw / raster.bounds.width);
        }
        raster.position = new P.Point(x0 + cw / 2, y0 + ch / 2);

        var group = new P.Group();
        group.data = {
            isTextureStroke: true,
            tex: texFilename,
            strokeCol: color,
            brushSize: brushSize,
            seed: seed,
            rot: rot,
            angJit: angJit,
            posJit: posJit,
            pressurePoints: points.map(function (p) {
                return {
                    x: p.point.x, y: p.point.y,
                    angle: p.angle, width: p.width
                };
            })
        };

        var guide = tempPath.clone({ insert: false });
        guide.visible = false;
        guide.data = { isGuide: true };
        group.addChild(guide);
        group.addChild(raster);

        tempPath.remove();
        return group;
    };

})();
