'use strict';

const nodeGlobals = require('globals').node;

/**
 * ESLint flat config for Pompedin.
 *
 * The codebase is plain browser-global scripts (IIFEs attaching to
 * window.VF, jQuery, Paper.js). This config targets high-signal
 * correctness rules (undefined names, duplicate keys, unreachable
 * code) and deliberately leaves stylistic churn to Prettier, which is
 * configured in .prettierrc to match the existing dominant style.
 *
 * Existing warnings are expected — `npm run lint` should stay clean
 * for NEW code; run `npm run lint:errors` to see errors only.
 */
module.exports = [
    {
        ignores: ['src/lib/**', 'node_modules/**', 'src-tauri/**', 'marketing/**']
    },
    {
        files: ['src/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                // Browser
                window: 'writable',
                document: 'readonly',
                console: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
                requestIdleCallback: 'readonly',
                cancelIdleCallback: 'readonly',
                navigator: 'readonly',
                location: 'readonly',
                history: 'readonly',
                performance: 'readonly',
                Image: 'readonly',
                Audio: 'readonly',
                URL: 'readonly',
                Blob: 'readonly',
                FileReader: 'readonly',
                fetch: 'readonly',
                getComputedStyle: 'readonly',
                matchMedia: 'readonly',
                devicePixelRatio: 'readonly',
                alert: 'readonly',
                btoa: 'readonly',
                atob: 'readonly',
                Event: 'readonly',
                MouseEvent: 'readonly',
                AbortController: 'readonly',
                EyeDropper: 'readonly',
                // Libraries / app globals
                VF: 'writable',
                $: 'readonly',
                jQuery: 'readonly',
                paper: 'readonly'
            }
        },
        rules: {
            // Real bug catchers — keep these at error level.
            'no-undef': 'error',
            'no-dupe-keys': 'error',
            'no-dupe-args': 'error',
            'no-unreachable': 'error',
            'no-constant-condition': ['error', { checkLoops: false }],
            'valid-typeof': 'error',
            'no-self-assign': 'error',
            'no-compare-neg-zero': 'error',
            'no-async-promise-executor': 'error',
            'no-fallthrough': 'error',
            'no-class-assign': 'error',
            'no-constructor-return': 'error',
            'no-template-curly-in-string': 'warn',
            // Hygiene — warnings, not blockers, for this legacy codebase.
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
            'no-redeclare': 'warn',
            'no-empty': ['warn', { allowEmptyCatch: true }]
        }
    },
    {
        // Node-side files: the test harness and the tests themselves.
        files: ['tests/**/*.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: nodeGlobals
        },
        rules: {
            'no-undef': 'error',
            'no-dupe-keys': 'error',
            'no-unreachable': 'error',
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }]
        }
    }
];
