// Mp4EncoderPlugin.kt
// ──────────────────────────────────────────────────────────────────────
// Place this file at:
//   src-tauri/gen/android/app/src/main/java/com/cinemint/pompedin/Mp4EncoderPlugin.kt
//
// Encodes a sequence of PNG frame images into an H.264 MP4 using
// Android's MediaCodec (hardware encoder) + MediaMuxer.
// Optionally muxes an audio track from a file on disk.
//
// Uses EGL + a GL textured quad to push Bitmap pixels into the
// encoder's input Surface, which is the most device-compatible path
// and avoids manual YUV colour-space conversion.
// ──────────────────────────────────────────────────────────────────────

package com.cinemint.pompedin

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.*
import android.opengl.*
import android.view.Surface
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

// ═══════════════════════════════════════════════════
//  Tauri plugin entry point
// ═══════════════════════════════════════════════════

@TauriPlugin
class Mp4EncoderPlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun encode(invoke: Invoke) {
        val args = invoke.parseArgs(app.tauri.plugin.JSObject::class.java)

        val inputDir    = args.getString("inputDir")
        val outputPath  = args.getString("outputPath")
        val fps         = args.optInt("fps", 12)
        val totalFrames = args.optInt("totalFrames", 0)
        val audioPath   = args.optString("audioPath", null)

        if (totalFrames <= 0) return invoke.reject("totalFrames must be > 0")

