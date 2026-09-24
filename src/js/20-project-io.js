(function () {
    "use strict";

    var S = VF.S;

    function getSaveState() {
        VF.saveFrame();
        S.layers.forEach(function (l) { if (l.cache) l.cache = {}; });

        return {
            formatVersion: VF.FORMAT_VERSION,
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
    /* AUTOSAVE HARDENING: a background autosave must never overlap a
       save that is already in flight (Rust-side writes are atomic, but
       overlapping snapshots are still wasted work), nor run while the
       user is deciding whether to restore a crashed session's autosave. */
    VF._saveInFlight = 0;
    VF._recoveryPending = false;

    /* Resolves where a new project save should go. Desktop: native save
       dialog (unchanged behavior). Mobile (iPad / Android): save dialogs
       are unavailable — write into the app's Documents folder (on iPad
       visible in the Files app; on Android it's the app's external
       documents dir); the returned path becomes currentProjectPath, so
       subsequent Ctrl+S writes go straight there. */
    function pickSavePath(invoke) {
        if (VF.isMobileApp && VF.isMobileApp()) {
            return invoke('get_documents_dir').then(function (dir) {
                function p2(n) { return (n < 10 ? '0' : '') + n; }
                var t = new Date();
                var stamp = t.getFullYear() + p2(t.getMonth() + 1) + p2(t.getDate()) +
                    '-' + p2(t.getHours()) + p2(t.getMinutes()) + p2(t.getSeconds());
                return dir.replace(/[\\/]+$/, '') + '/pompedin-' + stamp + '.json';
            });
        }

        var save = window.__TAURI__.dialog.save;
        var getDir = S.currentProjectPath ? Promise.resolve(null) : invoke('get_projects_dir');

        return getDir.then(function (projDir) {
            return save({
                title: 'Save Project',
                defaultPath: S.currentProjectPath || (projDir + '/my_animation.json'),
                filters: [{ name: 'Pompedin Project', extensions: ['json'] }]
            });
        });
    }

    function _doSaveInner(mode) {
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

        // Save As (or Save with no active path) — see pickSavePath for
        // the iPad Documents-folder fallback.
        return pickSavePath(invoke).then(function (filePath) {
            if (!filePath) return Promise.reject('cancelled'); // User cancelled

            S.currentProjectPath = filePath; // Update the active path

            return invoke('save_project_to_path', { state: statePayload, path: filePath })
                .then(function () {
                    var name = filePath.replace(/\\/g, '/').split('/').pop();
                    VF.updateWindowTitle();
                    if (VF.isMobileApp && VF.isMobileApp()) {
                        VF.toast(VF.t('toast.savedToDocuments', { name: name }));
                    } else {
                        VF.toast('Saved: ' + name);
                    }
                    VF._isDirty = false; // Mark clean
                });
        }).catch(function (e) {
            if (e !== 'cancelled') {
                console.error("Save failed", e);
                VF.toast('Save failed');
            }
            throw e; // Bubble up for the close modal
        });
    }

    VF.doSave = function (mode) {
        if (mode === true) mode = 'autosave';

        if (mode === 'autosave' && (VF._saveInFlight > 0 || VF._recoveryPending)) {
            return Promise.resolve();
        }

        VF._saveInFlight++;
        return Promise.resolve(_doSaveInner(mode)).then(function (v) {
            VF._saveInFlight--;
            return v;
        }, function (e) {
            VF._saveInFlight--;
            throw e;
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
            if (VF.clearOnionCache) VF.clearOnionCache();
            if (VF._plResetSync) VF._plResetSync();   // pLayers are about to be recreated

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
       PROJECT FORMAT VERSIONING
       Version history:
         1 — current. Files saved before this stamp existed have no
             formatVersion and are treated as version 1; the cfg
             deep-merge on load restores any keys newer builds add.
       Bump VF.FORMAT_VERSION (01-state.js) when the save structure
       changes, and add a matching step in migrateState() below.
       ═══════════════════════════════════════════════════ */

    function validateState(state) {
        if (!state || typeof state !== 'object') {
            return 'The file does not contain a project object.';
        }
        if (!Array.isArray(state.layers)) {
            return 'The file is missing its layers array — it may be corrupt.';
        }
        if (state.formatVersion && state.formatVersion > VF.FORMAT_VERSION) {
            return 'This project was saved by a newer version of Pompedin (format v' +
                state.formatVersion + '). Please update the app first.';
        }
        return null;
    }

    function migrateState(state) {
        var v = state.formatVersion || 1;
        // if (v < 2) { ...migrate v1 → v2... }
        state.formatVersion = VF.FORMAT_VERSION;
        return state;
    }

    /* Shared load path used by the Open dialog and crash recovery.
       filePath may be null (recovered autosave → stays untitled). */
    VF.applyLoadedState = function (state, filePath) {
        var err = validateState(state);
        if (err) throw err;
        migrateState(state);

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

        S.currentProjectPath = filePath || null;
        VF.updateWindowTitle();

        if (VF.syncPrefsUI) VF.syncPrefsUI();
        $('#rng-brush').val(S.cfg.brushSize || 4);
        $('#v-brush').val(S.cfg.brushSize || 4);

        VF.restoreSnapshot(JSON.stringify(state.layers));

        // Undo history belongs to the previous project — never let it
        // leak into (or corrupt) the newly loaded one.
        VF.undoStack = [];
        VF.redoStack = [];
        if (VF.clearOnionCache) VF.clearOnionCache();

        VF.fitCanvas();
        VF.resetView();
        VF._isDirty = false;
    };

    /* ═══════════════════════════════════════════════════
       LOAD PROJECT — native open dialog, with corrupt-file recovery
       ═══════════════════════════════════════════════════ */
    $('#btn-load').on('click', function () {
        var invoke = window.__TAURI__.core.invoke;
        var open = window.__TAURI__.dialog.open;
        var ask = window.__TAURI__.dialog.ask;

        // Load + validate; rejects on read/parse/structure errors.
        function tryLoad(path) {
            return invoke('load_project_from_path', { path: path }).then(function (d) {
                var state = (d && d.state) ? d.state : d;
                var err = validateState(state);
                if (err) throw err;
                return state;
            });
        }

        invoke('get_projects_dir').then(function (projDir) {
            return open({
                title: 'Open Project',
                defaultPath: projDir,
                multiple: false,
                filters: [{ name: 'Pompedin Project', extensions: ['json'] }]
            });
        }).then(function (filePath) {
            if (!filePath) return;

            tryLoad(filePath).catch(function (primaryErr) {
                console.error('Project load failed:', primaryErr);

                // CORRUPT-FILE RECOVERY: fall back to the rolling backups
                // the backend keeps next to every project file.
                var backups = [filePath + '.bak1', filePath + '.bak2', filePath + '.bak3'];
                var chain = Promise.reject();
                backups.forEach(function (b) {
                    chain = chain.catch(function () { return tryLoad(b); });
                });

                return chain.then(function (state) {
                    return ask(
                        'This file could not be read, but a backup from a previous save was found. Open the backup instead?',
                        { title: 'Project Recovery', kind: 'warning' }
                    ).then(function (confirmed) {
                        if (!confirmed) throw primaryErr;
                        return state;
                    });
                }, function () {
                    throw primaryErr;
                });
            }).then(function (state) {
                VF.applyLoadedState(state, filePath);
                var name = filePath.replace(/\\/g, '/').split('/').pop();
                VF.toast('Loaded: ' + name);
            }).catch(function (err) {
                if (err) {
                    VF.toast('Error loading project: ' +
                        (typeof err === 'string' ? err : 'file may be corrupt'));
                    console.error(err);
                }
            });
        }).catch(function (err) {
            if (err) {
                VF.toast('Could not open the file dialog');
                console.error(err);
            }
        });
    });

    /* ═══════════════════════════════════════════════════
       CRASH RECOVERY
       Clean exits delete the autosave (see 24-init.js), so an autosave
       still present at launch means the previous session ended
       abnormally. Offer to restore it, newest copy first.
       ═══════════════════════════════════════════════════ */
    VF.checkAutosaveRecovery = function () {
        if (!window.__TAURI__) return;
        var invoke = window.__TAURI__.core.invoke;
        var ask = window.__TAURI__.dialog.ask;

        // Keep the autosave timer from clobbering the file while the
        // user decides (doSave skips autosave while this is pending).
        VF._recoveryPending = true;

        var candidates = ['autosave.json', 'autosave.json.bak1', 'autosave.json.bak2', 'autosave.json.bak3'];
        var chain = Promise.reject();
        candidates.forEach(function (f) {
            chain = chain.catch(function () { return invoke('load_project', { filename: f }); });
        });

        chain.then(function (d) {
            var state = (d && d.state) ? d.state : d;
            var err = validateState(state);
            if (err || !state.layers || state.layers.length === 0) {
                // Empty or unusable autosave — clear it so we don't
                // re-prompt on every launch.
                return invoke('clear_autosave');
            }

            return ask(
                'Pompedin found an unsaved autosave from a previous session that ended unexpectedly. Restore it now?',
                { title: 'Crash Recovery', kind: 'warning' }
            ).then(function (confirmed) {
                if (!confirmed) return invoke('clear_autosave');

                try {
                    VF.applyLoadedState(state, null);   // stays untitled — never bind the autosave path
                    VF._isDirty = true;                 // restored work is unsaved by definition
                    VF.toast('Autosave restored — save it with Ctrl+S');
                } catch (e) {
                    console.error('Autosave restore failed:', e);
                    VF.toast('Could not restore the autosave');
                }
            });
        }, function () {
            // No autosave found — normal clean start, nothing to do.
        }).then(function () {
            VF._recoveryPending = false;
        }, function (e) {
            VF._recoveryPending = false;
            console.error('Crash recovery check failed:', e);
        });
    };

})();