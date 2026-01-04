/**
 * Video preview class
 */
class PreviewView extends EditorBaseClasses.View {
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

                    (this.__playButton = N({
                        tag: "button",
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
                    }
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

    setSource(source) {
        if(!source) {
            return this.clearSource();
        }

        if(!(source instanceof LS.GL.Renderer || source instanceof HTMLMediaElement || source instanceof HTMLCanvasElement)) {
            console.error("PreviewView.setSource: source must be a Renderer, HTMLMediaElement or HTMLCanvasElement");
            return;
        }

        // Clean previous source
        this.clearSource();

        this.isAttachedToRenderer = source instanceof LS.GL.Renderer;
        if(this.isAttachedToRenderer) {
            if(!this.parent) {
                console.error("PreviewView.setSource: cannot attach to renderer without a parent project");
                return;
            }

            this.sourceElement = source.canvas;
            this.parent?.on('seek', this.__seekHandler = (time) => this.#updateSeek(time));
            this.parent?.on('duration-changed', this.__durationChangedHandler = (duration) => this.#updateDuration(duration));
            this.parent?.on('playing-changed', this.__playHandler = (playing) => this.#updatePlay(playing));
            this.#updatePlay(this.parent?.playing);
            this.#updateSeek(this.parent?.time || 0);
            this.#updateDuration(this.parent?.duration || 0);
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
                this.parent?.off('seek', this.__seekHandler);
                this.parent?.off('playing-changed', this.__playHandler);
                this.parent?.off('duration-changed', this.__durationChangedHandler);
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
    }

    togglePlay() {
        if(this.isAttachedToRenderer) {
            this?.parent?.togglePlay();
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
            this?.parent?.play();
        } else if(this.sourceElement instanceof HTMLMediaElement) {
            this.sourceElement.play();
        }
    }

    pause() {
        if(this.isAttachedToRenderer) {
            this?.parent?.pause();
        } else if(this.sourceElement instanceof HTMLMediaElement) {
            this.sourceElement.pause();
        }
    }

    stop() {
        if(this.isAttachedToRenderer) {
            this?.parent?.pause();
        } else if(this.sourceElement instanceof HTMLMediaElement) {
            this.sourceElement.pause();
            this.sourceElement.currentTime = 0;
        }
    }

    seek(time, moveCamera = false) {
        if(time === -1) time = this.details.totalTime;

        if(this.isAttachedToRenderer) {
            this?.parent?.seek(time, moveCamera);
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
        this.__playButton = null;
        super.destroy();
    }
}


/**
 * Timeline class
 */
class TimelineView extends EditorBaseClasses.View {
    constructor() {
        super({
            name: 'TimelineView',
            title: 'Timeline',
            container: LS.Create({
                class: 'editor-timeline',
                inner: [
                    {
                        class: 'timeline-header controls-bar',
                        inner: [
                            [
                                { tag: "button", class: "control-button square clear", inner: { tag: "i", class: "bi-scissors" }, tooltip: "Cutting tool <kbd>Ctrl</kbd> + <kbd>X</kbd>", onclick: () => {
                                    // 
                                } },
                                { tag: "button", class: "control-button square clear", inner: { tag: "i", class: "bi-plus-lg" }, tooltip: "Add track", onclick: () => {
                                    this.timeline.addTrack();
                                } },
                                // { tag: "ls-select", tooltip: "Select timeline", onchange: (e) => {
                                //     const selectedTrack = e.target.value;
                                //     this.timeline.selectTrack(selectedTrack);
                                // } }
                            ],

                            [
                                { tag: "button", class: "control-button square clear", inner: { tag: "i", class: "bi-zoom-in" }, tooltip: "Zoom in <kbd>+</kbd>", onclick: () => {
                                    this.timeline.zoomIn();
                                } },
                                { tag: "button", class: "control-button square clear", inner: { tag: "i", class: "bi-zoom-out" }, tooltip: "Zoom out <kbd>-</kbd>", onclick: () => {
                                    this.timeline.zoomOut();
                                } }
                            ]
                        ]
                    }
                ]
            })
        });

        this.timeline = new LS.Timeline({
            element: this.container,
            allowAutomationClips: true,
            autoCreateAutomationClips: true,
        });

        const seekEventRef = this.prepareEvent("seek");
        this.timeline.on('seek', time => {
            this.emit(seekEventRef, time);
        });
    }

    setData(data) {
        this.timeline.reset(true, data);
    }

    destroy() {
        this.timeline.destroy();
        this.timeline = null;
        super.destroy();
    }
}


/**
 * Property editor view class
 */
class PropertyEditorView extends EditorBaseClasses.View {
    constructor() {
        super({
            name: 'PropertyEditorView',
            title: 'Properties',
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
                { tag: "h1", inner: "Nothing selected", style: "margin: 10px 0px 5px 0" },
                { tag: "h3", inner: "Select an element to edit it", style: "margin: 0; font-weight: normal; color: var(--surface-6);" }
            ]
        });

        this.inputs = new Map();

        this.tabContainer = LS.Create("ls-tabs", { class: "property-editor-tabs editor-tabs" });
        this.tabs = new LS.Tabs(this.tabContainer, {
            list: true,
            styled: false
        });

        // --- 3D Preview
        this.previewRotation = { x: -15, y: 30 };
        this.previewContainer = LS.Create({
            class: "property-preview-container",
            style: "height: 120px; background: var(--surface-2); perspective: 800px; overflow: hidden; position: relative; margin: 10px; border-radius: 4px; border: 1px solid var(--surface-4); cursor: grab;",
            inner: [
                this.previewWorld = LS.Create({
                    class: "property-preview-world",
                    style: "width: 100%; height: 100%; transform-style: preserve-3d; display: flex; align-items: center; justify-content: center;",
                    inner: [
                        // Axes
                        { style: "position: absolute; width: 100px; height: 1px; background: #ff5555; transform: translateX(50px);" }, // X
                        { style: "position: absolute; width: 1px; height: 100px; background: #55ff55; transform: translateY(-50px);" }, // Y
                        // Object
                        this.previewObject = LS.Create({
                            class: "property-preview-object",
                            style: "width: 40px; height: 40px; background: var(--accent); opacity: 0.8; border: 1px solid white; position: absolute;"
                        })
                    ]
                })
            ]
        });

        // --- Edit aid (moving and resizing)
        this.__editAid = LS.Create({
            class: "editAid",
        });

        const handles = LS.Resize.set(this.__editAid, {
            sides: true,
            corners: true,
            translate: true
        });

        for(const handle in handles) {
            const doesUpdatePosition = handle.toLowerCase().includes("left") || handle.toLowerCase().includes("top");

            handles[handle].handler.on("resize-start", (cancel) => {
                if(!this.currentTarget) return;
            });

            handles[handle].handler.on("resize", (width, height, state, leftOffset, topOffset) => {
                if(!this.currentTarget) return;

                const preview = this.parent.connectedViews.get("preview");
                if(preview) {
                    const contained = preview.getContainedCoords();
                    const isContainer = this.currentTarget.node.constructor === PIXI.Container;
                    width /= contained.scale;
                    height /= contained.scale;

                    this.#updateProp("scaleX", width / (isContainer ? 1 : this.currentTarget.node?.bounds.width ?? 1));
                    this.#updateProp("scaleY", height / (isContainer ? 1 : this.currentTarget.node?.bounds.height ?? 1));

                    if(doesUpdatePosition) {
                        this.#updateProp("positionX", (leftOffset - contained.left) / contained.scale);
                        this.#updateProp("positionY", (topOffset - contained.top) / contained.scale);
                    }
                }
            });

            handles[handle].handler.on("resize-end", () => {
                if(!this.currentTarget) return;
                this.updateAidPosition();
            });
        }

        this.#updatePreviewWorld();
        
        this.propertyGroups = {};

        this.propertyGroups.general = LS.Create([
            { tag: "h3", inner: "General", class: "property-editor-header" },
            {
                class: "property-editor-group level-n1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-tag" }, { tag: "label", inner: " Label:" }] }, this.__labelInput = LS.Create({
                        tag: "input", type: "text", class: "property-editor-name-input", oninput: () => {
                            if (this.currentTarget) {
                                this.currentTarget.label = this.__labelInput.value;
                                this.#updateTimeline();
                            }
                        }
                    })],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-palette2" }, { tag: "label", inner: " Tile color:" }] }, this.#createInput("tileColor", {
                        type: "select",
                        animatable: false,
                        defaultValue: "",
                        options: [
                            { value: "", text: "Default" },
                            { value: "white", text: "White" },
                            { value: "blue", text: "Blue" },
                            { value: "pastel-indigo", text: "Pastel Indigo" },
                            { value: "lapis", text: "Lapis" },
                            { value: "pastel-teal", text: "Pastel Teal" },
                            { value: "aquamarine", text: "Aquamarine" },
                            { value: "green", text: "Green" },
                            { value: "lime", text: "Lime" },
                            { value: "neon", text: "Neon" },
                            { value: "yellow", text: "Yellow" },
                            { value: "orange", text: "Orange" },
                            { value: "deep-orange", text: "Deep Orange" },
                            { value: "red", text: "Red" },
                            { value: "rusty-red", text: "Rusty Red" },
                            { value: "pink", text: "Pink" },
                            { value: "hotpink", text: "Hotpink" },
                            { value: "purple", text: "Purple" },
                            { value: "soap", text: "Soap" },
                            { value: "burple", text: "Burple" }
                        ]
                    })],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-stopwatch" }, { tag: "label", inner: " Duration (s):" }] }, this.#createInput("clipDuration", {
                        animatable: false, type: "number", attributes: { min: 0.1, step: 0.1 }, defaultValue: 5, onchange: () => {
                            this.#updateTimeline();
                    }})],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-align-start" }, { tag: "label", inner: " Start (s):" }] }, this.#createInput("clipStartTime", {
                        animatable: false, type: "number", attributes: { min: 0, step: 0.1 }, defaultValue: 0, onchange: () => {
                            this.#updateTimeline();
                    }})],
                ]
            },
        ]);

        this.propertyGroups.transform = LS.Create([
            { tag: "h3", inner: "Transform", class: "property-editor-header" },
            {
                class: "property-editor-group level-n1", inner: [
                    // Position Group
                    [
                        { tag: "span", inner: [{ tag: "i", class: "bi-arrows-move" }, { tag: "label", inner: " Position:" }] },
                        {
                            class: "input-group", inner: [
                                { tag: "label", inner: "X", class: "input-label-small" },
                                this.#createInput("positionX", { type: "number", attributes: { step: 1 }, defaultValue: 0 }),
                                { tag: "label", inner: "Y", class: "input-label-small" },
                                this.#createInput("positionY", { type: "number", attributes: { step: 1 }, defaultValue: 0 })
                            ]
                        }
                    ],
                    // Scale Group
                    [
                        { tag: "span", inner: [{ tag: "i", class: "bi-aspect-ratio" }, { tag: "label", inner: " Scale:" }] },
                        {
                            class: "input-group", inner: [
                                { tag: "label", inner: "X", class: "input-label-small" },
                                this.#createInput("scaleX", { type: "number", attributes: { step: 0.1 }, defaultValue: 1 }),
                                { tag: "label", inner: "Y", class: "input-label-small" },
                                this.#createInput("scaleY", { type: "number", attributes: { step: 0.1 }, defaultValue: 1 })
                            ]
                        }
                    ],
                    // Rotation
                    [
                        { tag: "span", inner: [{ tag: "i", class: "bi-arrow-clockwise" }, { tag: "label", inner: " Rotation:" }] },
                        this.#createInput("rotation", { type: "number", inputType: "angle", attributes: { min: 0, max: 360 }, defaultValue: 0 })
                    ],
                    // Skew Group
                    [
                        { tag: "span", inner: [{ tag: "i", class: "bi-slash-square" }, { tag: "label", inner: " Skew:" }] },
                        {
                            class: "input-group", inner: [
                                { tag: "label", inner: "X", class: "input-label-small" },
                                this.#createInput("skewX", { type: "number", inputType: "angle", attributes: { min: 0, max: 360 }, defaultValue: 0 }),
                                { tag: "label", inner: "Y", class: "input-label-small" },
                                this.#createInput("skewY", { type: "number", inputType: "angle", attributes: { min: 0, max: 360 }, defaultValue: 0 })
                            ]
                        }
                    ],
                    // Anchor Group
                    [
                        { tag: "span", inner: [{ tag: "i", class: "bi-pin-angle" }, { tag: "label", inner: " Anchor:" }] },
                        {
                            class: "input-group", inner: [
                                { tag: "label", inner: "X", class: "input-label-small" },
                                this.#createInput("anchorX", { type: "number", attributes: { step: 0.1, min: 0, max: 1 }, defaultValue: 0 }),
                                { tag: "label", inner: "Y", class: "input-label-small" },
                                this.#createInput("anchorY", { type: "number", attributes: { step: 0.1, min: 0, max: 1 }, defaultValue: 0 })
                            ]
                        }
                    ],
                ]
            },
        ]);

        this.propertyGroups.rendering = LS.Create([
            { tag: "h3", inner: "Rendering", class: "property-editor-header" },
            {
                class: "property-editor-group level-n1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-eye-slash" }, { tag: "label", inner: " Visible:" }] },
                        this.#createInput("visible", { type: "checkbox", defaultValue: true })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-palette-fill" }, { tag: "label", inner: " Tint color:" }] },
                        this.#createInput("tint", { type: "color", defaultValue: "#ffffff" })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-circle-half" }, { tag: "label", inner: " Opacity:" }] },
                        this.#createInput("opacity", { type: "number", attributes: { min: 0, max: 1, step: 0.05 }, defaultValue: 1 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-circle-half" }, { tag: "label", inner: " Blend mode:" }] },
                        this.#createInput("blendMode", {
                            type: "select",
                            options: [
                                { value: "normal", text: "Normal" },
                                { value: "add", text: "Additive" },
                                { value: "multiply", text: "Multiply" },
                                { value: "screen", text: "Screen" },
                                { value: "overlay", text: "Overlay" },
                                { value: "darken", text: "Darken" },
                                { value: "lighten", text: "Lighten" }
                            ],
                        })
                    ],
                ]
            },

            { tag: "ls-box", class: "elevated", inner: "TIP: For more effects, advanced blend modes and filters see the pipeline tab." }
        ]);

        this.propertyGroups.source = LS.Create([
            { tag: "h3", inner: "Source", class: "property-editor-header" },
            {
                class: "property-editor-group level-n1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-link-45deg" }, { tag: "label", inner: " URL:" }] },
                        this.#createInput("sourceUrl", { type: "text", defaultValue: "", callback: (v) => this.#updateProp({ url: v }) })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-aspect-ratio" }, { tag: "label", inner: " Fit mode:" }] },
                        this.#createInput("sourceFitMode", {
                            type: "select",
                            options: [
                                { value: "contain", text: "Contain" },
                                { value: "cover", text: "Cover" },
                                { value: "stretch", text: "Stretch" },
                                { value: "none", text: "None" }
                            ],
                        })
                    ],
                ]
            }
        ]);

        this.propertyGroups.audio = LS.Create([
            { tag: "h3", inner: "Audio", class: "property-editor-header" },
            {
                class: "property-editor-group level-n1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-volume-up" }, { tag: "label", inner: " Volume:" }] },
                        this.#createInput("audioVolume", { type: "number", inputType: "knob", attributes: { min: 0, max: 100, step: 0.05 }, defaultValue: 100 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-speaker" }, { tag: "label", inner: " Pan:" }] },
                        this.#createInput("audioPan", { type: "number", inputType: "knob", attributes: { min: -1, max: 1, step: 0.05 }, defaultValue: 0 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-alignment-baseline" }, { tag: "label", inner: " Playback rate:" }] },
                        this.#createInput("audioPlaybackRate", { type: "number", inputType: "knob", attributes: { min: 0.1, step: 0.1 }, defaultValue: 1 })
                    ],
                ]
            },

            { tag: "ls-box", class: "elevated", inner: "TIP: For more audio effects and options, see the pipeline tab." }
        ]);

        this.propertyGroups.text = LS.Create([
            { tag: "h3", inner: "Text", class: "property-editor-header" },
            {
                class: "property-editor-group level-n1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-fonts" }, { tag: "label", inner: " Content:" }] },
                        this.#createInput("textContent", { type: "text", defaultValue: "Some text" })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-type-bold" }, { tag: "label", inner: " Font weight:" }] },
                        this.#createInput("textStyleWeight", {
                            type: "select",
                            defaultValue: "400",
                            options: [
                                { value: "100", text: "Thin (100)" },
                                { value: "200", text: "Extra Light (200)" },
                                { value: "300", text: "Light (300)" },
                                { value: "400", text: "Normal (400)" },
                                { value: "500", text: "Medium (500)" },
                                { value: "600", text: "Semi Bold (600)" },
                                { value: "700", text: "Bold (700)" },
                                { value: "800", text: "Extra Bold (800)" },
                                { value: "900", text: "Black (900)" }
                            ],
                        })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-type-italic" }, { tag: "label", inner: " Font style:" }] },
                        this.#createInput("textStyleStyle", {
                            type: "select",
                            options: [
                                { value: "normal", text: "Normal" },
                                { value: "italic", text: "Italic" },
                                { value: "oblique", text: "Oblique" }
                            ],
                        })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-text-paragraph" }, { tag: "label", inner: " Font size:" }] },
                        this.#createInput("textStyleFontSize", { type: "number", attributes: { step: 1 }, defaultValue: 24 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-fonts" }, { tag: "label", inner: " Font family:" }] },
                        this.#createInput("textStyleFontFamily", { type: "text", defaultValue: "Arial" })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-text-left" }, { tag: "label", inner: " Alignment:" }] },
                        this.#createInput("textStyleAlignment", {
                            type: "select",
                            options: [
                                { value: "left", text: "Left" },
                                { value: "center", text: "Center" },
                                { value: "right", text: "Right" }
                            ],
                        })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-palette-fill" }, { tag: "label", inner: " Color:" }] },
                        this.#createInput("textStyleFill", { type: "color", defaultValue: "#ffffff" })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-layout-text-sidebar-reverse" }, { tag: "label", inner: " Line height:" }] },
                        this.#createInput("textStyleLineHeight", { type: "number", attributes: { step: 0.1, min: 0.1 }, defaultValue: 1.2 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-text-wrap" }, { tag: "label", inner: " Wrap width:" }] },
                        this.#createInput("textStyleWrapWidth", { type: "number", attributes: { step: 1, min: 0 }, defaultValue: 200 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-text-paragraph" }, { tag: "label", inner: " Letter spacing:" }] },
                        this.#createInput("textStyleLetterSpacing", { type: "number", attributes: { step: 0.1 }, defaultValue: 0 })
                    ],
                    
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-text-wrap" }, { tag: "label", inner: " Word wrap:" }] },
                        this.#createInput("textStyleWrap", { type: "checkbox", defaultValue: true })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-border-style" }, { tag: "label", inner: " Stroke:" }] },
                        this.#createInput("textStyleStroke", { type: "color", defaultValue: "#000000" })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-border-width" }, { tag: "label", inner: " Stroke thickness:" }] },
                        this.#createInput("textStyleStrokeThickness", { type: "number", attributes: { step: 1, min: 0 }, defaultValue: 0 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-text-paragraph" }, { tag: "label", inner: " Stroke line join:" }] },
                        this.#createInput("textStyleStrokeLinejoin", {
                            type: "select",
                            options: [
                                { value: "miter", text: "Miter" },
                                { value: "round", text: "Round" },
                                { value: "bevel", text: "Bevel" }
                            ],
                        })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-shadows" }, { tag: "label", inner: " Drop shadow:" }] },
                        this.#createInput("textStyleDropShadow", { type: "checkbox", defaultValue: false })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-palette" }, { tag: "label", inner: " Shadow color:" }] },
                        this.#createInput("textStyleDropShadowColor", { type: "color", defaultValue: "#000000" })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-circle-half" }, { tag: "label", inner: " Shadow opacity:" }] },
                        this.#createInput("textStyleDropShadowOpacity", { type: "number", attributes: { step: 0.1, min: 0, max: 1 }, defaultValue: 0.5 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-arrows-angle-expand" }, { tag: "label", inner: " Shadow angle:" }] },
                        this.#createInput("textStyleDropShadowAngle", { type: "number", inputType: "angle", attributes: { step: 0.1 }, defaultValue: Math.PI / 6 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-distribute-vertical" }, { tag: "label", inner: " Shadow distance:" }] },
                        this.#createInput("textStyleDropShadowDistance", { type: "number", attributes: { step: 1 }, defaultValue: 5 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-droplet-half" }, { tag: "label", inner: " Shadow blur:" }] },
                        this.#createInput("textStyleDropShadowBlur", { type: "number", attributes: { step: 0.1, min: 0 }, defaultValue: 0 })
                    ],
                ]
            }
        ]);

        this.propertyGroups.automation = LS.Create([
            { tag: "h3", inner: "Automation", class: "property-editor-header" },
            { class: "property-editor-group level-n1", inner: [
                [{ tag: "span", inner: [{ tag: "i", class: "bi-toggles" }, { tag: "label", inner: " Enabled:" }] },
                    this.#createInput("automationEnabled", {
                        type: "checkbox", defaultValue: false
                    })
                ],

                [{ tag: "span", inner: [{ tag: "i", class: "bi-123" }, { tag: "label", inner: " Starting value:" }] },
                    this.#createInput("automationBaseValue", {
                        type: "number", attributes: { step: 0.1, min: 0, max: 1 }, defaultValue: 0
                    })
                ],

                [{ tag: "span", inner: [{ tag: "i", class: "bi-braces-asterisk" }, { tag: "label", inner: " Global mapping function:" }] },
                    this.#createInput("automationFunction", {
                        type: "text", defaultValue: "x",
                        animatable: false,
                        helpModal: this.__automationHelpModal = LS.Modal.build({
                            title: "Mapping functions",
                            content: [
                                { tag: "p", style: "margin-top: 0", inner: "Mapping functions allow you to transform the automation value before applying it to the target property. You can use 'x' or 'input' to represent the input value (from the automation curve), and return a new value." },
                                { tag: "ls-box", accent: "orange", class: "elevated", innerHTML: "Tip: Mapping functions are largely compatible with the <a href=\"https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/automation_form.htm\" target=\"_blank\">FL Studio Mapping Formula</a>." },
                                { tag: "p", inner: "Examples:" },
                                { tag: "ul", style: "padding-left: 20px", inner: [
                                    { tag: "li", inner: [{ tag: "code", inner: "x" }, " - Identity function (1:1)"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "x + 10" }, " - Adds 10 to the value (offset)"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "x * 2" }, " - Doubles the value (multiplier)"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "x * 2 + 10" }, " - Offset & multiplier"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "x / 2" }, " - Halves the value"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "sin(x)" }, " - Applies sine function to the value"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "sin(x * pi)" }, " - sin(x * pi)"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "1-x" }, " - Inverts the value"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "-x * 0.5" }, " - Negates and halves the value"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "!x" }, " - Flips a boolean value"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "case(ifl(x, 0.5), 0, 1)" }, " - If x is below 0.5, returns 0; otherwise, returns 1"] },
                                ] },

                                { tag: "p", inner: "Available operators:" },
                                { tag: "div", style: "display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: 4px; margin-top: 5px;", inner: [
                                    "+", "-", "*", "/", "%", "^"
                                ].map(f => ({ tag: "code", class: "example-chip", inner: f })) },

                                { tag: "p", inner: "Available functions (hover for an example):" },
                                { tag: "div", style: "display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: 4px; margin-top: 5px;", inner: [
                                    { name: "x", example: "x - Input from the automation curve" },
                                    { name: "time", example: "time - Current project time in seconds" },
                                    { name: "sin", example: "sin(x)" },
                                    { name: "cos", example: "cos(x)" },
                                    { name: "tan", example: "tan(x)" },
                                    { name: "tg", example: "tg(x)" },
                                    { name: "ctg", example: "ctg(x)" },
                                    { name: "sec", example: "sec(x)" },
                                    { name: "cosec", example: "cosec(x)" },
                                    { name: "arcsin", example: "arcsin(x)" },
                                    { name: "arccos", example: "arccos(x)" },
                                    { name: "arctan", example: "arctan(x)" },
                                    { name: "arctg", example: "arctg(x)" },
                                    { name: "exp", example: "exp(x)" },
                                    { name: "sqrt", example: "sqrt(x)" },
                                    { name: "ln", example: "ln(x)" },
                                    { name: "log10", example: "log10(x)" },
                                    { name: "log2", example: "log2(x)" },
                                    { name: "abs", example: "abs(x)" },
                                    { name: "neg", example: "neg(x)" },
                                    { name: "round", example: "round(x)" },
                                    { name: "int", example: "int(x)" },
                                    { name: "frac", example: "frac(x)" },
                                    { name: "min", example: "min(x, 10)" },
                                    { name: "max", example: "max(x, 10)" },
                                    { name: "clamp", example: "clamp(x, 0, 1)" },
                                    { name: "sum", example: "sum(x, 10, 5)" },
                                    { name: "ife", example: "ife(a, b) - If equal" },
                                    { name: "ifl", example: "ifl(a, b) - If less" },
                                    { name: "ifg", example: "ifg(a, b) - If greater" },
                                    { name: "ifle", example: "ifle(a, b) - If less or equal" },
                                    { name: "ifge", example: "ifge(a, b) - If greater or equal" },
                                    { name: "case", example: "case(a, b, c) - Case statement (returns b if a=1, else returns c)" },
                                    { name: "pi", example: "pi - " + Math.PI },
                                    { name: "e", example: "e - " + Math.E },
                                    { name: "rand", example: "rand - Random number between 0 and 1" }
                                ].map(f => ({ tag: "code", class: "example-chip", inner: f.name, tooltip: `Example: ${f.example}` })) }
                            ],
                            buttons: [{ label: "Close" }]
                        })
                    })
                ],
            ] },

            { tag: "h3", inner: "Targets", class: "property-editor-header" },
            {
                class: "ls-table-wrap property-editor-table",
                inner: [
                    {
                        tag: "table",
                        inner: [
                            { tag: "thead", inner: { tag: "tr", inner: [
                                { tag: "th", inner: "Node" },
                                { tag: "th", inner: "Property" },
                                { tag: "th", inner: "Mapping Function" },
                                { tag: "th", inner: "Is Relative" },
                                { tag: "th", inner: "Action" }
                            ] } },
                            this.__automationTargetsBody = LS.Create({ tag: "tbody" })
                        ]
                    },
                    {
                        class: "ls-tfoot",
                        role: "caption",
                        inner: [
                            { tag: "button", class: "add-button pill elevated", inner: [{ tag: "i", class: "bi-plus-lg" }, { tag: "span", inner: "Add target" }], onclick: () => this.linkingAutomationTarget() },
                        ]
                    }
                ]
            },

            ... localStorage.getItem("show-automation-help") !== "false" ? [{ tag: "ls-box", class: "elevated margin-top-xlarge", inner: [
                { tag: "h2", inner: "Getting started with automation clips" },
                { tag: "p", style: "white-space: pre-wrap", innerHTML: "Automation clips allow you to animate one or more of any properties in any way you want.\n\nAutomation base value (x) ranges from 0 to 1, so you may want to use a mapping function to transform it. For booleans, 0 is <code>false</code>, anything above is <code>true</code>." },
                { tag: "ul", style: "padding-left: 20px; margin-top: 5px", inner: [
                    { tag: "li", inner: "First, connect the automation to a target (whatever you want to animate)" },
                    { tag: "li", inner: "Then, draw the automation curve in your timeline (right-click to create a point, right click a point to see options)" },
                    { tag: "li", inner: "Finally, you can add a mapping function to each target to modify how the value affects it" },
                ] },
                { tag: "p", inner: "You can also quickly make one by right-clicking the property you want to automate when editing any object." },
                { tag: "button", inner: "What is a mapping function?", class: "pill elevated", style: "margin-top: 10px", onclick: () => { this.__automationHelpModal.open(); } },
                { tag: "button", inner: "Don't show again", class: "pill elevated margin-left-small", style: "margin-top: 10px", onclick() {
                    this.parentElement.remove();
                    localStorage.setItem("show-automation-help", "false");
                } }
            ] }] : [],

            { tag: "ls-box", class: "elevated margin-top-large", innerHTML: "Relative: value gets added on top of the original value.<br>Absolute: value replaces (sets) the value." }
        ]);

        // --- Handles
        this.__previewHandle = new LS.Util.TouchHandle(this.previewContainer, {
            cursor: 'grabbing',
            pointerLock: true,

            onMove: (event) => {
                this.previewRotation.y += event.dx * 0.5;
                this.previewRotation.x -= event.dy * 0.5;
                this.#updatePreviewWorld();
            }
        });

        let startValue, min, max, input, step, precision;
        this.__valueHandle = new LS.Util.TouchHandle(this.editorContainer, {
            cursor: 'ew-resize',
            pointerLock: true,

            onStart(event) {
                if (event.domEvent.target.tagName !== "INPUT" || event.domEvent.target.type !== "number" || (event.domEvent.type === "mousedown" && event.domEvent.button !== 0) || this.__addingTarget) return event.cancel();
                input = event.domEvent.target;

                startValue = Number(input.value);
                input.focus();
                input.select();
                min = input.min !== "" ? Number(input.min) : -Infinity;
                max = input.max !== "" ? Number(input.max) : Infinity;
                step = input.step && input.step !== "any" ? Number(input.step) : 1;

                // Calculate precision based on step
                if (Math.floor(step) === step) precision = 0;
                else {
                    const str = step.toString();
                    if (str.indexOf("e-") > -1) precision = parseInt(str.split("e-")[1]);
                    else precision = str.split(".")[1]?.length || 0;
                }
            },

            onMove(event) {
                let modifier = 1;
                if (event.domEvent) {
                    if (event.domEvent.shiftKey) modifier = 10;
                    if (event.domEvent.altKey) modifier = 0.1;
                }

                const delta = event.dx * step * modifier;
                let newValue = startValue + delta;

                newValue = Math.max(min, Math.min(max, newValue));

                input.value = newValue.toFixed(precision);
                input.dispatchEvent(new Event('input'));
            },

            onEnd() {
                input = null;
            }
        });

        // --- Context menu for inputs
        this.__valueContextMenu = new LS.Menu({
            items: [
                { text: "Reset", icon: "bi-arrow-counterclockwise", action: () => {
                    if(this.focusedInput) {
                        this.focusedInput.input.value = this.focusedInput.defaultValue;
                        this.focusedInput.input.dispatchEvent(new Event('input'));
                    }
                } },

                { type: "separator" },

                { text: "Copy value", icon: "bi-clipboard", action: () => {
                    if(this.focusedInput) {
                        navigator.clipboard.writeText(this.focusedInput.input.value);
                    }
                } },

                { text: "Paste value", icon: "bi-clipboard-check", action: () => {
                    if(this.focusedInput) {
                        navigator.clipboard.readText().then(text => {
                            this.focusedInput.input.value = text;
                            this.focusedInput.input.dispatchEvent(new Event('input'));
                        });
                    }
                } },

                { type: "separator" },

                this.__valueContextMenu_createAutomationButton = { text: "Create automation clip", icon: "bi-bezier2", action: () => {
                    if(this.currentTarget && this.focusedInput) {
                        if(!this.focusedInput.animatable) return;

                        const propertyName = this.focusedInput.id;
                        if(!propertyName) return;

                        const timeline = this.parent?.timeline;
                        if(!timeline) return;

                        const clip = {
                            type: "automation",
                            start: this.currentTarget.start || 0,
                            duration: this.currentTarget.duration || 1,
                            row: (this.currentTarget.row || 0) + 1,
                            label: `${this.currentTarget.label || this.currentTarget.type || "Target"} - ${propertyName}`,
                            color: "neon",
                            data: {
                                targets: [
                                    { nodeId: this.currentTarget.id, property: propertyName }
                                ],

                                value: 0,
                                points: []
                            }
                        }

                        timeline.add(clip);
                    }
                } }
            ]
        });

        // --- Tabs
        this.editorContainer = LS.Create("ls-tab", { class: "property-editor-container" });

        this.tabs.add("Editor", this.editorContainer);
        this.tabs.add("Pipeline", N());
        this.tabs.add("Animation", N());
        this.tabs.add("Behavior", N());
        this.tabs.set(0);

        this.container.appendChild(this.emptyMessage);

        window.addEventListener("resize", this.__resizeListener = () => {
            this.updateAidPosition();
        });

        this.__resizeObserver = new ResizeObserver(this.__resizeListener);
        this.__resizeObserver.observe(this.container);

        this.frameScheduler = new LS.Util.FrameScheduler(() => {
            this.#render();
        });
    }

    /**
     * Set the current target to edit
     * @param {Object|null} target The target object to edit, or null to clear
     */
    setTarget(target) {
        if(!target) {
            this.tabContainer.remove();
            this.container.innerHTML = "";
            this.container.appendChild(this.emptyMessage);
            this.currentTarget = null;
            this.__editAid.remove();
            return;
        }

        this.editorContainer.innerHTML = "";
        this.editorContainer.appendChild(this.propertyGroups.general);

        this.currentTarget = target;

        for(const prop of ["id", "type", "clipDuration", "clipStartTime", "tileColor"]) {
            this.updateInputValue(prop);
        }

        this.__labelInput.value = target.label || "";

        this.targetNodeIsVisual = false;
        switch(target.type) {
            case "sprite":
            case "text":
            case "graphics":
            case "container":
            case "graphics":
            case "video":
                this.targetNodeIsVisual = true;

                for(const prop of ["positionX", "positionY", "scaleX", "scaleY", "rotation", "anchorX", "anchorY", "opacity", "visible", "blendMode", "tint", "skewX", "skewY"]) {
                    this.updateInputValue(prop);
                }

                this.editorContainer.prepend(this.previewContainer);
                this.editorContainer.appendChild(this.propertyGroups.transform);

                if(target.type === "text") {
                    for(const prop of ["textContent", "textStyleWeight", "textStyleStyle", "textStyleFontSize", "textStyleFontFamily", "textStyleAlignment", "textStyleFill", "textStyleLineHeight", "textStyleWrapWidth", "textStyleLetterSpacing", "textStyleWrap", "textStyleStroke", "textStyleStrokeThickness", "textStyleStrokeLinejoin", "textStyleDropShadow", "textStyleDropShadowColor", "textStyleDropShadowOpacity", "textStyleDropShadowAngle", "textStyleDropShadowDistance", "textStyleDropShadowBlur"]) {
                        this.updateInputValue(prop);
                    }

                    this.editorContainer.appendChild(this.propertyGroups.text);
                }

                if(target.type === "sprite" || target.type === "video") {
                    this.editorContainer.appendChild(this.propertyGroups.source);
                }

                this.editorContainer.appendChild(this.propertyGroups.rendering);
                break;

            case "automation":
                for(const prop of ["automationBaseValue", "automationEnabled", "automationFunction"]) {
                    this.updateInputValue(prop);
                }

                this.__automationTargetsBody.innerHTML = "";

                if (this.parent.timeline) for (const [i, t] of (target.data.targets || []).entries()) {
                    const targetNode = this.parent.timeline.getItemById(t.nodeId);
                    const targetLabel = targetNode ? (targetNode.label || targetNode.type || targetNode.id) : "Unknown Node";

                    const mappingFormulaInput = this.#createInput(`automationTargetMapping${i}`, {
                        type: "text",
                        animatable: false,
                        defaultValue: t.mapping || "x",
                        helpModal: this.__automationHelpModal,
                        dontUpdate: true,
                        callback: (v) => {
                            t.mapping = v;
                            t.__mappingCache = null; // Invalidate cache
                            target.__dirty = true;
                            this.#updateRender();
                        }
                    });

                    const modeSelect = this.#createInput(`automationTargetMode${i}`, {
                        type: "checkbox",
                        animatable: false,
                        dontUpdate: true,
                        defaultValue: t.isRelative,
                        callback: (v) => {
                            t.isRelative = v;
                            target.__dirty = true;
                            this.#updateRender();
                        }
                    });

                    const row = LS.Create({
                        tag: "tr",
                        inner: [
                            { tag: "td", inner: targetLabel },
                            { tag: "td", inner: t.property },
                            { tag: "td", inner: mappingFormulaInput },
                            { tag: "td", inner: modeSelect },
                            { tag: "td", inner: LS.Create({
                                tag: "button",
                                class: "square clear small",
                                inner: { tag: "i", class: "bi-trash", style: "font-size: 12px;" },
                                tooltip: "Remove target",
                                onclick: () => {
                                    target.data.targets.splice(i, 1);
                                    target.__dirty = true;
                                    this.setTarget(target);
                                    this.#updateRender();
                                }
                            }) }
                        ]
                    });

                    this.__automationTargetsBody.appendChild(row);
                }

                this.editorContainer.appendChild(this.propertyGroups.automation);
                break;

            case "sound":
                this.editorContainer.appendChild(this.propertyGroups.source);
                this.editorContainer.appendChild(this.propertyGroups.audio);
                break;

            default:
                break;
        }

        if(this.targetNodeIsVisual) {
            if(!target.node) {
                this.parent.createItemNode(target);
            }

            const connectedPreview = this.parent.connectedViews.get("preview");
            if(connectedPreview) {
                const previewContainer = connectedPreview.container.querySelector(".preview-container");
                previewContainer.appendChild(this.__editAid);

                this.updateAidPosition();

                let initialX, initialY, initialWorldX, initialWorldY, worldOffset, rect;
                if(!this.__editAidHandle) this.__editAidHandle = new LS.Util.TouchHandle(previewContainer, {
                    cursor: 'move',
                    exclude: ".ls-resize-handle",

                    onStart: (event) => {
                        if (!this.currentTarget || !this.currentTarget.node) return event.cancel();

                        worldOffset = connectedPreview.getContainedCoords();
                        rect = previewContainer.getBoundingClientRect();

                        initialX = event.x - rect.left - worldOffset.left;
                        initialY = event.y - rect.top - worldOffset.top;

                        initialWorldX = this.parent.getSavedNodeProperty(this.currentTarget, "positionX");
                        initialWorldY = this.parent.getSavedNodeProperty(this.currentTarget, "positionY");
                    },

                    onMove: (event) => {
                        // Screen delta coords to world delta coords
                        const dx = ((event.x - rect.left - worldOffset.left) - initialX) / worldOffset.scale;
                        const dy = ((event.y - rect.top - worldOffset.top) - initialY) / worldOffset.scale;

                        // Calculate new world position
                        const wx = initialWorldX + dx;
                        const wy = initialWorldY + dy;

                        this.__editAid.style.transform = `translate3d(${wx * worldOffset.scale + worldOffset.left}px, ${wy * worldOffset.scale + worldOffset.top}px, 0)`;
                        this.#updateProp("positionX", wx);
                        this.#updateProp("positionY", wy);
                    }
                });

                if(!this.__editAidZoomHandler) previewContainer.addEventListener('wheel', this.__editAidZoomHandler = (evt) => {
                    if(!this.currentTarget || !this.currentTarget.node) return;

                    if(evt.ctrlKey) {
                        evt.preventDefault();
                        this.#updateProp("scaleX", this.parent.getSavedNodeProperty(this.currentTarget, "scaleX") * (evt.deltaY < 0 ? 1.1 : 0.9));
                        this.#updateProp("scaleY", this.parent.getSavedNodeProperty(this.currentTarget, "scaleY") * (evt.deltaY < 0 ? 1.1 : 0.9));
                        this.updateAidPosition();
                    }

                    if(evt.shiftKey) {
                        evt.preventDefault();
                        this.#updateProp("rotation", (this.parent.getSavedNodeProperty(this.currentTarget, "rotation") + (evt.deltaY < 0 ? 0.1 : -0.1)) % (Math.PI * 2));
                        this.updateAidPosition();
                    }
                });
            }

            this.updatePreviewObject();
        } else {
            this.__editAid.remove();
        }

        this.emptyMessage.remove();
        this.container.appendChild(this.tabContainer);
    }

    /**
     * Create an input element
     * @param {string} id Input identifier
     * @param {*} inputObject Input options
     * @property {options.type} type Input type
     * @property {options.defaultValue} defaultValue Default value for the input
     * @property {options.animatable} animatable Whether the input is animatable or not (can be assigned to an automation clip)
     * @property {options.callback} callback Callback function when the value changes
     * @property {options.attributes} attributes Additional properties to set on the input element
     * @return {HTMLInputElement} The created input element
     */
    #createInput(id, inputObject) {
        const type = inputObject.type = (inputObject.type || "text").toLowerCase();
        const defaultValue = inputObject.defaultValue !== undefined ? inputObject.defaultValue : (type === "number" ? 0 : "");

        const tagName = type === "select" ? "ls-select" : (inputObject.inputType === "knob" ? "ls-knob" : "input");

        inputObject.animatable = inputObject.animatable === false ? false : true;

        inputObject.input = LS.Create({ tag: tagName, type, value: defaultValue, ...inputObject.attributes || {}, class: "property-editor-input" + (type === "select" ? " clear" : ""), options: inputObject.options || null, oninput: () => {
            let value = inputObject.input.value;
            if(type === "number") value = parseFloat(value);
            if(type === "checkbox") value = inputObject.input.checked;
            if(inputObject.inputType === "angle") value = value * (Math.PI / 180);

            if(!inputObject.dontUpdate) this.#updateProp(id, value);
            if(typeof inputObject.callback === "function") {
                inputObject.callback(value);
            }
        }});

        if(type === "checkbox" || type === "radio") {
            inputObject.container = LS.Create("label", { class: "ls-" + type, inner: [ inputObject.input, { tag: "span" } ] });
            inputObject.input.checked = !!defaultValue;
        }

        if(type === "number") {
            inputObject.input.style.cursor = inputObject.inputType === "knob" ? "ns-resize" : "ew-resize";
        }

        const hasDefault = typeof defaultValue !== "undefined";
        if(hasDefault || inputObject.helpModal) {            
            inputObject.container = LS.Create({
                class: "input-with-reset",
                style: "display: flex; align-items: center; min-width: 0;",
                inner: [ inputObject.container || inputObject.input ]
            });

            if(hasDefault) {
                LS.Create({
                    tag: "button",
                    class: "square clear small",
                    inner: { tag: "i", class: "bi-arrow-counterclockwise", style: "font-size: 10px;" },
                    onclick: () => {
                        inputObject.input.value = defaultValue;
                        inputObject.input.dispatchEvent(new Event('input'));
                    }
                }).addTo(inputObject.container);
            }

            if(inputObject.helpModal) {
                LS.Create({
                    tag: "button",
                    class: "square clear small",
                    inner: { tag: "i", class: "bi-question-lg", style: "font-size: 10px;" },
                    onclick: () => {
                        inputObject.helpModal.open();
                    }
                }).addTo(inputObject.container);
            }
        }

        ;(inputObject.container || inputObject.input).addEventListener('contextmenu', (e) => {
            e.preventDefault();

            this.__valueContextMenu_createAutomationButton.hidden = !inputObject.animatable;

            this.focusedInput = inputObject;
            this.__valueContextMenu.open(e.clientX, e.clientY);
        });

        inputObject.id = id;
        this.inputs.set(id, inputObject);
        return inputObject.container || inputObject.input;
    }

    updateInputValue(id, value) {
        const inputObject = this.inputs.get(id);
        if(inputObject) {
            if(value === undefined && this.currentTarget) {
                value = this.parent.getSavedNodeProperty(this.currentTarget, id);
            }

            if(inputObject.type === "color" && typeof value === "number") {
                value = LS.Color.fromInt(value).hex;
            }

            if(inputObject.inputType === "angle" && typeof value === "number") {
                value = value * (180 / Math.PI);
            }

            if(inputObject.type === "number") {
                inputObject.input.value = parseFloat(value);
            } else if(inputObject.type === "checkbox") {
                inputObject.input.checked = !!value;
            } else {
                inputObject.input.value = value;
            }
        }
    }

    linkingAutomationTarget() {
        if (!this.currentTarget || this.currentTarget.type !== "automation" || !this.parent.timeline) return;

        this.__addingTarget = this.currentTarget;
        LS._topLayer.appendChild(this.__addingTargetElement || (this.__addingTargetElement = LS.Create({
            tag: "ls-box",
            class: "elevated adding-automation-target-modal",
            inner: [
                { tag: "p", style: "margin: 0", inner: "Tweak an animatable property on any object to add it as an automation target." },
                { tag: "button", class: "elevated pill", inner: "Cancel", onclick: () => {
                    this.__addingTarget = null;
                    this.__addingTargetElement?.remove();
                } }
            ]
        })));

        if(localStorage.getItem("show-automation-target-hint") !== "false") {
            LS.Modal.buildEphemeral({
                title: "Hint",
                content: "Simply tweak any animatable property on any object after this message. This will automatically link it as a target in the automation clip.",
                buttons: [{ label: "Got it!" }]
            }).open();

            localStorage.setItem("show-automation-target-hint", "false");
        }
    }

    #updateProp(property, value) {
        if(this.currentTarget) {
            if(this.__addingTarget) {
                LS.Toast.show("Linked " + property + " as automation target.", {
                    timeout: 2000,
                    accent: "green"
                });

                if(!this.__addingTarget.data.targets) this.__addingTarget.data.targets = [];
                this.__addingTarget.data.targets.push({
                    nodeId: this.currentTarget.id,
                    property: property
                });

                this.__addingTarget.__dirty = true;
                this.#updateRender();

                this.setTarget(this.__addingTarget);
                this.__addingTarget = null;
                this.__addingTargetElement?.remove();
                return;
            }

            if(property === "clipDuration" || property === "clipStartTime") {
                this.#updateTimeline();
            }

            // Should not happen, but if it somehow does, this prevents exploding the program
            if(Number.isNaN(value)) value = 0;

            this.parent.applyNodeProperty(this.currentTarget, property, value);
            this.updateInputValue(property, value);

            if(this.targetNodeIsVisual) {
                this.#updateRender();
                this.updatePreviewObject();
                this.updateAidPosition();
            }
        }
    }

    #updateTimeline() {
        if(this.currentTarget && this.parent && this.parent.timeline) {
            this.parent.timeline.render(true);
        }
    }

    #updateRender(){
        if(this.currentTarget && this.parent && this.parent.renderer) {
            this.parent.render();
        }
    }

    #updatePreviewWorld() {
        if(this.previewWorld) {
            this.previewWorld.style.transform = `rotateX(${this.previewRotation.x}deg) rotateY(${this.previewRotation.y}deg)`;
        }
    }

    #render() {
        if (this.__aidDirty) {
            this.__aidDirty = false;
            if (this.currentTarget && this.__editAid) {
                const t = this.currentTarget;
                const worldOffset = this.parent.connectedViews.get("preview")?.getContainedCoords();
                if (!worldOffset) return;

                // Get values with fallback
                const x = this.parent.getSavedNodeProperty(t, "positionX");
                const y = this.parent.getSavedNodeProperty(t, "positionY");
                const w = (t.node?.width ?? t.data.width ?? 100);
                const h = (t.node?.height ?? t.data.height ?? 100);
                const ax = this.parent.getSavedNodeProperty(t, "anchorX");
                const ay = this.parent.getSavedNodeProperty(t, "anchorY");
                const rot = this.parent.getSavedNodeProperty(t, "rotation");

                // Calculate anchor offset
                const anchorOffsetX = -ax * w;
                const anchorOffsetY = -ay * h;

                // Apply rotation to anchor offset
                const cos = Math.cos(rot);
                const sin = Math.sin(rot);
                const rotatedOffsetX = anchorOffsetX * cos - anchorOffsetY * sin;
                const rotatedOffsetY = anchorOffsetX * sin + anchorOffsetY * cos;

                // Final position in screen space
                const screenX = (x + rotatedOffsetX) * worldOffset.scale + worldOffset.left;
                const screenY = (y + rotatedOffsetY) * worldOffset.scale + worldOffset.top;

                this.__editAid.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
                this.__editAid.style.width = (w * worldOffset.scale) + "px";
                this.__editAid.style.height = (h * worldOffset.scale) + "px";
            }
        }

        if(this.__previewDirty) {
            this.__previewDirty = false;

            if(this.currentTarget && this.previewObject) {
                const t = this.currentTarget.node || this.currentTarget.data;
                const scalePos = 0.1; 
                const x = this.parent.getSavedNodeProperty(this.currentTarget, "positionX") * scalePos;
                const y = this.parent.getSavedNodeProperty(this.currentTarget, "positionY") * scalePos;
                const rot = this.parent.getSavedNodeProperty(this.currentTarget, "rotation");
                const sx = this.parent.getSavedNodeProperty(this.currentTarget, "scaleX");
                const sy = this.parent.getSavedNodeProperty(this.currentTarget, "scaleY");
                const ax = this.parent.getSavedNodeProperty(this.currentTarget, "anchorX");
                const ay = this.parent.getSavedNodeProperty(this.currentTarget, "anchorY");
                const w = (t.width || 100) * scalePos;
                const h = (t.height || 100) * scalePos;

                this.previewObject.style.width = w + "px";
                this.previewObject.style.height = h + "px";
                this.previewObject.style.transformOrigin = `${ax * 100}% ${ay * 100}%`;
                this.previewObject.style.transform = `translate(${x}px, ${y}px) rotate(${rot}rad) scale(${sx}, ${sy})`;
                
                let tint = this.parent.getSavedNodeProperty(this.currentTarget, "tint");
                if (typeof tint === 'number') tint = '#' + tint.toString(16).padStart(6, '0');
                this.previewObject.style.backgroundColor = tint || "var(--accent)";
                
                this.previewObject.style.opacity = this.parent.getSavedNodeProperty(this.currentTarget, "opacity");
            }
        }
    }

    updateAidPosition() {
        this.__aidDirty = true;
        this.frameScheduler.schedule();
    }

    updatePreviewObject() {
        this.__previewDirty = true;
        this.frameScheduler.schedule();
    }

    destroy() {
        if(this.__previewHandle) {
            this.__previewHandle.destroy();
            this.__previewHandle = null;
        }

        if(this.__valueHandle) {
            this.__valueHandle.destroy();
            this.__valueHandle = null;
        }

        if(this.__valueContextMenu) {
            this.__valueContextMenu.destroy();
            this.__valueContextMenu = null;
        }

        this.tabContainer.remove();
        this.tabContainer = null;
        this.tabs.destroy();
        this.tabs = null;

        this.__addingTarget = null;
        this.__addingTargetElement?.remove();
        this.__addingTargetElement = null;

        LS.Resize.remove(this.__editAid);
        this.__editAid.remove();
        this.__editAid = null;

        if(this.__editAidHandle) this.__editAidHandle.destroy();

        this.__labelInput = null;
        this.__colorInput = null;

        this.emptyMessage = null;
        this.editorContainer = null;
        this.currentTarget = null;
        this.focusedInput = null;
        this.previewContainer = null;
        this.previewWorld = null;
        this.previewObject = null;
        this.__valueContextMenu_createAutomationButton = null;
        this.inputs.clear();

        this.propertyGroups = null;

        this.__automationHelpModal?.destroy();
        this.__automationHelpModal = null;

        window.removeEventListener("resize", this.__resizeListener);
        this.__resizeListener = null;

        if(this.__editAidZoomHandler && this.parent) {
            const connectedPreview = this.parent.connectedViews.get("preview");
            if(connectedPreview) {
                const previewContainer = connectedPreview.container.querySelector(".preview-container");
                previewContainer.removeEventListener('scroll', this.__editAidZoomHandler);
            }
            this.__editAidZoomHandler = null;
        }

        if(this.__resizeObserver) {
            this.__resizeObserver.disconnect();
            this.__resizeObserver = null;
        }

        super.destroy();
    }
}