        // Run the heavy work off the main thread.
        Thread {
            try {
                doEncode(inputDir, outputPath, fps, totalFrames, audioPath)
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject("Encoding failed: ${e.message}")
            }
        }.start()
    }

    // ───────────────────────────────────────────────
    //  Top-level encode orchestrator
    // ───────────────────────────────────────────────
    private fun doEncode(
        inputDir: String,
        outputPath: String,
        fps: Int,
        totalFrames: Int,
        audioPath: String?
    ) {
        // 1. Discover frame dimensions from the first PNG.
        val firstFile = File(inputDir, "frame_0000.png")
        if (!firstFile.exists()) throw IllegalStateException("frame_0000.png not found in $inputDir")

        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(firstFile.absolutePath, opts)
        // MediaCodec requires even dimensions.
        val width  = (opts.outWidth  + 1) / 2 * 2
        val height = (opts.outHeight + 1) / 2 * 2

        // 2. Encode video frames → temp video-only MP4.
        //    If there's no audio we write directly to outputPath.
        val hasAudio = audioPath != null && File(audioPath).exists()
        val videoOnlyPath = if (hasAudio) "$outputPath.tmp_video.mp4" else outputPath

        encodeVideo(inputDir, videoOnlyPath, width, height, fps, totalFrames)

        // 3. If audio requested, mux video + audio into the final file.
        if (hasAudio) {
            try {
                muxVideoAndAudio(videoOnlyPath, audioPath!!, outputPath, fps, totalFrames)
            } finally {
                File(videoOnlyPath).delete()
            }
        }
    }

    // ═══════════════════════════════════════════════
    //  VIDEO ENCODING  (MediaCodec + EGL Surface)
    // ═══════════════════════════════════════════════

    private fun encodeVideo(
        inputDir: String,
        outputPath: String,
        width: Int,
        height: Int,
        fps: Int,
        totalFrames: Int
    ) {
        // ── Encoder setup ──────────────────────────
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, width * height * 4)   // generous bitrate
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }

        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)

        val inputSurface = encoder.createInputSurface()
        encoder.start()

        // ── EGL + GL setup ─────────────────────────
        val egl = EglHelper(inputSurface)
        egl.makeCurrent()
        val renderer = TextureRenderer()

        // ── Muxer (started lazily after first output format) ──
        val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var trackIndex = -1
        var muxerStarted = false

        val bufferInfo = MediaCodec.BufferInfo()
        val frameDurationUs = 1_000_000L / fps

        try {
            for (i in 0 until totalFrames) {
                // ── Load the PNG ───────────────────
                val frameFile = File(inputDir, "frame_%04d.png".format(i))
                if (!frameFile.exists()) continue

                val bmp = BitmapFactory.decodeFile(frameFile.absolutePath) ?: continue
                val scaled = if (bmp.width != width || bmp.height != height) {
                    Bitmap.createScaledBitmap(bmp, width, height, true).also { bmp.recycle() }
                } else bmp

                // ── Draw to encoder surface ────────
                renderer.draw(scaled, width, height)
                scaled.recycle()

                // Set the presentation timestamp *before* swapping.
                val ptsNs = i.toLong() * frameDurationUs * 1_000L
                egl.setPresentationTime(ptsNs)
                egl.swapBuffers()

                // ── Drain encoder output ───────────
                drainEncoder(encoder, bufferInfo, muxer, trackIndex, muxerStarted).let {
                    trackIndex   = it.first
                    muxerStarted = it.second
                }
            }

            // Signal end-of-stream and drain remaining data.
            encoder.signalEndOfInputStream()
            drainEncoder(encoder, bufferInfo, muxer, trackIndex, muxerStarted, endOfStream = true)

        } finally {
            renderer.release()
            egl.release()
            encoder.stop();  encoder.release()
            if (muxerStarted) { muxer.stop() }
            muxer.release()
        }
    }

    /**
     * Pull encoded buffers from the encoder and write them to the muxer.
     * Returns the (possibly updated) trackIndex and muxerStarted flag.
     */
    private fun drainEncoder(
        encoder: MediaCodec,
        info: MediaCodec.BufferInfo,
        muxer: MediaMuxer,
        trackIndexIn: Int,
        muxerStartedIn: Boolean,
        endOfStream: Boolean = false
    ): Pair<Int, Boolean> {
        var trackIndex   = trackIndexIn
        var muxerStarted = muxerStartedIn
        val timeoutUs    = if (endOfStream) 10_000L else 0L

        while (true) {
            val idx = encoder.dequeueOutputBuffer(info, timeoutUs)

            when {
                idx == MediaCodec.INFO_TRY_AGAIN_LATER -> return trackIndex to muxerStarted

                idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    check(!muxerStarted) { "Format changed after muxer started" }
                    trackIndex = muxer.addTrack(encoder.outputFormat)
                    muxer.start()
                    muxerStarted = true
                }

                idx >= 0 -> {
                    val buf = encoder.getOutputBuffer(idx)
                        ?: throw RuntimeException("Null encoder output buffer")

                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                        // Codec config data — already handled by muxer via format.
                        info.size = 0
                    }

                    if (info.size > 0 && muxerStarted) {
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        muxer.writeSampleData(trackIndex, buf, info)
                    }

                    encoder.releaseOutputBuffer(idx, false)

                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        return trackIndex to muxerStarted
                    }
                }
            }
        }
    }

    // ═══════════════════════════════════════════════
    //  AUDIO MUXING  (remux video + audio)
    // ═══════════════════════════════════════════════

    /**
     * Read the video-only MP4 and the raw audio file, then write a
     * combined MP4 with both tracks.  Audio is trimmed to video length.
     */
    private fun muxVideoAndAudio(
        videoPath: String,
        audioPath: String,
        outputPath: String,
        fps: Int,
        totalFrames: Int
    ) {
        val videoDurationUs = totalFrames.toLong() * 1_000_000L / fps

        val videoExtractor = MediaExtractor()
        videoExtractor.setDataSource(videoPath)
        val videoTrackSrc = findTrack(videoExtractor, "video/")
            ?: throw IllegalStateException("No video track in temp file")
        videoExtractor.selectTrack(videoTrackSrc)
        val videoFormat = videoExtractor.getTrackFormat(videoTrackSrc)

        val audioExtractor = MediaExtractor()
        audioExtractor.setDataSource(audioPath)
        val audioTrackSrc = findTrack(audioExtractor, "audio/")
            ?: throw IllegalStateException("No audio track in $audioPath")
        audioExtractor.selectTrack(audioTrackSrc)
        val audioFormat = audioExtractor.getTrackFormat(audioTrackSrc)

        val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val videoTrackDst = muxer.addTrack(videoFormat)
        val audioTrackDst = muxer.addTrack(audioFormat)
        muxer.start()

        val buf = ByteBuffer.allocate(1024 * 1024)  // 1 MB
        val info = MediaCodec.BufferInfo()

        try {
            // Copy video samples.
            copyTrack(videoExtractor, muxer, videoTrackDst, buf, info, Long.MAX_VALUE)

            // Copy audio samples, stopping at video duration.
            copyTrack(audioExtractor, muxer, audioTrackDst, buf, info, videoDurationUs)
        } finally {
            muxer.stop();  muxer.release()
            videoExtractor.release()
            audioExtractor.release()
        }
    }

    /** Find the first track whose MIME starts with [prefix]. */
    private fun findTrack(extractor: MediaExtractor, prefix: String): Int? {
        for (i in 0 until extractor.trackCount) {
            val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith(prefix)) return i
        }
        return null
    }

    /** Copy every sample from [extractor] into [muxer] on [trackIndex]. */
    private fun copyTrack(
        extractor: MediaExtractor,
        muxer: MediaMuxer,
        trackIndex: Int,
        buf: ByteBuffer,
        info: MediaCodec.BufferInfo,
        maxTimeUs: Long
    ) {
        while (true) {
            val size = extractor.readSampleData(buf, 0)
            if (size < 0) break
            val sampleTime = extractor.sampleTime
            if (sampleTime > maxTimeUs) break

            info.offset = 0
            info.size   = size
            info.presentationTimeUs = sampleTime
            info.flags  = extractor.sampleFlags
            muxer.writeSampleData(trackIndex, buf, info)
            extractor.advance()
        }
    }

    // ═══════════════════════════════════════════════
    //  EGL HELPER
    // ═══════════════════════════════════════════════

    /**
     * Minimal EGL 1.4 context bound to a MediaCodec input [Surface].
     * Provides [setPresentationTime] for per-frame timestamps.
     */
    private class EglHelper(surface: Surface) {
        private val display: EGLDisplay
        private val context: EGLContext
        private val eglSurface: EGLSurface

        init {
            display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            check(display != EGL14.EGL_NO_DISPLAY) { "eglGetDisplay failed" }

            val version = IntArray(2)
            check(EGL14.eglInitialize(display, version, 0, version, 1)) { "eglInitialize failed" }

            val configAttribs = intArrayOf(
                EGL14.EGL_RED_SIZE,       8,
                EGL14.EGL_GREEN_SIZE,     8,
                EGL14.EGL_BLUE_SIZE,      8,
                EGL14.EGL_ALPHA_SIZE,     8,
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
                EGL14.EGL_SURFACE_TYPE,   EGL14.EGL_WINDOW_BIT,
                EGL14.EGL_NONE
            )
            val configs = arrayOfNulls<EGLConfig>(1)
            val numConfigs = IntArray(1)
            check(EGL14.eglChooseConfig(display, configAttribs, 0, configs, 0, 1, numConfigs, 0)) {
                "eglChooseConfig failed"
            }
            val config = configs[0]!!

            val contextAttribs = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE)
            context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT, contextAttribs, 0)
            check(context != EGL14.EGL_NO_CONTEXT) { "eglCreateContext failed" }

            val surfaceAttribs = intArrayOf(EGL14.EGL_NONE)
            eglSurface = EGL14.eglCreateWindowSurface(display, config, surface, surfaceAttribs, 0)
            check(eglSurface != EGL14.EGL_NO_SURFACE) { "eglCreateWindowSurface failed" }
        }

        fun makeCurrent() {
            check(EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)) {
                "eglMakeCurrent failed"
            }
        }

        fun setPresentationTime(nsecs: Long) {
            EGLExt.eglPresentationTimeANDROID(display, eglSurface, nsecs)
        }

        fun swapBuffers() {
            EGL14.eglSwapBuffers(display, eglSurface)
        }

        fun release() {
            EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            EGL14.eglDestroySurface(display, eglSurface)
            EGL14.eglDestroyContext(display, context)
            EGL14.eglTerminate(display)
        }
    }

    // ═══════════════════════════════════════════════
    //  GL TEXTURE RENDERER
    // ═══════════════════════════════════════════════

    /**
     * Draws a [Bitmap] to the current GL context as a textured
     * full-screen quad.  Handles the Y-flip so the image is right-side up.
     */
    private class TextureRenderer {
        private val textureId: Int
        private val program: Int
        private val vertexBuffer: FloatBuffer

        // Attribute / uniform locations
        private val aPosition: Int
        private val aTexCoord: Int
        private val uTexture: Int

        // Fullscreen quad: position (x,y) + texcoord (s,t)
        // Tex-coords are Y-flipped so Bitmap top-left maps to GL top-left.
        companion object {
            private val QUAD = floatArrayOf(
                // x      y     s    t
                -1f, -1f,  0f, 1f,   // bottom-left
                 1f, -1f,  1f, 1f,   // bottom-right
                -1f,  1f,  0f, 0f,   // top-left
                 1f,  1f,  1f, 0f,   // top-right
            )

            private const val VERTEX_SHADER = """
                attribute vec4 aPosition;
                attribute vec2 aTexCoord;
                varying   vec2 vTexCoord;
                void main() {
                    gl_Position = aPosition;
                    vTexCoord   = aTexCoord;
                }
            """

            private const val FRAGMENT_SHADER = """
                precision mediump float;
                varying vec2      vTexCoord;
                uniform sampler2D uTexture;
                void main() {
                    gl_FragColor = texture2D(uTexture, vTexCoord);
                }
            """
        }

        init {
            // Upload quad geometry.
            vertexBuffer = ByteBuffer.allocateDirect(QUAD.size * 4)
                .order(ByteOrder.nativeOrder())
                .asFloatBuffer()
                .put(QUAD)
            vertexBuffer.position(0)

            // Create texture.
            val tex = IntArray(1)
            GLES20.glGenTextures(1, tex, 0)
            textureId = tex[0]
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

            // Compile shaders and link program.
            program = createProgram(VERTEX_SHADER, FRAGMENT_SHADER)
            aPosition = GLES20.glGetAttribLocation(program, "aPosition")
            aTexCoord = GLES20.glGetAttribLocation(program, "aTexCoord")
            uTexture  = GLES20.glGetUniformLocation(program, "uTexture")
        }

        /** Upload [bitmap] to the texture and draw the quad. */
        fun draw(bitmap: Bitmap, viewportW: Int, viewportH: Int) {
            GLES20.glViewport(0, 0, viewportW, viewportH)
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)

            GLES20.glUseProgram(program)

            // Upload bitmap pixels.
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
            GLES20.glUniform1i(uTexture, 0)

            // Position attribute (2 floats, stride 4 floats).
            vertexBuffer.position(0)
            GLES20.glEnableVertexAttribArray(aPosition)
            GLES20.glVertexAttribPointer(aPosition, 2, GLES20.GL_FLOAT, false, 16, vertexBuffer)

            // Texcoord attribute (2 floats, offset 2).
            vertexBuffer.position(2)
            GLES20.glEnableVertexAttribArray(aTexCoord)
            GLES20.glVertexAttribPointer(aTexCoord, 2, GLES20.GL_FLOAT, false, 16, vertexBuffer)

            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

            GLES20.glDisableVertexAttribArray(aPosition)
            GLES20.glDisableVertexAttribArray(aTexCoord)
        }

        fun release() {
            val tex = intArrayOf(textureId)
            GLES20.glDeleteTextures(1, tex, 0)
            GLES20.glDeleteProgram(program)
        }

        // ── Shader helpers ─────────────────────────

        private fun createProgram(vertSrc: String, fragSrc: String): Int {
            val vs = loadShader(GLES20.GL_VERTEX_SHADER, vertSrc)
            val fs = loadShader(GLES20.GL_FRAGMENT_SHADER, fragSrc)
            val prog = GLES20.glCreateProgram()
            GLES20.glAttachShader(prog, vs)
            GLES20.glAttachShader(prog, fs)
            GLES20.glLinkProgram(prog)
            val status = IntArray(1)
            GLES20.glGetProgramiv(prog, GLES20.GL_LINK_STATUS, status, 0)
            check(status[0] != 0) { "glLinkProgram failed: ${GLES20.glGetProgramInfoLog(prog)}" }
            GLES20.glDeleteShader(vs)
            GLES20.glDeleteShader(fs)
            return prog
        }

        private fun loadShader(type: Int, source: String): Int {
            val shader = GLES20.glCreateShader(type)
            GLES20.glShaderSource(shader, source)
            GLES20.glCompileShader(shader)
            val status = IntArray(1)
            GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
            check(status[0] != 0) { "glCompileShader failed: ${GLES20.glGetShaderInfoLog(shader)}" }
            return shader
        }
    }
}