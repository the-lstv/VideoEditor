import RendererAdapter from "../backends/rendering/adapter-base.mjs";

/**
 * Visual preview view class
 */
class PreviewView extends LS.Multipane.View {
    static name = "videoPreview";

    constructor() {
        super({
            name: 'PreviewView',
            title: 'Preview',
            container: LS.Create({
                class: 'editor-preview'
            })
        });

        this.container.add([
            { class: "preview-container", inner: { class: "preview-source-target" } },
            { class: "preview-controls controls-bar", inner: [
                [
                    {
                        tag: "button",
                        class: "control-button square clear",
                        inner: { tag: "i", class: "bi-arrow-90deg-left" },
                        style: "font-size: smaller",
                        tooltip: "Jump to the beginning <kbd>Home</kbd>",
                        onclick: () => this.seek(0, true)
                    },

                    {
                        tag: "button",
                        class: "control-button square clear",
                        inner: { tag: "i", class: "bi-arrow-left" },
                        tooltip: "Previous frame <kbd>Shift</kbd> + <kbd>←</kbd>",
                        onclick: () => {}
                    },

                    (this.__playButton = LS.Create("button", {
                        class: "control-button square clear",
                        inner: { tag: "i", class: "bi-play-fill" },
                        tooltip: "Play/Pause <kbd>Space</kbd>",
                        onclick: () => this.togglePlay()
                    })),

                    {
                        tag: "button",
                        class: "control-button square clear",
                        inner: { tag: "i", class: "bi-arrow-right" },
                        tooltip: "Next frame <kbd>Shift</kbd> + <kbd>→</kbd>",
                        onclick: () => {}
                    },

                    {
                        tag: "button",
                        class: "control-button square clear",
                        inner: { tag: "i", class: "bi-arrow-90deg-right" },
                        style: "font-size: smaller",
                        tooltip: "Jump to the end <kbd>End</kbd>",
                        onclick: () => this.seek(this.details.totalTime)
                    },
                ],

                [
                    { tag: "span", class: "preview-time-current", inner: "0:00", style: { color: "var(--accent)" } },
                    { tag: "span", inner: "/" },
                    { tag: "span", class: "preview-time-total", inner: "0:00" }
                ],

                [
                    {
                        tag: "button",
                        class: "control-button square clear",
                        style: "font-size: smaller",
                        inner: { tag: "i", class: "bi-arrows-fullscreen" },
                        tooltip: "Fullscreen <kbd>F</kbd>",
                        onclick: () => {
                            this.toggleFullscreen();
                        }
                    }
                ]
            ] }
        ]);

        this.sourceTargetElement = this.container.querySelector(".preview-source-target");
        this.sourceElement = null;

        this.isAttachedToRenderer = false;

        this.container.addEventListener('click', () => {
            app.focusedPreview = this;
        });

        // Event handlers
        this.__playHandler = null;
        this.__pauseHandler = null;
        this.__seekHandler = null;
        this.__durationChangedHandler = null;
        this.__attachedEmitter = null;

        const previewTimeCurrent = this.container.querySelector(".preview-time-current");
        const previewTimeTotal = this.container.querySelector(".preview-time-total");

        this.details = {};
        this.frameScheduler = new LS.Util.FrameScheduler((delta) => {
            previewTimeCurrent.textContent = this.#formatTime(this.details.time, true);
            previewTimeTotal.textContent = this.#formatTime(this.details.totalTime);

            if(this.__playButton) this.__playButton.querySelector("i").className = this.details.playing? "bi-pause-fill": "bi-play-fill";
        });

        // We limit to 30 FPS to reduce CPU/GPU usage
        // Since this is not a high priority update
        this.frameScheduler.limitFPS(30);
    }

    #formatTime(seconds, decisecond = false) {
        if(isNaN(seconds) || !isFinite(seconds)) return "0:00";
        
        const totalSeconds = Math.floor(seconds);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        let timeString = mins + ":" + (secs < 10 ? "0" : "") + secs;

        if(decisecond) {
            const ds = Math.floor((seconds - totalSeconds) * 10);
            timeString += "." + ds;
        }

