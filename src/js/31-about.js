(function () {
    "use strict";

    /* ═══════════════════════════════════════════════════
       ABOUT DIALOG
       ═══════════════════════════════════════════════════ */

    VF.showAbout = function () {
        var verEl = document.getElementById('about-version');
        if (verEl) {
            if (window.__TAURI__ && window.__TAURI__.app) {
                window.__TAURI__.app.getVersion().then(function (v) {
                    verEl.textContent = 'v' + v;
                }).catch(function () {
                    verEl.textContent = '';
                });
            } else {
                verEl.textContent = '';
            }
        }
        $('#modal-about').show();
    };

    /* ═══════════════════════════════════════════════════
       HELP & DOCS DIALOG
       ═══════════════════════════════════════════════════ */

    VF.showHelp = function () {
        $('#modal-help').show();
    };

    $(document).ready(function () {

        // Ribbon Buttons
        $('#btn-about').on('click', VF.showAbout);
        $('#btn-help').on('click', VF.showHelp);

        // Getting Started card (first-run tour, re-openable here)
        $('#btn-getting-started').on('click', function () {
            $('#modal-help').hide();
            if (VF.showGettingStarted) VF.showGettingStarted();
        });

        // Keyboard shortcuts panel (built from the live keymap in
        // 36-shortcuts.js, so it can never drift from the real bindings)
        $('#btn-shortcuts').on('click', function () {
            if (VF.showShortcuts) VF.showShortcuts();
        });

        // Crash Reports (local-only diagnostics — see 24-init.js hooks)
        $('#about-open-crash').on('click', function () {
            if (!window.__TAURI__) return;
            window.__TAURI__.core.invoke('open_crash_reports').catch(function (e) {
                VF.toast('Could not open the crash reports folder');
                console.error(e);
            });
        });

        // Close Buttons
        $('#about-close').on('click', function () { $('#modal-about').hide(); });
        $('#help-close-x').on('click', function () { $('#modal-help').hide(); });

        // Close on overlay click
        $('.mo-ov').on('click', function (e) {
            if (e.target === this) $(this).hide();
        });

        // Close on Escape
        $(document).on('keydown', function (e) {
            if (e.key === 'Escape') {
                if ($('#modal-about').is(':visible')) { e.preventDefault(); $('#modal-about').hide(); }
                if ($('#modal-help').is(':visible')) { e.preventDefault(); $('#modal-help').hide(); }
            }
        });

        // Smooth scrolling for Help Index sidebar
        $('.help-index a').on('click', function (e) {
            e.preventDefault();
            var targetId = $(this).attr('href');
            var $targetElem = $(targetId);
            var $scrollArea = $('#help-scroll-area');

            if ($targetElem.length) {
                $scrollArea.animate({
                    // Calculate exact scroll position relative to the scroll container
                    scrollTop: $scrollArea.scrollTop() + $targetElem.position().top - 20
                }, 300);
            }
        });
    });

})();