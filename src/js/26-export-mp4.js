(function () {
    "use strict";

    var S = VF.S;

    VF.exportMP4 = async function () {
        if (!window.__TAURI__) {
            VF.toast("MP4 Export requires the Tauri desktop environment.");
            return;
        }

        const { invoke } = window.__TAURI__.core;
        const { save } = window.__TAURI__.dialog;

        // 1. Prompt for save location BEFORE starting the heavy render process
        let outputPath = null;
        try {
            outputPath = await save({
                title: 'Export Animation as MP4',
                defaultPath: 'animation.mp4',
                filters: [{ name: 'Video', extensions: ['mp4'] }]
            });
        } catch (err) {
            console.error("Dialog error:", err);
            return;
        }

        if (!outputPath) return; // User canceled the dialog

        VF.toast("Starting MP4 export...");
        let $btn = $('#btn-export-mp4');
        $btn.prop('disabled', true).text('Preparing...');

        // Lock down the UI with the export modal
        $('#export-progress-bar').css('width', '0%');
        $('#export-status-text').text('Preparing export...');
        $('#modal-export').css('display', 'flex');

        // Save current state and clear UI selections
        VF.saveFrame();
        VF.clearHandles();

        // Store original view state so we can restore it later
        var originalFrame = S.tl.frame;
        var originalZoom = VF.view.zoom;
        var originalCenter = VF.view.center.clone();
        // FIX (Bug #5): Save workspace rotation
        var originalRotation = VF.viewRotation || 0;

        // Hide system layers (canvas borders, onion skins, etc.)
        var borderRect = VF.getBorderRect();
        var borderOutline = VF.getBorderOutline();
        if (borderRect) borderRect.visible = false;
        if (borderOutline) borderOutline.visible = false;
        VF.onionLayerBg.visible = false;
        VF.onionLayerFg.visible = false;
        VF.fgLayer.visible = false;

        /* Hide reference layers during MP4 export (matching PNG export) */
        var hiddenRefLayers = [];
        S.layers.forEach(function (l) {
            if (l.reference && l.vis) {
                var pl = VF.pLayers[l.id];
                if (pl) {
                    pl.visible = false;
                    hiddenRefLayers.push(pl);
                }
            }
        });

        /* Hide wobble temp layers during MP4 export */
        var hiddenWobble = [];
        if (VF._wobbleTempLayers) {
            VF._wobbleTempLayers.forEach(function (tl) {
                if (tl.visible) {
                    tl.visible = false;
                    hiddenWobble.push(tl);
                }
            });
        }

        // FIX (Bug #5): Reset workspace rotation before export
        if (originalRotation) {
            VF.view.rotate(-originalRotation, VF.view.center);
            VF.viewRotation = 0;
        }

        // Reset camera to exactly 1:1 for rendering
        VF.view.viewSize = new VF.P.Size(S.canvas.w, S.canvas.h);
        VF.view.zoom = 1;
        VF.view.center = new VF.P.Point(S.canvas.w / 2, S.canvas.h / 2);

        try {
            // 2. Start an MP4 session in Rust
            let sessionId = await invoke('mp4_start');

            // Create an off-screen canvas to copy the exact resolution
            var ec = document.createElement('canvas');
            ec.width = S.canvas.w;
            ec.height = S.canvas.h;
            var ectx = ec.getContext('2d');

            // Set global flag so `04-serialization.js` forces full vector deserialization
            VF._exporting = true;

            // Video doesn't support alpha. If canvas is transparent, force white.
            var mp4Bg = (VF.wsPrefs && !VF.wsPrefs.canvasBgTransparent) ? VF.wsPrefs.canvasBgColor : '#ffffff';

            // 3. Loop through every frame
            for (let i = 0; i < S.tl.max; i++) {
                S.tl.frame = i;
                VF.render();       // Load items for this frame

                /* ── Apply camera transform ── */
                var _cam = null;
                if (VF.hasCameraKeyframes && VF.hasCameraKeyframes()) {
                    _cam = VF.getCameraAtFrame(i);
                    VF.view.zoom = _cam.zoom;
                    VF.view.center = new VF.P.Point(_cam.x, _cam.y);
                }
                /* If no camera, view is already set to 1:1 by the caller */

                VF.view.update();  // Force Paper.js to draw it

                // Clear export canvas and paint background
                ectx.clearRect(0, 0, ec.width, ec.height);
                ectx.fillStyle = mp4Bg;
                ectx.fillRect(0, 0, ec.width, ec.height);

                // Draw the Paper.js canvas onto our export canvas (with rotation)
                if (VF.captureWithCamera) {
                    VF.captureWithCamera(_cam, VF.cvs, ectx, S.canvas.w, S.canvas.h);
                } else {
                    ectx.drawImage(VF.cvs, 0, 0, VF.cvs.width, VF.cvs.height, 0, 0, S.canvas.w, S.canvas.h);
                }

                // Extract base64 data URL
                let dataUrl = ec.toDataURL('image/png');

                // Send the frame to Rust to save in the temp directory
                await invoke('mp4_frame', {
                    sessionId: sessionId,
                    frameIndex: i,
                    image: dataUrl
                });

                // Update UI progress (Frame rendering represents roughly the first 50% of the time)
                let renderPercent = Math.round(((i + 1) / S.tl.max) * 50);
                $('#export-progress-bar').css('width', renderPercent + '%');
                $('#export-status-text').text('Rendering frame ' + (i + 1) + ' of ' + S.tl.max);
                $btn.text('Exporting ' + (i + 1) + ' / ' + S.tl.max);
            }

            VF._exporting = false; // Turn off high-res forced render
            $btn.text('Encoding Video...');
            $('#export-progress-bar').css('width', '50%'); // Push to half-way explicitly
            $('#export-status-text').text('Encoding video file (FFmpeg)...');

            // 4. Trigger FFmpeg rendering in Rust
            let includeAudio = !!(VF.audio && VF.audio.filename);

            // Calculate exact animation duration in seconds for FFmpeg truncation
            let durationSec = S.tl.max / S.tl.fps;

            await invoke('mp4_render', {
                sessionId: sessionId,
                fps: S.tl.fps,
                totalFrames: S.tl.max,
                durationSec: durationSec, // NEW: Tell FFmpeg exactly when to stop
                includeAudio: includeAudio,
                audioData: includeAudio ? S.audioData : null,
                audioFilename: includeAudio ? S.audioFilename : null,
                audioVolume: includeAudio ? VF.audio.volume : 1.0, // NEW: Sync MP4 volume to workspace
                outputPath: outputPath
            });

            $('#export-progress-bar').css('width', '100%');
            VF.toast("MP4 Exported Successfully!");
        } catch (err) {
            console.error("Export failed:", err);
            VF.toast("MP4 Export Failed: " + err);
        } finally {
            // 5. Restore original state and UI
            VF._exporting = false;

            // Release the UI lock
            $('#modal-export').hide();

            if (borderRect) borderRect.visible = true;
            if (borderOutline) borderOutline.visible = true;
            VF.onionLayerBg.visible = true;
            VF.onionLayerFg.visible = true;
            VF.fgLayer.visible = true;

            /* Restore reference layers */
            hiddenRefLayers.forEach(function (pl) { pl.visible = true; });
            hiddenWobble.forEach(function (tl) { tl.visible = true; });

            S.tl.frame = originalFrame;
            VF.fitCanvas();
            VF.view.zoom = originalZoom;
            VF.view.center = originalCenter;

            // FIX (Bug #5): Restore workspace rotation
            if (originalRotation) {
                VF.view.rotate(originalRotation, VF.view.center);
                VF.viewRotation = originalRotation;
            }

            VF.render();
            VF.uiTimeline();

            $btn.prop('disabled', false).html('<i class="fa-solid fa-film" style="margin-right:3px"></i> Video (MP4)');
        }
    };

    // Bind the event
    $(document).ready(function () {
        $('#btn-export-mp4').off('click').on('click', VF.exportMP4);
    });

})();