/**
 * Asset manager view class
 * Not proud of the state of this code
 */
class AssetManagerView extends EditorBaseClasses.View {
    library = {
        objects: {
            name: "Object presets",
            icon: "bi-box",
            items: [
                { name: "Container", type: "container", item: { type: "container", label: "Container", color: "white" } },
                { name: "Text", type: "text", item: { type: "text", label: "Text", data: { text: "Some text" }, color: "aquamarine" } },
                { name: "Rectangle", type: "sprite", icon: "bi-square", item: { type: "sprite", label: "Rectangle", data: { positionX: 100, positionY: 100, scaleX: 500, scaleY: 500, anchorX: 0, anchorY: 0 } } },
                { name: "Vector shape", type: "graphics", item: { type: "graphics", label: "Vector shape" } },
                { name: "Automation clip", type: "automation", item: { type: "automation", label: "Automation clip", data: { value: 1, points: [ { value: 0, type: "linear", time: 1 } ] } } },
                { name: "Video", type: "video", item: { type: "video", label: "Video", color: "blue" } },
                { name: "Image", type: "sprite", item: { type: "sprite", label: "Image" } },
                { name: "Audio", type: "sound", item: { type: "sound", label: "Audio", color: "purple" } },
                { name: "Notes", type: "notes", item: { type: "notes", label: "Notes", color: "yellow" } }
            ]
        },

        folders: {
            name: "Project Folders",
            icon: "bi-folder",
        },

        projectAssets: {
            name: "Project Assets",
            icon: "bi-file-earmark-binary-fill",
        },

        // remoteAssets: {
        //     name: "Remote Assets",
        //     icon: "bi-cloud-upload",
        // },

        saved: {
            name: "Saved items",
            icon: "bi-star-fill",
        }
    }

