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

    var _cachedBrushConfig = null;

    VF.cacheBrushConfig = function () {
        if (!_cachedBrushConfig) {
            _cachedBrushConfig = {
                brushSize: S.cfg.brushSize,
                strokeCol: S.cfg.strokeCol,
                autoStroke: S.cfg.autoStroke,
                fillCol: S.cfg.fillCol,
                autoFill: S.cfg.autoFill,
                tex: S.cfg.tex
            };
        }
    };

    VF.restoreBrushConfig = function () {
        if (_cachedBrushConfig) {
            S.cfg.brushSize = _cachedBrushConfig.brushSize;
            S.cfg.strokeCol = _cachedBrushConfig.strokeCol;
            S.cfg.autoStroke = _cachedBrushConfig.autoStroke;
            S.cfg.fillCol = _cachedBrushConfig.fillCol;
            S.cfg.autoFill = _cachedBrushConfig.autoFill;
            S.cfg.tex = _cachedBrushConfig.tex;

            // Sync UI back to freehand defaults
            $('#rng-brush').val(S.cfg.brushSize);
            $('#v-brush').val(S.cfg.brushSize);
            $('#clr-stroke').val(S.cfg.strokeCol);
            $('#tgl-stroke').toggleClass('on', S.cfg.autoStroke);
            $('#clr-fill').val(S.cfg.fillCol);
            $('#tgl-fill').toggleClass('on', S.cfg.autoFill);
            $('#sel-tex').val(S.cfg.tex);

            _cachedBrushConfig = null;
        }
    };

    VF.syncUIFromSelection = function () {
        var items = VF.getSelectedItems();

        // Restore brush defaults if the selection was cleared
        if (items.length === 0) {
            if (VF.restoreBrushConfig) VF.restoreBrushConfig();
            return;
        }

        // Cache the freehand brush config before the selection overrides it
        if (VF.cacheBrushConfig) VF.cacheBrushConfig();

        var item = items[0];

        /* ── Texture stroke group ── */
        if (item.data && item.data.isTextureStroke) {
            if (item.data.brushSize != null) {
                var bs = Math.round(item.data.brushSize);
                S.cfg.brushSize = bs;
                $('#rng-brush').val(bs);
                $('#v-brush').val(bs);
            }
            if (item.data.strokeCol) {
                S.cfg.strokeCol = item.data.strokeCol;
                S.cfg.autoStroke = true;
                $('#clr-stroke').val(item.data.strokeCol);
                $('#tgl-stroke').addClass('on');
            }
            if (item.data.tex && $('#sel-tex option[value="' + item.data.tex + '"]').length) {
                S.cfg.tex = item.data.tex;
                $('#sel-tex').val(item.data.tex);
            }
            return;
        }

        /* ── Regular path / group ── */
        var path = findFirstPath(item) || item;

        if (path.strokeWidth != null && path.strokeWidth > 0) {
            var sw = Math.round(path.strokeWidth);
            S.cfg.brushSize = sw;
            $('#rng-brush').val(sw);
            $('#v-brush').val(sw);
        }

        if (path.strokeColor) {
            try {
                var hex = path.strokeColor.toCSS(true);
                S.cfg.strokeCol = hex;
                S.cfg.autoStroke = true;
                $('#clr-stroke').val(hex);
                $('#tgl-stroke').addClass('on');
            } catch (e) { }
        } else {
            S.cfg.autoStroke = false;
            $('#tgl-stroke').removeClass('on');
        }

        if (path.fillColor) {
            try {
                var hexF = path.fillColor.toCSS(true);
                S.cfg.fillCol = hexF;
                S.cfg.autoFill = true;
                $('#clr-fill').val(hexF);
                $('#tgl-fill').addClass('on');
            } catch (e) { }
        } else {
            S.cfg.autoFill = false;
            $('#tgl-fill').removeClass('on');
        }

        /* Regular paths are never texture-based */
        S.cfg.tex = 'none';
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
                        item.strokeColor = S.cfg.strokeCol;
                } else {
                    item.strokeColor = null;
                }
                break;
            case 'enableFill':
                if (value) {
                    if (!item.fillColor) item.fillColor = S.cfg.fillCol;
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