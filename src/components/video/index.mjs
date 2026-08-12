/**
 * Abstract utilities for video decoding and encoding.
 * @copyright 2026 lstv.space
 * @license GPL-3.0
 */

// I usually despise 3rd party libraries but I love this library
// It covers and does everything and just works
// Nevermind, I just read some of it's code... oh god :'(
// Either way pretty neat. Let's hope it won't turn into slop.
import { 
    Input, Output, UrlSource, FilePathSource,

    OutputFormat,

    // Video formats
    Mp4OutputFormat, WebMOutputFormat, MkvOutputFormat,

    // Audio formats
    WavOutputFormat, OggOutputFormat, FlacOutputFormat, Mp3OutputFormat,
    
    BufferTarget, FilePathTarget,
    VideoSampleSink, ALL_FORMATS, VideoSample, CanvasSink,

    getFirstEncodableVideoCodec, CanvasSource,
    
    // QUALITY_HIGH, ...
    Quality
} from "mediabunny";

// We can just set ._factor to get anything i guess, no need to overcomplicate it
// The getters seem to recalculate it every time anyway
const SHARED_QUALITY = new Quality(1);
function getQuality(factor) {
    SHARED_QUALITY._factor = factor;
    return SHARED_QUALITY;
}

if(localStorage.getItem("suppressSlowFramesWarning") === "true") {
    globalThis.slowFramesWarningShown = true;
}

/**
 * Placeholder video decoder helper class
 */
class VideoDecoder {
    constructor(resource, options = {}) {
        this.resource = resource;
        this.ready = false;

        this.slowFrames = 0;
        this.sinceLastSlowFrame = 0;

        this.options = options;
        
        // Video will be provided to the engine as a simple texture for rendering
        if(!this.options.noCanvas) {
            this.canvas = document.createElement('canvas');

            // I don't think willReadFrequently is a good idea here since it forces CPU readback
            // Correct me if I'm wrong, I don't have a way to benchmark this at the moment and I am unaware of how the upload/download pipeline works in this setup
            this.ctx = this.canvas.getContext('2d');
        }

        this._initPromise = this.init();
    }

    async init() {
        try {
            this.input = new Input({
                // UrlSource should then be used for remote videos
                // TODO: use blobs in local files in the browser when possible
                source: isNode? new FilePathSource(this.resource.fullPath): new UrlSource(this.resource.getURI()),

                // Supports HLS, MP4, QTFF, MATROSKA, WEBM, WAVE, OGG, FLAC, MP3, ADTS, MPEG_TS!
                formats: ALL_FORMATS
            });

            this.duration = await this.input.computeDuration();
            this.videoTrack = await this.input.getPrimaryVideoTrack();

	        const decodable = await this.videoTrack.canDecode();
            if (!decodable) {
                console.warn("VideoDecoder: Browser may not support decoding this video codec.");
            }

            this.sink = new VideoSampleSink(this.videoTrack);
            this.ready = true;

            await this.seek(0);
            this._initPromise = null;
        } catch (error) {
            console.error("VideoDecoder: Failed to initialize", error);
        }
    }

