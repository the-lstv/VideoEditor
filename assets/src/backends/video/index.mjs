// ! TODO !
// At some point we need proper native video decoding & encoding, this is a temporary solution


// import * as THREE from 'three';

// I love this library. It covers everything and saved me a lot of work. I think the first 3rd party library that is an enjoyment to use
const { 
    Input, Output, UrlSource, FilePathSource,
    Mp4OutputFormat, WebMOutputFormat, BufferTarget, 
    VideoSampleSink, ALL_FORMATS, VideoSample, CanvasSink
} = require("mediabunny");

/**
 * Video encoder/renderer helper class
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
    constructor(resource) {
        this.resource = resource;
        this.ready = false;

        this.canvas = document.createElement('canvas');

        // I don't think willReadFrequently is a good idea since it forces CPU readback
        // this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.ctx = this.canvas.getContext('2d');

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.generateMipmaps = false;
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.needsUpdate = false;

        this.slowFrames = 0;
        this.sinceLastSlowFrame = 0;

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

    async seek(time) {
        if (!this.ready) await this._initPromise;
        if (!this.ready || !this.sink) return;

        if(this.isSeeking) {
            if(!globalThis.slowFramesWarningShown && performance.now() - this.sinceLastSlowFrame > 100) {
                this.slowFrames ++;
                this.sinceLastSlowFrame = performance.now();
    
                if(this.slowFrames > 30) {
                    LS.Modal.buildEphemeral({
                        title: "Performance Notice",
                        content: LS.Create({ html: "<pre style='white-space:pre-wrap'>VideoDecoder seems to be struggling to keep up with one or more of your video files.\nIt is likely that the video is compressed and not optimized for editing, which causes stuttering.\n\nTo improve scrub performance while editing, the editor can attempt to create a \"proxy\" copy of the video in a more editing-friendly format.\nThis copy will be in slightly lower quality and only used during editing, exported videos will use the original and won't have issues with stuttering.\n\n<strong>Warning:</strong> this process may take a long time (seconds to minutes, depending on the video and your system) and require a lot of disk space (proxy videos are uncompressed and may take many times the original video size).</pre>" }),
                        buttons: [
                            { label: "Ignore", class: "elevated" },
                            { label: "Don't show", class: "elevated", onclick: (event) => {
                                localStorage.setItem("suppressSlowFramesWarning", "true");
                                event.target.closest(".ls-modal").lsComponent.close();
                            } },
                            { label: "Optimize", onclick: async (event) => {
                                event.target.closest(".ls-modal").lsComponent.close();

                                // ! todo
                            } }
                        ]
                    }, { closeable: false });
                    globalThis.slowFramesWarningShown = true;
                }
            }
            return;
        }

        // Snap to 30FPS & clamp to duration for better editing performance.
        const newTime = Math.max(0, Math.min((time * 30 | 0) / 30, this.duration));
        if(this.currentTime === newTime) return;

        this.isSeeking = true;
        this.currentTime = newTime;

        try {
            const sample = await this.sink.getSample(this.currentTime);
            if (sample) this.drawSample(sample);
        } catch (error) {
            console.error("VideoDecoder: Error seeking to frame", error);
        } finally {
            this.isSeeking = false;
        }
    }

    /**
     * @param {VideoSample} sample
     */
    drawSample(sample) {
        if (this.canvas.width !== sample.displayWidth || this.canvas.height !== sample.displayHeight) {
            this.canvas.width = sample.displayWidth;
            this.canvas.height = sample.displayHeight;
            this.texture.dispose();
        }

        sample.draw(this.ctx, 0, 0);
        this.texture.needsUpdate = true;
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

    destroy() {
        if(this.destroyed) return;
        this.texture.dispose();

        if (this.input) {
            this.input.dispose();
        }

        this.input = null;
        this.sink = null;
        this.ready = false;
        this.texture = null;
        this.canvas = null;
        this.ctx = null;
        this.resource = null;
        this.destroyed = true;
    }
}

export { VideoEncoder, VideoDecoder };