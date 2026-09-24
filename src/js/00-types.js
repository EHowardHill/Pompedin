/**
 * Pompedin — core type definitions (JSDoc)
 * ========================================
 *
 * Documentation-only file: no runtime code, no <script> tag. IDEs pick
 * these typedefs up from the directory; they describe the core state
 * (S), the VF helper surface, and — most importantly — the on-disk
 * PROJECT FILE FORMAT, so the save format and the code can't drift
 * apart silently.
 *
 * The format contract is owned by:
 *   - VF.FORMAT_VERSION            (01-state.js)  — current version
 *   - validateState()/migrateState() (20-project-io.js) — the gate
 * When the structure below changes, bump FORMAT_VERSION and add a
 * migration step there, then update this file.
 */

/**
 * A saved project file (JSON). This is the shape produced by
 * getSaveState() (20-project-io.js) and consumed by
 * VF.applyLoadedState().
 *
 * Files saved before the formatVersion stamp exists are treated as
 * version 1.
 *
 * @typedef {Object} PompedinProjectFile
 * @property {number}  formatVersion - Save-format version; must be <= VF.FORMAT_VERSION to load
 * @property {{w: number, h: number}} canvas - Canvas size in pixels
 * @property {{frame: number, max: number, fps: number, playing: boolean}} tl
 *           Timeline state (frame is the current frame index at save time)
 * @property {(PompedinLayer|PompedinFolder)[]} layers - Full layer tree (flat list with parentId nesting)
 * @property {number}   activeId - id of the active layer
 * @property {number}   nextId  - next free layer id (ids are monotonic, never reused)
 * @property {Object}  cfg      - brush/UI defaults; deep-merged over current defaults on load
 * @property {{rel: boolean, val: number, op: number, top: boolean}[]} onions - onion-skin configuration
 * @property {?string}  audioData     - imported audio as base64 (nullable)
 * @property {?string}  audioFilename - original filename of the imported audio
 * @property {{frames: Object<number, PompedinCameraState>}} camera - camera keyframes
 */

/**
 * A drawable layer.
 *
 * INVARIANT (relied on by every performance cache in 04-serialization.js
 * and 07-render.js): entries in `frames` are ALWAYS replaced wholesale —
 * `layer.frames[f] = newData` or `delete layer.frames[f]` — never
 * mutated in place. Reference identity is the cache invalidation signal.
 *
 * @typedef {Object} PompedinLayer
 * @property {number}  id           - unique, monotonic
 * @property {?number} parentId    - owning folder's id, or null for root
 * @property {string}  name
 * @property {'vector'|'image'} type
 * @property {boolean} vis
 * @property {number}  opacity     - 0..1
 * @property {number}  z           - sibling order (ascending = back→front)
 * @property {Object<number, PompedinFrameData>} frames - keyframed content, keyed by frame index
 * @property {Object<number, boolean>} tweens   - tweening enabled per keyframe
 * @property {Object<number, PompedinLoopConfig>} loops - loop config per keyframe
 * @property {Object<number, PompedinTransformKey>} transforms - layer-transform keyframes
 * @property {?string} imgData      - image layers only: source image as data URL
 * @property {string}  blendMode
 * @property {boolean} locked
 * @property {boolean} reference    - reference layers are hidden during export
 * @property {string}  colorTag
 * @property {PompedinWobbleConfig} wobble
 */

/**
 * A folder node. Folders have no frames; `kind: 'switch'` folders pick
 * one child per frame via switch.frames.
 *
 * @typedef {Object} PompedinFolder
 * @property {number}  id
 * @property {?number} parentId
 * @property {string} name
 * @property {'folder'} type
 * @property {string}  kind      - 'group' | 'switch'
 * @property {number}  z
 * @property {boolean} vis
 * @property {number}  opacity
 * @property {?{frames: Object<number, number>}} switch - switch folders: frame → child layer id
 */

/**
 * Keyframed content for a vector layer: an array of serialized
 * Paper.js item JSON strings. Texture strokes are stored as
 * `{__texStroke: true, ...}` objects (see serPL/desPL,
 * 04-serialization.js). Image layers store `{matrix: number[6]}` instead.
 *
 * @typedef {string[]|{matrix:number[]}} PompedinFrameData
 */

/**
 * @typedef {Object} PompedinLoopConfig
 * @property {boolean} active
 * @property {'relative'|'absolute'} mode
 * @property {number}  val - span length (relative: back from the key; absolute: first frame of the span)
 */

/**
 * @typedef {Object} PompedinTransformKey
 * @property {number} x
 * @property {number} y
 * @property {number} scaleX
 * @property {number} scaleY
 * @property {number} rotation - degrees
 */

/**
 * @typedef {Object} PompedinCameraState
 * @property {number} x
 * @property {number} y
 * @property {number} zoom
 * @property {number} rotation - degrees
 */

/**
 * @typedef {Object} PompedinWobbleConfig
 * @property {boolean} enabled
 * @property {number}  offset
 * @property {number}  scale
 * @property {boolean} stroke
 * @property {boolean} fill
 * @property {boolean} perFrame
 */

/**
 * The live application state (VF.S). Shape mirrors the project file,
 * plus runtime-only fields (cfg carries all brush/UI defaults).
 * See 01-state.js for the authoritative initialization.
 *
 * @typedef {Object} PompedinState
 * @property {{w:number,h:number}} canvas
 * @property {{frame:number,max:number,fps:number,playing:boolean}} tl
 * @property {(PompedinLayer|PompedinFolder)[]} layers
 * @property {?number} activeId
 * @property {number} nextId
 * @property {?string} currentProjectPath
 * @property {Object} cfg           - new-stroke / UI defaults (never modified by selection sync)
 * @property {Object} onions
 * @property {string} tool
 * @property {?string} audioData
 * @property {?string} audioFilename
 * @property {{frames:Object<number,PompedinCameraState>}} camera
 */

/**
 * VF.selStyle (30-selection-sync.js): the LIVE selection context shown
 * in the ribbon while a selection is active. Kept strictly separate
 * from S.cfg (new-stroke defaults) — the Phase 4 separation fix.
 *
 * @typedef {Object} PompedinSelStyle
 * @property {number}  brushSize
 * @property {string}  strokeCol
 * @property {boolean} autoStroke
 * @property {string}  fillCol
 * @property {boolean} autoFill
 * @property {string}  tex
 */
