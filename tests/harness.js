'use strict';

/**
 * Test harness: loads the REAL production scripts (src/js/*.js) under
 * Node with browser-environment stubs, so unit tests exercise the
 * actual shipped code rather than a copy.
 *
 * The production files are browser-global IIFEs (window.VF, jQuery,
 * Paper.js). Instead of refactoring them, this harness:
 *   1. installs `window` (= globalThis), a chainable jQuery stub,
 *      `document`, and `localStorage` on the global object;
 *   2. assigns a minimal Paper.js stand-in (tests/fake-paper.js) to VF.P;
 *   3. evaluates the scripts in global scope via indirect eval.
 *
 * loadCore() reloads 01-state.js (which does `window.VF = {}`), so every
 * call returns a completely fresh VF/S state — call it once per test.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'js');

let stubsInstalled = false;

function installStubs() {
    if (stubsInstalled) return;
    stubsInstalled = true;

    global.window = global;

    // Chainable, no-op element stub. Any property access or call returns
    // the stub itself, so jQuery chains like $('#x').on(...).val(...)
    // work at script load time without a DOM.
    const el = new Proxy(function () {}, {
        get(target, prop) {
            if (prop === 'length') return 0;
            if (prop === Symbol.toPrimitive) return () => '';
            return el;
        },
        apply() { return el; }
    });

    const $ = function () { return el; };
    $.fn = {};

    // $.extend is used by real logic (e.g. 34-camera.js) and must behave.
    $.extend = function extend(target) {
        for (let i = 1; i < arguments.length; i++) {
            const src = arguments[i];
            if (!src || typeof src !== 'object') continue;
            for (const k of Object.keys(src)) {
                const v = src[k];
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                    if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) {
                        target[k] = {};
                    }
                    extend(target[k], v);
                } else {
                    target[k] = v;
                }
            }
        }
        return target;
    };

    global.$ = $;
    global.jQuery = $;

    global.document = new Proxy({}, {
        get(target, prop) {
            if (prop === 'createElement') {
                return () => ({
                    width: 0, height: 0, style: {},
                    getContext: () => ({ drawImage() {}, fillRect() {}, fill() {} }),
                    addEventListener() {}
                });
            }
            if (prop === 'addEventListener' || prop === 'removeEventListener') return () => {};
            if (prop === 'getElementById') return () => null;
            return el;
        }
    });

    global.localStorage = {
        _data: {},
        getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
        setItem(k, v) { this._data[k] = String(v); },
        removeItem(k) { delete this._data[k]; }
    };
}

function loadScript(rel) {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    // Indirect eval: executes in global scope, so the IIFEs attach to
    // global window.VF exactly as they do in the browser.
    (0, eval)(src);
}

/**
 * Loads a fresh core (state + serialization + history + render + camera +
 * folders) with a fake Paper.js. Returns the fresh VF namespace.
 */
function loadCore() {
    installStubs();
    loadScript('01-state.js');          // resets window.VF and S
    global.VF.P = require('./fake-paper');
    loadScript('01b-i18n.js');
    loadScript('04-serialization.js');
    loadScript('05-history.js');
    loadScript('07-render.js');
    loadScript('30-selection-sync.js');
    loadScript('34-camera.js');
    loadScript('37-folders.js');
    loadScript('40-touch-input.js');
    return global.VF;
}

module.exports = { loadCore };
