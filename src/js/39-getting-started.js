/**
 * Getting Started card (Phase 5) — a short first-run tour.
 *
 * Shows once on the very first launch (localStorage flag), and can be
 * re-opened from the Help dialog ("Getting Started" button). All copy
 * lives in the i18n table (01b-i18n.js) — this module only assembles it.
 */
(function () {
    "use strict";

    var FLAG_KEY = 'pompedin_onboarded';

    var $modal = null;

    function buildModal() {
        var html = '<div class="mo-box" style="min-width:430px;max-width:520px">';
        html += '<div class="mo-title">' + VF.t('gs.title') + '</div>';
        html += '<div style="font-size:12px;color:var(--text-secondary);margin:10px 0 14px;line-height:1.5">' +
            VF.t('gs.intro') + '</div>';

        var steps = ['gs.step1', 'gs.step2', 'gs.step3', 'gs.step4'];
        html += '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">';
        steps.forEach(function (key, i) {
            html += '<div style="display:flex;gap:10px;align-items:flex-start">' +
                '<span style="min-width:18px;height:18px;border-radius:50%;background:var(--accent);color:#fff;' +
                'font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;' +
                'flex-shrink:0">' + (i + 1) + '</span>' +
                '<span style="font-size:12px;color:var(--text-primary);line-height:1.5">' + VF.t(key) + '</span>' +
                '</div>';
        });
        html += '</div>';

        html += '<div style="font-size:11px;color:var(--text-dim);margin-bottom:14px;line-height:1.5">' +
            VF.t('gs.hint') + '</div>';

        html += '<div style="display:flex;justify-content:flex-end">' +
            '<button class="btn btn-p" id="gs-close">' + VF.t('gs.close') + '</button></div>';
        html += '</div>';

        $modal = $('<div id="modal-getting-started" class="mo-ov" style="display:none"></div>').html(html);
        $('body').append($modal);

        $modal.on('click', function (e) { if (e.target === this) close(); });
        $modal.on('click', '#gs-close', close);
        $(document).on('keydown', function (e) {
            if (e.key === 'Escape' && $modal.is(':visible')) { e.preventDefault(); close(); }
        });
    }

    function open() {
        if (!$modal) buildModal();
        $modal.css('display', 'flex');
        $('#gs-close').trigger('focus');
    }

    function close() {
        if ($modal) $modal.hide();
        try { localStorage.setItem(FLAG_KEY, '1'); } catch (e) { }
    }

    /** Re-openable from the Help dialog. */
    VF.showGettingStarted = open;

    /** Show on the first launch only. Called from init (24-init.js). */
    VF.maybeShowGettingStarted = function () {
        var seen = false;
        try { seen = localStorage.getItem(FLAG_KEY) === '1'; } catch (e) { }
        if (!seen) open();
    };

})();
