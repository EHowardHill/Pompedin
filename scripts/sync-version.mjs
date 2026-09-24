/**
 * Single-source the app version (Phase 3).
 *
 * package.json is canonical. This script propagates its `version` to:
 *   - src-tauri/tauri.conf.json  (the version users see / installers use)
 *   - src-tauri/Cargo.toml       (the Rust crate)
 *   - src-tauri/Cargo.lock        (keeps `cargo` from rewriting the lock
 *                                  as a side effect of the next build)
 *
 * Usage:
 *   node scripts/sync-version.mjs          # write the files
 *   node scripts/sync-version.mjs --check  # CI: exit 1 on drift
 *
 * Release flow: bump `version` in package.json, run this script, commit.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;

if (!/^\d+\.\d+\.\d+/.test(version)) {
    console.error(`Invalid package.json version: ${version}`);
    process.exit(1);
}

let drift = false;

function syncFile(label, path, apply) {
    const before = readFileSync(path, 'utf8');
    const after = apply(before);
    if (before === after) {
        console.log(`  ${label}: in sync (${version})`);
        return;
    }
    if (CHECK) {
        console.error(`  ${label}: OUT OF SYNC — expected ${version}`);
        drift = true;
        return;
    }
    writeFileSync(path, after);
    console.log(`  ${label}: updated → ${version}`);
}

syncFile('tauri.conf.json', join(ROOT, 'src-tauri', 'tauri.conf.json'), (src) =>
    src.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${version}"`)
);

syncFile('Cargo.toml', join(ROOT, 'src-tauri', 'Cargo.toml'), (src) =>
    src.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`)
);

syncFile('Cargo.lock', join(ROOT, 'src-tauri', 'Cargo.lock'), (src) =>
    src.replace(
        /(name\s*=\s*"pompedin"\s*\nversion\s*=\s*)"[^"]*"/,
        `$1"${version}"`
    )
);

if (drift) {
    console.error('\nVersion drift detected. Run: node scripts/sync-version.mjs');
    process.exit(1);
}

console.log(CHECK ? 'All versions in sync.' : 'Done.');
