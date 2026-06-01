(function () {
    "use strict";

    var S = VF.S;

    /* ═══════════════════════════════════════════════════
       AUDIO STATE
       ═══════════════════════════════════════════════════ */
    VF.audio = {
        ctx: null,           // AudioContext
        buffer: null,        // Decoded AudioBuffer
        filename: null,      // Current audio filename
        waveformData: null,  // Float32Array of peak values for drawing
        source: null,        // Currently playing BufferSourceNode
        gainNode: null,      // Gain for volume control
        startTime: 0,        // AudioContext time when playback started
        startOffset: 0,      // Offset into buffer where playback started
        isPlaying: false,
        volume: 0.8
    };

    var A = VF.audio;

    /* ── Lazy-init AudioContext (must be triggered by user gesture) ── */
    function ensureCtx() {
        if (!A.ctx) {
            A.ctx = new (window.AudioContext || window.webkitAudioContext)();
            A.gainNode = A.ctx.createGain();
            A.gainNode.gain.value = A.volume;
            A.gainNode.connect(A.ctx.destination);
        }
        if (A.ctx.state === 'suspended') A.ctx.resume();
        return A.ctx;
    }

    /* ═══════════════════════════════════════════════════
       LOAD AUDIO FROM BASE64 DATA
       ═══════════════════════════════════════════════════ */
    function loadAudioFromBase64(base64Data, filename, silent) {
        ensureCtx();

        try {
            // Bypass fetch() CSP issues by converting base64 directly to an ArrayBuffer
            var binaryStr = window.atob(base64Data);
            var len = binaryStr.length;
            var bytes = new Uint8Array(len);
            for (var i = 0; i < len; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }

            A.ctx.decodeAudioData(bytes.buffer)
                .then(function (decoded) {
                    A.buffer = decoded;
                    A.filename = filename;

                    // Tie audio data explicitly to project state
                    S.audioData = base64Data;
                    S.audioFilename = filename;

                    if (!silent) VF.toast('Audio loaded: ' + filename);

                    // Rebuild data AND render the waveform to the canvas
                    VF.rebuildWaveform();

                    VF.uiTimeline();
                    updateAudioLabel();
                })
                .catch(function (err) {
                    if (!silent) VF.toast('Failed to decode audio');
                    console.error('Audio decode error:', err);
                });
        } catch (err) {
            if (!silent) VF.toast('Failed to parse audio data');
            console.error('Base64 parse error:', err);
        }
    }

    // Expose for project loader
    VF.loadAudioFromProject = loadAudioFromBase64;

    /* ═══════════════════════════════════════════════════
       LOAD AUDIO FILE (legacy — kept for compatibility)
       ═══════════════════════════════════════════════════ */
    VF.loadAudioFile = function (file) {
        ensureCtx();
        var reader = new FileReader();
        reader.onload = function (e) {
            A.ctx.decodeAudioData(e.target.result, function (decoded) {
                A.buffer = decoded;
                A.filename = file.name;
                VF.toast('Audio loaded: ' + file.name);
                buildWaveformData();
                VF.uiTimeline();
                updateAudioLabel();
            }, function (err) {
                VF.toast('Failed to decode audio');
                console.error('Audio decode error:', err);
            });
        };
        reader.readAsArrayBuffer(file);
    };

    /* Load from server (for project restore) */
    VF.loadAudioFromURL = function (url, filename) {
        ensureCtx();
        fetch(url)
            .then(function (r) { return r.arrayBuffer(); })
            .then(function (buf) { return A.ctx.decodeAudioData(buf); })
            .then(function (decoded) {
                A.buffer = decoded;
                A.filename = filename;
                buildWaveformData();
                VF.uiTimeline();
                updateAudioLabel();
            })
            .catch(function (err) {
                console.error('Audio load error:', err);
            });
    };

    function updateAudioLabel() {
        var el = document.getElementById('audio-label');
        if (el) {
            if (A.filename) {
                var dur = A.buffer ? A.buffer.duration.toFixed(1) + 's' : '';
                el.textContent = A.filename + ' (' + dur + ')';
                el.title = A.filename;
            } else {
                el.textContent = 'No audio';
            }
        }
    }

    /* ═══════════════════════════════════════════════════
       REMOVE AUDIO
       ═══════════════════════════════════════════════════ */
    VF.removeAudio = function (silent) {
        stopAudio();
        A.buffer = null;
        A.filename = null;
        A.waveformData = null;

        // Sever audio from project state
        S.audioData = null;
        S.audioFilename = null;

        // Force waveform empty generation and timeline UI refresh
        VF.rebuildWaveform();
        VF.uiTimeline();
        updateAudioLabel();

        if (!silent) VF.toast('Audio removed');
    };

    /* ═══════════════════════════════════════════════════
       WAVEFORM DATA EXTRACTION
       ═══════════════════════════════════════════════════ */

    function buildWaveformData() {
        if (!A.buffer) { A.waveformData = null; return; }

        var fps = S.tl.fps;
        var sampleRate = A.buffer.sampleRate;
        var channelData = A.buffer.getChannelData(0);

        // Extract peaks for the ENTIRE duration of the audio file
        var audioFrames = Math.ceil(A.buffer.duration * fps);
        var peaks = new Float32Array(audioFrames);

        for (var f = 0; f < audioFrames; f++) {
            var tStart = f / fps;
            var tEnd = (f + 1) / fps;
            var sStart = Math.floor(tStart * sampleRate);
            var sEnd = Math.min(Math.floor(tEnd * sampleRate), channelData.length);

            var peak = 0;
            for (var s = sStart; s < sEnd; s++) {
                var abs = Math.abs(channelData[s]);
                if (abs > peak) peak = abs;
            }
            peaks[f] = peak;
        }

        A.waveformData = peaks;
    }

    /* ═══════════════════════════════════════════════════
       WAVEFORM CANVAS RENDERING
       ═══════════════════════════════════════════════════ */
    VF.renderAudioWaveform = function () {
        var canvas = document.getElementById('audio-waveform');
        if (!canvas) return;

        var cellW = 18;
        var height = 24;
        var dpr = window.devicePixelRatio || 1;

        var audioFrames = A.waveformData ? A.waveformData.length : 0;
        var displayFrames = Math.max(S.tl.max, audioFrames);

        // Prevent the "Sad Face" Canvas OOM Crash
        // Browsers kill canvases that exceed ~32,000 physical pixels in width.
        var maxSafePixels = 30000;
        var maxSafeFrames = Math.floor(maxSafePixels / (cellW * dpr));

        // Cap the render loop so it never exceeds the safe browser limit
        displayFrames = Math.min(displayFrames, maxSafeFrames);

        // Scale internal canvas resolution
        canvas.width = displayFrames * cellW * dpr;
        canvas.height = height * dpr;

        // Force the visual CSS footprint to stay exactly the same
        canvas.style.width = (displayFrames * cellW) + 'px';
        canvas.style.height = height + 'px';

        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, displayFrames * cellW, height);

        if (!A.waveformData || A.waveformData.length === 0) {
            ctx.fillStyle = 'rgba(128, 128, 128, 0.15)';
            ctx.fillRect(0, height / 2, displayFrames * cellW, 1);
            return;
        }

        var midY = height / 2;
        var maxBarH = height / 2 - 1;

        for (var f = 0; f < displayFrames; f++) {
            var peak = f < A.waveformData.length ? A.waveformData[f] : 0;
            var barH = peak * maxBarH;
            if (barH < 0.5) barH = 0.5;

            var x = f * cellW;

            if (f >= S.tl.max) {
                ctx.fillStyle = peak > 0.6 ? 'rgba(150, 150, 150, 0.4)' : 'rgba(150, 150, 150, 0.2)';
            } else if (peak > 0.6) {
                ctx.fillStyle = 'rgba(74, 111, 255, 0.45)';
            } else {
                ctx.fillStyle = 'rgba(74, 111, 255, 0.25)';
            }

            var barW = Math.max(2, cellW - 4);
            if (f < audioFrames) {
                ctx.fillRect(x + (cellW - barW) / 2, midY - barH, barW, barH * 2);
            }
        }

        ctx.strokeStyle = 'rgba(128, 128, 128, 0.06)';
        ctx.lineWidth = 0.5;
        for (var i = 0; i <= displayFrames; i++) {
            ctx.beginPath();
            ctx.moveTo(i * cellW, 0);
            ctx.lineTo(i * cellW, height);
            ctx.stroke();
        }

        // Draw a warning line at the project's actual End Frame 
        if (audioFrames > S.tl.max && S.tl.max <= displayFrames) {
            ctx.strokeStyle = 'rgba(218, 42, 0, 0.6)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(S.tl.max * cellW, 0);
            ctx.lineTo(S.tl.max * cellW, height);
            ctx.stroke();
        }
    };

    /* Rebuild waveform data when fps/max changes */
    VF.rebuildWaveform = function () {
        buildWaveformData();
        VF.renderAudioWaveform();
    };

    /* ═══════════════════════════════════════════════════
       FRAME-SNAP AUDIO PLAYBACK
       Plays a short audio snippet for the given frame.
       Used when navigating frame-by-frame for lip sync.
       ═══════════════════════════════════════════════════ */
    VF.playFrameAudio = function (frame) {
        if (!A.buffer) return;
        ensureCtx();

        stopAudio();

        var fps = S.tl.fps;
        var frameDuration = 1 / fps;
        var offset = frame / fps;

        if (offset >= A.buffer.duration) return;

        /* Play 1.5x frame duration so phonemes aren't cut off harshly */
        var duration = Math.min(frameDuration * 1.5, A.buffer.duration - offset);

        var source = A.ctx.createBufferSource();
        source.buffer = A.buffer;
        source.connect(A.gainNode);
        source.start(0, offset, duration);

        A.source = source;
        A.isPlaying = false;

        source.onended = function () {
            if (A.source === source) A.source = null;
        };
    };

    /* ═══════════════════════════════════════════════════
       CONTINUOUS PLAYBACK (synced with animation)
       Starts playing from the given frame position.
       ═══════════════════════════════════════════════════ */
    VF.startAudioPlayback = function (fromFrame) {
        if (!A.buffer) return;
        ensureCtx();

        stopAudio();

        var offset = fromFrame / S.tl.fps;
        if (offset >= A.buffer.duration) offset = 0;

        var source = A.ctx.createBufferSource();
        source.buffer = A.buffer;
        source.connect(A.gainNode);
        source.start(0, offset);

        A.source = source;
        A.isPlaying = true;
        A.startTime = A.ctx.currentTime;
        A.startOffset = offset;

        source.onended = function () {
            if (A.source === source) {
                A.source = null;
                A.isPlaying = false;
            }
        };
    };

    /* ═══════════════════════════════════════════════════
       STOP AUDIO
       ═══════════════════════════════════════════════════ */
    function stopAudio() {
        if (A.source) {
            try { A.source.stop(); } catch (e) { }
            A.source = null;
        }
        A.isPlaying = false;
    }
    VF.stopAudio = stopAudio;

    /* ═══════════════════════════════════════════════════
       VOLUME CONTROL
       ═══════════════════════════════════════════════════ */
    VF.setAudioVolume = function (v) {
        A.volume = Math.max(0, Math.min(1, v));
        if (A.gainNode) A.gainNode.gain.value = A.volume;
    };

    /* ═══════════════════════════════════════════════════
       UI EVENT BINDINGS
       ═══════════════════════════════════════════════════ */
    $(document).ready(function () {

        /* Load audio button — opens native file dialog */
        $('#btn-load-audio').on('click', function () {
            var invoke = window.__TAURI__.core.invoke;
            var open = window.__TAURI__.dialog.open;

            open({
                title: 'Load Audio Track',
                multiple: false,
                filters: [{
                    name: 'Audio Files',
                    extensions: ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'webm']
                }]
            }).then(function (filePath) {
                if (!filePath) return; // User cancelled

                // Read the file via Rust backend
                invoke('read_file_base64', { path: filePath }).then(function (result) {
                    var base64Data = result.data;
                    var filename = result.filename;

                    // Decode the audio for playback
                    loadAudioFromBase64(base64Data, filename, false);

                }).catch(function (err) {
                    VF.toast('Failed to read audio file: ' + err);
                    console.error('Audio read error:', err);
                });
            }).catch(function (err) {
                console.error('Dialog error:', err);
            });
        });

        /* Remove audio button */
        $('#btn-remove-audio').on('click', function () {
            if (!A.buffer) return;

            var ask = window.__TAURI__.dialog.ask;
            ask('Remove audio track?', {
                title: 'Remove Audio',
                kind: 'warning'
            }).then(function (confirmed) {
                if (confirmed) VF.removeAudio(false);
            });
        });

        /* Volume slider */
        $('#rng-audio-vol').on('input', function () {
            VF.setAudioVolume(+this.value / 100);
            $('#v-audio-vol').text(this.value + '%');
        });

        /* Hook into FPS changes to rebuild waveform */
        $('#pref-fps').on('change.audio', function () {
            if (A.buffer) VF.rebuildWaveform();
        });

        /* Hook into end-frame changes to rebuild waveform */
        $('#pref-end').on('change.audio', function () {
            if (A.buffer) VF.rebuildWaveform();
        });
    });

})();