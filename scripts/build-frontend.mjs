/**
 * Release frontend builder (Phase 2 performance).
 *
 * Produces src-dist/ — a deployable, trimmed, minified copy of src/:
 *
 *   - All 38 app scripts (01-state.js … 38-ribbon-collapse.js) are
 *     concatenated in load order and minified by esbuild into a single
 *     js/pompedin.bundle.js. index.html's 38 <script> tags are replaced
 *     with one.
 *   - Only the runtime parts of lib/ are copied: jQuery, Paper.js,
 *     Tailwind, and fontawesome's css/ + webfonts/ (0.72 MB). The 28 MB
 *     of fontawesome source trees (svgs/, scss/, js/, metadata/,
 *     sprites/) never reach the app bundle.
 *
 * Dev stays untouched: tauri dev serves ../src directly, so iteration
 * keeps working on the unbundled files. `npm run build` (tauri build
 * --config src-tauri/tauri.release.conf.json) runs this script first
 * and points the bundle at ../src-dist.
 *
 * Usage: node scripts/build-frontend.mjs [--no-minify]
 */

import { transform } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'src-dist');
const MINIFY = !process.argv.includes('--no-minify');

function copyDir(from, to, filter) {
    mkdirSync(to, { recursive: true });
    let files = 0, bytes = 0;
    const walk = (rel) => {
        for (const entry of readdirSync(join(from, rel), { withFileTypes: true })) {
            const relPath = rel ? join(rel, entry.name) : entry.name;
            if (entry.isDirectory()) {
                walk(relPath);
            } else {
                if (filter && !filter(relPath)) continue;
                mkdirSync(join(to, dirname(relPath)), { recursive: true });
                copyFileSync(join(from, relPath), join(to, relPath));
                files++;
                bytes += statSync(join(from, relPath)).size;
            }
        }
    };
    walk('');
    return { files, bytes };
}

function fmtMB(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

console.log(`Building release frontend → src-dist/ (minify: ${MINIFY})`);
rmSync(DIST, { recursive: true, force: true });

/* ── 1. Bundle + minify the app scripts ──────────────────────── */
const jsFiles = readdirSync(join(SRC, 'js'))
    .filter((f) => f.endsWith('.js'))
    .sort(); // zero-padded names guarantee load order (01 … 38)

if (jsFiles.length === 0) throw new Error('no app scripts found in src/js');

const concatenated = jsFiles
    .map((f) => readFileSync(join(SRC, 'js', f), 'utf8'))
    .join('\n;\n');

const { code: bundle } = await transform(concatenated, {
    minify: MINIFY,
    // Tauri 2 webviews: WebView2 (Chromium 100+) and WKWebView (Safari 15+)
    target: ['es2020'],
    legalComments: 'none'
});

mkdirSync(join(DIST, 'js'), { recursive: true });
writeFileSync(join(DIST, 'js', 'pompedin.bundle.js'), bundle);
console.log(`  js: ${jsFiles.length} scripts → pompedin.bundle.js (${fmtMB(bundle.length)})`);

/* ── 2. Patch index.html: one bundle tag instead of 38 ─────────── */
let html = readFileSync(join(SRC, 'index.html'), 'utf8');
let replaced = 0;
html = html.replace(/<script src="js\/[^"]+"><\/script>/g, (m) => {
    replaced++;
    return replaced === 1 ? '<script src="js/pompedin.bundle.js"></script>' : '';
});
if (replaced === 0) throw new Error('no app <script> tags found in index.html');
writeFileSync(join(DIST, 'index.html'), html);
console.log(`  index.html: ${replaced} script tags → 1`);

/* ── 3. Stylesheets + assets ───────────────────────────────────── */
for (const f of readdirSync(SRC)) {
    const st = statSync(join(SRC, f));
    if (st.isFile() && f.endsWith('.css')) {
        copyFileSync(join(SRC, f), join(DIST, f));
    }
}
console.log(`  css: stylesheets copied`);
const assets = copyDir(join(SRC, 'assets'), join(DIST, 'assets'));
console.log(`  assets: ${assets.files} files (${fmtMB(assets.bytes)})`);

/* ── 4. Trimmed lib/ ───────────────────────────────────────────── */
mkdirSync(join(DIST, 'lib'), { recursive: true });
// Runtime libs at the root (all pre-minified — copied as-is)
for (const f of ['jquery.min.js', 'paper-full.min.js', 'tailwind.min.css']) {
    copyFileSync(join(SRC, 'lib', f), join(DIST, 'lib', f));
}

// FontAwesome: only the compiled CSS + webfonts are used at runtime.
// The source trees (svgs/, svgs-full/, scss/, js/, metadata/, sprites/,
// sprites-full/) are build-time material — ~28 MB that never ships.
const fa = copyDir(
    join(SRC, 'lib', 'fontawesome'),
    join(DIST, 'lib', 'fontawesome'),
    (rel) => rel.startsWith('css' + sep) || rel.startsWith('webfonts' + sep)
);
console.log(`  lib: fontawesome runtime only — ${fa.files} files (${fmtMB(fa.bytes)})`);

console.log('Done. Bundle ready for tauri build.');
