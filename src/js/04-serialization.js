(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    VF.getResolvedFrame = function (layer, f) {
        var P = getP();
        if (!layer.frames) return null;
        var keys = Object.keys(layer.frames).map(Number).sort(function (a, b) { return a - b; });
        if (keys.length === 0) return null;

        var prev = -1, next = -1;
        for (var i = 0; i < keys.length; i++) {
            if (keys[i] <= f) prev = keys[i];
            if (keys[i] > f && next === -1) next = keys[i];
        }

        if (prev === -1) return null;

        // --- LOOP LOGIC ---
        if (layer.loops && layer.loops[prev] && layer.loops[prev].active && f > prev) {
            var L = layer.loops[prev];
            var elapsed = f - prev;
            var loopLen, targetF;

            if (L.mode === 'relative') {
                loopLen = L.val;
                if (loopLen > 0) {
                    targetF = Math.max(0, prev - loopLen) + ((elapsed - 1) % loopLen);
                }
            } else { // absolute
                loopLen = prev - L.val + 1;
                if (loopLen > 0) {
                    targetF = L.val + ((elapsed - 1) % loopLen);
                }
            }

            if (targetF !== undefined && targetF >= 0 && targetF !== f) {
                // Recursively fetch the target frame's data
                var loopedRes = VF.getResolvedFrame(layer, targetF);
                if (loopedRes) {
                    return { keyFrame: f, data: loopedRes.data, isTween: loopedRes.isTween, isLoop: true, loopSource: targetF };
                }
            }
        }
        // --- END LOOP LOGIC ---

        var dataA = layer.frames[prev];
        var dataB = layer.frames[next];

        if (prev === f || next === -1 || !layer.tweens || !layer.tweens[prev]) {
            return { keyFrame: prev, data: dataA };
        }

        var t = (f - prev) / (next - prev);

        if (layer.type === 'image') {
            if (!dataA.matrix || !dataB.matrix) return { keyFrame: f, data: dataA };
            var mA = new P.Matrix(dataA.matrix[0], dataA.matrix[1], dataA.matrix[2], dataA.matrix[3], dataA.matrix[4], dataA.matrix[5]).decompose();
            var mB = new P.Matrix(dataB.matrix[0], dataB.matrix[1], dataB.matrix[2], dataB.matrix[3], dataB.matrix[4], dataB.matrix[5]).decompose();

            var lerp = function (a, b, amt) { return a + (b - a) * amt; };
            var nT = new P.Point(lerp(mA.translation.x, mB.translation.x, t), lerp(mA.translation.y, mB.translation.y, t));
            var nS = new P.Point(lerp(mA.scaling.x, mB.scaling.x, t), lerp(mA.scaling.y, mB.scaling.y, t));
            var nR = lerp(mA.rotation, mB.rotation, t);
            var nSk = new P.Point(lerp(mA.skewing.x, mB.skewing.x, t), lerp(mA.skewing.y, mB.skewing.y, t));

            var m = new P.Matrix();
            m.translate(nT); m.rotate(nR); m.scale(nS); m.skew(nSk);
            return { keyFrame: f, data: { matrix: m.values }, isTween: true };
        }

        if (layer.type === 'vector') {
            if (dataA.length !== dataB.length) return { keyFrame: prev, data: dataA };

            var resultData = [];
            var lerp = function (a, b, amt) { return a + (b - a) * amt; };
            var lerpPt = function (p1, p2, amt) { return new P.Point(lerp(p1.x, p2.x, amt), lerp(p1.y, p2.y, amt)); };

            var interpolateTrees = function (itemA, itemB) {
                if (itemA.className !== itemB.className) return;

                if (itemA.className === 'Path') {
                    if (itemA.segments && itemB.segments && itemA.segments.length === itemB.segments.length) {
                        for (var i = 0; i < itemA.segments.length; i++) {
                            var sA = itemA.segments[i], sB = itemB.segments[i];
                            sA.point = lerpPt(sA.point, sB.point, t);
                            sA.handleIn = lerpPt(sA.handleIn, sB.handleIn, t);
                            sA.handleOut = lerpPt(sA.handleOut, sB.handleOut, t);
                        }
                    }
                    if (itemA.strokeWidth !== undefined && itemB.strokeWidth !== undefined) {
                        itemA.strokeWidth = lerp(itemA.strokeWidth, itemB.strokeWidth, t);
                    }
                } else if (itemA.className === 'Group' || itemA.className === 'CompoundPath') {
                    if (itemA.children && itemB.children && itemA.children.length === itemB.children.length) {
                        for (var j = 0; j < itemA.children.length; j++) {
                            interpolateTrees(itemA.children[j], itemB.children[j]);
                        }
                    }
                }
                if (itemA.matrix && itemB.matrix && !itemA.matrix.equals(itemB.matrix)) {
                    var dA = itemA.matrix.decompose();
                    var dB = itemB.matrix.decompose();
                    var mat = new P.Matrix();
                    mat.translate(lerpPt(dA.translation, dB.translation, t));
                    mat.rotate(lerp(dA.rotation, dB.rotation, t));
                    mat.scale(lerpPt(dA.scaling, dB.scaling, t));
                    mat.skew(lerpPt(dA.skewing, dB.skewing, t));
                    itemA.matrix = mat;
                }
            };

            for (var idx = 0; idx < dataA.length; idx++) {
                try {
                    var jA = dataA[idx], jB = dataB[idx];
                    if (!jB) { resultData.push(jA); continue; }

                    var pA = JSON.parse(jA), pB = JSON.parse(jB);

                    if (pA.__texStroke && pB.__texStroke) {
                        pA.size = lerp(pA.size, pB.size, t);
                        if (pA.pressurePoints && pB.pressurePoints && pA.pressurePoints.length === pB.pressurePoints.length) {
                            for (var k = 0; k < pA.pressurePoints.length; k++) {
                                var ptA = pA.pressurePoints[k], ptB = pB.pressurePoints[k];
                                ptA.x = lerp(ptA.x, ptB.x, t);
                                ptA.y = lerp(ptA.y, ptB.y, t);
                                ptA.angle = lerp(ptA.angle, ptB.angle, t);
                                ptA.width = lerp(ptA.width, ptB.width, t);
                            }
                        } else if (pA.pathJSON && pB.pathJSON) {
                            var tmpA = new P.Group({ insert: false }), tmpB = new P.Group({ insert: false });
                            var gA = tmpA.importJSON(pA.pathJSON);
                            var gB = tmpB.importJSON(pB.pathJSON);
                            interpolateTrees(gA, gB);
                            pA.pathJSON = gA.exportJSON();
                            tmpA.remove(); tmpB.remove();
                        }
                        resultData.push(JSON.stringify(pA));
                    } else {
                        var tmpA2 = new P.Group({ insert: false }), tmpB2 = new P.Group({ insert: false });
                        var gA2 = tmpA2.importJSON(jA);
                        var gB2 = tmpB2.importJSON(jB);
                        if (gA2 && gB2) {
                            interpolateTrees(gA2, gB2);
                            resultData.push(gA2.exportJSON());
                        } else {
                            resultData.push(jA);
                        }
                        tmpA2.remove(); tmpB2.remove();
                    }
                } catch (e) {
                    resultData.push(dataA[idx]);
                }
            }
            return { keyFrame: f, data: resultData, isTween: true };
        }

        return { keyFrame: prev, data: dataA };
    };

    VF.serPL = function (pl) {
        var P = getP();
        var out = [];

        pl.children.forEach(function (c) {
            if (c._isH) return;

            // --- TEXTURE STROKE GROUP ---
            if (c.data && c.data.isTextureStroke) {
                var customData = {
                    __texStroke: true,
                    tex: c.data.tex,
                    col: c.data.strokeCol,
                    size: c.data.brushSize,
                    seed: c.data.seed || 0,
                    rot: c.data.rot || 0,
                    angJit: c.data.angJit !== undefined ? c.data.angJit : 100,
                    posJit: c.data.posJit || 0
                };

                var mat = c.matrix;
                var decomp = mat.decompose();

                if (c.data.pressurePoints) {
                    customData.pressurePoints = c.data.pressurePoints.map(function (p) {
                        var mappedPt = mat.transform(new P.Point(p.x, p.y));
                        return {
                            x: mappedPt.x,
                            y: mappedPt.y,
                            angle: p.angle,
                            width: p.width * decomp.scaling.x
                        };
                    });
                } else {
                    var guide = c.children ? Array.from(c.children).find(
                        function (ch) { return ch.data && ch.data.isGuide; }
                    ) : null;

                    if (guide) {
                        var gClone = guide.clone({ insert: false });
                        gClone.transform(mat);
                        gClone.visible = true;
                        customData.pathJSON = gClone.exportJSON({ asString: true });
                    }
                }
                out.push(JSON.stringify(customData));
                return;
            }

            // --- STANDARD VECTOR ITEMS ---
            if (c.className === 'Path' || c.className === 'CompoundPath' || c.className === 'Shape' || c.className === 'Group') {
                out.push(c.exportJSON({ asString: true }));
            }
        });

        return out;
    };

    VF.desPL = function (pl, arr) {
        var P = getP();
        pl.removeChildren();
        if (!arr || !Array.isArray(arr)) return;

        arr.forEach(function (j) {
            try {
                var parsed = null;
                try { parsed = JSON.parse(j); } catch (_) { parsed = null; }

                if (parsed && parsed.__texStroke) {
                    if (parsed.pressurePoints && parsed.pressurePoints.length > 0) {
                        var pts = parsed.pressurePoints.map(function (p) {
                            return {
                                point: new P.Point(p.x, p.y),
                                angle: p.angle,
                                width: p.width
                            };
                        });
                        var grp = VF.renderPressureTextureRibbon(pts, parsed.tex, parsed.col, parsed.size, parsed);
                        if (grp) pl.addChild(grp);
                    } else if (parsed.pathJSON) {
                        var tempGroup = new P.Group({ insert: false });
                        var guidePath = tempGroup.importJSON(parsed.pathJSON);
                        if (guidePath) {
                            guidePath.remove();
                            var grp2 = VF.renderTextureRibbon(guidePath, parsed.tex, parsed.col, parsed.size, parsed);
                            if (grp2) pl.addChild(grp2);
                        }
                        tempGroup.remove();
                    }
                    return;
                }

                pl.importJSON(j);
            } catch (e) { }
        });
    };

    VF.saveFrame = function () {
        var l = VF.AL();
        if (!l) return;
        var pl = VF.pLayers[l.id]; if (!pl) return;

        var res = VF.getResolvedFrame(l, S.tl.frame);
        var targetFrame = (res && !res.isTween) ? res.keyFrame : S.tl.frame;

        if (l.type === 'vector') {
            l.frames[targetFrame] = VF.serPL(pl);
            if (!l.cache) l.cache = {};

            if (l.tweens && Object.keys(l.tweens).length > 0) l.cache = {};
            else delete l.cache[targetFrame];

        } else if (l.type === 'image') {
            var r = pl.children.find(function (c) { return c.className === 'Raster'; });
            l.frames[targetFrame] = r ? { matrix: r.matrix.values } : [];
            if (l.tweens && Object.keys(l.tweens).length > 0) l.cache = {};
        }
    };

    VF.loadFrame = function (id, f) {
        var P = getP();
        var l = S.layers.find(function (x) { return x.id === id; });
        var pl = VF.pLayers[id]; if (!l || !pl) return;

        var res = VF.getResolvedFrame(l, f);
        var data = res ? res.data : null;
        var targetFrame = res ? res.keyFrame : null;

        if (l.type === 'vector') {
            pl.removeChildren();

            if (id === S.activeId || VF._exporting) {
                VF.desPL(pl, data);
            } else {
                if (targetFrame === null) return;
                if (!l.cache) l.cache = {};

                if (l.cache[targetFrame]) {
                    var cacheData = l.cache[targetFrame];
                    var r = new P.Raster({ canvas: cacheData.cvs });
                    r.position = new P.Point(cacheData.x, cacheData.y);

                    var expectedWidth = cacheData.cvs.width / (cacheData.dpr || 1);
                    if (r.bounds.width && Math.abs(r.bounds.width - expectedWidth) > 0.01) {
                        r.scale(expectedWidth / r.bounds.width);
                    }

                    pl.addChild(r);
                } else {
                    VF.desPL(pl, data);

                    if (pl.children.length > 0) {
                        var dpr = window.devicePixelRatio || 1;

                        var oldZoom = VF.view.zoom;
                        var oldCenter = VF.view.center.clone();

                        VF.view.zoom = 1;
                        VF.view.center = new P.Point(S.canvas.w / 2, S.canvas.h / 2);
                        VF.view.update();

                        var resolution = Math.max(72, 72 * VF.view.zoom) * dpr;
                        var raster = pl.rasterize(resolution, false);

                        VF.view.zoom = oldZoom;
                        VF.view.center = oldCenter;
                        VF.view.update();

                        var cacheCvs = document.createElement('canvas');
                        cacheCvs.width = raster.canvas.width;
                        cacheCvs.height = raster.canvas.height;
                        cacheCvs.getContext('2d').drawImage(raster.canvas, 0, 0);

                        l.cache[targetFrame] = {
                            cvs: cacheCvs,
                            x: raster.position.x,
                            y: raster.position.y,
                            dpr: dpr
                        };

                        pl.removeChildren();
                        pl.addChild(raster);
                    }
                }
            }
        } else if (l.type === 'image' && l.imgData) {
            pl.removeChildren();
            if (data || l.frames[0] !== undefined) {
                var imgR = new P.Raster({ source: l.imgData });
                if (data && data.matrix) {
                    imgR.matrix = new P.Matrix(data.matrix[0], data.matrix[1], data.matrix[2], data.matrix[3], data.matrix[4], data.matrix[5]);
                } else {
                    imgR.position = new P.Point(S.canvas.w / 2, S.canvas.h / 2);
                }
                pl.addChild(imgR);
            }
        }
    };

    VF.getLayerTransform = function (layer, f) {
        var def = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
        if (!layer.transforms) return def;
        var keys = Object.keys(layer.transforms).map(Number).sort(function (a, b) { return a - b; });
        if (keys.length === 0) return def;
        if (keys.length === 1 || f <= keys[0]) return Object.assign({}, layer.transforms[keys[0]]);
        if (f >= keys[keys.length - 1]) return Object.assign({}, layer.transforms[keys[keys.length - 1]]);

        var prev = keys[0], next = keys[1];
        for (var i = 0; i < keys.length - 1; i++) {
            if (f >= keys[i] && f <= keys[i + 1]) { prev = keys[i]; next = keys[i + 1]; break; }
        }

        var t = (next === prev) ? 0 : (f - prev) / (next - prev);
        var a = layer.transforms[prev], b = layer.transforms[next];
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            scaleX: a.scaleX + (b.scaleX - a.scaleX) * t,
            scaleY: a.scaleY + (b.scaleY - a.scaleY) * t,
            rotation: a.rotation + (b.rotation - a.rotation) * t
        };
    };

})();