    /**
     * Seeks to a specific time in the video and decodes the corresponding frame, then updates the target texture
     * @param {*} time The time to seek to (in seconds)
     * @param {Object} options Additional options for seeking (optional)
     * @param {number} options.videoFrameRate Custom framerate
     * @param {number} options.playbackRate Playback rate to simulate
     * @param {number} options.mediaOffset Time offset to apply to the media (in seconds)
     * @param {string} options.loopMode Loop mode for the media ("none", "loop", "pingpong")
     * @param {Object} target The target texture to update with the decoded frame
     * @param {number} offset Additional offset to apply in seconds
     */
    async seek(time, options = {}, target, offset = 0) {
        if (!this.ready) await this._initPromise;
        if (!this.ready || !this.sink) return false;

        const framerateLimit = options.videoFrameRate || -1;
        const playbackRate = options.playbackRate ?? 1;
        const mediaOffset = options.mediaOffset ?? 0;
        const loopMode = options.loopMode || "loop";
        const duration = this.duration;

        if (framerateLimit > 0) {
            time = (time * framerateLimit | 0) / framerateLimit;
        }

        // Apply media offset and playback rate
        time = (time - mediaOffset - offset) * playbackRate;

        // Looping (ping-pong takes precedence over regular loop).
        if (duration > 0) {
            if (loopMode === "pingpong") {
                const cycle = duration * 2;
                const t = ((time % cycle) + cycle) % cycle;
                time = t > duration ? cycle - t : t;
            } else if (loopMode === "loop") {
                time = ((time % duration) + duration) % duration;
            }
        }

        // Clamp to valid range.
        const newTime = time < 0 ? 0 : (time > duration ? duration : time);

        if(this.targetTime === newTime) return false;
        this.targetTime = newTime;

        if(this.isSeeking) {
            if(!globalThis.slowFramesWarningShown && performance.now() - this.sinceLastSlowFrame > 100) {
                this.slowFrames ++;
                this.sinceLastSlowFrame = performance.now();

                if(this.slowFrames > 30) {
                    this.#showSlowFramesWarning();

                    globalThis.slowFramesWarningShown = true;
                }
            }
            return true;
        }

        this.isSeeking = true;

        while (true) {
            const currentTarget = this.targetTime;
            if (this.currentTime === currentTarget) {
                this.isSeeking = false;
                return false;
            }

            this.currentTime = currentTarget;

            let sample;

            try {
                sample = await this.sink.getSample(currentTarget);
            } catch (error) {
                console.error("VideoDecoder: Error seeking to frame", error);
                break;
            }

            if (sample) this.drawSample(sample, target);

            // The task was too long and the client has moved on
            if(this.targetTime !== currentTarget) {
                // console.warn(`VideoDecoder: Target time changed from ${this.currentTime} to ${this.targetTime} while waiting for sample`);
                continue;
            }

            break;
        }

        this.isSeeking = false;
        return true;
    }

    /**
     * @param {VideoSample} sample
     * @param {Object} target The target THREE.js texture that is getting updated
     */
    drawSample(sample, target) {
        if(!this.options.noCanvas) {
            if (this.canvas.width !== sample.displayWidth || this.canvas.height !== sample.displayHeight) {
                this.canvas.width = sample.displayWidth;
                this.canvas.height = sample.displayHeight;
                if(target) target.dispose();
            }

            sample.draw(this.ctx, 0, 0);
            if(target) target.needsUpdate = true;
        }

        sample.close();
    }

    // ! todo; playback stream for efficient exporting.
    // async *playbackStream() {
    //     if (!this.ready || !this.sink) return;
    // }

    /**
     * Generates thumbnail images at evenly spaced intervals throughout the video
     * Useful for timeline generation
     * 
     * @param {*} count 
     * @returns An array of thumbnail image data
     */
    async generateThumbnails(count = 5) {
        if (!this.ready) return [];

        const canvasSink = new CanvasSink(this.videoTrack, { width: 160, height: 90 });
        const startTimestamp = await videoTrack.getFirstTimestamp();
		const endTimestamp = await videoTrack.computeDuration();

        for await (const result of canvasSink.canvasesAtTimestamps(
            Array.from({ length: count }, (_, i) => startTimestamp + i * (endTimestamp - startTimestamp) / (count - 1))
        )) {
            console.log(`Got thumbnail for timestamp ${timestamp}:`, result);
		}

        return thumbnails;
    }

