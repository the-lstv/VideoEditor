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
import ThreeRendererAdapter from "../../backends/graphics/ThreeJS/index.mjs";

import AudioRenderer from "../../backends/audio/index.mjs";

// --- Views
import { AssetManagerView } from "../../views/asset-manager.mjs";
import PreviewView from "../../views/preview.mjs";
import PropertyEditorView from "../../views/property-editor.mjs";
import TimelineView from "../../views/timeline.mjs";

import Project from "../../core/project.mjs";

import { Variable, mappingCompiler } from "../../core/variable.mjs";
import { ResourceManager, Resource } from "../../core/resources.mjs";


const TRACK_STRIDE = 1000; // The distance in renderOrder between each track

// --- Video editor flavor
class VideoEditor extends FlavorBase {
    static name = "video-editor";

    static iconSet = {
        icon: 'assets/src/flavors/video-editor/images/icon.svg',
        small: 'assets/src/flavors/video-editor/images/icon-flat.svg',
        favicon: 'assets/src/flavors/video-editor/images/favicon.svg',
        desktopIcon: 'assets/src/flavors/video-editor/images/favicon.png'
    };

    static version = "2.2.1-alpha";

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
            }).show();
            throw new Error(e);
        }

        console.log("Video editor initialized with renderer options:", rendererOptions);
        
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
                this.timelineInstance.setSeek(this.timelineInstance.seek + (delta / 1000));
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
        const assetManagerView = new AssetManagerView();
        const propertyEditorView = new PropertyEditorView();

        app.layoutManager.add(previewView, timelineView, assetManagerView, propertyEditorView);

        app.setIcon(this.constructor.iconSet);
        app.focusedPreview = previewView;

        this.project.on("ready", () => {
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
                        this.project.resources.addProjectResources(files, row, offset);
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
                        const elementsFromPoint = document.elementsFromPoint(event.x, event.y);

                        // Dropped on a timeline
                        // TODO: This is quite hacky
                        const timeline = elementsFromPoint.find(el => el.classList.contains('ls-timeline'))?.__lsComponent || null;
                        if(timeline) {
                            if(!(timeline instanceof LS.Timeline)) {
                                LS.Toast.show("Sorry, something went wrong while adding the item to a timeline.", { timeout: 3000, accent: "red" });
                                return;
                            }

                            const { time, row } = timeline.transformCoords(event.x, event.y);

                            console.log("Adding item to timeline at time", time, "row", row);

                            // It is a timeline item/template, we can simply clone it.
                            if(event.data.item) {
                                const newItem = timeline.cloneItem(event.data.item);
                                newItem.start = time;
                                newItem.row = row;
                                newItem.duration = newItem.duration || 1;

                                timeline.add(newItem);
                            }

                            // External file dropped, so we need to ensure it is saved as a resource,
                            // and then create a new timeline item.
                            else {
                                const isResource = event.data instanceof Resource;

                                if(!isResource) {
                                    event.data.isExternal = true;
                                    event.data.type = null; // :shrug:
                                    event.data.id = null; // :shrug:
                                }

                                const resource = isResource? event.data: this.project.resources.addResource(event.data);

                                // Now we need to make an item for the asset
                                // TODO: this is temporary, just testing
                                const newItem = {
                                    type: resource.guessNodeType(),
                                    // resource: ResourceManager.createReference(resource),
                                    data: { resource },
                                    label: event.data.label || resource.name,
                                    start: time,
                                    row,
                                    duration: 1
                                };

                                const isVideo = resource.type === "video";
                                if(resource.type === "image" || isVideo) {
                                    const meta = isVideo? await resource.getVideoMetadata(): await resource.getImageDimensions();

                                    if(isVideo) newItem.duration = meta.duration;

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
                                    newItem.duration = meta.duration;
                                }

                                timeline.add(newItem);
                            }
                        }
                    });
            }
        });

        // When a view disconnects from the project
        this.project.on("view-disconnected", (view) => {
            switch(view.constructor.name) {
                case "timeline":
                    view.timeline.reset(true);
                    this.timelineInstance.events.clear();
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

    /**
     * The default setup for the video editor flavor.
     * TODO: direction on how flavors get initiated is undecided and the current implementation is tempoarary
     * @param {*} app 
     */
    static setupIn(app) {
        app.flavor = this;

        //app.flavorInstance = new VideoEditor(app.currentProject || (app.currentProject = ));
        app.currentProject = new Project();

        if(app.currentProject && app.currentProject.loaded) {
            throw new Error("The current project is already loaded. The flavor must be set up while loading a project.");
        }
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
            this.timelineInstance.reset(true, timeline);
        }
    }


    /**
     * * THE MAIN VIDEO FRAME RENDERING LOGIC
     * Must be kept well optimized
     * 
     * Also, the whole setup here is quite temporary and has a lot to be worked on
     * 
     * @param {Number} time Time in seconds of the frame to render. If not provided, it will render the current time of the timeline.
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
     * Destroys the flavor and optionally all connected views
     * @param {Boolean} destroyViews Whether to destroy connected views
     */
    destroy(destroyViews = false) {
        if(this.destroyed) return;

        if(this.timelineInstance) {
            // If destroyViews is true, the timeline has been destroyed already, so we don't need to reset it
            if(!destroyViews) this.timelineInstance.reset(true);
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
}




// TODO: separate layouts per flavor

// --- Layout presets for the video editor

const CATEGORY_NAME = "Video Editing";
Object.assign(LS.Multipane.PRESETS,  {
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
    },

    /**
     * |   |   |
     * |-------|
     * |   |   |
     */
    'default-but-better': {
        title: "Secret",
        direction: 'column',
        category: CATEGORY_NAME,
        tilt: Math.floor(Math.random() * 17 + 28),
        inner: [
            // Two horizontal rows
            { inner: [{ type: 'slot', view: 'PreviewView', resize: { width: 600 } }, { type: 'slot', view: 'PropertyEditorView' }], resize: { height: "65%" } },
            { inner: [{ type: 'slot', view: 'TimelineView', resize: { width: 420 } }, { type: 'slot', view: 'AssetManagerView' }] },
        ]
    },
});

export default VideoEditor;