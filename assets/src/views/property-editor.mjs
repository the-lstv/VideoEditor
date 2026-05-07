/**
 * Property editor view class
 */
class PropertyEditorView extends LS.Multipane.View {
    static name = "propertyEditor";

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

        const entry = LS.Resize.set(this.__editAid, {
            sides: true,
            corners: true,
            translate: true
        });

        entry.handler.on("resize", (side, width, height, leftOffset, topOffset, state) => {
            if(!this.currentTarget) return;

            const project = this.#getProject();
            const preview = project?.connectedViews.get("videoPreview");
            if(preview) {
                const contained = preview.getContainedCoords();
                // TODO:
                const isContainer = false// this.currentTarget.node.constructor === PIXI.Container;
                width /= contained.scale;
                height /= contained.scale;

                this.#updateProp("scaleX", width / (isContainer ? 1 : this.currentTarget.node?.bounds.width ?? 1));
                this.#updateProp("scaleY", height / (isContainer ? 1 : this.currentTarget.node?.bounds.height ?? 1));

                if(side.toLowerCase().includes("left") || side.toLowerCase().includes("top")) {
                    this.#updateProp("positionX", (leftOffset - contained.left) / contained.scale);
                    this.#updateProp("positionY", (topOffset - contained.top) / contained.scale);
                }
            }
        });
        
