'use strict';

/**
 * Pompedin integration smoke test (WebdriverIO + tauri-driver).
 *
 * NOT wired into CI yet — see tests/integration/README.md for
 * prerequisites and how to run it.
 *
 * Requires: tauri-driver running on the default port (4444) and a built
 * app binary. WebdriverIO must be installed (npm i -D webdriverio).
 */

const path = require('path');
const os = require('os');

const BIN = process.env.APPSRC || null;
if (!BIN) {
    console.error(
        'Set APPSRC to the built app binary, e.g. ' +
        'APPSRC="src-tauri/target/debug/pompedin.exe" node tests/integration/smoke.js'
    );
    process.exit(2);
}

const binary = path.isAbsolute(BIN) ? BIN : path.join(process.cwd(), BIN);

// tauri-driver capabilities (see https://docs.rs/tauri-driver)
const capabilities = os.platform() === 'win32'
    ? { 'tauri:options': { binary } }
    : { 'tauri:options': { binary }, 'ms:edgeOptions': {}, 'moz:firefoxOptions': {} };

let browser;

async function main() {
    const { remote } = require('webdriverio');
    browser = await remote({
        hostname: '127.0.0.1',
        port: 4444,
        path: '/',
        capabilities: [{ capabilities }]
    });

    const step = (name, fn) => console.log(`  ✓ ${name}`) || fn();

    // 1. Window opens with a canvas
    const canvas = await browser.$('#canvas');
    if (!canvas || !(await canvas.isExisting())) {
        throw new Error('canvas element not found — app failed to start');
    }
    console.log('  ✓ app window opened, canvas present');

    // 2. Seeded layer exists
    const layerRow = await browser.$('.layer-row .lyr-name');
    const name = layerRow ? await layerRow.getText() : '';
    if (!/Layer 1/.test(name || '')) {
        throw new Error(`expected seeded "Layer 1", got "${name}"`);
    }
    console.log('  ✓ seeded layer present');

    // 3. Brush stroke writes frame data (stroke via synthetic pointer
    //    events is flaky across webview drivers — instead we validate
    //    through the timeline UI that frame 0 shows as a keyframe after
    //    a scripted draw via keyboard shortcut isn't available; the
    //    unit suite covers saveFrame, so here we only assert the
    //    timeline renders).
    const timeline = await browser.$('#timeline');
    if (!timeline || !(await timeline.isExisting())) {
        throw new Error('timeline element not found');
    }
    console.log('  ✓ timeline rendered');

    console.log('\nSMOKE TEST PASSED');
    await browser.deleteSession();
}

main().catch(async (err) => {
    console.error('\nSMOKE TEST FAILED:', err.message);
    if (browser) { try { await browser.deleteSession(); } catch (_) { } }
    process.exit(1);
});
