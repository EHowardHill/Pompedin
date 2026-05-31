(function () {
    "use strict";

    var cvs = VF.cvs;
    var P = VF.P;
    var view = VF.view;

    cvs.addEventListener('pointermove', function (e) {
        var rect = cvs.getBoundingClientRect();
        var vp = view.viewToProject(new P.Point(e.clientX - rect.left, e.clientY - rect.top));
        $('#cursor-info').text(Math.round(vp.x) + ', ' + Math.round(vp.y));
    });

})();

(function () {
    "use strict";

    var S = VF.S;

    /* ═══════════════════════════════════════════════════
       BRUSH LOADING / REFRESH
       ═══════════════════════════════════════════════════ */

    /**
     * (Re)load the brush list from the Rust backend.
     * Clears the tinted-canvas cache so updated PNGs take effect.
     * Can be called at init or any time the user clicks Refresh.
     */
    VF.refreshBrushes = function () {
        if (!window.__TAURI__) return;

        var invoke = window.__TAURI__.core.invoke;

        invoke('list_brushes').then(function (files) {
            var sel = $('#sel-tex');
            sel.empty();
            sel.append('<option value="none">N/A</option>');

            // Clear caches so updated PNGs take effect
            VF.tintedCanvasCache = {};

            var loadedCount = 0;
            var totalCount = files.length;

            files.forEach(function (f) {
                sel.append('<option value="' + f + '">' + f.replace('.png', '') + '</option>');

                invoke('get_brush_data', { filename: f })
                    .then(function (base64Data) {
                        var img = new Image();
                        img.onload = function () {
                            VF.baseBrushes[f] = img;
                            loadedCount++;
                            if (loadedCount === totalCount) {
                                VF.toast(totalCount + ' brush' + (totalCount !== 1 ? 'es' : '') + ' loaded');
                            }
                        };
                        img.src = 'data:image/png;base64,' + base64Data;
                    })
                    .catch(function (err) {
                        console.error("Failed to load brush data for " + f, err);
                        loadedCount++;
                    });
            });

            // Restore previously selected texture if it still exists
            var currentTex = S.cfg.tex || 'none';
            if (sel.find('option[value="' + currentTex + '"]').length > 0) {
                sel.val(currentTex);
            } else {
                sel.val('none');
                S.cfg.tex = 'none';
            }

            if (totalCount === 0) {
                VF.toast('No brushes found — add PNGs to the brush folder');
            }
        }).catch(function (err) {
            console.error("Error listing brushes:", err);
            VF.toast('Failed to list brushes');
        });
    };

    /* ═══════════════════════════════════════════════════
       BUTTON BINDINGS — Open Brush Folder & Refresh
       ═══════════════════════════════════════════════════ */

    $('#btn-open-brush-folder').on('click', function () {
        if (!window.__TAURI__) return;
        var invoke = window.__TAURI__.core.invoke;

        invoke('open_brush_folder').then(function () {
            VF.toast('Opened brush folder');
        }).catch(function (err) {
            VF.toast('Could not open folder: ' + err);
            console.error(err);
        });
    });

    $('#btn-refresh-brushes').on('click', function () {
        VF.refreshBrushes();
    });

    /* ═══════════════════════════════════════════════════
       APP INITIALIZATION
       ═══════════════════════════════════════════════════ */

    function init() {
        VF.loadPrefs();

        // Load brushes on startup (silently, without the per-refresh toast)
        if (window.__TAURI__) {
            var invoke = window.__TAURI__.core.invoke;

            invoke('list_brushes').then(function (files) {
                var sel = $('#sel-tex');
                sel.empty();
                sel.append('<option value="none">N/A</option>');

                files.forEach(function (f) {
                    sel.append('<option value="' + f + '">' + f.replace('.png', '') + '</option>');

                    invoke('get_brush_data', { filename: f })
                        .then(function (base64Data) {
                            var img = new Image();
                            img.onload = function () {
                                VF.baseBrushes[f] = img;
                            };
                            img.src = 'data:image/png;base64,' + base64Data;
                        })
                        .catch(function (err) {
                            console.error("Failed to load brush data for " + f, err);
                        });
                });

                sel.val(S.cfg.tex || 'none');
            }).catch(function (err) {
                console.error("Error listing brushes:", err);
            });

            // Log the data directory path for the user
            invoke('get_data_dir').then(function (dir) {
                console.log('pompedin data directory: ' + dir);
                console.log('Place brush PNGs in: ' + dir + '/brush/');
            });
        } else {
            console.warn("Tauri API not found. App must be run via Tauri desktop window.");
        }

        // Window Close Interception
        if (window.__TAURI__ && window.__TAURI__.window) {
            var appWindow = window.__TAURI__.window.getCurrentWindow();

            appWindow.onCloseRequested(async function (event) {
                // ALWAYS prevent the default OS close so we control it deterministically
                event.preventDefault();

                if (VF._isDirty) {
                    var isUntitled = !S.currentProjectPath;

                    if (isUntitled) {
                        $('#close-title').text('Unsaved File');
                        $('#close-msg').text("You haven't saved your file yet. Are you sure you want to close and lose your work?");
                    } else {
                        $('#close-title').text('Unsaved Changes');
                        $('#close-msg').text("You have unsaved changes. Do you want to save before closing?");
                    }

                    $('#btn-close-save').prop('disabled', false).text('Save & Close');
                    $('#modal-close').css('display', 'flex'); // Flex to center properly
                } else {
                    // If there are no unsaved changes, explicitly destroy the window right now.
                    // We use destroy() instead of close() to prevent an infinite loop!
                    await appWindow.destroy();
                }
            });

            $('#btn-close-cancel').on('click', function () {
                $('#modal-close').hide();
            });

            $('#btn-close-nosave').on('click', async function () {
                $('#modal-close').hide();
                VF._isDirty = false;
                await appWindow.destroy();
            });

            $('#btn-close-save').on('click', async function () {
                $('#btn-close-save').prop('disabled', true).text('Saving...');

                try {
                    await VF.doSave('save');
                    $('#modal-close').hide();
                    await appWindow.destroy();
                } catch (e) {
                    // Save was cancelled or failed — restore button so they can retry
                    $('#btn-close-save').prop('disabled', false).text('Save & Close');
                }
            });
        }

        VF.addLayer('Layer 1', 'vector');
        VF.fitCanvas();
        VF.resetView();
        VF.uiTimeline();
        VF.render();
        VF.setTool('select');
        VF.tSelect.activate();
        VF.toast('Pompedin ready — draw with B, select with V');

        // Mark project dirty whenever history is saved (i.e. any undoable change)
        var _origSaveHistory = VF.saveHistory;
        VF.saveHistory = function () {
            VF._isDirty = true;
            return _origSaveHistory.apply(this, arguments);
        };

        if (VF.updateWindowTitle) VF.updateWindowTitle();

        // Start Autosave Background Timer
        setInterval(function () { VF.doSave(true); }, 60000);
    }

    $(document).ready(init);

})();