        entry.handler.on("resize-end", () => {
            if(!this.currentTarget) return;
            this.updateAidPosition();
        });

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
                                this.#createInput("positionY", { type: "number", attributes: { step: 1 }, defaultValue: 0 }),
                                { tag: "label", inner: "Z", class: "input-label-small" },
                                this.#createInput("positionZ", { type: "number", attributes: { step: 1 }, defaultValue: 0 })
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
                                this.#createInput("scaleY", { type: "number", attributes: { step: 0.1 }, defaultValue: 1 }),
                                { tag: "label", inner: "Z", class: "input-label-small" },,
                                this.#createInput("scaleZ", { type: "number", attributes: { step: 0.1 }, defaultValue: 1 })
                            ]
                        }
                    ],
                    // Rotation
                    [
                        { tag: "span", inner: [{ tag: "i", class: "bi-arrow-clockwise" }, { tag: "label", inner: " Rotation:" }] },
                        this.#createInput("rotationX", { type: "number", inputType: "angle", attributes: { min: 0, max: 360 }, defaultValue: 0 }),
                        this.#createInput("rotationY", { type: "number", inputType: "angle", attributes: { min: 0, max: 360 }, defaultValue: 0 }),
                        this.#createInput("rotationZ", { type: "number", inputType: "angle", attributes: { min: 0, max: 360 }, defaultValue: 0 })
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

                const delta = event.offsetX * step * modifier;
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

                        const timeline = this.#getAttachment()?.timeline;
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
        this.tabs.add("Pipeline", LS.Create());
        this.tabs.add("Animation", LS.Create());
        this.tabs.add("Behavior", LS.Create());
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

                for(const prop of ["positionX", "positionY", "scaleX", "scaleY", "scaleZ", "rotationX", "rotationY", "rotationZ", "anchorX", "anchorY", "opacity", "visible", "blendMode", "tint", "skewX", "skewY"]) {
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

                const attachment = this.#getAttachment();
                if (attachment?.timeline) for (const [i, t] of (target.data.targets || []).entries()) {
                    const targetNode = attachment.timeline.getItemById(t.nodeId);
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
            const attachment = this.#getAttachment();
            if(!target.node) {
                attachment?.createItemNode?.(target);
            }

            const project = this.#getProject();
            const connectedPreview = project?.connectedViews.get("videoPreview");
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

                        initialWorldX = attachment?.getSavedNodeProperty?.(this.currentTarget, "positionX") ?? 0;
                        initialWorldY = attachment?.getSavedNodeProperty?.(this.currentTarget, "positionY") ?? 0;
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
                        const baseScaleX = attachment?.getSavedNodeProperty?.(this.currentTarget, "scaleX") ?? 1;
                        const baseScaleY = attachment?.getSavedNodeProperty?.(this.currentTarget, "scaleY") ?? 1;
                        this.#updateProp("scaleX", baseScaleX * (evt.deltaY < 0 ? 1.1 : 0.9));
                        this.#updateProp("scaleY", baseScaleY * (evt.deltaY < 0 ? 1.1 : 0.9));
                        this.updateAidPosition();
                    }

                    if(evt.shiftKey) {
                        evt.preventDefault();
                        const baseRotation = attachment?.getSavedNodeProperty?.(this.currentTarget, "rotation") ?? 0;
                        this.#updateProp("rotation", (baseRotation + (evt.deltaY < 0 ? 0.1 : -0.1)) % (Math.PI * 2));
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

    #getAttachment() {
        return this.attachedTo || this.parent;
    }

    #getProject() {
        return this.parent || this.attachedTo?.project || null;
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
                value = this.#getAttachment()?.getSavedNodeProperty?.(this.currentTarget, id);
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
        if (!this.currentTarget || this.currentTarget.type !== "automation" || !this.#getAttachment()?.timeline) return;

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

            this.#getAttachment()?.renderer?.applyNodeProperty?.(this.currentTarget, property, value);
            this.updateInputValue(property, value);

            if(this.targetNodeIsVisual) {
                this.#updateRender();
                this.updatePreviewObject();
                this.updateAidPosition();
            }
        }
    }

    #updateTimeline() {
        const attachment = this.#getAttachment();
        if(this.currentTarget && attachment?.timeline) {
            attachment.timeline.render(true);
        }
    }

    #updateRender(){
        const attachment = this.#getAttachment();
        if(this.currentTarget && attachment?.renderer) {
            attachment.render();
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
                const worldOffset = this.#getProject()?.connectedViews.get("videoPreview")?.getContainedCoords();
                if (!worldOffset) return;

                // Get values with fallback
                const attachment = this.#getAttachment();
                const x = attachment?.getSavedNodeProperty?.(t, "positionX") ?? 0;
                const y = attachment?.getSavedNodeProperty?.(t, "positionY") ?? 0;
                const w = (t.node?.width ?? t.data.width ?? 100);
                const h = (t.node?.height ?? t.data.height ?? 100);
                const ax = attachment?.getSavedNodeProperty?.(t, "anchorX") ?? 0;
                const ay = attachment?.getSavedNodeProperty?.(t, "anchorY") ?? 0;
                const rot = attachment?.getSavedNodeProperty?.(t, "rotation") ?? 0;

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
                const attachment = this.#getAttachment();
                const x = (attachment?.getSavedNodeProperty?.(this.currentTarget, "positionX") ?? 0) * scalePos;
                const y = (attachment?.getSavedNodeProperty?.(this.currentTarget, "positionY") ?? 0) * scalePos;
                const rot = attachment?.getSavedNodeProperty?.(this.currentTarget, "rotation") ?? 0;
                const sx = attachment?.getSavedNodeProperty?.(this.currentTarget, "scaleX") ?? 1;
                const sy = attachment?.getSavedNodeProperty?.(this.currentTarget, "scaleY") ?? 1;
                const ax = attachment?.getSavedNodeProperty?.(this.currentTarget, "anchorX") ?? 0;
                const ay = attachment?.getSavedNodeProperty?.(this.currentTarget, "anchorY") ?? 0;
                const w = (t.width || 100) * scalePos;
                const h = (t.height || 100) * scalePos;

                this.previewObject.style.width = w + "px";
                this.previewObject.style.height = h + "px";
                this.previewObject.style.transformOrigin = `${ax * 100}% ${ay * 100}%`;
                this.previewObject.style.transform = `translate(${x}px, ${y}px) rotate(${rot}rad) scale(${sx}, ${sy})`;
                
                let tint = attachment?.getSavedNodeProperty?.(this.currentTarget, "tint");
                if (typeof tint === 'number') tint = '#' + tint.toString(16).padStart(6, '0');
                this.previewObject.style.backgroundColor = tint || "var(--accent)";
                
                this.previewObject.style.opacity = attachment?.getSavedNodeProperty?.(this.currentTarget, "opacity");
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

        if(this.__editAidZoomHandler) {
            const connectedPreview = this.#getProject()?.connectedViews.get("videoPreview");
            if(connectedPreview) {
                const previewContainer = connectedPreview.container.querySelector(".preview-container");
                previewContainer.removeEventListener('wheel', this.__editAidZoomHandler);
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

export default PropertyEditorView;