    constructor() {
        super({
            name: 'AssetManagerView',
            title: 'Content library',
            container: LS.Create({
                class: 'editor-asset-manager',
                inner: []
            })
        });

        this.container.add([
            this.__sidebar = LS.Create({ class: 'asset-manager-sidebar' }),
            this.__contentContainer = LS.Create({ class: 'asset-manager-content' })
        ]);

        for(const [tabName, tabData] of Object.entries(this.library)) {
            const tabButton = LS.Create({ attributes: { role: "button", "data-tab": tabName }, inner: { tag: 'i', class: tabData.icon }, tooltip: tabData.name, onclick: () => { this.setTab(tabName) } });
            this.__sidebar.appendChild(tabButton);
        }

        this.previewElement = LS.Create({ class: 'asset-drop-preview' });

        // File browser instance (created lazily)
        this.fileBrowser = null;
        this._currentFolderHandle = null;

        let dragItemType = null;
        this.handle = new LS.Util.TouchHandle(this.__contentContainer, {
            cursor: 'grabbing',
            onStart: (event) => {
                const obj = event.domEvent.target.targetObject || event.domEvent.target._fileData;
                if(!obj) return event.cancel();

                dragItemType = event.domEvent.target.targetObject ? 'library-object' : 'project-asset';

                obj.icon = this.getIcon(obj);
                EditorBaseClasses.dragState.start(obj, event.x, event.y);
            },

            onMove: (event) => EditorBaseClasses.dragState.setPosition(event.x, event.y),

            onEnd: (event) => {
                const x = EditorBaseClasses.dragState.x;
                const y = EditorBaseClasses.dragState.y;
                EditorBaseClasses.dragState.stop();

                const elementsFromPoint = document.elementsFromPoint(x, y);
                const timeline = elementsFromPoint.find(el => el.classList.contains('ls-timeline'))?.__lsComponent || null;

                if(timeline) {
                    if(!(timeline instanceof LS.Timeline) || (dragItemType === 'library-object' && !EditorBaseClasses.dragState.target?.item)) {
                        LS.Toast.show("Sorry, something went wrong while adding the item.", { timeout: 3000, accent: "red" });
                        return;
                    }

                    const { time, row } = timeline.transformCoords(x, y);

                    if(dragItemType === 'library-object') {
                        const newItem = timeline.cloneItem(EditorBaseClasses.dragState.target.item);
                        newItem.start = time;
                        newItem.row = row;
                        newItem.duration = newItem.duration || 1;

                        timeline.add(newItem);
                    } else if(dragItemType === 'project-asset') {
                        this.parent.resources.addProjectResources([EditorBaseClasses.dragState.target], row, time);
                    }
                }
            }
        });

        this.__contentContainer.addEventListener("dragover", (e) => {
            if(this.currentTab !== 'projectAssets') return;

            e.preventDefault();
            this.__contentContainer.classList.add("drag-over");
        });

        this.__contentContainer.addEventListener("dragleave", (e) => {
            if(this.currentTab !== 'projectAssets') return;

            e.preventDefault();
            this.__contentContainer.classList.remove("drag-over");
        });

        this.__contentContainer.addEventListener("drop", (e) => {
            if(this.currentTab !== 'projectAssets') return;

            e.preventDefault();
            this.__contentContainer.classList.remove("drag-over");
            this.parent?.resources.addProjectResources(e.dataTransfer.files);
        });

        this._boundRefreshFolders = () => this.refreshTab('folders');
        this._boundRefreshProjectAssets = () => this.refreshTab('projectAssets');

        this.setTab('objects');
    }

