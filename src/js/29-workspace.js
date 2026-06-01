(function () {
    "use strict";

    /* ═══════════════════════════════════════════════════
       WORKSPACE PREFERENCES
       ═══════════════════════════════════════════════════ */

    var WORKSPACE_KEY = 'vf_workspace_prefs';

    // Attach to global VF object so other files can read these
    VF.wsPrefs = {
        theme: 'system',
        canvasBgColor: '#ffffff',
        canvasBgTransparent: false,
        tabletMode: 'ink'
    };

    function loadWorkspacePrefs() {
        try {
            var raw = localStorage.getItem(WORKSPACE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed.theme) VF.wsPrefs.theme = parsed.theme;
                if (parsed.canvasBgColor) VF.wsPrefs.canvasBgColor = parsed.canvasBgColor;
                if (parsed.canvasBgTransparent !== undefined) VF.wsPrefs.canvasBgTransparent = parsed.canvasBgTransparent;
                if (parsed.tabletMode) VF.wsPrefs.tabletMode = parsed.tabletMode;
            }
        } catch (e) { }
    }

    function saveWorkspacePrefs() {
        try {
            localStorage.setItem(WORKSPACE_KEY, JSON.stringify(VF.wsPrefs));
        } catch (e) { }
    }

    function applyTheme() {
        var root = document.documentElement;
        root.classList.remove('theme-light', 'theme-dark');

        if (VF.wsPrefs.theme === 'light') {
            root.classList.add('theme-light');
        } else if (VF.wsPrefs.theme === 'dark') {
            root.classList.add('theme-dark');
        }
    }

    VF.applyWorkspaceBg = function () {
        var bgCol = VF.wsPrefs.canvasBgTransparent ? null : VF.wsPrefs.canvasBgColor;
        var rect = VF.getBorderRect();
        if (rect) {
            rect.fillColor = bgCol;
            VF.view.update();
        }
    };

    // Initialize immediately
    loadWorkspacePrefs();
    applyTheme();

    $(document).ready(function () {
        // 1. Sync UI to loaded state
        $('#sel-theme').val(VF.wsPrefs.theme);
        $('#clr-ws-bg').val(VF.wsPrefs.canvasBgColor);
        $('#chk-ws-transparent').prop('checked', VF.wsPrefs.canvasBgTransparent);
        $('#sel-tablet-mode').val(VF.wsPrefs.tabletMode);

        if (VF.wsPrefs.canvasBgTransparent) {
            $('#clr-ws-bg').css('opacity', '0.4').css('pointer-events', 'none');
        }

        // Apply background immediately (overrides the hardcoded #fff in 03-paper-setup)
        VF.applyWorkspaceBg();

        // 2. Bind UI events
        $('#sel-theme').on('change', function () {
            VF.wsPrefs.theme = $(this).val();
            applyTheme();
            saveWorkspacePrefs();
        });

        $('#sel-tablet-mode').on('change', function () {
            VF.wsPrefs.tabletMode = $(this).val();
            saveWorkspacePrefs();
            VF.toast('Tablet mode set to ' + ($(this).val() === 'ink' ? 'Standard' : 'Smoothed'));
        });

        $('#clr-ws-bg').on('input change', function () {
            VF.wsPrefs.canvasBgColor = $(this).val();
            VF.applyWorkspaceBg();
            saveWorkspacePrefs();
        });

        $('#chk-ws-transparent').on('change', function () {
            VF.wsPrefs.canvasBgTransparent = $(this).is(':checked');

            if (VF.wsPrefs.canvasBgTransparent) {
                $('#clr-ws-bg').css('opacity', '0.4').css('pointer-events', 'none');
            } else {
                $('#clr-ws-bg').css('opacity', '1').css('pointer-events', 'auto');
            }

            VF.applyWorkspaceBg();
            saveWorkspacePrefs();
        });
    });

})();