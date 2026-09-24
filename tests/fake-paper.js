'use strict';

/**
 * Minimal Paper.js stand-in for unit tests.
 *
 * Implements just enough of the Paper surface that the pure logic under
 * test (getResolvedFrame tweening, serialization round-trips) runs
 * faithfully: Point, Matrix (with affine ops + decompose), Group with a
 * JSON-based importJSON/exportJSON pair, and inert Path/Raster/Layer.
 *
 * The fake's JSON format is its own (plain hydrated objects), which is
 * fine: tests assert on OUR logic (lerp math, cache rules, resolution),
 * not on Paper.js's serialization format.
 */

class Point {
    constructor(x, y) { this.x = x; this.y = y; }
}

class Matrix {
    constructor(a, b, c, d, tx, ty) {
        this.v = (a === undefined)
            ? [1, 0, 0, 1, 0, 0]
            : [a, b, c, d, tx, ty];
    }
    get values() { return this.v.slice(); }
    translate(p) { this.v[4] += p.x; this.v[5] += p.y; }
    rotate(deg) {
        const r = deg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
        const [a, b, c, d, tx, ty] = this.v;
        this.v = [a * cos - b * sin, a * sin + b * cos, c * cos - d * sin, c * sin + d * cos, tx, ty];
    }
    scale(pt) { this.v[0] *= pt.x; this.v[3] *= pt.y; }
    skew() { /* not exercised by tests (skew-free matrices only) */ }
    decompose() {
        const [a, b, c, d, tx, ty] = this.v;
        return {
            translation: new Point(tx, ty),
            scaling: new Point(Math.sqrt(a * a + b * b), Math.sqrt(c * c + d * d)),
            rotation: Math.atan2(b, a) * 180 / Math.PI,
            skewing: new Point(0, 0)
        };
    }
    equals(m) { return !!m && this.v.every((x, i) => x === m.v[i]); }
}

class Item {
    constructor(data) {
        this.className = data.className;
        this.segments = data.segments || null;
        this.children = data.children || null;
        this.strokeWidth = data.strokeWidth;
        this.visible = data.visible !== undefined ? data.visible : true;
        this.fillColor = data.fillColor || null;
        this.strokeColor = data.strokeColor || null;
    }
    exportJSON() {
        return JSON.stringify(dehydrateItem(this));
    }
    remove() {}
}

class Group {
    constructor() { this.children = []; this.className = 'Group'; }
    importJSON(str) {
        let data;
        try { data = JSON.parse(str); } catch (e) { return null; }
        const item = hydrate(data);
        if (!item) return null;
        this.children.push(item);
        return item;
    }
    exportJSON() {
        return JSON.stringify({ className: 'Group', children: this.children.map(dehydrateItem) });
    }
    addChild(c) { this.children.push(c); }
    remove() {}
    removeChildren() { this.children = []; }
}

// Path/Raster/Layer/Tool: inert stand-ins — the tested code paths never
// call methods on them, they just must exist as constructors (the camera
// module builds its Paper Tool at script load time).
class Path {
    constructor() { this.className = 'Path'; this.segments = []; }
    add() {}
    remove() {}
}
class Raster { constructor() { this.className = 'Raster'; } remove() {} }
class Layer { constructor() { this.className = 'Layer'; this.children = []; } remove() {} }
class Color { constructor() { this.alpha = 1; } clone() { return new Color(); } }
class Tool {
    constructor() { this.name = ''; this.onMouseDown = null; this.onMouseUp = null; this.onMouseDrag = null; }
    activate() {}
    remove() {}
}

function toPoint(v) {
    if (v instanceof Point) return v;
    if (Array.isArray(v)) return new Point(v[0], v[1]);
    if (v && typeof v === 'object') return new Point(v.x, v.y);
    return new Point(0, 0);
}

/** Convert parsed JSON into fake items with real Point instances. */
function hydrate(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const item = new Item(data);
    if (data.segments) {
        item.segments = data.segments.map(function (s) {
            return {
                point: toPoint(s.point),
                handleIn: toPoint(s.handleIn),
                handleOut: toPoint(s.handleOut)
            };
        });
    }
    if (data.children) {
        item.children = data.children.map(hydrate).filter(Boolean);
    }
    return item;
}

function dehydrateValue(v) {
    if (v instanceof Point) return { x: v.x, y: v.y };
    if (v instanceof Item) return dehydrateItem(v);
    if (Array.isArray(v)) return v.map(dehydrateValue);
    if (v && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v)) out[k] = dehydrateValue(v[k]);
        return out;
    }
    return v;
}

function dehydrateItem(item) {
    const out = { className: item.className };
    if (item.segments) out.segments = item.segments.map(dehydrateValue);
    if (item.children) out.children = item.children.map(dehydrateItem);
    if (item.strokeWidth !== undefined) out.strokeWidth = item.strokeWidth;
    if (item.visible !== undefined) out.visible = item.visible;
    if (item.fillColor) out.fillColor = item.fillColor;
    if (item.strokeColor) out.strokeColor = item.strokeColor;
    return out;
}

module.exports = { Point, Matrix, Group, Item, Path, Raster, Layer, Color, Tool };