    async generateProxy(options = {}) {
        if (!isNode) {
            throw new Error("VideoDecoder.generateProxy: Proxy generation is currently not supported in the browser.");
        }

        options.fps ??= 30;
        options.width ??= 1280;
        options.output ??= __dirname + "/video_proxies/" + this.resource.fullPath.replace(/\.[^/.]+$/, "") + "_proxy.mp4";

        const spawn = require("child_process").spawn;
        const path = require("path");
        const fs = require("fs");

        const progress = typeof options.progress === "function" ? options.progress : null;
        const cancelHook = typeof options.cancelHook === "function" ? options.cancelHook : null;

        const outputDir = path.dirname(options.output);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const ffmpegArgs = [
            "-i",
            this.resource.fullPath,

            "-vf",
            "scale=w='if(gt(iw," + options.width + ")," + options.width + ",iw)':h=-2" +
                (options.fps && options.fps > 0 ? `,fps=${options.fps}` : ""),

            "-c:v",
            "libx264",
            "-g",
            "1",
            "-keyint_min",
            "1",
            "-sc_threshold",
            "0",
            "-preset",
            "fast",

            options.output,
        ];

        const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
            stdio: ["pipe", "pipe", "pipe"],
        });

        let durationSeconds = null;
        let lastProgress = 0;

        const kill = (signal = "SIGTERM") => {
            try {
                ffmpeg.kill(signal);
            } catch {}
        };

        const cancel = () => {
            kill("SIGKILL");
            fs.unlink(options.output, () => {});
        };

        if (cancelHook) {
            cancelHook(cancel);
        }

        const parseTimeToSeconds = (time) => {
            // HH:MM:SS.xx
            const parts = time.split(":");
            if (parts.length !== 3) return 0;
            const [h, m, s] = parts;
            return (
                parseInt(h, 10) * 3600 +
                parseInt(m, 10) * 60 +
                parseFloat(s)
            );
        };

        const stderrBuffer = [];
        ffmpeg.stderr.on("data", (chunk) => {
            const text = chunk.toString();
            stderrBuffer.push(text);

            // duration
            if (durationSeconds === null) {
                const durMatch = text.match(/Duration:\s(\d+:\d+:\d+\.\d+)/);
                if (durMatch) {
                    durationSeconds = parseTimeToSeconds(durMatch[1]);
                }
            }

            // time progress
            const timeMatch = text.match(/time=(\d+:\d+:\d+\.\d+)/);
            if (timeMatch && durationSeconds) {
                const current = parseTimeToSeconds(timeMatch[1]);
                const pct = Math.min(1, current / durationSeconds);

                if (progress && pct !== lastProgress) {
                    lastProgress = pct;
                    progress(pct * 100);
                }
            }
        });

        return await new Promise((resolve, reject) => {
            ffmpeg.on("error", (err) => {
                reject(err);
            });

            ffmpeg.on("close", (code) => {
                if (code === 0) {
                    if (progress) progress(100);
                    resolve(options.output);
                } else {
                    reject(new Error("ffmpeg exited with code " + code + "\n" + stderrBuffer.join("")));
                }
            });
        });
    }

    generateProxyWithModal() {
        this.constructor.showProxyGenerationModal(this);
    }

    static proxyGenerationModal = LS.Modal.build({
        title: "Generate Proxy",
        content: LS.Create({
            style: "white-space: pre-wrap;",
            inner: [
                "Generating a proxy video will create an optimized copy of your video with improved scrub performance.\n\nThis copy will be in slightly lower quality and take a lot of disk space due to being uncompressed (may be over 10x the original size).\n\nThis process may take a long time depending on the video. This copy will not affect your export.\n\nYou can later manage proxy files and specify where they get saved in settings.\n\n\n",
                new LS.Range(LS.Range.PRESET_PROGRESS)
            ]
        }),
        buttons: [
            { label: "Close", class: "elevated cancel-button" },
            { label: "Start", class: "start-button" },
        ]
    }, { closeable: false });

    static showProxyGenerationModal(decoder) {
        const range = this.proxyGenerationModal.container.querySelector(".ls-range");
        range.value = 0;

        const startButton = this.proxyGenerationModal.container.querySelector(".start-button");
        const cancelButton = this.proxyGenerationModal.container.querySelector(".cancel-button");

        startButton.onclick = async () => {
            startButton.disabled = true;
            cancelButton.textContent = "Stop";

            try {
                await decoder.generateProxy({
                    progress(percent) {
                        range.value = percent;
                    },

                    cancelHook(hook) {
                        cancelButton.onclick = () => {
                            hook();
                            LS.Toast.show("Proxy video generation cancelled", { timeout: 3000 });
                            LS.Modal.closeFromElement(cancelButton);
                        };
                    }
                });

                LS.Toast.show("Proxy video generated successfully", { timeout: 3000 });
            } catch (err) {
                console.error("Failed to generate proxy video", err);
                LS.Toast.show("Failed to generate proxy video: " + err.message, { timeout: 3000 });
            } finally {
                startButton.disabled = false;
                cancelButton.textContent = "Close";
                range.value = 0;
            }
        };

        this.proxyGenerationModal.open({ focus: false });
        range.blur();
    }

    #showSlowFramesWarning() {
        LS.Modal.buildEphemeral({
            title: "Performance Notice",
            content: LS.Create({ html: "<pre style='white-space:pre-wrap'>VideoDecoder seems to be struggling to keep up with one or more of your video files.\nIt is likely that the video is compressed and not optimized for editing, which causes stuttering.\n\nTo improve scrub performance while editing, the editor can attempt to create a \"proxy\" copy of the video in a more editing-friendly format.\nThis copy will be in slightly lower quality and only used during editing, exported videos will use the original and won't have issues with stuttering.\n\n<strong>Warning:</strong> this process may take a long time (seconds to minutes, depending on the video and your system) and require a lot of disk space (proxy videos are uncompressed and may take many times the original video size).\n\n(File that caused this warning: " + this.resource.fullPath.replaceAll("<", "&lt;") + ")</pre>" }),
            buttons: [
                { label: "Ignore", class: "elevated" },
                { label: "Don't show", class: "elevated", onclick: (event) => {
                    localStorage.setItem("suppressSlowFramesWarning", "true");
                    LS.Modal.closeFromElement(event.target);
                } },
                { label: "Optimize", onclick: async (event) => {
                    LS.Modal.closeFromElement(event.target);
                    this.generateProxyWithModal();
                } }
            ]
        }, { closeable: false });
    }

    /** Clear the proxy video */
    clearProxy() {

    }

    async getMetadata(estimateFPS = false, extractTags = false, extractAudioInfo = false) {
        if (!this.ready) await this._initPromise;
        if (!this.ready) return null;

        const meta = {
            duration: this.duration,
            width: this.videoTrack?.displayWidth || 0,
            height: this.videoTrack?.displayHeight || 0,
            codedWidth: this.videoTrack?.codedWidth || 0,
            codedHeight: this.videoTrack?.codedHeight || 0,
            codec: this.videoTrack?.codec || "unknown",
            languageCode: this.videoTrack?.languageCode || "und",
        };

        if (estimateFPS) {
            // Estimate frame rate (FPS)
            const packetStats = await this.videoTrack.computePacketStats(100);
            meta.fps = packetStats.averagePacketRate;
        }

        if (extractTags) {
            if(!this.metadataTags) {
                await this.getMetadataTags();
            }

            meta.tags = this.metadataTags;
        }

        if(extractAudioInfo) {
            const audioTrack = await this.input.getPrimaryAudioTrack();
            if(audioTrack) {
                meta.audio = {
                    codec: await audioTrack.getCodec() || "unknown",
                    sampleRate: await audioTrack.sampleRate() || 0, // in Hz
                    channels: await audioTrack.getNumberOfChannels() || 0,
                };
            }
        }

        return meta;
    }

    async getMetadataTags() {
        if (!this.ready) await this._initPromise;
        if (!this.ready) return null;

        try {
            this.metadataTags = await this.input.getMetadataTags();
            return this.metadataTags;
        } catch (err) {
            console.warn("VideoDecoder: Failed to extract metadata tags", err);
            return null;
        }
    }

    destroy() {
        if(this.destroyed) return;

        // if(this.texture) {
        //     this.texture.dispose();
        //     this.texture = null;
        // }

        if (this.input) {
            this.input.dispose();
            this.input = null;
        }

        this.sink = null;
        this.ready = false;
        this.canvas = null;
        this.ctx = null;
        this.resource = null;
        this.destroyed = true;
        this.options = null;
    }
}



