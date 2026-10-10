'use strict';

/**
 * Platform layer tests: 01a-platform.js must boot under the Node harness
 * in BOTH modes — web (no window.__TAURI__) and Tauri (stubbed IPC bridge)
 * — and route every capability call to the right backend. The Tauri
 * adapter must dispatch the exact same commands/arguments the Rust
 * backend already handles, so these tests double as a regression guard
 * for the desktop app.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { installStubs, loadScript } = require('./harness');

function loadPlatform() {
    installStubs();
    loadScript('01-state.js');
    loadScript('01a-platform.js');
    return global.VF;
}

test('platform: web adapter is selected when Tauri is absent', () => {
    delete global.__TAURI__;
    const VF = loadPlatform();
    assert.strictEqual(VF.platform.env, 'web');
    assert.strictEqual(VF.platform.capabilities.mp4Export, false);
    assert.strictEqual(VF.platform.capabilities.windowClose, false);
    assert.strictEqual(VF.platform.capabilities.brushFolder, false);
});

test('platform: web ask() routes through window.confirm', async () => {
    delete global.__TAURI__;
    const VF = loadPlatform();
    global.confirm = () => true;
    assert.strictEqual(await VF.platform.ask('Proceed?'), true);
    global.confirm = () => false;
    assert.strictEqual(await VF.platform.ask('Proceed?'), false);
    delete global.confirm;
});

test('platform: web crash log round-trips through localStorage', async () => {
    delete global.__TAURI__;
    const VF = loadPlatform();
    localStorage.removeItem('pompedin.crashLog');
    localStorage.removeItem('pompedin.crashPending');

    await VF.platform.logCrash('js: boom');
    const log = JSON.parse(localStorage.getItem('pompedin.crashLog'));
    assert.strictEqual(log.length, 1);
    assert.strictEqual(log[0].message, 'js: boom');
    assert.ok(log[0].t, 'entries are timestamped');

    assert.strictEqual(await VF.platform.consumeCrashFlag(), true);
    assert.strictEqual(await VF.platform.consumeCrashFlag(), false, 'flag is consumed once');

    localStorage.removeItem('pompedin.crashLog');
    localStorage.removeItem('pompedin.crashPending');
});

test('platform: web setWindowTitle updates document.title', () => {
    delete global.__TAURI__;
    const VF = loadPlatform();
    const prevDocument = global.document;
    global.document = { title: '' };
    VF.platform.setWindowTitle('Pompedin - Untitled');
    assert.strictEqual(global.document.title, 'Pompedin - Untitled');
    global.document = prevDocument;
});

test('platform: web pickProjectSavePath (fallback mode) normalizes the filename', async () => {
    delete global.__TAURI__;
    const VF = loadPlatform();
    global.prompt = () => 'my animation';
    assert.strictEqual(await VF.platform.pickProjectSavePath(), 'my animation.json');
    global.prompt = () => '   ';
    assert.strictEqual(await VF.platform.pickProjectSavePath(), null, 'blank name cancels');
    global.prompt = () => null;
    assert.strictEqual(await VF.platform.pickProjectSavePath(), null, 'prompt cancel is cancel');
    global.prompt = () => 'exact.json';
    assert.strictEqual(await VF.platform.pickProjectSavePath(), 'exact.json', 'no double extension');
    delete global.prompt;
});

test('platform: web storage rejects cleanly when nothing is registered', async () => {
    delete global.__TAURI__;
    const VF = loadPlatform();
    await assert.rejects(
        VF.platform.loadProjectFromPath('missing.json'),
        (err) => err === 'File not found'
    );
    await assert.rejects(
        VF.platform.loadProjectFile('autosave.json'),
        (err) => err === 'File not found'
    );
});

test('platform: tauri adapter dispatches to the invoke bridge unchanged', async () => {
    const calls = [];
    const results = {
        list_brushes: ['a.png'],
        get_brush_data: 'AAAA',
        get_projects_dir: '/data/projects',
        save_project: 'autosave.json',
        save_project_to_path: null,
        clear_autosave: null,
        load_project: { formatVersion: 1, layers: [] },
        load_project_from_path: { formatVersion: 1, layers: [] },
        export_png: null,
        get_data_dir: '/data',
        consume_crash_flag: true
    };
    global.__TAURI__ = {
        core: {
            invoke: (cmd, args) => {
                calls.push([cmd, args]);
                return Promise.resolve(results[cmd]);
            }
        },
        dialog: {
            ask: () => Promise.resolve(true),
            save: () => Promise.resolve('/data/projects/chosen.json'),
            open: (opts) => Promise.resolve(opts && opts.directory ? '/data/exports' : '/data/projects/opened.json')
        },
        window: { getCurrentWindow: () => ({ setTitle: () => Promise.resolve() }) },
        app: { getVersion: () => Promise.resolve('9.9.9') }
    };
    const VF = loadPlatform();
    const P = VF.platform;

    try {
        assert.strictEqual(P.env, 'tauri');
        assert.strictEqual(P.capabilities.mp4Export, true);
        assert.strictEqual(P.capabilities.windowClose, true);
        assert.strictEqual(P.capabilities.brushFolder, true);

        assert.deepStrictEqual(await P.listBrushes(), ['a.png']);
        assert.deepStrictEqual(calls[0], ['list_brushes', undefined]);

        await P.saveAutosave({ a: 1 });
        assert.deepStrictEqual(
            calls.find((c) => c[0] === 'save_project'),
            ['save_project', { state: { a: 1 }, name: null, isAutosave: true }]
        );

        const final = await P.saveProjectToPath({ a: 1 }, '/x/y.json');
        assert.strictEqual(final, '/x/y.json', 'final path passthrough');
        assert.deepStrictEqual(
            calls.find((c) => c[0] === 'save_project_to_path'),
            ['save_project_to_path', { state: { a: 1 }, path: '/x/y.json' }]
        );

        const state = await P.loadProjectFile('autosave.json');
        assert.deepStrictEqual(
            calls.find((c) => c[0] === 'load_project'),
            ['load_project', { filename: 'autosave.json' }]
        );
        assert.strictEqual(state.layers.length, 0);

        await P.loadProjectFromPath('/x/y.json');
        assert.deepStrictEqual(
            calls.find((c) => c[0] === 'load_project_from_path'),
            ['load_project_from_path', { path: '/x/y.json' }]
        );

        assert.strictEqual(await P.pickProjectSavePath(), '/data/projects/chosen.json');
        assert.ok(calls.some((c) => c[0] === 'get_projects_dir'));

        assert.strictEqual(await P.pickOpenProject(), '/data/projects/opened.json');

        assert.strictEqual(await P.ask('Really?', { title: 'T' }), true);

        const res = await P.saveDataUrl('data:image/png;base64,AAA', 'frame_1.png', {});
        assert.strictEqual(res.saved, true);
        assert.deepStrictEqual(
            calls.find((c) => c[0] === 'export_png'),
            ['export_png', { image: 'data:image/png;base64,AAA', path: '/data/projects/chosen.json' }]
        );

        assert.strictEqual(await P.pickExportDirectory('Choose folder'), '/data/exports');

        await P.writeExportFile('C:\\out', 'frame_01.png', 'data:image/png;base64,AAA');
        assert.deepStrictEqual(
            calls[calls.length - 1],
            ['export_png', { image: 'data:image/png;base64,AAA', path: 'C:\\out\\frame_01.png' }],
            'windows-style folders join with backslash'
        );

        assert.strictEqual(await P.getVersion(), '9.9.9');

        assert.deepStrictEqual(await P.describeStorage(), [
            'pompedin data directory: /data',
            'Place brush PNGs in: /data/brush/'
        ]);

        await P.logCrash('js: boom');
        assert.deepStrictEqual(
            calls.find((c) => c[0] === 'log_crash'),
            ['log_crash', { message: 'js: boom' }]
        );
        assert.strictEqual(await P.consumeCrashFlag(), true);
    } finally {
        delete global.__TAURI__;
    }
});
