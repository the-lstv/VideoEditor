/**
 * Video Editor flavor
 */

/**
 * Rough schema:
 * 
 * [Project]
 * - ResourceManager; holds all resources
 * - timelines
 * - config
 * 
 * [TimelineItem]
 * - Represents an item in the scene. Such as a video clip, an image, a text block, a sound, etc.
 * - Mostly static data (exportable) + the attached runtime node/etc. and a reference to a resource if any.
 * 
 * [Renderer]
 * - Responsible providing rendering help.
 */

import FlavorBase from "../../core/flavor.mjs";
import ThreeRendererAdapter from "../../components/graphics/ThreeJS/index.mjs";

// import * as AudioEngine from "../../components/audio/index.mjs";

// --- Views
import { AssetManagerView } from "../../views/asset-manager.mjs";
import PreviewView          from "../../views/preview.mjs";
import PropertyEditorView   from "../../views/property-editor.mjs";
import TimelineView         from "../../views/timeline.mjs";

import Project from "../../core/project.mjs";

import { Variable, mappingCompiler } from "../../core/variable.mjs";
import { ResourceManager, Resource } from "../../core/resources.mjs";

const { webUtils } = typeof require !== "undefined" ? require("electron") : {};

const CATEGORY_NAME = "Video Editing";

const TRACK_STRIDE = 1000; // The distance in renderOrder between each track

// --- Video editor flavor
class VideoEditor extends FlavorBase {
    static name = "video-editor";

    static iconSet = {
        icon: 'src/flavors/video-editor/images/icon.svg',
        small: 'src/flavors/video-editor/images/icon-flat.svg',
        favicon: 'src/flavors/video-editor/images/favicon.svg',
        desktopIcon: 'src/flavors/video-editor/images/favicon.png'
    };

    static version = "2.3.0-alpha";

    static meta = {
        name: "Video Editor",
        description: "A professional video editor built on the universal LS creative engine with web technologies and the LS framework.",
        category: CATEGORY_NAME,
        engine_version: ">=2.3.0-alpha",
    }

    async #init() {
        this.renderingCanvas = this.addDestroyable(document.createElement('canvas'));

        const rendererOptions = this.flavorConfig.rendererOptions || {};

        try {
            this.renderer = new ThreeRendererAdapter({
                canvas: this.renderingCanvas,
                width: rendererOptions.width || 1280,
                height: rendererOptions.height || 720,
                backgroundColor: rendererOptions.backgroundColor ?? 0x000000,
                backgroundAlpha: rendererOptions.backgroundAlpha ?? 1,
                antialias: rendererOptions.antialias !== false,
                alpha: rendererOptions.alpha !== false,
                powerPreference: rendererOptions.powerPreference || "high-performance",
                preserveDrawingBuffer: !!rendererOptions.preserveDrawingBuffer,
                ambientLightIntensity: rendererOptions.ambientLightIntensity,
                directionalLightIntensity: rendererOptions.directionalLightIntensity,
                toneMapping: rendererOptions.toneMapping,
                toneMappingExposure: rendererOptions.toneMappingExposure
            }, this.project);
        } catch (e) {
            LS.Modal.buildEphemeral({
                title: "Renderer Initialization Failed",
                content: { html: "Failed to initialize the video renderer. This may be due to an unsupported or outdated graphics card or driver. Video editing features will be unavailable.<br><br>Error details: <pre class=\"log-message\">" + e.message + "</pre>" },
                buttons: [
                    { label: "OK" }
                ]
            });
            throw new Error(e);
        }