/**
 * Video encoder/renderer helper class
 * 
 * ! todo
 * 
 * Types:
 * - FFMPEG (WebAssembly) / native on Node.js
 * - WebCodecs API
 * - MediaRecorder API
 * - none (image sequence only)
 */
class VideoEncoder {
    /**
     * Creates a video encoder
     * @param {*} project Target project to render
     * @param {*} options Encoding options
     * @param {number} options.fps Frames per second
     * @param {boolean} options.alpha Whether to include alpha channel
    //  * @param {string} options.type Encoding type: 'ffmpeg', 'webcodecs', 'mediarecorder', 'none'
     * @param {boolean} options.audio Whether to include an audio stream (if supported)
     */
    constructor() {}

    /**
     * Exports a video from a renderer
     * @param {*} videoFlavor The videoFlavor instance to export from. Expected shape is: { renderer: { canvas: HTMLCanvasElement }, renderAtTime: function(time), timelineInstance: { duration: number } }, but the simple shape { canvas, renderAtTime(time), totalDuration } is also supported
     * @param {*} options Export options
     * @param {number} options.fps Frames per second
     * @param {boolean} options.alpha Whether to include alpha channel
     * @param {number} options.quality Subjective quality level
     * @param {number} options.offset Offset in seconds to start rendering from (defaults to 0)
     * @param {number} options.end Optional end time in seconds to stop rendering at (defaults to the end of the timeline)
     * @param {number} options.endPadding Optional padding in seconds to add after the end time (defaults to 0)
     * @param {string|OutputFormat} options.format The output video format (e.g. "mp4", "webm", "mkv") or a custom OutputFormat instance
     * @param {string} options.filePath Optional file path to save the video to (Node.js only)
     * 
     * @returns {Promise<Blob|string|ArrayBuffer>} A promise that resolves to the exported video as a Blob (browser) or file path (Node.js) or ArrayBuffer (if no filePath is provided). If options.getPreview is true, resolves to a temporary URL for previewing the video in the browser.
     * 
     * TODO: support audio export
     */
    static async exportVideo(videoFlavor, options = {}) {
        const canvas = videoFlavor.canvas || (videoFlavor.renderer?.renderer? videoFlavor.renderer.renderer : videoFlavor.renderer).canvas;

        videoFlavor.renderingMode = 1; // Set rendering mode to "export"
        
        if(!canvas) {
            throw new Error("VideoEncoder.exportVideo: Renderer does not have a canvas to capture");
        }

        const output = new Output({
			target: options.filePath? new FilePathTarget(options.filePath) : new BufferTarget(),
			format: options.format instanceof OutputFormat ? options.format : (options.format === "webm" ? new WebMOutputFormat() : options.format === "mkv" ? new MkvOutputFormat() : new Mp4OutputFormat()),
		});

		// Retrieve the first video codec supported by this browser that can be contained in the output format
		const videoCodec = await getFirstEncodableVideoCodec(output.format.getSupportedVideoCodecs(), {
			width: canvas.width,
			height: canvas.height,
		});

        if (!videoCodec) {
            throw new Error('Your browser doesn\'t support video encoding in this format: ' + output.format.name + '.');
        }

        const canvasSource = new CanvasSource(canvas, {
			codec: videoCodec,
			bitrate: getQuality(options.quality || 2),
		});

        const frameRate = options.fps || 30;

        videoFlavor.pause?.();

		output.addVideoTrack(canvasSource, { frameRate });

        await output.start();

        let timeOffset = options.offset ?? 0;

        const rawEnd = options.end ?? (videoFlavor.totalDuration? videoFlavor.totalDuration: (videoFlavor.timelineInstance ? videoFlavor.timelineInstance.duration : 0));
        const endTime = Math.max(0, rawEnd + (options.endPadding ?? 0));
        const totalFrames = Math.ceil((endTime - timeOffset) * frameRate);

        if (typeof videoFlavor.renderAtTime !== "function") {
            throw new Error("VideoFlavor does not have a render function");
        }

        for (let currentFrame = 0; currentFrame < totalFrames; currentFrame++) {
            const currentTime = (currentFrame / frameRate) + timeOffset;

            await videoFlavor.renderAtTime(currentTime);
            await canvasSource.add(currentTime, 1 / frameRate);
        }

        this.renderingMode = 0; // Reset rendering mode to "normal"

        canvasSource.close();
		await output.finalize();

        if(options.filePath) {
            return options.filePath;
        }

        if(options.getPreview) {
            const videoBlob = new Blob([output.target.buffer], { type: output.format.mimeType });
            const videoURL = URL.createObjectURL(videoBlob);
            return videoURL;
        }

        return output.target.buffer;
    }

