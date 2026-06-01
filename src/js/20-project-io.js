(function () {
    "use strict";

    var S = VF.S;

    function getSaveState() {
        VF.saveFrame();
        S.layers.forEach(function (l) { if (l.cache) l.cache = {}; });

        return {
            canvas: S.canvas,
            tl: S.tl,
            layers: S.layers,
            activeId: S.activeId,
            nextId: S.nextId,
            cfg: S.cfg,
            onions: S.onions,
            audioData: S.audioData,
            audioFilename: S.audioFilename,
            camera: S.camera || { frames: {} }
        };
    }

    /* ═══════════════════════════════════════════════════
           WINDOW TITLE HELPER
           ═══════════════════════════════════════════════════ */
    VF.updateWindowTitle = function () {
        if (!window.__TAURI__ || !window.__TAURI__.window) return;

        var title = "Pompedin";
        if (S.currentProjectPath) {
            var name = S.currentProjectPath.replace(/\\/g, '/').split('/').pop();
            title += " - " + name;
        } else {
            title += " - Untitled";
        }

        // Tauri v2 API for window management
        var win = window.__TAURI__.window.getCurrentWindow();
        win.setTitle(title).catch(function (e) { console.error("Failed to set title", e); });
    };

    /* ═══════════════════════════════════════════════════
       SAVE PROJECT
       - 'autosave': silent write to internal directory
       - 'save': overwrite current path (or Save As if none)
       - 'save-as': force native OS save dialog
       ═══════════════════════════════════════════════════ */
    VF.doSave = function (mode) {
        // Fallback for the autosave timer passing true
        if (mode === true) mode = 'autosave';

        VF.saveFrame();
        var statePayload = getSaveState();
        var invoke = window.__TAURI__.core.invoke;

        if (mode === 'autosave') {
            return invoke('save_project', {
                state: statePayload,
                name: null,
                isAutosave: true
            }).catch(function (e) { console.error("Autosave failed", e); });
        }

        // Direct Save (Ctrl+S) if we already have a path
        if (mode === 'save' && S.currentProjectPath) {
            return invoke('save_project_to_path', { state: statePayload, path: S.currentProjectPath })
                .then(function () {
                    var name = S.currentProjectPath.replace(/\\/g, '/').split('/').pop();
                    VF.toast('Saved: ' + name);
                    VF._isDirty = false; // Mark clean
                })
                .catch(function (e) {
                    console.error("Save failed", e);
                    VF.toast('Save failed');
                    throw e;
                });
        }

        // Save As (or Save with no active path)
        var save = window.__TAURI__.dialog.save;
        var getDir = S.currentProjectPath ? Promise.resolve(null) : invoke('get_projects_dir');

        return getDir.then(function (projDir) {
            return save({
                title: 'Save Project',
                defaultPath: S.currentProjectPath || (projDir + '/my_animation.json'),
                filters: [{ name: 'Pompedin Project', extensions: ['json'] }]
            });
        }).then(function (filePath) {
            if (!filePath) return Promise.reject('cancelled'); // User cancelled

            S.currentProjectPath = filePath; // Update the active path

            return invoke('save_project_to_path', { state: statePayload, path: filePath })
                .then(function () {
                    var name = filePath.replace(/\\/g, '/').split('/').pop();
                    VF.updateWindowTitle();
                    VF.toast('Saved: ' + name);
                    VF._isDirty = false; // Mark clean
                });
        }).catch(function (e) {
            if (e !== 'cancelled') {
                console.error("Save failed", e);
                VF.toast('Save failed');
            }
            throw e; // Bubble up for the close modal
        });
    };

    $('#btn-save').on('click', function () { VF.doSave('save'); });
    $('#btn-save-as').on('click', function () { VF.doSave('save-as'); });

    /* ═══════════════════════════════════════════════════
       NEW PROJECT
       ═══════════════════════════════════════════════════ */
    $('#btn-new').on('click', function () {
        var ask = window.__TAURI__.dialog.ask;

        ask('Start new project? Unsaved changes will be lost.', {
            title: 'New Project',
            kind: 'warning'
        }).then(function (confirmed) {
            if (!confirmed) return;
            VF._isDirty = false; // Reset to clean

            S.layers = [];
            for (var k in VF.pLayers) { VF.pLayers[k].remove(); delete VF.pLayers[k]; }

            S.tl.frame = 0;
            S.nextId = 1;

            // Reset per-project configurations
            S.canvas = { w: 800, h: 600 };
            S.tl.max = 24;
            S.tl.fps = 12;
            S.currentProjectPath = null; // Unlink file path
            S.camera = { frames: {} };

            // Clear Audio
            S.audioData = null;
            S.audioFilename = null;
            if (VF.removeAudio) VF.removeAudio(true); // Pass true to silence the toast

            VF.updateWindowTitle();
            VF.syncPrefsUI();

            VF.addLayer('Layer 1', 'vector');

            // Clear history AFTER seeding the layer so we don't snapshot a 0-layer state
            VF.undoStack = [];
            VF.redoStack = [];

            VF.resetView();
            VF.render();
            VF.uiTimeline();
            VF.toast('New project started');
        });
    });

    /* ═══════════════════════════════════════════════════
           LOAD PROJECT — native open dialog
           ═══════════════════════════════════════════════════ */
    $('#btn-load').on('click', function () {
        var invoke = window.__TAURI__.core.invoke;
        var open = window.__TAURI__.dialog.open;

        invoke('get_projects_dir').then(function (projDir) {
            return open({
                title: 'Open Project',
                defaultPath: projDir,
                multiple: false,
                filters: [{ name: 'Pompedin Project', extensions: ['json'] }]
            });
        }).then(function (filePath) {
            if (!filePath) return;

            return invoke('load_project_from_path', { path: filePath }).then(function (d) {
                var state = d.state || d;
                S.canvas = state.canvas || S.canvas;
                S.tl = state.tl || S.tl;
                S.activeId = state.activeId || (state.layers && state.layers.length > 0 ? state.layers[0].id : 1);
                S.nextId = state.nextId || S.nextId;

                // Deep merge the loaded config over the current defaults
                // This ensures newly introduced keys in the current build survive
                S.cfg = $.extend(true, {}, S.cfg, state.cfg || {});

                S.onions = state.onions || S.onions;

                // Restore Audio from project
                S.audioData = state.audioData || null;
                S.audioFilename = state.audioFilename || null;
                S.camera = state.camera || { frames: {} };
                if (S.audioData && S.audioFilename) {
                    if (VF.loadAudioFromProject) VF.loadAudioFromProject(S.audioData, S.audioFilename, true);
                } else {
                    if (VF.removeAudio) VF.removeAudio(true);
                }

                S.currentProjectPath = filePath; // Bind to loaded file
                VF.updateWindowTitle();

                if (VF.syncPrefsUI) VF.syncPrefsUI();
                $('#rng-brush').val(S.cfg.brushSize || 4);
                $('#v-brush').val(S.cfg.brushSize || 4);

                VF.restoreSnapshot(JSON.stringify(state.layers));
                VF.fitCanvas();
                VF.resetView();

                var name = filePath.replace(/\\/g, '/').split('/').pop();
                VF.toast('Loaded: ' + name);
                VF._isDirty = false; // Reset to clean
            });
        }).catch(function (err) {
            if (err) {
                VF.toast('Error loading project');
                console.error(err);
            }
        });
    });

})();