        console.log("Video editor initialized with renderer options:", rendererOptions);
        
    }

    #getFilePath(file) {
        if(!file) return null;

        if(webUtils?.getPathForFile) {
            return webUtils.getPathForFile(file);
        }

        return file.path || file.fullPath || null;
    }

    constructor(project) {
        super(project);

        // LS.Timeline instance
        this.timelineInstance = null;
        this.firstFrameRendered = false;

        // Current timeline data
        this.currentTimeline = null;

        // Set of currently active render items
        this.activeRenderItems = [];

        this.editingItem = null;

        this.renderingMode = 0; // 0 = editing mode, 1 = export mode
        this.rerenderCallback = this.#maybeRerender.bind(this);

        // Cache event references that are emitted frequently (small benefit but skips event lookup)
        // In general this doesn't do much BUT in high-perf scenarios any detail matters so why not do it
        this.__seekEventRef = this.prepareEvent('seek');

        // The frame scheduler is responsible for scheduling frames to be rendered
        this.frameScheduler = new LS.Util.FrameScheduler((delta) => {
            if(delta > 0 && this.timelineInstance) {
                this.timelineInstance.setSeek(this.timelineInstance.seek + delta);
            }

            this.renderAtTime(this.timelineInstance.seek || 0);
        }, {
            deltaTime: true
        });

        // Limit FPS in the editor (exports can have any framerate)
        this.frameScheduler.limitFPS(60);

        // ! ---- todo: move elsewhere
        // Initialize editor GUI with views for video editing
        const previewView = new PreviewView();
        const timelineView = new TimelineView();
        const propertyEditorView = new PropertyEditorView();
        const assetManagerView = new AssetManagerView(this, {
            library: {
                'objects': [
                    // { i18n: "assets.base.container", icon: "bi-archive", label: "Container", type: "container", item: { type: "container", label: "Container", tileColor: "white" } },
                    { i18n: "assets.base.shape", icon: "bi-square", label: "Simple plane", type: "sprite", item: { type: "sprite", label: "Plane", data: { positionX: 100, positionY: 100, scaleX: 500, scaleY: 500, anchorX: 0, anchorY: 0 } } },
                    { i18n: "assets.base.vector_shape", icon: "bi-vector-pen", label: "Vector shape", type: "graphics", item: { type: "graphics", label: "Vector shape" } },
                    { i18n: "assets.base.automation_clip", icon: "bi-bezier2", label: "Automation clip", type: "automation", item: { type: "automation", label: "Automation clip" } },
                    // { i18n: "assets.base.video", icon: "bi-film", label: "Video", type: "sprite", item: { type: "sprite", label: "Video", tileColor: "blue" } },
                    // { i18n: "assets.base.image", icon: "bi-image", label: "Image", type: "sprite", item: { type: "sprite", label: "Image", tileColor: "lightgray" } },
                    { i18n: "assets.base.sound", icon: "bi-music-note-beamed", label: "Sound", type: "audio", item: { type: "audio", label: "Sound", tileColor: "purple" } },
                    { i18n: "assets.base.dynamic_text", icon: "bi-textarea-t", label: "Dynamic text", type: "text", helpText: "A dynamic text object.\n\nIt uses a custom text rendering engine. Text can be updated at any time, can be written anywhere, can be scripted, and shown at any scale. Also supports realtime effects and syntax highlighting.\n\nCons/limitations:\n- Fonts need to be converted to a special format, and limited to a set of characters\n- Text shaping and certain styling is not currently supported.\n- At the moment only works well with monospace fonts.\n- Bigger overhead per instance and while rendering then static text; it's recommended to reuse it.\n- Slightly more complex to use.\n\nPros:\n- Text remains crisp at any scale\n- Dynamic content and per-character effects\n- More versatile draw API.\n\nSuitable when you change text or text styles often and need high performance text rendering with advanced per-character effects.", item: { type: "text", label: "Dynamic text", data: { text: "Some text" }, tileColor: "aquamarine" } },
                    { i18n: "assets.base.static_text", icon: "bi-fonts", label: "Static text", type: "static_text", helpText: "A static text object that uses the browser's native text rendering, and then applies it as a texture to a sprite.\n\nCons:\n- Updates are expensive, meaning changing text or styles often may cause performance issues.\n- Handles less textthan dynamic text (performance and memory usage worsens with more text).\n- Less flexible scripting interface and styling is limited to one block (no individual character styling).\n- Does not handle scaling automatically, so changing text size requires re-rendering, otherwise the text will be distorted/pixelated.\n\nPros:\n- Simpler to use\n- More efficient for fixed text content\n- Handles font features (ligatures, kerning) better and works with any supported language.\n\nSuitable when you have short to medium fixed text content that doesn't need frequent updates and stays more-or-less the same size.", item: { type: "static_text", label: "Static text", data: { text: "Some text" }, tileColor: "aquamarine" } },
                    { i18n: "assets.base.timeline_script", icon: "bi-braces-asterisk", label: "Timeline script", type: "script", item: { type: "script", label: "Timeline script", tileColor: "pastel-indigo" } },
                    { i18n: "assets.base.anotherTimeline", icon: "bi-bar-chart-steps", label: "Another timeline (composite)", type: "timeline", item: { type: "timeline", label: "Timeline" } },
                    { i18n: "assets.base.pattern", icon: "bi-music-note-list", label: "Pattern", type: "notes", item: { type: "notes", label: "Pattern", tileColor: "yellow" } },
                    { i18n: "assets.base.3d_mesh", icon: "bi-box", label: "3D Object", type: "mesh", item: { type: "mesh", label: "3D Object", tileColor: "lapis" } },
                    { i18n: "assets.base.perspectiveCamera", icon: "bi-camera-video", label: "Perspective Camera", type: "camera", item: { type: "camera", label: "Perspective Camera", tileColor: "orange", data: { cameraType: "perspective", positionZ: 500 } } },
                    { i18n: "assets.base.orthographicCamera", icon: "bi-camera-video", label: "Orthographic Camera", type: "camera", item: { type: "camera", label: "Orthographic Camera", tileColor: "orange", data: { cameraType: "orthographic", positionZ: 500 } } },
                    { i18n: "assets.base.light", icon: "bi-lightbulb", label: "Light", type: "light", item: { type: "light", label: "Light", tileColor: "yellow" } },
                    { i18n: "assets.base.particle_emitter", icon: "bi-stars", label: "Particles", type: "particles", item: { type: "particles", label: "Particles", tileColor: "pink" } },
                    // { i18n: "assets.base.events", icon: "bi-toggles", label: "Events", type: "events", item: { type: "events", label: "Events" } },
                    { i18n: "assets.base.empty_item", icon: "bi-file-earmark", label: "Empty item", type: "empty", item: { type: "empty", label: "Empty item" } },
                ]
            }
        });

        app.focusedPreview = previewView;

        this.project.on("ready", () => {
        app.layoutManager.add(previewView, timelineView, assetManagerView, propertyEditorView);
            this.project.connect(previewView);
            this.project.connect(timelineView);
            this.project.connect(assetManagerView);
            this.project.connect(propertyEditorView);
        });

        // Expose some globals for debugging
        window.timelineView = timelineView;
        window.timeline = timelineView.timeline;
        // ! ----

        // this.masterAudioOut = null;

        // --- Project hooks

        // When the project data has loaded
        this.project.on("project-data-loaded", (data) => {
            // Here we can initialize some flavor-specific project data
            if(!this.flavorConfig.rendererOptions) {
                this.flavorConfig.rendererOptions = {
                    width: 1280,
                    height: 720
                };
            }

            this.timelines = new Map(Object.entries(data.timelines || {
                "main": []
            }));

            // ! todo; rename to activeTimeline
            this.setTimeline(this.project.config.timeline || "main");
        });

        // When the projects starts initializing
        this.project.once("initializing", async () => {
            await this.#init();
        });

        // When a view connects to the project
        this.project.on("view-connected", async (view) => {
            if(view.attachedTo == null) {
                view.attachedTo = this;
            }

            switch(view.constructor.name) {
                case "timeline":
                    this.timelineInstance = view.timeline;
                    this.setTimeline(this.currentTimeline || "main");

                    this.addExternalEventListener(this.timelineInstance, 'seek', () => {
                        if(this.destroyed) return console.error("Timeline emitted seek event for a destroyed instance! This is a bug!", this);

                        this.quickEmit(this.__seekEventRef, view.timeline.seek);
                        this.render();
                    });

                    this.addExternalEventListener(this.timelineInstance, 'duration-changed', (duration) => {
                        this.emit('duration-changed', [duration]);
                    });

                    this.addExternalEventListener(this.timelineInstance, 'item-select', (item) => {
                        const itemEditor = this.project.connectedViews.get('propertyEditor');
                        if(itemEditor) {
                            itemEditor.setTarget(item);
                            this.editingItem = item;
                            this.render();
                        }
                    });

                    this.addExternalEventListener(this.timelineInstance, 'item-deselect', () => {
                        const itemEditor = this.project.connectedViews.get('propertyEditor');
                        if(itemEditor) {
                            itemEditor.setTarget(null);
                        }
                        this.editingItem = null;
                        this.render();
                    });

                    this.addExternalEventListener(this.timelineInstance, "drag-start", (type) => {
                        if(type === "seek") {
                            this.prevPlayState = this.playing;
                            this.pause();
                        }
                    });

                    this.addExternalEventListener(this.timelineInstance, "drag-end", (type) => {
                        if(type === "seek" && this.prevPlayState) {
                            this.play();
                        }
                    });

                    this.addExternalEventListener(this.timelineInstance, 'file-dropped', async (files, row, offset) => {
                        await this.fileDrop({ data: { files } }, this.timelineInstance, offset, row);
                    });

                    this.addExternalEventListener(this.timelineInstance, 'action', (action) => {
                        this.project.historyManager.execute(action);
                    });

                    this.addExternalEventListener(this.timelineInstance, "item-cleanup", (item) => {
                        if(this.editingItem === item) {
                            this.editingItem = null;

                            const itemEditor = this.project.connectedViews.get('propertyEditor');
                            if(itemEditor) {
                                itemEditor.setTarget(null);
                            }
                        }

                        if(item.node) {
                            ThreeRendererAdapter.disposeObject(item.node);
                            item.node = null;
                        }

                        if(item.data.resource) {
                            const used = this.currentTimeline.some(item => item.data.resource === item.data.resource);
                            if(!used) {
                                const resource = this.project.resources.getResource(item.data.resource);
                                if(resource) {
                                    resource.unload();
                                }
                            }
                        }
                        this.render();
                    });

                    if(!this.firstFrameRendered) {
                        this.renderAtTime(0);
                        this.firstFrameRendered = true;
                    }

                    this.quickEmit(this.__seekEventRef, this.timelineInstance.seek);
                    this.emit('duration-changed', [this.timelineInstance.duration]);
                    break;

                case "videoPreview":
                    view.setSource(this.renderer);
                    break;

                case "assetManager":
                    this.addExternalEventListener(view, 'asset-dropped', async (event) => {
                        this.fileDrop(event, true);
                    });
            }
        });

        // When a view disconnects from the project
        this.project.on("view-disconnected", (view) => {
            switch(view.constructor.name) {
                case "timeline":
                    view.timeline.reset(null, true);
                    if(this.timelineInstance) {
                        this.timelineInstance.events.clear();
                    }
                    this.timelineInstance = null;
                    break;

                case "videoPreview":
                    view.setSource(null);
                    break;

                case "propertyEditor":
                    this.editingItem = null;
                    view.setTarget(null);
                    break;
            }

            if(view.attachedTo === this) {
                view.attachedTo = null;
            }
        });

        // When the project data is being exported
        this.project.on("export", (data) => {
            this.#exportTo(data);
        });

        LS.emit("flavor-ready", [this]);
    }

    #exportTo(data) {
        if(!data.savedFlavorId) data.savedFlavorId = "video-editor";

        const exportedTimelines = {};
        for(const [id, timeline] of this.timelines) {
            exportedTimelines[id] = timeline.map(item => {
                return this.timelineInstance.cloneItem(item, true, true);
            });
        }

        data.timelines = exportedTimelines;
    }

    onAboutDialog() {
        LS.Modal.buildEphemeral({
            content: [
                { tag: 'img', src: this.constructor.iconSet.icon, style: 'height: 5em; width: 100%; margin: auto' },
                { tag: 'h2', inner: 'Video Editor', style: 'text-align: center' },
                { tag: 'p', html: `Version <code>${this.constructor.version}</code><br>Editor version <code>${app.VERSION}</code><br>LS version <code>${LS.version}</code>` },
                { tag: 'p', inner: 'A professional video editor built on the universal LS creative engine with web technologies and the LS framework.' },
                { tag: 'p', inner: ['Created with love and hard work by Lukas (', { tag: 'a', href: 'https://lstv.space', target: '_blank', inner: 'https://lstv.space' }, ')'] },
                { tag: 'p', inner: ['Source code available on ', { tag: 'a', href: app.GITHUB_REPO, target: '_blank', inner: 'GitHub' }] },
            ],
            buttons: [ { label: "Close" } ]
        });
    }

    // --- General setters/getters

    get playing() {
        return this.frameScheduler.running;
    }

    set playing(value) {
        value = !!value;
        if(this.frameScheduler.running === value) return;

        this.emit('playing-changed', [value]);
        this.emit(value? 'play': 'pause');

        if(value) {
            this.frameScheduler.start();
        } else {
            this.frameScheduler.stop();
        }
    }

    get duration() {
        return this.timelineInstance? this.timelineInstance.duration: 0;
    }

    get time() {
        return this.timelineInstance? this.timelineInstance.seek: 0;
    }

    togglePlay() {
        this.playing = !this.playing;
    }

    play() {
        this.playing = true;
    }

    pause() {
        this.playing = false;
    }

    seek(time, moveTimelineView = false) {
        if(this.timelineInstance) {
            this.timelineInstance.setSeek(time);
            if(moveTimelineView) {
                this.timelineInstance.offset = time * this.timelineInstance.zoom;
            }
        }
    }

    render() {
        this.frameScheduler.schedule();
    }

    setTimeline(timelineId) {
        const timeline = Array.isArray(timelineId)? timelineId: this.timelines.get(timelineId);
        this.currentTimeline = timeline;

        if(this.timelineInstance) {
            // Set the timeline in the view
            this.timelineInstance.reset(timeline, true);
        }
    }


    /**
     * * THE MAIN VIDEO FRAME RENDERING LOGIC
     * Must be kept well optimized
     * 
     * Also, the whole setup here is quite temporary and has a lot to be worked on
     * 
     * @param {Number} time Time in milliseconds of the frame to render. If not provided, it will render the current time of the timeline.
     */
    async renderAtTime(time) {
        if(!this.timelineInstance || !this.renderer) return;
        if(time === undefined) time = this.timelineInstance.seek;

        // Hide items that are currently rendered
        for(const item of this.activeRenderItems) {
            if(item.node) item.node.visible = false;
        }
        this.activeRenderItems.length = 0;

        // Clear screen
        // this.renderer.clear();

        // First loop to process automation items and values
        // We find intersecting items at the current time via a binary search
        const items = this.timelineInstance.getIntersectingAt(time);

        if(this.editingItem && !items.includes(this.editingItem)) {
            items.push(this.editingItem);
        }

        let activeCamera = this.renderer.defaultCamera;

        for(const item of items) {
            if(item.type === "automation") {
                // Process automation & event & timeline data input items
                mappingCompiler.processTimelinedAutomation(item, time, this.timelineInstance, this.renderer);
                continue;
            }

            if(item.type === "audio") {
                console.log("TODO: implement audio rendering");
                continue;
            }

            // Ensure we have a visual node/rendering object
            if(!item.node) this.renderer.createObject(item);
            const node = item.node;

            if(!node || item.data.visible === false) continue;

            if(item.__dirtyPosition) {
                ThreeRendererAdapter.updateItemPosition(item);
            }

            if(item.type === "camera") {
                activeCamera = node;
                continue;
            }

            if(item.data.resource) {
                // Check for material resource updates
                if(item.resourceUpdated !== false) {
                    this.renderer.updateNodeResource(item);
                }

                const resource = this.project.resources.getResource(item.data.resource);
                if(resource && resource.type === "video") {
                    // Seek and update the video texture using the video decoder, which is assumed to have been created by the above renderer.updateNodeResource call
                    const decoder = resource.assets.videoDecoder;
                    if(decoder) {
                        // ! todo: rerender callback doesnt seem to work right
                        const seekPromise = decoder.seek(time - item.start, item.data, node.userData.canvasTexture, item.offset || 0);

                        if(this.renderingMode === 1) {
                            // Exporting, so we must wait for the frame to be ready
                            await seekPromise;
                        } else {
                            // Editing, so we can render later
                            seekPromise.then(this.rerenderCallback);
                        }
                    }
                }
            }

            // Apply local animations
            if(item.data.animations) {
                for(const anim of item.data.animations) {
                    mappingCompiler.processTimelinedAutomation(anim, time, this.timelineInstance, this.renderer);
                }
            }

            // Basic linear fadeIn/fadeOut
            if(item.data.fadeIn || item.data.fadeOut) {
                const progress = Math.min(
                    item.data.fadeIn? (time - item.start) / item.data.fadeIn: 1,
                    item.data.fadeOut? ((item.start + item.duration) - time) / item.data.fadeOut: 1
                );

                this.renderer.constructor.setMaterialOpacity(item, progress * (item.data.opacity ?? 1));
            } else {
                this.renderer.constructor.setMaterialOpacity(item, item.data.opacity ?? 1);
            }

            if(!node.visible) node.visible = true;
            const renderOrder = (item.row * TRACK_STRIDE) + (item.data.zIndex || 0);

            // Temporary
            if(renderOrder !== node._renderOrder) {
                node.renderOrder = renderOrder;
                node._renderOrder = renderOrder;
                node.traverse((child) => child.renderOrder = renderOrder);
            }

            // Mark as active
            this.activeRenderItems.push(item);
        }

        this.renderer.render(activeCamera);
        // this.frameRerender = false;
    }

    #maybeRerender(frameChanged) {
        if(this.destroyed) return;
        if(frameChanged) {
            this.render();
        }
    }

    /**
     * Handles file drops on the timeline, either as new resources or as timeline items.
     * @param {*} event The file drop event
     * @param {*} event.data The data associated with the drop, which can be a Resource or raw file data
     * @param {*} event.data.item If the dropped data is a timeline item template, it will be included here for cloning
     * @param {*} event.data.label A label for the dropped item
     * @param {*} event.data.path File path may be included here
     * @param {*} event.data.folderName If a file and belongs to a project folder, the folder name may be included here for better resource organization
     * @param {*} event.data.mimeType Optional MIME type may be included here
     * @param {*} timeline The timeline the file was dropped on, or null if not dropped on a timeline. OR set to true to try to detect based on event coordinates.
     * @param {*} time Optional custom time the file was dropped at, if applicable.
     * @param {*} row Optional custom row the file was dropped on, if applicable.
     * @returns 
     */
    async fileDrop(event, timeline, time, row) {
        if(timeline === true) {
            const dropX = event.x ?? event.clientX ?? event.data?.x;
            const dropY = event.y ?? event.clientY ?? event.data?.y;
            const elementsFromPoint = document.elementsFromPoint(dropX, dropY);
            timeline = elementsFromPoint.find(el => el.classList.contains('ls-timeline'))?.__lsComponent || null;

            if(timeline && !(timeline instanceof LS.Timeline)) {
                LS.Toast.show("Sorry, something went wrong while adding the item to a timeline.", { timeout: 3000, accent: "red" });
                return;
            }
        }

        if(timeline && (time === undefined || row === undefined)) {
            const dropX = event.x ?? event.clientX ?? event.data?.x;
            const dropY = event.y ?? event.clientY ?? event.data?.y;
            const coords = timeline.transformCoords(dropX, dropY);
            time = coords.time;
            row = coords.row;
        }

        console.log("Adding item to timeline at time", time, "row", row);

        const droppedFiles = event?.data?.files || event?.files || event?.dataTransfer?.files;
        if(droppedFiles && typeof droppedFiles.length === "number") {
            const files = Array.from(droppedFiles).map(file => {
                if(typeof file === "string") return file;

                const filePath = this.#getFilePath(file);
                return filePath || file?.name || null;
            }).filter(Boolean);

            if(files.length === 0) return;

            const resources = await this.project.resources.addProjectResources(files, row, time);

            if(!timeline) {
                return resources;
            }

            if(time === undefined) time = this.timelineInstance?.seek || 0;
            if(row === undefined) row = 0;

            for(let index = 0; index < resources.length; index++) {
                const resource = resources[index];
                if(!resource) continue;

                // Now we need to make an item for the asset
                const newItem = {
                    type: resource.guessNodeType(),
                    data: { resource },
                    label: resource.label,
                    start: time,
                    row: row + index,
                    duration: 1000
                };

                const isVideo = resource.type === "video";
                if(resource.type === "image" || isVideo) {
                    const meta = isVideo ? await resource.getVideoMetadata() : await resource.getImageDimensions();

                    if(isVideo) newItem.duration = meta.duration;

                    const viewportWidth = this.flavorConfig.rendererOptions.width || 1280;
                    const viewportHeight = this.flavorConfig.rendererOptions.height || 720;
                    const resourceWidth = meta.width;
                    const resourceHeight = meta.height;

                    const scale = Math.min(
                        viewportWidth / resourceWidth,
                        viewportHeight / resourceHeight
                    );

                    newItem.data.scaleX = resourceWidth * scale;
                    newItem.data.scaleY = resourceHeight * scale;

                    newItem.data.positionX = (viewportWidth - newItem.data.scaleX) * 0.5;
                    newItem.data.positionY = (viewportHeight - newItem.data.scaleY) * 0.5;
                }

                if(resource.type === "audio") {
                    const meta = await resource.getAudioMetadata();
                    newItem.duration = meta.duration * 1000;
                }

                timeline.add(newItem);
            }

            return resources;
        }

        // It is a timeline item/template, we can simply clone it.
        if(event?.data?.item) {
            if(!timeline) return;

            const newItem = timeline.cloneItem(event.data.item);
            newItem.start = time;
            newItem.row = row;
            newItem.duration = newItem.duration || 1000;

            timeline.add(newItem);
        }

        // External file dropped, so we need to ensure it is saved as a resource,
        // and then create a new timeline item.
        else {
            const data = event?.data || {};
            const isResource = data instanceof Resource;

            if(!isResource) {
                data.isExternal = true;
                data.type = null; // :shrug:
                data.id = null; // :shrug:
            }

            const resource = isResource? data: this.project.resources.addResource(data);

            // If not dropping to a timeline, then all we need to do is add the resource to the project
            if(!timeline) {
                LS.Toast.show("Resource added: " + data.label || resource.name || resource.path, { timeout: 3000 });
                return;
            }

            // Now we need to make an item for the asset
            const newItem = {
                type: resource.guessNodeType(),
                // resource: ResourceManager.createReference(resource),
                data: { resource },
                label: data.label || resource.name,
                start: time,
                row,
                duration: 1000
            };

            const isVideo = resource.type === "video";
            if(resource.type === "image" || isVideo) {
                const meta = isVideo? await resource.getVideoMetadata(): await resource.getImageDimensions();

                if(isVideo) newItem.duration = meta.duration * 1000;

                // todo: use w/h
                // newItem.data.scaleX = meta.width;
                // newItem.data.scaleY = meta.height;

                const viewportWidth = this.flavorConfig.rendererOptions.width || 1280;
                const viewportHeight = this.flavorConfig.rendererOptions.height || 720;
                const resourceWidth = meta.width;
                const resourceHeight = meta.height;

                // TODO: temporary, this should later be done by the renderer based on fitMode
                const scale = Math.min(
                    viewportWidth / resourceWidth,
                    viewportHeight / resourceHeight
                )

                newItem.data.scaleX = resourceWidth * scale;
                newItem.data.scaleY = resourceHeight * scale;

                newItem.data.positionX = (viewportWidth - newItem.data.scaleX) * 0.5;
                newItem.data.positionY = (viewportHeight - newItem.data.scaleY) * 0.5;

                // newItem.data.layoutSnap = "fit"; // Snap to video viewport.

                // newItem.data.loopMode = "loop"; // default to enabled looping for videos

                // newItem.data.layoutSnap = "fit"; // Snap to video viewport.
            }

            if(resource.type === "audio") {
                // todo: handle audio resource

                const meta = await resource.getAudioMetadata();
                newItem.duration = meta.duration * 1000;
            }

            timeline.add(newItem);
        }
    }

    /**
     * Destroys the flavor and optionally all connected views
     * @param {Boolean} destroyViews Whether to destroy connected views
     */
    destroy(destroyViews = false) {
        if(this.destroyed) return;

        if(this.timelineInstance) {
            // If destroyViews is true, the timeline has been destroyed already, so we don't need to reset it
            if(!destroyViews) this.timelineInstance.reset(null, true);
            this.timelineInstance = null;
        }

        if(this.renderer) this.renderer.destroy();
        this.currentTimeline = null;

        if(this.timelines) this.timelines.clear();

        this.renderingCanvas.remove();
        this.frameScheduler.destroy();
        this.frameScheduler = null;
        super.destroy();
    }

    static layoutPresets = {
        /**
         * |   |   |
         * |-------|
         * |   |   |
         */
        'default': {
            title: "Classic",
            direction: 'column',
            category: CATEGORY_NAME,
            inner: [
                // Two horizontal rows
                { inner: [{ type: 'slot', view: 'PropertyEditorView', resize: { width: 600 } }, { type: 'slot', view: 'PreviewView' }], resize: { height: "60%" } },
                { type: "tabs", tabs: [ [{ type: 'slot', view: 'AssetManagerView', resize: { width: 420 } }, { type: 'slot', view: 'TimelineView' }], [{ type: 'slot' }] ] },
            ]
        },

        /**
         * |   | | |
         * |   |---|
         * |   |   |
         */
        'vertical-split': {
            title: "Timeline Focused",
            direction: 'row',
            category: CATEGORY_NAME,
            inner: [
                { type: 'slot', view: 'TimelineView' },
                {
                    inner: {
                        direction: 'column',
                        inner: [{ direction: "row", inner: [{ type: 'slot', view: 'PreviewView' }, { type: 'slot', view: 'PropertyEditorView' }] }, { type: 'slot', view: 'AssetManagerView' }]
                    }
                }
            ]
        },

        // /**
        // * |       |
        // * |-------|
        // * |       |
        // */
        // 'simple-horizontal': {
        //     title: "Simple Horizontal",
        //     direction: 'column',
        //     category: CATEGORY_NAME,
        //     inner: [
        //         { type: 'slot', view: 'PreviewView', resize: { height: "50%" } },
        //         { type: 'slot', view: 'TimelineView' }
        //     ]
        // },

        // /**
        // * |   |   |
        // * |   |   |
        // * |   |   |
        // */
        // 'simple-vertical': {
        //     title: "Simple Vertical",
        //     category: CATEGORY_NAME,
        //     direction: 'row',
        //     inner: [
        //         { type: 'slot', view: 'PreviewView', resize: { width: "50%" } },
        //         { type: 'slot', view: 'TimelineView' }
        //     ]
        // },

        /**
        * |       |
        * |-------|
        * | | | | |
        */
        'preview-focused': {
            title: "Preview Focused",
            direction: 'column',
            category: CATEGORY_NAME,
            inner: [
                { type: 'slot', view: 'PreviewView', resize: { height: "70%" } },
                {
                    direction: 'row',
                    inner: [
                        { type: 'slot', view: 'AssetManagerView', resize: { width: "20%" } },
                        { type: 'slot', view: 'TimelineView', resize: { width: "60%" } },
                        { type: 'slot', view: 'PropertyEditorView' }
                    ]
                }
            ]
        },

        /**
        * | |     |
        * | |-----|
        * | |     |
        */
        'sidebar-left': {
            title: "Sidebar Left",
            direction: 'row',
            category: CATEGORY_NAME,
            inner: [
                { type: 'slot', view: 'AssetManagerView', resize: { width: 250 } },
                {
                    direction: 'column',
                    inner: [
                        { type: 'slot', view: 'PreviewView', resize: { height: "60%" } },
                        {
                            direction: 'row',
                            inner: [
                                { type: 'slot', view: 'TimelineView', resize: { width: "60%" } },
                                { type: 'slot', view: 'PropertyEditorView' }
                            ]
                        }
                    ]
                }
            ]
        },

        /**
        * |     |  |
        * |-----|--|
        * |     |  |
        */
        'sidebar-right': {
            title: "Property Editor Focused",
            direction: 'row',
            category: CATEGORY_NAME,
            inner: [
                {
                    direction: 'column',
                    inner: [
                        { type: 'slot', view: 'PreviewView', resize: { height: "60%" } },
                        { 
                            direction: 'row',
                            inner: [
                                { type: 'slot', view: 'TimelineView', resize: { width: "60%" } },
                                { type: 'slot', view: 'AssetManagerView' }
                            ]
                        }
                    ]
                },
                { type: 'slot', view: 'PropertyEditorView', resize: { width: 300 } }
            ]
        },

        /**
        * | |   | |
        * | |   | |
        * | |   | |
        */
        'three-column': {
            title: "Three Columns (vertical video)",
            direction: 'row',
            category: CATEGORY_NAME,
            inner: [
                { type: 'slot', view: 'PropertyEditorView', resize: { width: "30%" } },
                { type: 'slot', view: 'PreviewView', resize: { width: "30%" } },
                {
                    direction: 'column',
                    inner: [
                        { type: 'slot', view: 'TimelineView' },
                        { type: 'slot', view: 'AssetManagerView', resize: { height: "25%" } },
                    ], resize: { width: "40%" }
                }
            ]
        },

        /**
        * |   |   |
        * |-------|
        * |   |   |
        * |-------|
        * |   |   |
        */
        'grid-2x3': {
            title: "Grid 2x3",
            direction: 'column',
            category: CATEGORY_NAME,
            inner: [
                { inner: [{ type: 'slot', view: 'PreviewView', resize: { width: "50%" } }, { type: 'slot', view: 'PropertyEditorView' }], resize: { height: "33%" } },
                { inner: [{ type: 'slot', resize: { width: "50%" } }, { type: 'slot' }], resize: { height: "34%" } },
                { inner: [{ type: 'slot', view: 'AssetManagerView', resize: { width: "50%" } }, { type: 'slot', view: 'TimelineView' }] }
            ]
        }
    }

    static {
        LS.Multipane.registerPresets(this.name, this.layoutPresets);
    }
}

// --- Debug
window.VideoEditor = VideoEditor;

export default VideoEditor;