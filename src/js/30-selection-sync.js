(function () {
    "use strict";

    var S = VF.S, P;
    function getP() { if (!P) P = VF.P; return P; }

    /* ── History dedup: save once per drag/edit session ── */
    var _selEditHistorySaved = false;

    $(document).on('mouseup pointerup', function () {
        _selEditHistorySaved = false;
    });

    /* ═══════════════════════════════════════════════════
       HELPERS
       ═══════════════════════════════════════════════════ */

    function hasSelection() {
        return VF.selSegments.length > 0 &&
            ['select', 'lasso', 'translate', 'rotate', 'scale'].indexOf(S.tool) !== -1;
    }

    VF.hasSelection = hasSelection;

    /** Find the first Path in a tree (for reading properties). */
    function findFirstPath(item) {
        if (!item) return null;
        if (item.className === 'Path' && item.strokeWidth != null) return item;
        if (item.children) {
            for (var i = 0; i < item.children.length; i++) {
                var found = findFirstPath(item.children[i]);
                if (found) return found;
            }
        }
        return null;
    }

    /* ═══════════════════════════════════════════════════
       SYNC UI FROM SELECTION
       Reads properties from the first selected item and
       updates the ribbon controls to match.
       ═══════════════════════════════════════════════════ */

    /* ═══════════════════════════════════════════════════
       SELECTION STYLE vs. NEW-STROKE DEFAULTS
       ─────────────────────────────────────────────────
       The ribbon serves two masters: with an active selection it
       shows (and edits) the SELECTED items' properties; without one
       it shows the new-stroke defaults (S.cfg). The old implementation
       copied selection properties straight into S.cfg and tried to
       restore the defaults afterwards — any path that missed the
       restore leaked the selection's properties into the user's
       brush defaults (e.g. selecting a stroke-only shape turned Fill
       off for NEW strokes).

       Now the two are fully separate: selection reads/writes live in
       VF.selStyle and never touch S.cfg. Drawing always reads S.cfg.
       ═════════════════════════════════════════════════ */

    /** Live selection context, or null when nothing is selected. */
    VF.selStyle = null;

    /** Point the ribbon controls at the new-stroke defaults (S.cfg). */
    VF.refreshRibbonFromCfg = function () {
        $('#rng-brush').val(S.cfg.brushSize);
        $('#v-brush').val(S.cfg.brushSize);
        $('#clr-stroke').val(S.cfg.strokeCol);
        $('#tgl-stroke').toggleClass('on', S.cfg.autoStroke);
        $('#clr-fill').val(S.cfg.fillCol);
        $('#tgl-fill').toggleClass('on', S.cfg.autoFill);
        $('#sel-tex').val(S.cfg.tex);
    };

    /** Drop the selection context and show the brush defaults again. */
    VF.clearSelStyle = function () {
        if (!VF.selStyle) return;
        VF.selStyle = null;
        VF.refreshRibbonFromCfg();
    };

    VF.syncUIFromSelection = function () {
        var items = VF.getSelectedItems();

        // Selection cleared → back to the new-stroke defaults
        if (items.length === 0) {
            VF.clearSelStyle();
            return;
        }

        var item = items[0];

        // Build the selection context (displayed by the ribbon while the
        // selection is active — S.cfg is never touched).
        VF.selStyle = {
            brushSize: S.cfg.brushSize,
            strokeCol: S.cfg.strokeCol,
            autoStroke: S.cfg.autoStroke,
            fillCol: S.cfg.fillCol,
            autoFill: S.cfg.autoFill,
            tex: S.cfg.tex
        };
        var sel = VF.selStyle;

        /* ── Texture stroke group ── */
        if (item.data && item.data.isTextureStroke) {
            if (item.data.brushSize != null) {
                sel.brushSize = Math.round(item.data.brushSize);
                $('#rng-brush').val(sel.brushSize);
                $('#v-brush').val(sel.brushSize);
            }
            if (item.data.strokeCol) {
                sel.strokeCol = item.data.strokeCol;
                sel.autoStroke = true;
                $('#clr-stroke').val(item.data.strokeCol);
                $('#tgl-stroke').addClass('on');
            }
            if (item.data.tex && $('#sel-tex option[value="' + item.data.tex + '"]').length) {
                sel.tex = item.data.tex;
                $('#sel-tex').val(item.data.tex);
            }
            return;
        }

        /* ── Regular path / group ── */
        var path = findFirstPath(item) || item;

        if (path.strokeWidth != null && path.strokeWidth > 0) {
            sel.brushSize = Math.round(path.strokeWidth);
            $('#rng-brush').val(sel.brushSize);
            $('#v-brush').val(sel.brushSize);
        }

        if (path.strokeColor) {
            try {
                sel.strokeCol = path.strokeColor.toCSS(true);
                sel.autoStroke = true;
                $('#clr-stroke').val(sel.strokeCol);
                $('#tgl-stroke').addClass('on');
            } catch (e) { VF.reportError('selection-sync', e); }
        } else {
            sel.autoStroke = false;
            $('#tgl-stroke').removeClass('on');
        }

        if (path.fillColor) {
            try {
                sel.fillCol = path.fillColor.toCSS(true);
                sel.autoFill = true;
                $('#clr-fill').val(sel.fillCol);
                $('#tgl-fill').addClass('on');
            } catch (e) { VF.reportError('selection-sync', e); }
        } else {
            sel.autoFill = false;
            $('#tgl-fill').removeClass('on');
        }

        /* Regular paths are never texture-based */
        sel.tex = 'none';
        $('#sel-tex').val('none');
    };

    /* ═══════════════════════════════════════════════════
       APPLY PROPERTY TO SELECTION
       Applies a property change to all selected items.
       Returns true if changes were applied.
       ═══════════════════════════════════════════════════ */

    var _rebuildTimer = null;
    var REBUILD_DELAY = 120;

    VF.applyPropertyToSelection = function (prop, value) {
        if (!hasSelection()) return false;
        var items = VF.getSelectedItems();
        if (items.length === 0) return false;

        var P = getP();

        /* Save history once per drag session */
        if (!_selEditHistorySaved) {
            VF.saveHistory();
            _selEditHistorySaved = true;
        }

        var needsTexRebuild = [];

        items.forEach(function (item) {
            if (item.data && item.data.isTextureStroke) {
                applyToTexGroup(item, prop, value, needsTexRebuild);
            } else {
                applyToTree(item, prop, value);
            }
        });

        /* Texture rebuilds are expensive — debounce */
        if (needsTexRebuild.length > 0) {
            clearTimeout(_rebuildTimer);
            _rebuildTimer = setTimeout(function () {
                VF.tintedCanvasCache = {};
                needsTexRebuild.forEach(function (grp) {
                    VF.rebuildTextureRaster(grp);
                });
                VF.saveFrame();
                VF.view.update();
            }, REBUILD_DELAY);
        } else {
            VF.saveFrame();
        }

        return true;
    };

    /* ── Apply to texture stroke group ── */
    function applyToTexGroup(item, prop, value, rebuildQueue) {
        switch (prop) {
            case 'brushSize':
                var oldSize = item.data.brushSize || 4;
                if (oldSize === value) return;
                var ratio = value / oldSize;
                item.data.brushSize = value;
                if (item.data.pressurePoints) {
                    item.data.pressurePoints.forEach(function (p) {
                        p.width *= ratio;
                    });
                }
                rebuildQueue.push(item);
                break;

            case 'strokeColor':
                item.data.strokeCol = value;
                rebuildQueue.push(item);
                break;

            case 'texture':
                if (VF.baseBrushes[value] || value === 'none') {
                    item.data.tex = value;
                    rebuildQueue.push(item);
                }
                break;

            case 'enableStroke':
                /* Texture strokes are always stroked — no-op */
                break;

            case 'enableFill':
                /* Fill is a separate sibling path for textures — no-op */
                break;
        }
    }

    /* ── Apply to regular path tree ── */
    function applyToTree(item, prop, value) {
        if (item.className === 'Raster') return;

        switch (prop) {
            case 'brushSize':
                if (item.strokeWidth != null) item.strokeWidth = value;
                break;
            case 'strokeColor':
                if (item.strokeColor != null) item.strokeColor = value;
                break;
            case 'fillColor':
                if (item.fillColor != null) item.fillColor = value;
                break;
            case 'enableStroke':
                if (value) {
                    if (!item.strokeColor && item.strokeWidth != null)
                        item.strokeColor = (VF.selStyle && VF.selStyle.strokeCol) || S.cfg.strokeCol;
                } else {
                    item.strokeColor = null;
                }
                break;
            case 'enableFill':
                if (value) {
                    if (!item.fillColor) item.fillColor = (VF.selStyle && VF.selStyle.fillCol) || S.cfg.fillCol;
                } else {
                    item.fillColor = null;
                }
                break;
        }

        if (item.children) {
            var kids = item.children.slice();
            kids.forEach(function (child) {
                applyToTree(child, prop, value);
            });
        }
    }

})();