        return timeString;
    }

    #updatePlay(playing) {
        if(playing === this.details.playing) return;
        this.details.playing = playing;
        this.frameScheduler.schedule();
    }

    #updateSeek(time) {
        if(time === this.details.time) return;
        this.details.time = time;
        this.frameScheduler.schedule();
    }

    #updateDuration(totalTime) {
        if(totalTime === this.details.totalTime) return;
        this.details.totalTime = totalTime;
        this.frameScheduler.schedule();
    }

    #getAttachment() {
        return this.attachedTo || this.parent;
    }

    setSource(source) {
        if(!source) {
            return this.clearSource();
        }

        if(!(source instanceof RendererAdapter || source instanceof HTMLMediaElement || source instanceof HTMLCanvasElement)) {
            console.error("PreviewView.setSource: source must be a Renderer, HTMLMediaElement or HTMLCanvasElement");
            return;
        }

        // Clean previous source
        this.clearSource();

        this.isAttachedToRenderer = source instanceof RendererAdapter;
        if(this.isAttachedToRenderer) {
            const attachment = this.#getAttachment();
            if(!attachment) {
                console.error("PreviewView.setSource: cannot attach to renderer without an attachment or parent project");
                return;
            }

            this.sourceElement = source.canvas;
            this.__attachedEmitter = attachment;
            attachment?.on('seek', this.__seekHandler = (time) => this.#updateSeek(time));
            attachment?.on('duration-changed', this.__durationChangedHandler = (duration) => this.#updateDuration(duration));
            attachment?.on('playing-changed', this.__playHandler = (playing) => this.#updatePlay(playing));
            this.#updatePlay(attachment?.playing);
            this.#updateSeek(attachment?.time || 0);
            this.#updateDuration(attachment?.duration || 0);
        } else {
            this.sourceElement = source;
            this.sourceElement.addEventListener('timeupdate', this.__seekHandler = () => this.#updateSeek(this.sourceElement.currentTime));
            this.sourceElement.addEventListener('play', this.__playHandler = () => this.#updatePlay(true));
            this.sourceElement.addEventListener('pause', this.__pauseHandler = () => this.#updatePlay(false));
            this.#updatePlay(!this.sourceElement.paused);
            this.#updateSeek(this.sourceElement.currentTime);
            this.#updateDuration(this.sourceElement.duration);
        }

        this.sourceTargetElement.appendChild(this.sourceElement);
    }

    clearSource() {
        if(this.sourceElement) {
            if(this.isAttachedToRenderer) {
                this.__attachedEmitter?.off('seek', this.__seekHandler);
                this.__attachedEmitter?.off('playing-changed', this.__playHandler);
                this.__attachedEmitter?.off('duration-changed', this.__durationChangedHandler);
                this.__attachedEmitter = null;
            } else {
                this.sourceElement.removeEventListener('timeupdate', this.__seekHandler);
                this.sourceElement.removeEventListener('play', this.__playHandler);
                this.sourceElement.removeEventListener('pause', this.__pauseHandler);
                
                this.sourceElement.remove();
                this.sourceElement = null;
            }
        }

        this.__playHandler = null;
        this.__pauseHandler = null;
        this.__seekHandler = null;
        this.__durationChangedHandler = null;
    }

    togglePlay() {
        if(this.isAttachedToRenderer) {
            this.#getAttachment()?.togglePlay?.();
        } else if(this.sourceElement instanceof HTMLMediaElement) {
            if(this.sourceElement.paused) {
                this.sourceElement.play();
            } else {
                this.sourceElement.pause();
            }
        }
    }

    play() {
        if(this.isAttachedToRenderer) {
            this.#getAttachment()?.play?.();
        } else if(this.sourceElement instanceof HTMLMediaElement) {
            this.sourceElement.play();
        }
    }

    pause() {
        if(this.isAttachedToRenderer) {
            this.#getAttachment()?.pause?.();
        } else if(this.sourceElement instanceof HTMLMediaElement) {
            this.sourceElement.pause();
        }
    }

    stop() {
        if(this.isAttachedToRenderer) {
            this.#getAttachment()?.pause?.();
        } else if(this.sourceElement instanceof HTMLMediaElement) {
            this.sourceElement.pause();
            this.sourceElement.currentTime = 0;
        }
    }

    seek(time, moveCamera = false) {
        if(time === -1) time = this.details.totalTime;

        if(this.isAttachedToRenderer) {
            this.#getAttachment()?.seek?.(time, moveCamera);
        } else if(this.sourceElement instanceof HTMLMediaElement) {
            this.sourceElement.currentTime = time;
        }
    }

    toggleFullscreen() {
        document.fullscreenElement === this.container ?
            document.exitFullscreen() :
            this.container.requestFullscreen();
    }

    getContainedCoords() {
        const canvasWidth = this.sourceElement.offsetWidth;
        const canvasHeight = this.sourceElement.offsetHeight;

        const contentWidth = this.sourceElement.width;
        const contentHeight = this.sourceElement.height;

        const canvasAspect = canvasWidth / canvasHeight;
        const contentAspect = contentWidth / contentHeight;

        let renderedWidth, renderedHeight;

        // Determine which dimension is constrained
        if (contentAspect > canvasAspect) {
            renderedWidth = canvasWidth;
            renderedHeight = canvasWidth / contentAspect;
        } else {
            renderedHeight = canvasHeight;
            renderedWidth = canvasHeight * contentAspect;
        }

        // Calculate offset (centering)
        const left = (canvasWidth - renderedWidth) / 2;
        const top = (canvasHeight - renderedHeight) / 2;

        return {
            left,
            top,
            width: renderedWidth,
            height: renderedHeight,
            scale: contentAspect > canvasAspect ? renderedWidth / contentWidth : renderedHeight / contentHeight
        };
    }

    destroy() {
        // Clean up
        this.clearSource();
        this.stop();
        this.sourceTargetElement = null;
        this.__seekHandler = null;
        this.__playHandler = null;
        this.__pauseHandler = null;
        this.__attachedEmitter = null;
        this.__playButton = null;
        super.destroy();
    }
}

export default PreviewView;