    onAttached() {
        if (this.parent?.resources) {
            this.parent.resources.on('folder-added', this._boundRefreshFolders);
            this.parent.resources.on('folder-removed', this._boundRefreshFolders);
            this.parent.resources.on('resource-added', this._boundRefreshProjectAssets);
            this.parent.resources.on('resource-removed', this._boundRefreshProjectAssets);
            this.parent.resources.on('resources-loaded', () => {
                this.refreshTab('folders');
                this.refreshTab('projectAssets');
            });
        }
    }

    onDetached() {
        if (this.parent?.resources) {
            this.parent.resources.off('folder-added', this._boundRefreshFolders);
            this.parent.resources.off('folder-removed', this._boundRefreshFolders);
            this.parent.resources.off('resource-added', this._boundRefreshProjectAssets);
            this.parent.resources.off('resource-removed', this._boundRefreshProjectAssets);
        }
    }

    refreshTab(tabName) {
        const library = this.library[tabName];
        if (library.__element) {
            library.__element.remove();
            library.__element = null;
        }
        if (this.currentTab === tabName) {
            this.__contentContainer.innerHTML = '';
            this.__contentContainer.appendChild(this.createTab(library));
        }
    }

    setTab(tabName) {
        const library = this.library[tabName];
        const tabs = this.__sidebar.children;

        for(const tab of tabs) {
            tab.classList.toggle('selected', tab.getAttribute('data-tab') === tabName);
        }

        // Clean up file browser if switching away from folders
        if (this.currentTab === 'folders' && tabName !== 'folders' && this.fileBrowser) {
            this._currentFolderHandle = null;
        }

        this.currentTab = tabName;
        this.__contentContainer.innerHTML = '';
        this.__contentContainer.appendChild(this.createTab(library));
    }

