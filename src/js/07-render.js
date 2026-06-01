(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    function tintTree(item, tintColor, skinOpacity) {
        if (!item) return;

        if (item.className === 'Raster') {
            item.opacity = skinOpacity * 0.6;
            return;
        }

        if (item.strokeColor) {
            var sc = tintColor.clone();
            sc.alpha = skinOpacity;
            item.strokeColor = sc;
        }
        if (item.fillColor) {
            var fc = tintColor.clone();
            fc.alpha = skinOpacity * 0.3;
            item.fillColor = fc;
        }

        if (item.children) {
            var kids = item.children.slice();
            kids.forEach(function (child) { tintTree(child, tintColor, skinOpacity); });
        }
    }

    VF.render = function () {
        var P = getP();
        var f = S.tl.frame;

        VF.onionLayerBg.removeChildren();
        VF.onionLayerFg.removeChildren();

        var sorted = VF.flattenDrawables();   // drawables only, back -> front
        sorted.forEach(function (l, i) {
            if (VF.ensureLayerSettings) VF.ensureLayerSettings(l);
            var pl = VF.pLayers[l.id]; if (!pl) return;
            pl.visible = VF.isLayerRenderable(l, f);   // <-- was l.vis
            VF.loadFrame(l.id, f);

            var groupMult = VF.ancestorOpacity ? VF.ancestorOpacity(l) : 1;
            if (l.type === 'image') {
                pl.opacity = 1;
                pl.children.forEach(function (c) { c.opacity = l.opacity * groupMult; });
            } else {
                pl.opacity = l.opacity * groupMult;
            }

            if (VF.applyBlendMode) VF.applyBlendMode(l, pl);

            // ── Apply Layer-Level Matrix Transformations ──
            if (VF.getLayerTransform) {
                var xf = VF.getLayerTransform(l, f);
                var cx = S.canvas.w / 2, cy = S.canvas.h / 2;
                var m = new P.Matrix();
                m.translate(cx + xf.x, cy + xf.y);
                m.rotate(xf.rotation);
                m.scale(xf.scaleX, xf.scaleY);
                m.translate(-cx, -cy);

                // IMPORTANT Prevent Paper.js from baking this transform into the children's 
                // native coordinates, which causes the timeline accumulation bug.
                pl.applyMatrix = false;
                pl.matrix = m;
            }

            if (i === 0) pl.insertAbove(VF.onionLayerBg);
            else pl.insertAbove(VF.pLayers[sorted[i - 1].id]);
        });

        if (S.cfg.onion && !S.tl.playing) {

            var oldZoom = VF.view.zoom;
            var oldCenter = VF.view.center.clone();
            VF.view.zoom = 1;
            VF.view.center = new P.Point(S.canvas.w / 2, S.canvas.h / 2);
            VF.view.update();

            S.onions.forEach(function (skin) {
                var targetF = skin.rel ? f + skin.val : skin.val - 1;
                if (targetF < 0 || targetF >= S.tl.max || targetF === f) return;

                var isFuture = skin.rel ? skin.val > 0 : (skin.val - 1) > f;
                var tintColor = isFuture
                    ? new P.Color(0.2, 0.8, 0.2)
                    : new P.Color(0.2, 0.4, 1.0);

                var skinOpacity = skin.op / 100;

                VF.flattenDrawables().forEach(function (l) {
                    if (!VF.isLayerRenderable(l, targetF)) return;
                    if (S.cfg.onionIsolate && l.id !== S.activeId) return;

                    var res = VF.getResolvedFrame(l, targetF);
                    var curRes = VF.getResolvedFrame(l, f);

                    if (res && (!curRes || res.keyFrame !== curRes.keyFrame)) {
                        var d = res.data;
                        if (!d || (Array.isArray(d) && d.length === 0)) return;

                        var targetLayer = skin.top ? VF.onionLayerFg : VF.onionLayerBg;

                        var skinGroup = new P.Group();
                        targetLayer.addChild(skinGroup);

                        // Compensate for camera difference between current and onion frame
                        if (VF.hasCameraKeyframes && VF.hasCameraKeyframes()) {
                            var camCur = VF.getCameraAtFrame(f);
                            var camOnion = VF.getCameraAtFrame(targetF);
                            var camDx = camOnion.x - camCur.x;
                            var camDy = camOnion.y - camCur.y;
                            var camZoomRatio = camCur.zoom / camOnion.zoom;
                            var camRotDelta = camOnion.rotation - camCur.rotation;

                            // Apply inverse camera delta so onion aligns with current viewport
                            var camCompensate = new P.Matrix();
                            camCompensate.translate(camCur.x, camCur.y);
                            camCompensate.scale(camZoomRatio);
                            camCompensate.rotate(-camRotDelta);
                            camCompensate.translate(-camOnion.x, -camOnion.y);

                            skinGroup.applyMatrix = false;
                            skinGroup.matrix = camCompensate;
                        }

                        // ── Apply transforms to onion skins ──
                        if (VF.getLayerTransform) {
                            var xfo = VF.getLayerTransform(l, targetF);
                            var cxo = S.canvas.w / 2, cyo = S.canvas.h / 2;
                            var mo = new P.Matrix();
                            mo.translate(cxo + xfo.x, cyo + xfo.y);
                            mo.rotate(xfo.rotation);
                            mo.scale(xfo.scaleX, xfo.scaleY);
                            mo.translate(-cxo, -cyo);

                            skinGroup.applyMatrix = false;
                            skinGroup.matrix = mo;
                        }

                        if (l.type === 'vector') {
                            d.forEach(function (j) {
                                try {
                                    var parsed = null;
                                    try { parsed = JSON.parse(j); } catch (_) { parsed = null; }

                                    if (parsed && parsed.__texStroke) {
                                        if (parsed.pressurePoints && parsed.pressurePoints.length > 1) {
                                            var tc = tintColor.clone();
                                            tc.alpha = skinOpacity;

                                            var pp = new P.Path({
                                                strokeColor: tc,
                                                strokeWidth: parsed.size || 2,
                                                strokeCap: 'round'
                                            });
                                            parsed.pressurePoints.forEach(function (p) {
                                                pp.add(new P.Point(p.x, p.y));
                                            });
                                            pp.simplify(5);
                                            skinGroup.addChild(pp);
                                        } else if (parsed.pathJSON) {
                                            var tempGroup = new P.Group({ insert: false });
                                            var guide = tempGroup.importJSON(parsed.pathJSON);
                                            if (guide) {
                                                guide.remove();
                                                guide.visible = true;
                                                var tc2 = tintColor.clone();
                                                tc2.alpha = skinOpacity;
                                                guide.strokeColor = tc2;
                                                guide.strokeWidth = parsed.size || 2;
                                                guide.fillColor = null;
                                                skinGroup.addChild(guide);
                                            }
                                        }
                                    } else {
                                        var item = skinGroup.importJSON(j);
                                        if (item) tintTree(item, tintColor, skinOpacity);
                                    }
                                } catch (e) { }
                            });
                        } else if (l.type === 'image' && l.imgData) {
                            var imgR = new P.Raster({ source: l.imgData });
                            if (d.matrix) {
                                imgR.matrix = new P.Matrix(d.matrix[0], d.matrix[1], d.matrix[2], d.matrix[3], d.matrix[4], d.matrix[5]);
                            } else {
                                imgR.position = new P.Point(S.canvas.w / 2, S.canvas.h / 2);
                            }
                            imgR.opacity = skinOpacity * 0.5;
                            skinGroup.addChild(imgR);
                        }
                    }
                });
            });

            VF.view.zoom = oldZoom;
            VF.view.center = oldCenter;
            VF.view.update();
        }

        if (VF.applyWobbleEffects) {
            VF.applyWobbleEffects(sorted, f);
        }

        if (VF.grainGroup && VF.grainRaster && VF.grainClip) {
            if (S.cfg.grain) {
                VF.grainGroup.visible = true;
                VF.grainRaster.opacity = (S.cfg.grainAmt / 100) * 0.5;

                var cam = VF.getCameraAtFrame ? VF.getCameraAtFrame(f) : { x: S.canvas.w / 2, y: S.canvas.h / 2, zoom: 1, rotation: 0 };

                VF.grainClip.remove();
                var newClip = new P.Path.Rectangle({
                    point: [-S.canvas.w / 2, -S.canvas.h / 2],
                    size: [S.canvas.w, S.canvas.h],
                    insert: false
                });

                // Tell Paper.js this path acts as the clipping mask
                newClip.clipMask = true;

                newClip.position = new P.Point(cam.x, cam.y);
                newClip.scale(1 / cam.zoom);
                newClip.rotate(cam.rotation);

                VF.grainGroup.insertChild(0, newClip);
                VF.grainClip = newClip;

                VF.grainRaster.matrix = new P.Matrix();
                var scaleX = (S.canvas.w * 1.6) / 1024 / cam.zoom;
                var scaleY = (S.canvas.h * 1.6) / 1024 / cam.zoom;
                VF.grainRaster.scale(Math.max(scaleX, scaleY));
                VF.grainRaster.rotate(cam.rotation);

                var rand = VF.seededRandom(f * 1234);
                var ox = (rand() - 0.5) * (S.canvas.w * 0.5) / cam.zoom;
                var oy = (rand() - 0.5) * (S.canvas.h * 0.5) / cam.zoom;

                var rad = cam.rotation * Math.PI / 180;
                var cos = Math.cos(rad), sin = Math.sin(rad);
                var rox = ox * cos - oy * sin;
                var roy = ox * sin + oy * cos;

                VF.grainRaster.position = new P.Point(cam.x + rox, cam.y + roy);
            } else {
                VF.grainGroup.visible = false;
            }
        }

        if (VF.fxLayer) VF.fxLayer.bringToFront();
        if (VF.pLayers[S.activeId]) VF.pLayers[S.activeId].activate();

        VF.fgLayer.bringToFront();
        VF.drawBorder();
        if (VF.renderCameraOverlay) VF.renderCameraOverlay();
    };

})();