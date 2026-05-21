/**
 * Abstract utilities for video decoding and encoding.
 * @copyright 2026 lstv.space
 * @license GPL-3.0
 */

// import * as THREE from 'three';

// I love this library
// It covers and does everything and just works, in a variety of ways.
// I usually despise 3rd party libraries and do everything myself whenever I can
// Nevermind, I just read some of it's code... oh god
const { 
    Input, Output, UrlSource, FilePathSource,
    Mp4OutputFormat, WebMOutputFormat, BufferTarget, 
    VideoSampleSink, ALL_FORMATS, VideoSample, CanvasSink
} = require("mediabunny");

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
     * @param {string} options.type Encoding type: 'ffmpeg', 'webcodecs', 'mediarecorder', 'none'
     * @param {boolean} options.audio Whether to include an audio stream (if supported)
     */
    constructor(project, options = {}) {
        this.project = project;

        this.options = LS.Util.defaults({
            fps: 30,
            alpha: false,
            type: 'webcodecs', // 'ffmpeg', 'webcodecs', 'mediarecorder', 'none'
            audio: true
        }, options);

        switch(this.options.type) {
            case 'ffmpeg':
                if(!isNode && !FFMPEG.isLoaded()) {
                    console.warn("VideoEncoder: FFMPEG is not loaded, falling back to WebCodecs");
                    this.options.type = 'webcodecs';
                }
                break;

            case 'webcodecs':
                if(typeof window === "undefined" || !('VideoEncoder' in window)) {
                    console.warn("VideoEncoder: WebCodecs API is not supported, falling back to MediaRecorder");
                    this.options.type = 'mediarecorder';
                }
                break;

            case 'mediarecorder':
                if(typeof window === "undefined" || !('MediaRecorder' in window)) {
                    console.warn("VideoEncoder: MediaRecorder API is not supported, falling back to image sequence only");
                    this.options.type = 'none';
                }
                break;
        }
    }

    /**
     * Extracts pixel data from the renderer
     * @param {*} renderer The renderer to extract from
     * @param {*} pixels The array to store pixel data in (optional)
     * @returns The pixel data array (RGBA or RGB depending on options)
     * 
     * Todo: should not be three.js specific
     */
    extractFrame(renderer, pixels) {
        renderer = renderer?.isWebGLRenderer? renderer: renderer?.renderer;
        if(!renderer?.getContext) return;

        const gl = renderer.getContext();
        const width = renderer.width || renderer.domElement.width;
        const height = renderer.height || renderer.domElement.height;

        if(this.options.alpha) {
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return;
        }

        const rgba = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

        // What was the thing below even for
        // for(let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        //     pixels[j] = rgba[i];
        //     pixels[j + 1] = rgba[i + 1];
        //     pixels[j + 2] = rgba[i + 2];
        // }

        return pixels? pixels.set(rgba): rgba;
    }

    /**
     * Renders video frames between the specified start and end times
     * @param {*} startTime The start time
     * @param {*} endTime The end time
     */
    async renderFrames(startTime, endTime) {
        const frameDuration = 1 / (this.options.fps || 30);
        const totalFrames = Math.ceil((endTime - startTime) / frameDuration);

        const wasPlaying = this.project.playing;
        if(wasPlaying) this.project.pause();

        for(let i = 0; i < totalFrames; i++) {
            const currentTime = startTime + i * frameDuration;
            await this.project.renderFrameAtTime(currentTime);

            // Extract frame pixels and feed to an encoder
            const width = this.project.renderer.renderer.width || this.project.renderer.width;
            const height = this.project.renderer.renderer.height || this.project.renderer.height;
            const pixelSize = this.options.alpha? 4: 3;
            const pixels = new Uint8Array(width * height * pixelSize);
            this.extractFrame(this.project.renderer, pixels);
            await this.digest({ time: currentTime, pixels, width, height });
        }

        if(wasPlaying) this.project.play();
    }

    /**
     * Processes a video frame to be encoded
     * @param {*} frame The frame to process
     */
    async digest(frame) {
        // ...
    }
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
     * @param {boolean} options.unlockedFramerate Disable framerate limit
     * @param {number} options.videoFrameRate Custom framerate
     * @param {number} options.playbackRate Playback rate to simulate
     * @param {number} options.mediaOffset Time offset to apply to the media (in seconds)
     * @param {string} options.loopMode Loop mode for the media ("none", "loop", "pingpong")
     * @param {Object} target The target texture to update with the decoded frame
     */
    async seek(time, options = {}, target) {
        if (!this.ready) await this._initPromise;
        if (!this.ready || !this.sink) return false;

        const playbackFramerate = options.unlockedFramerate ? (options.videoFrameRate || -1) : (options.videoFrameRate < 1 ? 30 : Math.min(30, options.videoFrameRate || 30));
        const playbackRate = options.playbackRate ?? 1;
        const mediaOffset = options.mediaOffset ?? 0;
        const loopMode = options.loopMode || "loop";
        const duration = this.duration;

        if (playbackFramerate > 0) {
            time = (time * playbackFramerate | 0) / playbackFramerate;
        }

        // Apply media offset and playback rate
        time = (time - mediaOffset) * playbackRate;

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
            if (this.currentTime === currentTarget) break;
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

        // console.log("Completed seeking");

        this.isSeeking = false;
        return false;
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
                new LS.Range(LS.Range.PRESET_PROGRESS).element
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

export { VideoEncoder, VideoDecoder };