    static async benchmark({ frameRate = 30, totalFrames = 300 } = {}) {
        const resultVideo = document.createElement("video");

        const renderCanvas = new OffscreenCanvas(1280, 720);
        const renderCtx = renderCanvas.getContext('2d', { alpha: false });

        // Benchmark encoding frames as fast as possible
        const output = new Output({
			target: new BufferTarget(), // Stored in memory
			format: new Mp4OutputFormat(),
		});

		// Retrieve the first video codec supported by this browser that can be contained in the output format
		const videoCodec = await getFirstEncodableVideoCodec(output.format.getSupportedVideoCodecs(), {
			width: renderCanvas.width,
			height: renderCanvas.height,
		});

		if (!videoCodec) {
			throw new Error('Your browser doesn\'t support video encoding.');
		}

        const canvasSource = new CanvasSource(renderCanvas, {
			codec: videoCodec,
			bitrate: getQuality(2),
		});

		output.addVideoTrack(canvasSource, { frameRate });

        await output.start();

        let currentFrame = 0, lastTime = performance.now(), times = [];
        for (currentFrame; currentFrame < totalFrames; currentFrame++) {
			const currentTime = currentFrame / frameRate;
            
			// Update the scene
            renderCtx.fillStyle = `hsl(${(currentTime * 60) % 360}, 100%, 50%)`;
            renderCtx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
            // renderCtx.fillStyle = "#fff";
            // renderCtx.font = "bold 48px sans-serif";
            // renderCtx.fillText(`Frame ${currentFrame + 1}, Time: ${currentTime.toFixed(2)}s, last time took: ${times[times.length - 1]?.toFixed?.(2) || 0}ms`, 50, 100);

            renderCtx.fillStyle = "#fff";
            renderCtx.fillRect(Math.cos(currentFrame) * 50 + 50, Math.sin(currentFrame) * 50 + 50, 50, 50);

			// Add the current state of the canvas as a frame to the video. Using `await` here is crucial to
			// automatically slow down the rendering loop when the encoder can't keep up.
			await canvasSource.add(currentTime, 1 / frameRate);

            const time = performance.now();
            times.push(time - lastTime);
            lastTime = time;
		}

        canvasSource.close();
		await output.finalize();

        const videoBlob = new Blob([output.target.buffer], { type: output.format.mimeType });
		resultVideo.src = URL.createObjectURL(videoBlob);
		void resultVideo.play();

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`Finished encoding`, resultVideo.src, `()\nAverage time per frame: ${avg}ms`, `\nAverage FPS: ${1000 / avg}\nA minute of video could take around ${avg * frameRate * 60 / 1000} minutes to encode at this speed.`);

        resultVideo.style.width = "320px";
        resultVideo.controls = true;
        return resultVideo;
    }
}

window._VideoDecoder = VideoDecoder;
window._VideoEncoder = VideoEncoder;

export { VideoEncoder, VideoDecoder };