    createTab(library) {
        const grid = library.__element = LS.Create({ class: 'asset-library-grid' });

        if (library.name === "Project Folders") {
            this._createFoldersTab(grid);
        } else if (library.name === "Saved items") {
            grid.appendChild(N("ls-box", {
                inner: "You can save presets you use often here for quick access. To save an item, right click on it and select 'Save to library'.",
            }));
        } else if (library.name === "Project Assets") {
            grid.appendChild(N("ls-box", {
                inner: "These assets are embedded in the project file and work anywhere. Note that this increases the project file size and memory usage, so use it for small files only! You can drag and drop files here or to the timeline directly.",
                class: "margin-bottom-medium"
            }));

            this.populateProjectAssets(grid);
        }

        if (library.items) for (const obj of library.items) {
            const itemElement = obj.__element || this.createAssetPreview(obj);
            grid.appendChild(itemElement);
        }

        return grid;
    }

    // FIXME: I know this isnt clean but im tired :(
    _createFoldersTab(grid) {
        const hasCurrentFolder = this._currentFolderHandle !== null;

        if(!hasCurrentFolder) {
            grid.appendChild(N("ls-box", {
                class: "margin-bottom-medium",
                inner: "Add folders from your computer to browse and access their content."
            }));
        }

        grid.appendChild(LS.Create({
            tag: 'button',
            class: 'elevated',
            inner: [{ tag: 'i', class: hasCurrentFolder? 'bi-arrow-left': 'bi-folder-plus' }, hasCurrentFolder? ' Back to folders': ' Add folder'],
            onclick: () => {
                if(hasCurrentFolder) {
                    this._currentFolderHandle = null;
                    this.refreshTab('folders');
                } else {
                    this.parent?.resources.addFolder();
                }
            }
        }));

        if (hasCurrentFolder) {
            this._showFileBrowser(grid);
        } else {
            this._populateFolderList(grid);
        }
    }

