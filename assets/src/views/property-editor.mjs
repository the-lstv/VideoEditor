import * as EditorBaseClasses from "../core/base.mjs";

/**
 * Property editor view class
 * A bit of a monolith at the moment
 */
class PropertyEditorView extends LS.View {
    static name = "propertyEditor";

    constructor() {
        super({
            name: 'PropertyEditorView',
            title: 'Properties',
            container: LS.Create({
                class: 'editor-property-editor'
            })
        });

        // Shown when no element is selected
        this.emptyMessage = LS.Create({
            class: "centered-layout",
            style: "flex-direction: column; color: var(--surface-8); text-align: center",
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
                { tag: "h1", i18n: "properties.nothingSelected", text: "Nothing selected", style: "margin: 10px 0px 5px 0" },
                { tag: "h3", i18n: "properties.selectElement", text: "Select an element to edit it", style: "margin: 0; font-weight: normal; color: var(--surface-6);" }
            ]
        });

        // Map of input elements
        this.inputs = new Map();

        // Property groups
        this.propertyGroups = {};

        // --- Tabs
        this.tabs = new LS.Tabs((this.tabContainer = LS.Create("ls-tabs.property-editor-tabs.editor-tabs")), {
            list: true,
            styled: false
        });

        this.tabs.add("Properties", this.editorContainer = LS.Create("ls-tab.property-editor-container"));
        this.tabs.add("Pipeline", this.pipelineEditorContainer = LS.Create("ls-tab.property-editor-pipeline-tab"));
        this.tabs.add("Animation", this.animationEditorContainer = LS.Create("ls-tab.property-editor-animation-tab"));
        this.tabs.add("Behavior", this.behaviorEditorContainer = LS.Create("ls-tab.property-editor-behavior-tab", {
            inner: { tag: "textarea", placeholder: "Behavior scripts coming soon!", value: `// Example behavior script

// You can register inputs and outputs.
// This returns a function, which either sets or gets a value.
// The name can be anything. Using any of the built-in property names will modulate those (you can right-click a property and click "Copy value ID"  to get the ID).
// Custom inputs will be saved in the node on demand but may not be as performant.
const posIn  = input("positionX", 0);
const posOut = output("positionX", 0);

// When reading inputs, the current vs saved values may differ (eg. after animations and other modulations are applied, that do not affect the saved value).
// To specifically get the saved value rather than fetch the currently rendered value, you can do:
// getSaved("positionX");

// If applicable, you can get a reference to the current node.
// This allows you to obtain or change some information about it.
// This does not apply to custom graph nodes however, only to timeline nodes.
const node = getNode();

// For certain objects, you can get access to their scripting API, for example dynamic text:
const dynamicText = node.textRenderer;

function update(time) {
    // This function is called when time updates, aka a frame is to be rendered.
    // The 'time' parameter is the current video time in seconds.

    // Example of modulating the input value into a new output value.
    posOut(posIn() + Math.sin(time) * 50);

    // If you want the time relative to the start of the clip, you can do:
    // const offsetTime = time - node.start;

    // Example of using the dynamic text API to render realtime information
    if(dynamicText) {
        dynamicText.clear();
        dynamicText.write(\`Hello world! Current time: \${time}, this node's track: \${node.track}\`, {});

        // You can also use some low-level operations when performance is critical:
        // The below sets the first character to 'h'. The char color is perserved, however it can also be changed with this method.
        dynamicText._updateVertex(0, 0, 104);
    }
}

function cleanup() {
    // You can perform any needed cleanup here.
}
`, disabled: true }
        }));
        this.tabs.set(0);

        // Setup (i separated it because the constructor became way too big)
        this.#setupContextMenu();
        this.#setupValueHandle();
        this.#setupPropertyGroups();
        this.#setupEditAid();

        this.#setupAnimationEditor();

        this.container.appendChild(this.emptyMessage);

        this.__resizeObserver = new ResizeObserver(this.__resizeCallback = () => {
            this.updateAidPosition();
        });

        this.__resizeObserver.observe(this.container);

        window.addEventListener("resize", this.__resizeCallback);

        this.frameScheduler = new LS.Util.FrameScheduler(() => this.#render());
    }


