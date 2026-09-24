# Preference Persistence Audit

**Audit date:** 2026-09-23 (Phase 5) · Scope: everything that should
survive a restart, where it lives, and the one gap that was fixed.

## What persists, and where

| Preference | Mechanism | Key / location | Notes |
|---|---|---|---|
| Window size, position, maximized | `tauri-plugin-window-state` | app data dir (plugin file) | **Fixed in this pass** — previously the window always opened at the hardcoded 1400×900; now restored per-monitor |
| Theme (light/dark) | localStorage | `pompedin_ws_prefs` | `29-workspace.js` |
| Canvas background color / transparency | localStorage | `pompedin_ws_prefs` | `29-workspace.js` |
| Tablet mode | localStorage | `pompedin_ws_prefs` | `29-workspace.js` |
| Panel sizes (left/right panel widths) | localStorage | `vf_panel_sizes` | `27-resize-panels.js` |
| Keyboard shortcuts keymap | localStorage | `pompedin_keymap` | `36-shortcuts.js`; remappable in the Keys panel; unknown actions from newer versions are ignored safely |
| Ribbon collapsed state | localStorage | per `38-ribbon-collapse.js` | |
| UI locale | localStorage | `pompedin_locale` | `01b-i18n.js`; English-only today |
| First-run Getting Started seen | localStorage | `pompedin_onboarded` | `39-getting-started.js`; re-openable from Help |
| Canvas size, timeline length, FPS | **project file** | `canvas`, `tl` | Persist per project, not per app launch |
| Brush size/colors/texture/tool settings (`S.cfg`) | **project file** | `cfg` (deep-merged on load) | Deliberate: "Removed localStorage. We just sync UI with the active state." (`21-project.js`, `VF.loadPrefs`) — loading a project restores its settings; fresh launches start from defaults |
| Camera keys, layers, audio | **project file** | `camera`, `layers`, `audioData` | With `formatVersion`, validated + migrated on load |
| Autosave | app data dir | `projects/autosave.json` (+ `.bak1`–`.bak3`) | Deleted on clean exit; offered as recovery after a crash |
| Crash reports | app data dir | `crash-reports/crash-log.txt` | Local only |

## Gaps and decisions

1. **Window geometry — fixed.** `tauri-plugin-window-state` was added
   (`Cargo.toml`, `lib.rs`, capability `window-state:default`). The
   window now reopens where the user left it.
2. **Tool settings across launches — intentional gap.** They persist
   *inside projects*, so switching projects switches your brush state
   with them. This predates the audit (documented in `21-project.js`);
   changing it would alter user expectations and is left as-is.
3. **localStorage is per-webview-profile.** Keys survive app updates on
   the same machine, but are not synced and are lost if the app data
   directory is wiped. Acceptable for UI preferences; nothing
   project-critical relies on it.
4. **Platform note.** All mechanisms behave identically on
   Windows/macOS/Linux (Tauri webview storage + the plugin's file).

## How to verify (per platform)

1. Launch, resize/move the window, toggle theme + a panel width, remap a
   key, collapse the ribbon.
2. Quit cleanly (no recovery prompt on relaunch).
3. Relaunch: geometry, theme, panels, keymap, and ribbon state all match.
