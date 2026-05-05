// ! TODO !
// At some point we need proper native video decoding & encoding, this is a temporary solution


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

/**
 * Placeholder video decoder helper class
 */
class VideoDecoder {
    constructor(resource) {
        this.resource = resource;

        this.video = document.createElement('video');

        video.src = resource.getURI();
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;

        this.frameReady = false;

        video.play();

        this.texture = new THREE.VideoTexture(video);

        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = false;
    }

    update() {
        // To be added to exporting
        // this.video.requestVideoFrameCallback(() => {
        //     this.frameReady = true;
        // });

        if (this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
            this.texture.needsUpdate = true;
        }
    }

    seek(time) {
        this.video.currentTime = time;
    }

    destroy() {
        this.texture.dispose();
        this.video.pause();
        this.video.src = "";
    }
}

export { VideoEncoder, VideoDecoder };