    _populateFolderList(grid) {
        const folders = this.parent?.resources?.projectFolders;
        if (!folders || folders.size === 0) {
            grid.appendChild(LS.Create({
                class: 'empty-state',
                inner: [
                    { tag: 'i', class: 'bi-folder2-open', style: 'font-size: 3em; opacity: 0.3;' },
                    { tag: 'p', inner: 'No folders added yet' }
                ]
            }));
            return;
        }

        const folderGrid = LS.Create({ class: 'folder-list-grid' });

        for (const [name, folderData] of folders) {
            const folderElement = folderData.__element || (folderData.__element = LS.Create({
                class: 'folder-list-item asset-library-item',
                inner: [
                    [{ tag: 'i', class: 'bi-folder-fill' }, " " + folderData.name],
                    { class: 'folder-actions', inner: [
                        LS.Create({
                            tag: 'button',
                            class: 'square clear small',
                            inner: { tag: 'i', class: 'bi-trash' },
                            tooltip: 'Remove folder',
                            onclick: (e) => {
                                e.stopPropagation();
                                this.parent?.resources.removeFolder(name);
                            }
                        })
                    ]}
                ],
                onclick: () => this._openFolder(folderData.handle, folderData.name)
            }));

            folderGrid.appendChild(folderElement);
        }

        grid.appendChild(folderGrid);
    }

