(function () {
    "use strict";

    VF._downloadDataUrl = function (dataUrl, filename) {
        var a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    var MIME_BY_EXT = {
        json: 'application/json',
        png: 'image/png',
        gif: 'image/gif',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        bmp: 'image/bmp',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        mp4: 'video/mp4',
        wav: 'audio/wav',
        mp3: 'audio/mpeg',
        ogg: 'audio/ogg',
        flac: 'audio/flac',
        aac: 'audio/aac',
        m4a: 'audio/mp4',
        webm: 'audio/webm'
    };

    function basename(p) {
        return String(p || '').replace(/\\/g, '/').split('/').pop();
    }

    function bytesToBase64(bytes) {
        var bin = '';
        for (var i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(bin);
    }

    function dataUrlToBlob(dataUrl) {
        var comma = dataUrl.indexOf(',');
        var mime = dataUrl.slice(5, comma > 5 ? comma : undefined).split(';')[0] || 'application/octet-stream';
        var bin = atob(dataUrl.slice(comma + 1));
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    }

    function isAbortError(err) {
        return !!(err && err.name === 'AbortError');
    }

    /* ═══════════════════════════════════════════════════
       TAURI ADAPTER — wraps the existing Rust commands 1:1
       ═══════════════════════════════════════════════════ */

    function buildTauri(T) {
        var invoke = T.core.invoke;

        function mobileSavePath() {
            return invoke('get_documents_dir').then(function (dir) {
                function p2(n) { return (n < 10 ? '0' : '') + n; }
                var t = new Date();
                var stamp = t.getFullYear() + p2(t.getMonth() + 1) + p2(t.getDate()) +
                    '-' + p2(t.getHours()) + p2(t.getMinutes()) + p2(t.getSeconds());
                return dir.replace(/[\\/]+$/, '') + '/pompedin-' + stamp + '.json';
            });
        }

        return {
            env: 'tauri',
            capabilities: {
                mp4Export: true,
                windowClose: !!(T.window && T.window.getCurrentWindow),
                brushFolder: true,
                autosave: true
            },

            ask: function (message, opts) {
                return T.dialog.ask(message, opts || {});
            },

            pickProjectSavePath: function () {
                var S = VF.S;
                if (VF.isMobileApp && VF.isMobileApp()) return mobileSavePath();
                var getDir = S.currentProjectPath ? Promise.resolve(null) : invoke('get_projects_dir');
                return getDir.then(function (projDir) {
                    return T.dialog.save({
                        title: 'Save Project',
                        defaultPath: S.currentProjectPath || (projDir + '/my_animation.json'),
                        filters: [{ name: 'Pompedin Project', extensions: ['json'] }]
                    });
                });
            },

            pickOpenProject: function () {
                return invoke('get_projects_dir').then(function (projDir) {
                    return T.dialog.open({
                        title: 'Open Project',
                        defaultPath: projDir,
                        multiple: false,
                        filters: [{ name: 'Pompedin Project', extensions: ['json'] }]
                    });
                });
            },

            saveAutosave: function (state) {
                return invoke('save_project', { state: state, name: null, isAutosave: true });
            },

            saveProjectToPath: function (state, path) {
                return invoke('save_project_to_path', { state: state, path: path })
                    .then(function () { return path; });
            },

            loadProjectFromPath: function (path) {
                return invoke('load_project_from_path', { path: path });
            },

            loadProjectFile: function (filename) {
                return invoke('load_project', { filename: filename });
            },

            clearAutosave: function () {
                return invoke('clear_autosave');
            },

            importImage: function () {
                return T.dialog.open({
                    title: 'Import Image',
                    multiple: false,
                    filters: [{
                        name: 'Images',
                        extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']
                    }]
                }).then(function (filePath) {
                    if (!filePath) return null;
                    return invoke('read_image_file', { path: filePath }).then(function (dataUrl) {
                        return {
                            dataUrl: dataUrl,
                            name: basename(filePath).replace(/\.\w+$/, '')
                        };
                    });
                });
            },

            importAudio: function () {
                return T.dialog.open({
                    title: 'Load Audio Track',
                    multiple: false,
                    filters: [{
                        name: 'Audio Files',
                        extensions: ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'webm']
                    }]
                }).then(function (filePath) {
                    if (!filePath) return null;
                    return invoke('read_file_base64', { path: filePath }).then(function (result) {
                        return { base64: result.data, filename: result.filename };
                    });
                });
            },

            saveDataUrl: function (dataUrl, suggestedName, opts) {
                return T.dialog.save({
                    title: (opts && opts.title) || 'Export',
                    defaultPath: suggestedName,
                    filters: (opts && opts.filters) || [{ name: 'Image', extensions: ['png'] }]
                }).then(function (filePath) {
                    if (!filePath) return { saved: false };
                    return invoke('export_png', { image: dataUrl, path: filePath })
                        .then(function () { return { saved: true, name: suggestedName }; });
                });
            },

            pickExportDirectory: function (title) {
                return T.dialog.open({ title: title, directory: true });
            },

            writeExportFile: function (folder, filename, dataUrl) {
                var path = folder + '/' + filename;
                if (folder.indexOf('\\') > -1) path = folder + '\\' + filename;
                return invoke('export_png', { image: dataUrl, path: path });
            },

            listBrushes: function () { return invoke('list_brushes'); },
            getBrushData: function (filename) { return invoke('get_brush_data', { filename: filename }); },
            openBrushFolder: function () { return invoke('open_brush_folder'); },

            getVersion: function () {
                if (T.app && T.app.getVersion) return T.app.getVersion().catch(function () { return null; });
                return Promise.resolve(null);
            },

            setWindowTitle: function (title) {
                if (!T.window || !T.window.getCurrentWindow) return;
                T.window.getCurrentWindow().setTitle(title)
                    .catch(function (e) { console.error('Failed to set title', e); });
            },

            describeStorage: function () {
                return invoke('get_data_dir').then(function (dir) {
                    return [
                        'pompedin data directory: ' + dir,
                        'Place brush PNGs in: ' + dir + '/brush/'
                    ];
                });
            },

            logCrash: function (message) { return invoke('log_crash', { message: message }); },
            consumeCrashFlag: function () { return invoke('consume_crash_flag'); },
            openCrashReports: function () { return invoke('open_crash_reports'); }
        };
    }

    /* ═══════════════════════════════════════════════════
       WEB ADAPTER — browser storage (OPFS), File System
       Access dialogs with download/upload fallbacks
       ═══════════════════════════════════════════════════ */

    function buildWeb() {
        var hasSavePicker = typeof window.showSaveFilePicker === 'function';
        var hasOpenPicker = typeof window.showOpenFilePicker === 'function';
        var hasDirPicker = typeof window.showDirectoryPicker === 'function';
        var hasOpfs = typeof navigator !== 'undefined' &&
            !!(navigator.storage && navigator.storage.getDirectory);

        var fileHandles = {};
        var fileInputs = {};

        var CRASH_KEY = 'pompedin.crashLog';
        var CRASH_PENDING = 'pompedin.crashPending';

        function delay(ms) {
            return new Promise(function (res) { setTimeout(res, ms); });
        }

        function pickerTypes(filters) {
            var types = [];
            (filters || []).forEach(function (f) {
                var accept = {};
                (f.extensions || []).forEach(function (ext) {
                    var mime = MIME_BY_EXT[String(ext).toLowerCase()];
                    if (mime) accept[mime] = ['.' + ext.toLowerCase()];
                });
                if (Object.keys(accept).length) {
                    types.push({ description: f.name || 'Files', accept: accept });
                }
            });
            return types.length ? types : undefined;
        }

        function downloadBlob(blob, filename) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        }

        function pickFileViaInput(accept) {
            return new Promise(function (resolve) {
                var input = document.createElement('input');
                input.type = 'file';
                if (accept) input.accept = accept;
                input.style.position = 'fixed';
                input.style.left = '-9999px';
                document.body.appendChild(input);
                function done(file) {
                    document.body.removeChild(input);
                    resolve(file || null);
                }
                input.addEventListener('change', function () {
                    done(input.files && input.files[0]);
                });
                input.addEventListener('cancel', function () { done(null); });
                input.click();
            });
        }

        function fileToDataUrl(file) {
            return new Promise(function (resolve, reject) {
                var r = new FileReader();
                r.onload = function () { resolve(r.result); };
                r.onerror = function () { reject(r.error || new Error('read failed')); };
                r.readAsDataURL(file);
            });
        }

        function writeHandle(h, data) {
            return h.createWritable().then(function (w) {
                return w.write(data).then(function () { return w.close(); });
            });
        }

        function ensureWritable(h) {
            if (typeof h.queryPermission !== 'function') return Promise.resolve(h);
            return h.queryPermission({ mode: 'readwrite' }).then(function (state) {
                if (state === 'granted') return h;
                if (typeof h.requestPermission !== 'function') {
                    return Promise.reject(new Error('Permission denied'));
                }
                return h.requestPermission({ mode: 'readwrite' }).then(function (s) {
                    if (s === 'granted') return h;
                    return Promise.reject(new Error('Permission denied'));
                });
            });
        }

        function opfsProjectsDir() {
            return navigator.storage.getDirectory().then(function (root) {
                return root.getDirectoryHandle('projects', { create: true });
            });
        }

        function opfsWriteFile(dir, name, data) {
            return dir.getFileHandle(name, { create: true }).then(function (h) {
                return writeHandle(h, data);
            });
        }

        function opfsCopyFile(dir, from, to) {
            return dir.getFileHandle(from).then(function (src) {
                return src.getFile().then(function (file) {
                    return opfsWriteFile(dir, to, file);
                });
            });
        }

        function opfsMoveFile(dir, from, to) {
            return dir.getFileHandle(from).then(function (src) {
                if (typeof src.move === 'function') {
                    return src.move(to).catch(function () { return opfsCopyFile(dir, from, to); });
                }
                return opfsCopyFile(dir, from, to);
            });
        }

        function rotateBackups(dir, name) {
            var chain = opfsMoveFile(dir, name + '.bak2', name + '.bak3').catch(function () { });
            chain = chain.then(function () {
                return opfsMoveFile(dir, name + '.bak1', name + '.bak2').catch(function () { });
            });
            chain = chain.then(function () {
                return opfsMoveFile(dir, name, name + '.bak1').catch(function () { });
            });
            return chain;
        }

        function readStoredFile(dir, name) {
            return dir.getFileHandle(name).then(function (h) {
                return h.getFile();
            }).then(function (f) {
                return f.text();
            }).then(function (text) {
                return JSON.parse(text);
            });
        }

        function clearAutosave() {
            if (!hasOpfs) return Promise.resolve();
            return opfsProjectsDir().then(function (dir) {
                var chain = Promise.resolve();
                ['autosave.json', 'autosave.json.bak1', 'autosave.json.bak2', 'autosave.json.bak3']
                    .forEach(function (n) {
                        chain = chain.then(function () {
                            return dir.removeEntry(n).catch(function () { });
                        });
                    });
                return chain;
            });
        }

        if (typeof window.addEventListener === 'function') {
            window.addEventListener('beforeunload', function (e) {
                if (VF._isDirty) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });
        }

        return {
            env: 'web',
            capabilities: {
                mp4Export: false,
                windowClose: false,
                brushFolder: false,
                autosave: hasOpfs
            },

            ask: function (message) {
                return Promise.resolve(window.confirm(message));
            },

            pickProjectSavePath: function () {
                var suggested = VF.S.currentProjectPath || 'my_animation.json';
                if (hasSavePicker) {
                    return window.showSaveFilePicker({
                        suggestedName: suggested,
                        types: pickerTypes([{ name: 'Pompedin Project', extensions: ['json'] }]),
                        excludeAcceptAllOption: false
                    }).then(function (h) {
                        fileHandles[h.name] = h;
                        return h.name;
                    }).catch(function () { return null; });
                }
                var name = window.prompt('Save project as:', suggested);
                if (name) name = name.trim();
                if (!name) return Promise.resolve(null);
                if (!/\.json$/i.test(name)) name += '.json';
                return Promise.resolve(name);
            },

            pickOpenProject: function () {
                if (hasOpenPicker) {
                    return window.showOpenFilePicker({
                        multiple: false,
                        types: pickerTypes([{ name: 'Pompedin Project', extensions: ['json'] }])
                    }).then(function (handles) {
                        var h = handles[0];
                        fileHandles[h.name] = h;
                        return h.name;
                    }).catch(function () { return null; });
                }
                return pickFileViaInput('.json,application/json').then(function (file) {
                    if (!file) return null;
                    fileInputs[file.name] = file;
                    return file.name;
                });
            },

            saveAutosave: function (state) {
                if (!hasOpfs) return Promise.resolve();
                return opfsProjectsDir().then(function (dir) {
                    return rotateBackups(dir, 'autosave.json').then(function () {
                        return opfsWriteFile(dir, 'autosave.json', JSON.stringify(state, null, 2));
                    });
                });
            },

            saveProjectToPath: function (state, path) {
                var json = JSON.stringify(state, null, 2);
                var h = fileHandles[path];
                if (h) {
                    return ensureWritable(h).then(function (h2) {
                        return writeHandle(h2, json);
                    }).then(function () {
                        return clearAutosave().then(function () { return path; });
                    });
                }
                if (hasSavePicker) {
                    return window.showSaveFilePicker({
                        suggestedName: path,
                        types: pickerTypes([{ name: 'Pompedin Project', extensions: ['json'] }]),
                        excludeAcceptAllOption: false
                    }).then(function (h2) {
                        fileHandles[h2.name] = h2;
                        return writeHandle(h2, json).then(function () { return h2.name; });
                    }).then(function (finalName) {
                        return clearAutosave().then(function () { return finalName; });
                    }).catch(function (err) {
                        if (isAbortError(err)) return Promise.reject('cancelled');
                        throw err;
                    });
                }
                downloadBlob(new Blob([json], { type: 'application/json' }), path);
                return clearAutosave().then(function () { return path; });
            },

            loadProjectFromPath: function (path) {
                var h = fileHandles[path];
                if (h) {
                    return h.getFile().then(function (f) { return f.text(); })
                        .then(function (t) { return JSON.parse(t); });
                }
                var file = fileInputs[path];
                if (file) {
                    return file.text().then(function (t) { return JSON.parse(t); });
                }
                return Promise.reject('File not found');
            },

            loadProjectFile: function (filename) {
                if (!hasOpfs) return Promise.reject('File not found');
                return opfsProjectsDir().then(function (dir) {
                    return readStoredFile(dir, filename);
                });
            },

            clearAutosave: clearAutosave,

            importImage: function () {
                var filters = [{
                    name: 'Images',
                    extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']
                }];
                var p = hasOpenPicker
                    ? window.showOpenFilePicker({ multiple: false, types: pickerTypes(filters) })
                        .then(function (hs) { return hs[0].getFile(); })
                    : pickFileViaInput('image/png,image/jpeg,image/gif,image/bmp,image/webp,image/svg+xml');
                return p.then(function (file) {
                    if (!file) return null;
                    return fileToDataUrl(file).then(function (dataUrl) {
                        return { dataUrl: dataUrl, name: basename(file.name).replace(/\.\w+$/, '') };
                    });
                }).catch(function (err) {
                    if (isAbortError(err)) return null;
                    throw err;
                });
            },

            importAudio: function () {
                var filters = [{
                    name: 'Audio Files',
                    extensions: ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'webm']
                }];
                var p = hasOpenPicker
                    ? window.showOpenFilePicker({ multiple: false, types: pickerTypes(filters) })
                        .then(function (hs) { return hs[0].getFile(); })
                    : pickFileViaInput('audio/*');
                return p.then(function (file) {
                    if (!file) return null;
                    return fileToDataUrl(file).then(function (dataUrl) {
                        return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), filename: basename(file.name) };
                    });
                }).catch(function (err) {
                    if (isAbortError(err)) return null;
                    throw err;
                });
            },

            saveDataUrl: function (dataUrl, suggestedName, opts) {
                var blob = dataUrlToBlob(dataUrl);
                if (hasSavePicker) {
                    return window.showSaveFilePicker({
                        suggestedName: suggestedName,
                        types: pickerTypes((opts && opts.filters) ||
                            [{ name: 'Image', extensions: ['png'] }]),
                        excludeAcceptAllOption: false
                    }).then(function (h) {
                        return writeHandle(h, blob);
                    }).then(function () {
                        return { saved: true, name: suggestedName };
                    }).catch(function (err) {
                        if (isAbortError(err)) return { saved: false };
                        throw err;
                    });
                }
                downloadBlob(blob, suggestedName);
                return Promise.resolve({ saved: true, name: suggestedName });
            },

            pickExportDirectory: function () {
                if (hasDirPicker) {
                    return window.showDirectoryPicker({ mode: 'readwrite' })
                        .catch(function () { return null; });
                }
                return Promise.resolve('downloads');
            },

            writeExportFile: function (dir, filename, dataUrl) {
                if (dir === 'downloads') {
                    VF._downloadDataUrl(dataUrl, filename);
                    return delay(400);
                }
                return opfsWriteFile(dir, filename, dataUrlToBlob(dataUrl));
            },

            listBrushes: function () {
                return fetch('assets/brushes/manifest.json')
                    .then(function (r) { return r.ok ? r.json() : []; })
                    .then(function (m) { return (m && m.brushes) || []; })
                    .catch(function () { return []; });
            },

            getBrushData: function (filename) {
                return fetch('assets/brushes/' + encodeURIComponent(filename))
                    .then(function (r) {
                        if (!r.ok) throw new Error('Brush not found: ' + filename);
                        return r.arrayBuffer();
                    })
                    .then(function (buf) {
                        return bytesToBase64(new Uint8Array(buf));
                    });
            },

            openBrushFolder: function () {
                return Promise.reject(new Error('not available in the web build'));
            },

            getVersion: function () {
                return Promise.resolve(null);
            },

            setWindowTitle: function (title) {
                document.title = title;
            },

            describeStorage: function () {
                return Promise.resolve([
                    'Pompedin web build',
                    hasOpfs
                        ? 'Projects autosave to this browser (OPFS).'
                        : 'Browser storage unavailable — autosave is disabled.',
                    'Brushes ship with the app in assets/brushes/.'
                ]);
            },

            logCrash: function (message) {
                try {
                    var log = [];
                    try { log = JSON.parse(localStorage.getItem(CRASH_KEY)) || []; } catch (e) { }
                    log.push({ t: new Date().toISOString(), message: String(message).slice(0, 500) });
                    while (log.length > 40) log.shift();
                    localStorage.setItem(CRASH_KEY, JSON.stringify(log));
                    localStorage.setItem(CRASH_PENDING, '1');
                } catch (e) { }
                return Promise.resolve();
            },

            consumeCrashFlag: function () {
                var had = false;
                try {
                    had = localStorage.getItem(CRASH_PENDING) === '1';
                    if (had) localStorage.removeItem(CRASH_PENDING);
                } catch (e) { }
                return Promise.resolve(had);
            },

            openCrashReports: function () {
                var log = [];
                try { log = JSON.parse(localStorage.getItem(CRASH_KEY)) || []; } catch (e) { }
                if (!log.length) {
                    VF.toast('No crash reports recorded yet');
                    return Promise.resolve();
                }
                var text = log.map(function (e) { return '[' + e.t + '] ' + e.message; }).join('\n');
                downloadBlob(new Blob([text], { type: 'text/plain' }), 'pompedin-crash-log.txt');
                VF.toast('Crash log downloaded');
                return Promise.resolve();
            }
        };
    }

    var T = window.__TAURI__;
    VF.platform = (T && T.core && typeof T.core.invoke === 'function')
        ? buildTauri(T)
        : buildWeb();

})();
