(function () {
    "use strict";

    var S = VF.S;

    var cvs = document.getElementById('main-canvas');
    paper.setup(cvs);

    // --- GLOBAL POINTER TRACKING ---
    cvs.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'pen') VF.currentPressure = e.pressure !== 0 ? e.pressure : 1.0;
        else VF.currentPressure = 1.0;
    });
    cvs.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'pen') VF.currentPressure = e.pressure !== 0 ? e.pressure : 1.0;
        else VF.currentPressure = 1.0;
    });

    var P = paper;
    var view = P.view;

    // Expose Paper.js references globally
    VF.cvs = cvs;
    VF.P = P;
    VF.view = view;

    // Create dedicated system layers that won't be serialized
    var bgLayer = new P.Layer(); bgLayer.name = 'SystemBackground';
    var onionLayerBg = new P.Layer(); onionLayerBg.name = 'OnionBackground';
    var onionLayerFg = new P.Layer(); onionLayerFg.name = 'OnionForeground';
    var fxLayer = new P.Layer(); fxLayer.name = 'SystemFX';             // NEW
    var fgLayer = new P.Layer(); fgLayer.name = 'SystemForeground';

    VF.bgLayer = bgLayer;
    VF.onionLayerBg = onionLayerBg;
    VF.onionLayerFg = onionLayerFg;
    VF.fxLayer = fxLayer;
    VF.fgLayer = fgLayer;
    VF.viewRotation = 0;

    // GENERATE STATIC NOISE CANVAS
    var noiseSize = 1024; // Increased base size for crispness
    var noiseCvs = document.createElement('canvas');
    noiseCvs.width = noiseSize; noiseCvs.height = noiseSize;
    var nCtx = noiseCvs.getContext('2d');
    var nData = nCtx.createImageData(noiseSize, noiseSize);
    var d = nData.data;
    for (var i = 0; i < d.length; i += 4) {
        var val = Math.random() < 0.5 ? 0 : 255;
        d[i] = val; d[i + 1] = val; d[i + 2] = val;
        d[i + 3] = Math.random() * 255;
    }
    nCtx.putImageData(nData, 0, 0);

    var grainRaster = new P.Raster({ canvas: noiseCvs });
    grainRaster.blendMode = 'overlay';

    // NEW: Create a clipping mask strictly bound to the canvas dimensions
    var grainClip = new P.Path.Rectangle({
        point: [0, 0],
        size: [S.canvas.w, S.canvas.h]
    });

    // In Paper.js, clipped=true uses the first child (grainClip) as the mask
    var grainGroup = new P.Group([grainClip, grainRaster]);
    grainGroup.clipped = true;
    grainGroup.visible = false;

    fxLayer.addChild(grainGroup);

    VF.grainRaster = grainRaster;
    VF.grainClip = grainClip;       // Tracked so we can update it on resize
    VF.grainGroup = grainGroup;     // Tracked so we can toggle visibility

    var borderRect = null;
    var borderOutline = null;

    VF.drawBorder = function () {
        if (borderRect) borderRect.remove();
        if (borderOutline) borderOutline.remove();

        // Fetch camera state, fallback to canvas center if undefined
        var cam = (VF.getCameraAtFrame) ? VF.getCameraAtFrame(S.tl.frame) : { x: S.canvas.w / 2, y: S.canvas.h / 2, zoom: 1, rotation: 0 };

        bgLayer.activate();
        var bgColor = (VF.wsPrefs && VF.wsPrefs.canvasBgTransparent) ? null : (VF.wsPrefs ? VF.wsPrefs.canvasBgColor : '#ffffff');

        // Draw centered at 0,0 first so scaling and rotating mathematically aligns
        borderRect = new P.Path.Rectangle({
            point: [-S.canvas.w / 2, -S.canvas.h / 2],
            size: [S.canvas.w, S.canvas.h],
            fillColor: bgColor
        });

        // Transform rect to match the camera
        borderRect.position = new P.Point(cam.x, cam.y);
        borderRect.scale(1 / cam.zoom);
        borderRect.rotate(cam.rotation);
        bgLayer.sendToBack();

        fgLayer.activate();
        borderOutline = new P.Path.Rectangle({
            point: [-S.canvas.w / 2, -S.canvas.h / 2],
            size: [S.canvas.w, S.canvas.h],
            strokeColor: '#ccc',
            strokeWidth: 1 / view.zoom, // keep the stroke 1px thick visually
            dashArray: [5 / view.zoom, 3 / view.zoom]
        });

        // Transform outline to match the camera
        borderOutline.position = new P.Point(cam.x, cam.y);
        borderOutline.scale(1 / cam.zoom);
        borderOutline.rotate(cam.rotation);
        fgLayer.bringToFront();

        if (VF.pLayers[S.activeId]) VF.pLayers[S.activeId].activate();
    };

    VF.fitCanvas = function () {
        var a = document.getElementById('canvas-area');
        cvs.width = a.clientWidth;
        cvs.height = a.clientHeight;
        view.viewSize = new P.Size(a.clientWidth, a.clientHeight);
        VF.drawBorder();
        if (VF.render) VF.render();
    };
    window.addEventListener('resize', VF.fitCanvas);

    VF.updateInfo = function () {
        var rotStr = (VF.viewRotation && Math.abs(VF.viewRotation) > 0.5)
            ? ' · ' + Math.round(VF.viewRotation) + '°' : '';
        $('#canvas-info').text(Math.round(view.zoom * 100) + '%' + rotStr + ' · ' + S.canvas.w + '×' + S.canvas.h);
    };

    VF.resetView = function () {
        if (VF.viewRotation) {
            view.rotate(-VF.viewRotation, view.center);
            VF.viewRotation = 0;
        }
        view.zoom = 1;
        view.center = new P.Point(S.canvas.w / 2, S.canvas.h / 2);
        VF.updateInfo();
        VF.drawBorder();
    };

    // Expose border refs for export
    VF.getBorderRect = function () { return borderRect; };
    VF.getBorderOutline = function () { return borderOutline; };

})();