    _openFolder(handle, name) {
        this._currentFolderHandle = handle;
        this._currentFolderName = name;
        this.refreshTab('folders');
    }

    _showFileBrowser(grid) {
        if (!this.fileBrowser) {
            this.fileBrowser = new FileBrowser({
                onFileSelect: (files) => this._onFileSelect(files),
                onFileOpen: (file) => this._onFileOpen(file)
            });
        }

        grid.appendChild(this.fileBrowser.element);
        this.fileBrowser.setRootFolder(this._currentFolderHandle);
    }

    _onFileSelect(files) {
        // Could show preview panel someday
    }

    _onFileOpen(file) {
        // Add to timeline or open preview (someday)
        // Yes it is this r*tarded
        // The whole file system is r*tarded
        // I hate resource management in browsers
        file.folder = this._currentFolderName;
        file.sourceType = 'folder';
        this.parent?.resources.addProjectResources(file);
    }

    populateFolders(grid) {
        // Deprecated - now using _populateFolderList
        this._populateFolderList(grid);
    }

    populateProjectAssets(grid) {
        const resources = this.parent?.resources?.resources;
        if (!resources || resources.size === 0) return;

        for (const [hash, fileData] of resources) {
            if (fileData.sourceType !== 'project_folder') continue;

            const obj = {
                name: fileData.name,
                type: fileData.type,
                hash: fileData.hash,
                path: fileData.path,
                mimeType: fileData.mimeType,
                size: fileData.size,
                sourceType: fileData.sourceType,
                item: this.createItemFromFileData(fileData)
            };

            const itemElement = this.createAssetPreview(obj);
            grid.appendChild(itemElement);
        }
    }

