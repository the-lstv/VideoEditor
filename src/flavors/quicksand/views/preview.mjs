/**
 * Game preview
 */
class PreviewView extends LS.View {
    static name = "gamePreviewPanel";

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
    }

    toggleFullscreen() {
        document.fullscreenElement === this.container? document.exitFullscreen(): this.container.requestFullscreen();
    }

    setSource(runtime) {
        const source = runtime.renderer.canvas;

        this.sourceElement = source;
        this.container.querySelector(".preview-source-target").appendChild(source);
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
            scale: contentAspect > canvasAspect ? renderedWidth / contentWidth : renderedHeight / contentHeight,
            contentWidth,
            contentHeight
        };
    }

    destroy() {
        // Clean up
        super.destroy();
    }
}

export default PreviewView;