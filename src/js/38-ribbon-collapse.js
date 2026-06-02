(function () {
    "use strict";

    /* ═══════════════════════════════════════════════════
       RIBBON COLLAPSE / EXPAND
       ───────────────────────────────────────────────────
       • The chevron button (#btn-ribbon-toggle) collapses or
         expands the ribbon body, leaving only the tab strip.
       • Clicking any tab while collapsed re-opens the ribbon.
       • State persists across sessions (localStorage).
       • After any change we fire a window resize so the canvas
         (03-paper-setup) and the panel handles (27-resize-panels)
         recompute against the ribbon's new height.

       Add to index.html after 37-folders.js:
         <script src="js/38-ribbon-collapse.js"></script>
       ═══════════════════════════════════════════════════ */

    var KEY = 'pompedin_ribbon_collapsed';

    function setCollapsed(on) {
        var $bar = $('#top-bar');
        var $btn = $('#btn-ribbon-toggle');

        $bar.toggleClass('ribbon-collapsed', on);

        var label = on ? 'Expand ribbon' : 'Collapse ribbon';
        $btn.attr('data-tip', label).attr('title', label);

        try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) { }

        /* Let the grid reflow, then notify the canvas + panel handles. */
        requestAnimationFrame(function () {
            window.dispatchEvent(new Event('resize'));
        });
    }

    $(document).ready(function () {
        /* Restore saved state (default: open) */
        var collapsed = false;
        try { collapsed = localStorage.getItem(KEY) === '1'; } catch (_) { }
        if (collapsed) setCollapsed(true);

        /* Toggle button */
        $('#btn-ribbon-toggle').on('click', function (e) {
            e.stopPropagation();
            setCollapsed(!$('#top-bar').hasClass('ribbon-collapsed'));
        });

        /* Any tab click always opens the ribbon (panel switch is
           handled by 22-ui-bindings.js; this just un-collapses). */
        $('.ribbon-tab').on('click', function () {
            if ($('#top-bar').hasClass('ribbon-collapsed')) setCollapsed(false);
        });
    });

})();