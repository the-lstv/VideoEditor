const { View, Renderer } = EditorBaseClasses;

/**
 * Video preview class
 */
class PreviewView extends View {
    constructor() {
        super({
            name: 'PreviewView',
            defaultSlots: ['top-right-row', 'top-right-left-row'],
            container: LS.Create({
                class: 'editor-preview',
                inner: [
                    { class: "preview-container", inner: { class: "preview-source-target" } },
                    { class: "preview-controls", inner: [
                        [
                            {
                                tag: "button",
                                class: "control-button square clear",
                                inner: { tag: "i", class: "bi-arrow-90deg-left" },
                                tooltip: "Jump to the beginning <kbd>Home</kbd>",
                                onclick: () => {}
                            },

                            {
                                tag: "button",
                                class: "control-button square clear",
                                inner: { tag: "i", class: "bi-arrow-left" },
                                tooltip: "Previous frame <kbd>Shift</kbd> + <kbd>←</kbd>",
                                onclick: () => {}
                            },

                            {
                                tag: "button",
                                class: "control-button square clear",
                                inner: { tag: "i", class: "bi-play-fill" },
                                tooltip: "Play/Pause <kbd>Space</kbd>",
                                onclick: () => {}
                            },

                            {
                                tag: "button",
                                class: "control-button square clear",
                                inner: { tag: "i", class: "bi-arrow-right" },
                                tooltip: "Next frame <kbd>Shift</kbd> + <kbd>→</kbd>",
                                onclick: () => {}
                            }
                        ],

                        [
                            { tag: "span", class: "preview-time-current", inner: "0:00", style: { color: "var(--accent)" } },
                            { tag: "span", inner: " / " },
                            { tag: "span", class: "preview-time-total", inner: "0:00" }
                        ],

                        [
                            {
                                tag: "button",
                                class: "control-button square clear",
                                inner: { tag: "i", class: "bi-arrows-fullscreen" },
                                tooltip: "Fullscreen <kbd>F</kbd>",
                                onclick: () => {}
                            }
                        ]
                    ] }
                ]
            })
        });

        this.sourceTargetElement = this.container.querySelector(".preview-source-target");
        this.sourceElement = null;

        this.container.addEventListener('click', () => {
            app.focusedPreview = this;
        });
    }

    setSource(source) {
        if(!(source instanceof Renderer || source instanceof HTMLVideoElement || source instanceof HTMLCanvasElement)) {
            console.error("PreviewView.setSource: source must be a Renderer, HTMLVideoElement or HTMLCanvasElement");
            return;
        }

        const isRenderer = source instanceof Renderer;

        if(this.sourceElement) this.sourceElement.remove();
        if(isRenderer) {
            this.sourceElement = source.canvas;
        } else {
            this.sourceElement = source;
        }

        this.sourceTargetElement.appendChild(this.sourceElement);
    }
}

/**
 * Timeline class
 */
class TimelineView extends View {
    constructor() {
        super({
            name: 'TimelineView',
            defaultSlots: ['bottom-right-row', 'left-panel'],
            container: LS.Create({
                class: 'editor-timeline',
                inner: [
                    { tag: "ls-timeline", class: "timeline-container" }
                ]
            })
        });

        this.timelineContainer = this.container.querySelector(".timeline-container");
        this.timeline = new LS.Timeline({
            element: this.timelineContainer,
            label(value, repeat, multiplier, scroll){
                let values = [];
                for(let i = 0; i < repeat; i++){
                    let seconds = value + (i * multiplier);
                    values.push(value + i == 0 ? "" : seconds+"s") // < 60 ? `${seconds}s` : seconds < 3600 ? `${(seconds / 60).toFixed(2)}m` : seconds < 86400 ? `${(seconds / 3600).toFixed(2)}h` : `${(seconds / 86400).toFixed(2)}d`)
                }
                return values
            },
            baseValue: 60
        });
    }
}

/**
 * Asset manager view class
 */
class AssetManagerView extends View {
    constructor() {
        super({
            name: 'AssetManagerView',
            defaultSlots: ['bottom-left-row', 'right-bottom'],
            container: LS.Create({
                class: 'editor-asset-manager',
                inner: [
                    { tag: 'h2', inner: 'Assets' }
                ]
            })
        });
    }
}

/**
 * Property editor view class
 */
class PropertyEditorView extends View {
    constructor() {
        super({
            name: 'PropertyEditorView',
            defaultSlots: ['top-left-row', 'top-right-right-row'],
            container: LS.Create({
                class: 'editor-property-editor'
            })
        });

        this.emptyMessage = LS.Create({
            class: "centered-layout",
            style: "flex-direction: column; color: var(--surface-8); text-align: center;",
            inner: [
                {
                    tag: "svg",
                    attributes: {
                        xmlns: "http://www.w3.org/2000/svg",
                        width: "5em",
                        height: "5em",
                        fill: "currentColor",
                        viewBox: "0 0 256 256"
                    },
                    innerHTML: `<path d="M120.85,28.42l8-16a8,8,0,0,1,14.31,7.16l-8,16a8,8,0,1,1-14.31-7.16ZM16,104h8a8,8,0,0,0,0-16H16a8,8,0,0,0,0,16ZM96,32a8,8,0,0,0,8-8V16a8,8,0,0,0-16,0v8A8,8,0,0,0,96,32ZM28.42,120.85l-16,8a8,8,0,0,0,7.16,14.31l16-8a8,8,0,1,0-7.16-14.31Zm135.65,15.9,50.34-21.88A16,16,0,0,0,213,85.07L52.92,32.8A15.95,15.95,0,0,0,32.8,52.92L85.07,213a15.82,15.82,0,0,0,14.41,11l.78,0a15.84,15.84,0,0,0,14.61-9.59l21.88-50.34L192,219.31a16,16,0,0,0,22.63,0l4.68-4.68a16,16,0,0,0,0-22.63Z"></path>`
                },
                { tag: "h1", inner: "Nothing selected", style: "margin: 10px 0" },
                { tag: "h3", inner: "Select an element to edit it", style: "margin: 0; font-weight: normal; color: var(--surface-6);" }
            ]
        });

        this.container.appendChild(this.emptyMessage);
    }
}

window.EditorViews = {
    PreviewView,
    TimelineView,
    AssetManagerView,
    PropertyEditorView
};