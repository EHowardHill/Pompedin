(function () {
    "use strict";

    VF.importImg = function () {
        VF.platform.importImage().then(function (picked) {
            if (!picked) return; // User cancelled

            var l = VF.addLayer(picked.name, 'image');
            l.imgData = picked.dataUrl;
            l.frames[0] = [];
            VF.render();
            VF.uiTimeline();
        }).catch(function (err) {
            VF.toast('Failed to import image: ' + err);
            console.error('Image import error:', err);
        });
    };

})();