    createItemFromFileData(fileData) {
        const baseItem = {
            label: fileData.name,
            resourceHash: fileData.hash
        };

        switch (fileData.type) {
            case 'sprite':
                return { type: 'sprite', ...baseItem };
            case 'video':
                return { type: 'video', ...baseItem, color: 'blue' };
            case 'sound':
                return { type: 'sound', ...baseItem, color: 'purple' };
            default:
                return { type: fileData.type || 'sprite', ...baseItem };
        }
    }

    createAssetPreview(obj) {
        if(!obj.__element) {
            obj.__element = LS.Create({
                class: 'asset-library-item',
                inner: [
                    { tag: 'i', class: this.getIcon(obj) },
                    { tag: 'span', inner: obj.name }
                ]
            });

            obj.__element.targetObject = obj;
        }

        return obj.__element;
    }

    getIcon(obj) {
        if(obj.mimeType) {
            if (obj.mimeType.startsWith("image/")) return "bi-image";
            if (obj.mimeType.startsWith("video/")) return "bi-film";
            if (obj.mimeType.startsWith("audio/")) return "bi-music-note-beamed";
        }

        return obj.icon || ({
            "container": "bi-archive",
            "sprite": "bi-image",
            "graphics": "bi-vector-pen",
            "text": "bi-textarea-t",
            "video": "bi-film",
            "sound": "bi-music-note-beamed",
            "automation": "bi-bezier2",
            "notes": "bi-music-note-list"
        }[obj.type] || "bi-file")
    }

    destroy() {
        this.onDetached();
        this.handle.destroy();
        this.handle = null;
        this.previewElement.remove();
        this.previewElement = null;
        this.library = null;
        if (this.fileBrowser) {
            this.fileBrowser.destroy();
            this.fileBrowser = null;
        }
        super.destroy();
    }
}

window.EditorViews = {
    PreviewView,
    TimelineView,
    AssetManagerView,
    PropertyEditorView
};