    /**
     * Set the current target to edit
     * @param {Object|null} target The target object to edit, or null to clear
     */
    setTarget(target) {
        if(!target) {
            this.tabContainer.remove();
            this.container.replaceChildren();
            this.container.appendChild(this.emptyMessage);
            this.currentTarget = null;
            this.__editAid.remove();
            return;
        }

        this.editorContainer.replaceChildren();
        this.editorContainer.appendChild(this.propertyGroups.general);

        this.animationEditorTreeView.loadData(target.data?.animations || []);

        this.currentTarget = target;

        this.__labelInput.value = target.label || "";

        this.targetNodeIsVisual = false;
        switch(target.type) {
            case "sprite": case "text": case "static_text": case "graphics": case "container": case "graphics":
                this.targetNodeIsVisual = true;

                this.editorContainer.appendChild(this.propertyGroups.transform);

                if(target.type === "text") {
                    this.editorContainer.appendChild(this.propertyGroups.dynamicText);
                } else if(target.type === "static_text") {
                    this.editorContainer.appendChild(this.propertyGroups.staticText);
                }

                const resourceType = this.parent && this.parent.resources.getResource(target.data.resource)?.type;

                if(resourceType || target.type === "sprite" || target.type === "audio") {
                    this.editorContainer.appendChild(this.propertyGroups.source);
                }

                if(resourceType === "video") {
                    this.editorContainer.appendChild(this.propertyGroups.video);
                }

                this.editorContainer.appendChild(this.propertyGroups.rendering);
                break;

            case "camera":
                this.targetNodeIsVisual = true;

                this.editorContainer.appendChild(this.propertyGroups.transform);
                this.editorContainer.appendChild(this.propertyGroups.camera);
                break;

            case "automation":
                this.__automationTargetsBody.innerHTML = "";

                const timelineInstance = this.attachedTo?.timelineInstance;
                if (timelineInstance) for (const [i, t] of (target.data.targets || []).entries()) {
                    const targetNode = timelineInstance.getItemById(t.nodeId);
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

            case "audio":
                this.editorContainer.appendChild(this.propertyGroups.source);
                this.editorContainer.appendChild(this.propertyGroups.audio);
                break;

            default: break;
        }

        for(const prop of this.editorContainer.querySelectorAll(".property-editor-input")) {
            const id = prop.dataset.inputId;
            this.updateInputValue(id);
        }

        // Edit aid for visual nodes
        if(this.targetNodeIsVisual) {
            const attachment = this.attachedTo;
            if(!target.node) {
                attachment?.createItemNode?.(target);
            }

            const project = this.#getProject();
            const connectedPreview = project?.connectedViews.get("videoPreview");

            let snapDivisX = 10, snapDivisY = 10;

            if(connectedPreview) {
                const previewContainer = connectedPreview.container.querySelector(".preview-container");
                previewContainer.appendChild(this.__editAid);

                this.updateAidPosition();

                let initialX, initialY, initialWorldX, initialWorldY, initialWorldZ, worldOffset, rect;
                let initialRotationX, initialRotationY, initialRotationZ;

                let lockedAxis = null;
                let rotateMode = null;
                let cursorResetTimer = null;

                if(!this.__editAidHandle) this.__editAidHandle = new LS.Util.TouchHandle(previewContainer, {
                    cursor: 'move',
                    exclude: ".ls-resize-handle",
                    pointerlock: true,

                    onStart: (event) => {
                        if (!this.currentTarget || !this.currentTarget.node) return event.cancel();

                        const isMiddleButton = event.domEvent?.button === 1 || event.domEvent?.buttons === 4;
                        rotateMode = isMiddleButton ? "3d" : null;
                        lockedAxis = null;

                        worldOffset = connectedPreview.getContainedCoords();
                        rect = previewContainer.getBoundingClientRect();

                        initialX = event.x - rect.left - worldOffset.left;
                        initialY = event.y - rect.top - worldOffset.top;

                        initialWorldX    = attachment?.renderer?.getSavedNodeProperty?.(this.currentTarget, "positionX") ?? 0;
                        initialWorldY    = attachment?.renderer?.getSavedNodeProperty?.(this.currentTarget, "positionY") ?? 0;
                        initialWorldZ    = attachment?.renderer?.getSavedNodeProperty?.(this.currentTarget, "positionZ") ?? 0;
                        initialRotationX = attachment?.renderer?.getSavedNodeProperty?.(this.currentTarget, "rotationX") ?? 0;
                        initialRotationY = attachment?.renderer?.getSavedNodeProperty?.(this.currentTarget, "rotationY") ?? 0;
                        initialRotationZ = attachment?.renderer?.getSavedNodeProperty?.(this.currentTarget, "rotationZ") ?? 0;

                        if(rotateMode === "3d") {
                            this.__editAidHandle.cursor = "--ls-cursor-rotate3d";
                        } else {
                            this.__editAidHandle.cursor = "--ls-cursor-move";
                        }
                    },

                    onMove: (event) => {
                        if(rotateMode === "3d") {
                            const dx = (event.x - rect.left - worldOffset.left) - initialX;
                            const dy = (event.y - rect.top - worldOffset.top) - initialY;

                            this.updateProp("rotationX", initialRotationX + dy * 0.01);
                            this.updateProp("rotationY", initialRotationY + dx * 0.01);
                            this.updateProp("rotationZ", initialRotationZ);
                            return;
                        }

                        // Screen delta coords to world delta coords
                        let dx = ((event.x - rect.left - worldOffset.left) - initialX) / worldOffset.scale;
                        let dy = ((event.y - rect.top - worldOffset.top) - initialY) / worldOffset.scale;

                        // Calculate new world position
                        let wx = initialWorldX + dx;
                        let wy = initialWorldY + dy;

                        if(event.domEvent.shiftKey) {
                            if(!lockedAxis) {
                                lockedAxis = Math.abs(dx) >= Math.abs(dy) ? "y" : "x";
                            }

                            if(lockedAxis === "x") wx = initialWorldX;
                            if(lockedAxis === "y") wy = initialWorldY;
                        } else {
                            lockedAxis = null;
                        }

                        // Snap to grid if alt is not held
                        if(!event.domEvent.altKey) {
                            wx = Math.round(wx / snapDivisX) * snapDivisX;
                            wy = Math.round(wy / snapDivisY) * snapDivisY;
                        }

                        this.__editAid.style.transform = `translate3d(${wx * worldOffset.scale + worldOffset.left}px, ${wy * worldOffset.scale + worldOffset.top}px, 0)`;
                        this.updateProp("positionX", wx);
                        this.updateProp("positionY", wy);
                    },

                    onEnd: () => {
                        rotateMode = null;
                        lockedAxis = null;
                        if(cursorResetTimer) window.clearTimeout(cursorResetTimer);
                    }
                });

                if(!this.__editAidZoomHandler) previewContainer.addEventListener('wheel', this.__editAidZoomHandler = (evt) => {
                    if(!this.currentTarget || !this.currentTarget.node) return;

                    if(evt.ctrlKey) {
                        evt.preventDefault();
                        const baseScaleX = attachment?.renderer?.getSavedNodeProperty?.(this.currentTarget, "scaleX") ?? 1;
                        const baseScaleY = attachment?.renderer?.getSavedNodeProperty?.(this.currentTarget, "scaleY") ?? 1;
                        this.updateProp("scaleX", baseScaleX * (evt.deltaY < 0 ? 1.1 : 0.9));
                        this.updateProp("scaleY", baseScaleY * (evt.deltaY < 0 ? 1.1 : 0.9));
                        this.updateAidPosition();
                    }

                    if(evt.shiftKey) {
                        evt.preventDefault();
                        const baseRotation = attachment?.renderer?.getSavedNodeProperty?.(this.currentTarget, "rotationZ") ?? 0;
                        this.updateProp("rotationZ", (baseRotation + (evt.deltaY < 0 ? 0.1 : -0.1)) % (Math.PI * 2));
                        this.updateAidPosition();
                        this.__editAidHandle.cursor = "--ls-cursor-rotate";
                    }
                });
            }
        } else {
            this.__editAid.remove();
        }

        this.emptyMessage.remove();
        this.container.appendChild(this.tabContainer);
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

            if(!inputObject.dontUpdate) this.updateProp(id, value);
            if(typeof inputObject.callback === "function") {
                inputObject.callback(value);
            }
        }});

        inputObject.input.dataset.inputId = id;
        inputObject.input.dataset.inputType = inputObject.inputType || type;

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
            this.__valueContextMenu_createAnimationButton.hidden  = !inputObject.animatable;
            // this.__valueContextMenu_enableOutputCheckbox.hidden   = !inputObject.animatable;

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
                value = this.attachedTo?.renderer?.getSavedNodeProperty?.(this.currentTarget, id);
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
        if (!this.currentTarget || this.currentTarget.type !== "automation" || !this.attachedTo?.timelineInstance) return;

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
                content: "After closing this message, tweak any animatable property on any object that you wish to automate. This will link it as a target in the automation clip.",
                buttons: [{ label: "Got it!" }]
            });

            localStorage.setItem("show-automation-target-hint", "false");
        }
    }

    updateProp(property, value) {
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

            this.attachedTo?.renderer?.applyNodeProperty?.(this.currentTarget, property, value);
            this.updateInputValue(property, value);

            if(this.targetNodeIsVisual) {
                this.#updateRender();
                this.updateAidPosition();
            }
        }
    }

    #updateTimeline() {
        const timelineInstance = this.attachedTo?.timelineInstance;
        if(this.currentTarget && timelineInstance) {
            timelineInstance.render(true);
        }
    }

    #updateRender(){
        const attachment = this.attachedTo;
        if(this.currentTarget && attachment?.renderer) {
            attachment.render();
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
                const attachment = this.attachedTo;
                const x = attachment?.renderer?.getSavedNodeProperty?.(t, "positionX") ?? 0;
                const y = attachment?.renderer?.getSavedNodeProperty?.(t, "positionY") ?? 0;
                // ! todo: width/height
                // const w = (t.node?.width ?? t.data.width ?? 100);
                // const h = (t.node?.height ?? t.data.height ?? 100);
                const w = attachment?.renderer?.getSavedNodeProperty?.(t, "scaleX") ?? 0;
                const h = attachment?.renderer?.getSavedNodeProperty?.(t, "scaleY") ?? 0;
                const ax = attachment?.renderer?.getSavedNodeProperty?.(t, "anchorX") ?? 0;
                const ay = attachment?.renderer?.getSavedNodeProperty?.(t, "anchorY") ?? 0;
                const az = attachment?.renderer?.getSavedNodeProperty?.(t, "anchorZ") ?? 0;
                const rot = attachment?.renderer?.getSavedNodeProperty?.(t, "rotationZ") ?? 0;
                const preserveAnchorPosition = attachment?.renderer?.getSavedNodeProperty?.(t, "preserveAnchorPosition") ?? false;

                // Calculate anchor offset
                const anchorOffsetX = -ax * w;
                const anchorOffsetY = -ay * h;

                // Apply rotation to anchor offset
                // const cos = Math.cos(rot);
                // const sin = Math.sin(rot);
                // const rotatedOffsetX = anchorOffsetX * cos - anchorOffsetY * sin;
                // const rotatedOffsetY = anchorOffsetX * sin + anchorOffsetY * cos;
                const rotatedOffsetX = preserveAnchorPosition ? 0:  anchorOffsetX;
                const rotatedOffsetY = preserveAnchorPosition ? 0:  anchorOffsetY;

                // Final position in screen space
                const screenX = (x + rotatedOffsetX) * worldOffset.scale + worldOffset.left;
                const screenY = (y + rotatedOffsetY) * worldOffset.scale + worldOffset.top;

                this.__editAid.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
                this.__editAid.style.width = (w * worldOffset.scale) + "px";
                this.__editAid.style.height = (h * worldOffset.scale) + "px";
            }
        }
    }

    updateAidPosition() {
        this.__aidDirty = true;

        // Sync with the frame scheduler of the attached renderer
        this.frameScheduler.limiter = this.attachedTo?.frameScheduler?.limiter;

        this.frameScheduler.schedule();
    }

    // --- Setup methods

    // -- Context menu for all inputs
    #setupContextMenu() {
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
                        let value = this.focusedInput.input.value;
                        if(this.focusedInput.type === "checkbox") value = this.focusedInput.input.checked;
                        LS.Util.copy(value);
                        LS.Toast.show("Copied \"" + value + "\" to clipboard", { timeout: 2000 });
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

                { text: "Copy value ID", icon: "bi-hash", action: () => {
                    if(this.focusedInput) {
                        LS.Util.copy(this.focusedInput.id);
                        LS.Toast.show("Copied \"" + this.focusedInput.id + "\" to clipboard", { timeout: 2000 });
                    }
                } },

                { type: "separator" },

                this.__valueContextMenu_createAutomationButton = { text: "Create automation clip", icon: "bi-bezier2", action: () => {
                    if(this.currentTarget && this.focusedInput) {
                        if(!this.focusedInput.animatable) return;

                        const propertyName = this.focusedInput.id;
                        if(!propertyName) return;

                        const timelineInstance = this.attachedTo?.timelineInstance;
                        if(!timelineInstance) return;

                        const clip = {
                            type: "automation",
                            start: this.currentTarget.start || 0,
                            duration: this.currentTarget.duration || 1,
                            row: (this.currentTarget.row || 0) + 1,
                            label: `${this.currentTarget.label || this.currentTarget.type || "Target"} - ${propertyName}`,
                            tileColor: "neon",
                            data: {
                                targets: [
                                    { nodeId: this.currentTarget.id, property: propertyName }
                                ],

                                value: 0,
                                points: []
                            }
                        }

                        timelineInstance.add(clip);
                    }
                } },

                this.__valueContextMenu_createAnimationButton = { text: "Create animation", icon: "bi-play-circle", action: () => { } },

                // this.__valueContextMenu_enableOutputCheckbox = { text: "Output in graph", type: "checkbox", action: () => { } },
            ]
        });
    }

    // -- Handle for dragging on number inputs
    #setupValueHandle() {
        let startValue, min, max, input, step, precision, moveTarget, inputType;
        let startRotationX, startRotationY, startRotationZ;

        console.log("Setting up value handle", this.editorContainer);

        this.__valueHandle = new LS.Util.TouchHandle(this.editorContainer, {
            cursor: 'ew-resize',
            pointerLock: true,
            buttons: [0],

            onStart: (event) => {
                input = event.domEvent.target;

                moveTarget = input.closest(".move-target") && (input = input.closest(".move-target")) && input.dataset.moveTarget;
                inputType = input.dataset.inputType;

                if (!this.currentTarget) return event.cancel();
                if (!moveTarget && (input.tagName !== "INPUT" || input.type !== "number" || (event.domEvent.type === "mousedown" && event.domEvent.button !== 0) || this.__addingTarget)) return event.cancel();

                if(moveTarget) {
                    switch(moveTarget) {
                        case "position":
                            this.__valueHandle.cursor = "--ls-cursor-move";
                            startValue = [
                                this.attachedTo?.renderer?.getSavedNodeProperty?.(this.currentTarget, "positionX") ?? 0,
                                this.attachedTo?.renderer?.getSavedNodeProperty?.(this.currentTarget, "positionY") ?? 0,
                                this.attachedTo?.renderer?.getSavedNodeProperty?.(this.currentTarget, "positionZ") ?? 0
                            ];
                            break;
                        
                        case "scale":
                            startValue = [
                                this.attachedTo?.renderer?.getSavedNodeProperty?.(this.currentTarget, "scaleX") ?? 1,
                                this.attachedTo?.renderer?.getSavedNodeProperty?.(this.currentTarget, "scaleY") ?? 1,
                                this.attachedTo?.renderer?.getSavedNodeProperty?.(this.currentTarget, "scaleZ") ?? 1
                            ];
                            break;
                        
                        case "rotation":
                            this.__valueHandle.cursor = "--ls-cursor-rotate3d";
                            startRotationX = this.attachedTo?.renderer?.getSavedNodeProperty?.(this.currentTarget, "rotationX") ?? 0;
                            startRotationY = this.attachedTo?.renderer?.getSavedNodeProperty?.(this.currentTarget, "rotationY") ?? 0;
                            startRotationZ = this.attachedTo?.renderer?.getSavedNodeProperty?.(this.currentTarget, "rotationZ") ?? 0;
                            break;
                    }
                    return;
                }

                startValue = Number(input.value);
                input.focus();
                input.select();
                min = input.min !== "" ? Number(input.min) : -Infinity;
                max = input.max !== "" ? Number(input.max) :  Infinity;
                step = input.step && input.step !== "any" ? Number(input.step) : 1;

                // Calculate precision based on step
                if (Math.floor(step) === step) precision = 0; else {
                    const str = step.toString();
                    if (str.indexOf("e-") > -1) precision = parseInt(str.split("e-")[1]);
                    else precision = str.split(".")[1]?.length || 0;
                }
            },

            onMove: (event) => {
                if(moveTarget) {
                    switch(moveTarget) {
                        case "position":
                            this.updateProp("positionX", startValue[0] + event.offsetX);
                            this.updateProp("positionY", startValue[1] + event.offsetY);
                            // this.updateProp("positionZ", startValue[2] + event.offsetY);
                            break;

                        case "scale":
                            const scaleChange = 1 - event.offsetY * 0.01;
                            this.updateProp("scaleX", startValue[0] * scaleChange);
                            this.updateProp("scaleY", startValue[1] * scaleChange);
                            this.updateProp("scaleZ", startValue[2] * scaleChange);
                            break;
                        
                        case "rotation":
                            this.updateProp("rotationX", startRotationX + event.offsetY * 0.01);
                            this.updateProp("rotationY", startRotationY + event.offsetX * 0.01);
                            this.updateProp("rotationZ", startRotationZ);
                            break;
                    }
                    return;
                }

                let modifier = 1;
                if (event.domEvent) {
                    if (event.domEvent.shiftKey) modifier = 10;
                    if (event.domEvent.altKey) modifier = 0.1;
                }

                const delta = event.offsetX * step * modifier;
                let newValue = startValue + delta;

                if (inputType === "angle") {
                    // Wrap between 0-360
                    newValue = Math.floor(((newValue % 360) + 360) % 360);
                }

                newValue = Math.max(min, Math.min(max, newValue));

                input.value = newValue.toFixed(precision);
                input.dispatchEvent(new Event('input'));
            },

            onEnd() {
                input = null;
                moveTarget = null;
            }
        });
    }

    #setupAnimationEditor() {
        // Animation targets are rendered in a tree view for virtualized rendering.
        this.animationEditorTreeView = new LS.Tree({
            rowHeight: 100,
            nested: false, // Optimization hint since we do not need nested nodes

            createNode: () => {
                return LS.Create({
                    class: "animation-target-node",
                    inner: [
                        { tag: "h4" },
                        { tag: "p" }
                    ]
                });
            },

            updateNode: (node, element) => {
                element.querySelector("h4").textContent = node.label;
                element.querySelector("p").textContent = node.id;
            }
        });

        EditorBaseClasses.createTip("animation", "TIP: You can link any input to an animation. There are also multiple ways to create animations: this tab is for simpler keyframe-based animation, but you can also use automation clips, data nodes, or scripts, when more complex, multi-target or reactive animations are needed.", this.animationEditorContainer);
        this.animationEditorContainer.append(this.animationEditorTreeView.container);
    }

    // -- Property groups & inputs
    #setupPropertyGroups() {
        this.propertyGroups.general = LS.Create([
            { tag: "h3", i18n: "properties.general", text: "General", class: "property-editor-header" },
            {
                class: "property-editor-group level-1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-tag" }, { tag: "label", i18n: "properties.label", text: " Label:" }] }, this.__labelInput = LS.Create({
                        tag: "input", type: "text", class: "property-editor-name-input", oninput: () => {
                            if (this.currentTarget) {
                                this.currentTarget.label = this.__labelInput.value;
                                this.#updateTimeline();
                            }
                        }
                    })],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-palette2" }, { tag: "label", i18n: "properties.tileColor", text: " Tile color:" }] }, this.#createInput("tileColor", {
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

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-stopwatch" }, { tag: "label", i18n: "properties.duration", text: " Duration (ms):" }] }, this.#createInput("clipDuration", {
                        animatable: false, type: "number", attributes: { min: 1, step: 100 }, defaultValue: 5, onchange: () => {
                            this.#updateTimeline();
                    }})],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-align-start" }, { tag: "label", i18n: "properties.start", text: " Start (ms):" }] }, this.#createInput("clipStartTime", {
                        animatable: false, type: "number", attributes: { min: 0, step: 100 }, defaultValue: 0, onchange: () => {
                            this.#updateTimeline();
                    }})],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-graph-up" }, { tag: "label", i18n: "properties.fadeIn", text: " Basic Fade In (ms):" }] }, this.#createInput("fadeIn", {
                        animatable: false, type: "number", attributes: { min: 0, step: 100 }, defaultValue: 0, onchange: () => {
                            this.#updateTimeline();
                    }})],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-graph-down" }, { tag: "label", i18n: "properties.fadeOut", text: " Basic Fade Out (ms):" }] }, this.#createInput("fadeOut", {
                        animatable: false, type: "number", attributes: { min: 0, step: 100 }, defaultValue: 0, onchange: () => {
                            this.#updateTimeline();
                    }})]
                ]
            },
        ]);

        this.propertyGroups.transform = LS.Create([
            { tag: "h3", i18n: "properties.transform", text: "Transform & Layout", class: "property-editor-header" },
            {
                class: "property-editor-group level-1", inner: [
                    [{ tag: "span", tooltip: "Changes the draw order regardless of Z position.\n-1 is default and draws items based on the track order of\nyour timeline from top to bottom.\nIt is useful to set if you want multiple items to draw on\nthe same layer or customize their order.", inner: [{ tag: "i", class: "bi-stack" }, { tag: "label", i18n: "properties.drawOrder", text: " Custom Draw Order:" }] }, this.#createInput("clipDrawOrder", { type: "number", attributes: { min: 0, step: 1 }, defaultValue: -1 })],

                    // Position Group
                    [
                        { tag: "span", inner: [{ tag: "i", class: "bi-arrows-move" }, { tag: "label", i18n: "properties.position", text: " Position:" }] },
                        {
                            class: "input-group", inner: [
                                { tag: "label", inner: "X", class: "input-label-small" },
                                this.#createInput("positionX", { type: "number", attributes: { step: 1 }, defaultValue: 0 }),
                                { tag: "label", inner: "Y", class: "input-label-small" },
                                this.#createInput("positionY", { type: "number", attributes: { step: 1 }, defaultValue: 0 }),
                                { tag: "label", inner: "Z", class: "input-label-small" },
                                this.#createInput("positionZ", { type: "number", attributes: { step: 1 }, defaultValue: 0 }),

                                { tag: "button", tooltip: "Move (hold & drag)\nRight click to reset", class: "square clear small move-target", attributes: { "data-move-target": "position" }, inner: { tag: "i", class: "bi-arrows-move" }, oncontextmenu: (e) => {
                                    e.preventDefault();
                                    this.updateProp("positionX", 0);
                                    this.updateProp("positionY", 0);
                                    this.updateProp("positionZ", 0);
                                } }
                            ]
                        }
                    ],
                    // Scale Group
                    [
                        { tag: "span", inner: [{ tag: "i", class: "bi-aspect-ratio" }, { tag: "label", i18n: "properties.scale", text: " Scale:" }] },
                        {
                            class: "input-group", inner: [
                                { tag: "label", inner: "X", class: "input-label-small" },
                                this.#createInput("scaleX", { type: "number", attributes: { step: 0.1 }, defaultValue: 1 }),
                                { tag: "label", inner: "Y", class: "input-label-small" },
                                this.#createInput("scaleY", { type: "number", attributes: { step: 0.1 }, defaultValue: 1 }),
                                { tag: "label", inner: "Z", class: "input-label-small" },,
                                this.#createInput("scaleZ", { type: "number", attributes: { step: 0.1 }, defaultValue: 1 }),

                                { tag: "button", tooltip: "Resize (hold & drag)\nRight click to reset", class: "square clear small move-target", attributes: { "data-move-target": "scale" }, inner: { tag: "i", class: "bi-arrows-vertical" }, oncontextmenu: (e) => {
                                    e.preventDefault();
                                    this.updateProp("scaleX", 1);
                                    this.updateProp("scaleY", 1);
                                    this.updateProp("scaleZ", 1);
                                } }
                            ]
                        }
                    ],
                    // Rotation
                    [
                        { tag: "span", inner: [{ tag: "i", class: "bi-arrow-clockwise" }, { tag: "label", i18n: "properties.rotation", text: " Rotation:" }] },
                        {
                            class: "input-group", inner: [
                                { tag: "label", inner: "X", class: "input-label-small" },
                                this.#createInput("rotationX", { type: "number", inputType: "angle", attributes: { min: 0, max: 360 }, defaultValue: 0 }),
                                { tag: "label", inner: "Y", class: "input-label-small" },
                                this.#createInput("rotationY", { type: "number", inputType: "angle", attributes: { min: 0, max: 360 }, defaultValue: 0 }),
                                { tag: "label", inner: "Z", class: "input-label-small" },
                                this.#createInput("rotationZ", { type: "number", inputType: "angle", attributes: { min: 0, max: 360 }, defaultValue: 0 }),

                                { tag: "button", tooltip: "3D Rotate (hold & drag)\nRight click to reset", class: "square clear small move-target", attributes: { "data-move-target": "rotation" }, inner: { tag: "i", class: "bi-arrow-repeat" }, oncontextmenu: (e) => {
                                    e.preventDefault();
                                    this.updateProp("rotationX", 0);
                                    this.updateProp("rotationY", 0);
                                    this.updateProp("rotationZ", 0);
                                } }
                            ]
                        }
                    ],
                    // // Skew Group
                    // [
                    //     { tag: "span", inner: [{ tag: "i", class: "bi-slash-square" }, { tag: "label", i18n: "properties.skew", text: " Skew:" }] },
                    //     {
                    //         class: "input-group", inner: [
                    //             { tag: "label", inner: "X", class: "input-label-small" },
                    //             this.#createInput("skewX", { type: "number", inputType: "angle", attributes: { min: 0, max: 360 }, defaultValue: 0 }),
                    //             { tag: "label", inner: "Y", class: "input-label-small" },
                    //             this.#createInput("skewY", { type: "number", inputType: "angle", attributes: { min: 0, max: 360 }, defaultValue: 0 })
                    //         ]
                    //     }
                    // ],
                    // Anchor Group
                    [
                        { tag: "span", inner: [{ tag: "i", class: "bi-pin-angle" }, { tag: "label", i18n: "properties.anchor", text: " Anchor:" }] },
                        {
                            class: "input-group", inner: [
                                { tag: "label", inner: "X", class: "input-label-small" },
                                this.#createInput("anchorX", { type: "number", attributes: { step: 0.1, min: 0, max: 1 }, defaultValue: 0 }),
                                { tag: "label", inner: "Y", class: "input-label-small" },
                                this.#createInput("anchorY", { type: "number", attributes: { step: 0.1, min: 0, max: 1 }, defaultValue: 0 }),
                                { tag: "label", inner: "Z", class: "input-label-small" },
                                this.#createInput("anchorZ", { type: "number", attributes: { step: 0.1, min: 0, max: 1 }, defaultValue: 0 }),
                                { tag: "button", tooltip: "Center", class: "square clear small", inner: { tag: "i", class: "bi-crosshair" }, onclick: () => {
                                    this.updateProp("anchorX", 0.5);
                                    this.updateProp("anchorY", 0.5);
                                    this.updateProp("anchorZ", 0.5);
                                }, oncontextmenu: (e) => {
                                    e.preventDefault();
                                    this.updateProp("anchorX", 0);
                                    this.updateProp("anchorY", 0);
                                    this.updateProp("anchorZ", 0);
                                } }
                            ]
                        }
                    ],
                    
                    [{ tag: "span", inner: [{ tag: "label", tooltip: "When enabled, anchor only applies to scale and rotation, position is preserved at the top-left corner", i18n: "properties.preserveAnchorPosition", text: " Preserve position:" }] },
                        {
                            class: "input-group", inner: [
                                this.#createInput("preserveAnchorPosition", { type: "checkbox", defaultValue: false }),
                                { tag: "button", tooltip: "When enabled, anchor only applies to scale and rotation, position is preserved at the top-left corner", class: "square clear small", style: "cursor: default", inner: { tag: "i", class: "bi-question-lg" } }
                            ]
                        }
                    ],
                ]
            },
        ]);

        this.propertyGroups.rendering = LS.Create([
            { tag: "h3", i18n: "properties.rendering", text: "Rendering", class: "property-editor-header" },
            {
                class: "property-editor-group level-1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-eye-slash" }, { tag: "label", i18n: "properties.visible", text: " Visible:" }] },
                        this.#createInput("visible", { type: "checkbox", defaultValue: true })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-palette-fill" }, { tag: "label", i18n: "properties.tint", text: " Color:" }] },
                        this.#createInput("materialColor", { type: "color", defaultValue: "#ffffff" })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-circle-half" }, { tag: "label", i18n: "properties.opacity", text: " Opacity:" }] },
                        this.#createInput("opacity", { type: "number", attributes: { min: 0, max: 1, step: 0.05 }, defaultValue: 1 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-circle-half" }, { tag: "label", i18n: "properties.blendMode", text: " Blend mode:" }] },
                        this.#createInput("blendMode", {
                            type: "select",
                            options: [
                                { value: "normal", text: "Normal" },
                                { value: "add", text: "Additive" },
                                { value: "subtract", text: "Subtractive" },
                                { value: "multiply", text: "Multiply" },
                                { value: "screen", text: "Screen" },
                                // { value: "overlay", text: "Overlay" },
                                { value: "darken", text: "Darken" },
                                { value: "lighten", text: "Lighten" },
                                // { value: "color-dodge", text: "Color Dodge" },
                                // { value: "color-burn", text: "Color Burn" },
                                // { value: "hard-light", text: "Hard Light" },
                                // { value: "soft-light", text: "Soft Light" },
                                // { value: "difference", text: "Difference" },
                                // { value: "exclusion", text: "Exclusion" },
                                // { value: "hue", text: "Hue" },
                                // { value: "saturation", text: "Saturation" },
                                // { value: "color", text: "Color" },
                                // { value: "luminosity", text: "Luminosity" }
                            ],
                        })
                    ],
                    
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-shadows" }, { tag: "label", i18n: "properties.castShadow", text: " Cast shadows:" }] },
                        this.#createInput("castShadow", { type: "checkbox", defaultValue: false })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-shadows" }, { tag: "label", i18n: "properties.receiveShadow", text: " Receive shadows:" }] },
                        this.#createInput("receiveShadow", { type: "checkbox", defaultValue: false })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-bounding-box-circles" }, { tag: "label", i18n: "properties.wireframe", text: " Wireframe:" }] },
                        this.#createInput("wireframe", { type: "checkbox", defaultValue: false })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-funnel" }, { tag: "label", i18n: "properties.dithering", text: " Dithering:" }] },
                        this.#createInput("dithering", { type: "checkbox", defaultValue: false })
                    ],
                ]
            },

            EditorBaseClasses.createTip("effects", "TIP: For more effects, advanced blend modes and filters see the pipeline tab.")
        ]);

        this.propertyGroups.source = LS.Create([
            { tag: "h3", i18n: "properties.source", text: "Source / Media / Material", class: "property-editor-header" },
            {
                class: "property-editor-group level-1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-link-45deg" }, { tag: "label", i18n: "properties.resource", text: " Media:" }] },
                        this.#createInput("resource", { type: "resource", resourceType: "media" })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-highlights" }, { tag: "label", i18n: "properties.material", text: " Material:" }] },
                        this.#createInput("material", { type: "resource", resourceType: "material" })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-aspect-ratio" }, { tag: "label", i18n: "properties.sourceFitMode", text: " Fit mode:" }] },
                        this.#createInput("sourceFitMode", {
                            type: "select",
                            options: [
                                { value: "contain", text: "Contain" },
                                { value: "cover",   text: "Cover"   },
                                { value: "stretch", text: "Stretch" },
                                { value: "none",    text: "None"    }
                            ],
                        })
                    ],
                ]
            }
        ]);

        this.propertyGroups.audio = LS.Create([
            { tag: "h3", i18n: "properties.audio", text: "Audio", class: "property-editor-header" },
            {
                class: "property-editor-group level-1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-volume-up" }, { tag: "label", i18n: "properties.volume", text: " Volume:" }] },
                        this.#createInput("audioVolume", { type: "number", inputType: "knob", attributes: { min: 0, max: 100, step: 0.05 }, defaultValue: 100 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-speaker" }, { tag: "label", i18n: "properties.audioPan", text: " Pan:" }] },
                        this.#createInput("audioPan", { type: "number", inputType: "knob", attributes: { min: -1, max: 1, step: 0.05 }, defaultValue: 0 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-alignment-baseline" }, { tag: "label", i18n: "properties.playbackRate", text: " Playback rate:" }] },
                        this.#createInput("audioPlaybackRate", { type: "number", inputType: "knob", attributes: { min: 0.1, step: 0.1 }, defaultValue: 1 })
                    ],
                ]
            },

            EditorBaseClasses.createTip("audio", "TIP: For more audio effects and options, see the pipeline tab.")
        ]);

        this.propertyGroups.video = LS.Create([
            { tag: "h3", i18n: "properties.video", text: "Video", class: "property-editor-header" },
            {
                class: "property-editor-group level-1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-film" }, { tag: "label", i18n: "properties.playbackRateDirection", text: " Playback rate/direction:" }] },
                        this.#createInput("playbackRate", { type: "number", inputType: "number", attributes: { min: -30, max: 30, step: 0.1 }, defaultValue: 1 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-display" }, { tag: "label", i18n: "properties.frameRateLimit", text: " Frame rate limit:" }] },
                        this.#createInput("videoFrameRate", { type: "number", inputType: "number", attributes: { min: -1, max: 460, step: 1 }, defaultValue: -1 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-stopwatch" }, { tag: "label", i18n: "properties.offset", text: " Offset:" }] },
                        this.#createInput("mediaOffset", { type: "number", inputType: "number", attributes: { step: 0.1 }, defaultValue: 0 })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-repeat-1" }, { tag: "label", i18n: "properties.loopMode", text: " Loop mode:" }] },
                        this.#createInput("loopMode", {
                            type: "select",
                            defaultValue: "loop",
                            options: [
                                { value: "none", text: "None" },
                                { value: "loop", text: "Loop" },
                                { value: "pingpong", text: "Ping Pong" }
                            ],
                        })
                    ],

                    { tag: "hr" },

                    { tag: "h3", i18n: "properties.proxySettings", text: "Proxy settings", style: "margin: 0" },
                    { tag: "p", i18n: "properties.proxyDescription", text: "If the video is not playing or scrubbing smoothly during editing, this can help. Press generate proxy to create a version of the video optimized for editing." },

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-speedometer" }, { tag: "label", i18n: "properties.proxy", text: " Proxy:" }] },
                        { tag: "label", class: "ls-switch",
                            inner: [
                                { tag: "fixme-span", i18n: "properties.enabled", text: "Enabled" },
                                { tag: "input", type: "checkbox", onchange: (e) => {
                                    // ! todo
                                }},
                                { tag: "span" }, // This NEEDS to be fixed
                            ]
                        },

                        { tag: "button", i18n: "properties.generateProxy", text: "Generate Proxy", class: "elevated", onclick: () => {
                            if(this.currentTarget) {
                                const resource = this.currentTarget.data.resource;
                                if(resource && resource.assets?.videoDecoder) {
                                    resource.assets.videoDecoder.generateProxyWithModal();
                                }
                            }
                        }},

                        { tag: "button", i18n: "properties.deleteProxy", text: "Delete Proxy", class: "elevated", onclick: () => {
                            if(this.currentTarget) {
                                const resource = this.currentTarget.data.resource;
                                if(resource && resource.assets?.videoDecoder) {
                                    resource.assets.videoDecoder.clearProxy();
                                }
                            }
                        }}
                    ],
                ]
            }
        ]);

        this.propertyGroups.staticText = LS.Create([
            { tag: "h3", i18n: "properties.text", text: "Text", class: "property-editor-header" },
            {
                class: "property-editor-group level-1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-fonts" }, { tag: "label", i18n: "properties.textContent", text: " Content:" }] },
                        this.#createInput("textContent", { type: "text", defaultValue: "Some text" })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-type-bold" }, { tag: "label", i18n: "properties.textStyleWeight", text: " Font weight:" }] },
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

        this.propertyGroups.dynamicText = LS.Create([
            { tag: "h3", i18n: "properties.text", text: "Text", class: "property-editor-header" },
            {
                class: "property-editor-group level-1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-fonts" }, { tag: "label", i18n: "properties.textContent", text: " Content:" }] },
                        this.#createInput("textContent", { type: "text", defaultValue: "Some text" })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-type-bold" }, { tag: "label", i18n: "properties.textStyleWeight", text: " Font weight:" }] },
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
            { tag: "h3", i18n: "properties.automation", text: "Automation", class: "property-editor-header" },
            { class: "property-editor-group level-1", inner: [
                [{ tag: "span", inner: [{ tag: "i", class: "bi-toggles" }, { tag: "label", i18n: "properties.automationEnabled", text: " Enabled:" }] },
                    this.#createInput("automationEnabled", {
                        type: "checkbox", defaultValue: false
                    })
                ],

                [{ tag: "span", inner: [{ tag: "i", class: "bi-123" }, { tag: "label", i18n: "properties.automationBaseValue", text: " Starting value:" }] },
                    this.#createInput("automationBaseValue", {
                        type: "number", attributes: { step: 0.1, min: 0, max: 1 }, defaultValue: 0
                    })
                ],

                [{ tag: "span", inner: [{ tag: "i", class: "bi-braces-asterisk" }, { tag: "label", i18n: "properties.automationFunction", text: " Global mapping function:" }] },
                    this.#createInput("automationFunction", {
                        type: "text", defaultValue: "x",
                        animatable: false,
                        helpModal: this.__automationHelpModal = LS.Modal.build({
                            title: "Mapping functions",
                            content: [
                                { tag: "p", style: "margin-top: 0", inner: "Mapping functions allow you to transform the automation value before applying it to the target property. You can use 'x' or 'input' to represent the input value (from the automation curve), and return a new value." },
                                { tag: "ls-box", accent: "orange", class: "elevated", innerHTML: "Tip: Mapping functions are backwards compatible with the <a href=\"https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/automation_form.htm\" target=\"_blank\">FL Studio Mapping Formula</a>." },
                                { tag: "p", inner: "Examples:" },
                                { tag: "ul", style: "padding-left: 20px", inner: [
                                    { tag: "li", inner: [{ tag: "code", inner: "x" }, " - Identity function (1:1)"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "x + 10" }, " - Adds 10 to the value (offset)"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "x * 2" }, " - Doubles the value (multiplier)"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "x * 2 + 10" }, " - Offset & multiplier"] },
                                    { tag: "li", inner: [{ tag: "code", inner: "time % (2 * pi)" }, " - Continuous rotation"] },
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
                                    { name: "start", example: "start - Start time of a target clip in seconds" },
                                    { name: "length", example: "length - Length of a target clip in seconds" },
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
                { tag: "button", inner: "How do mapping functions work?", class: "pill elevated", style: "margin-top: 10px", onclick: () => { this.__automationHelpModal.open(); } },
                { tag: "button", inner: "Don't show again", class: "pill elevated margin-left-small", style: "margin-top: 10px", onclick() {
                    this.parentElement.remove();
                    localStorage.setItem("show-automation-help", "false");
                } }
            ] }] : [],

            { tag: "ls-box", class: "elevated margin-top-large", innerHTML: "Relative: value gets added on top of the original value.<br>Absolute: value replaces (sets) the value." }
        ]);

        this.propertyGroups.camera = LS.Create([
            { tag: "h3", i18n: "properties.camera", text: "Camera", class: "property-editor-header" },
            {
                class: "property-editor-group level-1", inner: [
                    [{ tag: "span", inner: [{ tag: "i", class: "bi-arrows-move" }, { tag: "label", i18n: "properties.cameraFov", text: " Field of view:" }] },
                        this.#createInput("cameraFov", { type: "number", defaultValue: 75, callback: (v) => this.updateProp({ fov: v }) })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-arrows-move" }, { tag: "label", i18n: "properties.cameraNear", text: " Near clip:" }] },
                        this.#createInput("cameraNear", { type: "number", defaultValue: 0.1, callback: (v) => this.updateProp({ near: v }) })
                    ],

                    [{ tag: "span", inner: [{ tag: "i", class: "bi-arrows-move" }, { tag: "label", i18n: "properties.cameraFar", text: " Far clip:" }] },
                        this.#createInput("cameraFar", { type: "number", defaultValue: 10000, callback: (v) => this.updateProp({ far: v }) })
                    ]
                ]
            }
        ]);
    }

    // -- Edit aid (moving and resizing objects in preview)
    #setupEditAid() {
        this.__editAid = LS.Create({
            class: "editAid",
        });

        let contained = null, preview;

        // Edit aid resize handles
        const aidResizerEntry = LS.Resize.set(this.__editAid, {
            sides: true,
            corners: true,
            translate: true,
            map: (data) => {
                if (data.event.domEvent.altKey || !preview) {
                    return null;
                }

                contained = preview.getContainedCoords();

                return {
                    // Apply snapping if alt is not held
                    width:  (Math.round(data.width  / contained.scale / 10) * 10) * contained.scale,
                    height: (Math.round(data.height / contained.scale / 10) * 10) * contained.scale,
                    posX:   (Math.round(data.posX   / contained.scale / 10) * 10) * contained.scale,
                    posY:   (Math.round(data.posY   / contained.scale / 10) * 10) * contained.scale,
                    cancelIfUnchanged: true
                }
            }
        });

        aidResizerEntry.handler.on("start", (event) => {
            const project = this.#getProject();
            preview = project?.connectedViews.get("videoPreview");
        });

        aidResizerEntry.handler.on("resize", (side, width, height, leftOffset, topOffset, state) => {
            if(!this.currentTarget) return;

            if(preview) {
                // TODO:
                const isContainer = false// this.currentTarget.node.constructor === PIXI.Container;
                width  /= contained.scale;
                height /= contained.scale;

                // TODO: w/h system for THREE (well, all) objects
                this.updateProp("scaleX", width / (isContainer ? 1 : this.currentTarget.node?.bounds?.width ?? 1));
                this.updateProp("scaleY", height / (isContainer ? 1 : this.currentTarget.node?.bounds?.height ?? 1));

                if(side.toLowerCase().includes("left") || side.toLowerCase().includes("top")) {
                    this.updateProp("positionX", (leftOffset - contained.left) / contained.scale);
                    this.updateProp("positionY", (topOffset - contained.top) / contained.scale);
                }
            }
        });
        
        aidResizerEntry.handler.on("end", () => {
            if(!this.currentTarget) return;
            this.updateAidPosition();
        });
    }

    destroy() {
        if(this.destroyed) return;

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
        this.__valueContextMenu_createAutomationButton = null;
        this.inputs.clear();

        this.propertyGroups = null;

        this.__automationHelpModal?.destroy();
        this.__automationHelpModal = null;

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

        window.removeEventListener("resize", this.__resizeCallback);
        this.__resizeCallback = null;

        super.destroy();
    }
}

export default PropertyEditorView;