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
import ThreeRendererAdapter from "../../backends/rendering/threejs.mjs";

// --- Views
import { AssetManagerView } from "../../views/asset-manager.mjs";
import PreviewView from "../../views/preview.mjs";
import PropertyEditorView from "../../views/property-editor.mjs";
import TimelineView from "../../views/timeline.mjs";

import Project from "../../core/project.mjs";

import { Variable, mappingCompiler } from "../../core/variable.mjs";

// --- Video editor flavor
class VideoEditor extends FlavorBase {
    static name = "video-editor";

    static iconSet = {
        icon: 'assets/src/flavors/video-editor/images/icon.svg',
        small: 'assets/src/flavors/video-editor/images/icon-flat.svg',
        favicon: 'assets/src/flavors/video-editor/images/favicon.svg',
        desktopIcon: 'assets/src/flavors/video-editor/images/favicon.png'
    };

    static version = "0.2.0-alpha";

    constructor(project) {
        super(project);

        // LS.Timeline instance
        this.timelineInstance = null;

        // Current timeline data
        this.currentTimeline = null;

        // Set of currently active render items
        this.activeRenderItems = new Set();

        this.__renderTargets = [];

        // TODO
        this.__currentMediaItems = new Set();
        this.activeMediaItems = new Set();

        this.editingItem = null;

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


        // --- Project hooks

        // When the projects starts initializing
        this.project.once("initializing", async () => {
            await this.#init();
        });

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

        // When a view connects to the project
        this.project.on("view-connected", (view) => {
            if(view.attachedTo == null) {
                view.attachedTo = this;
            }

            switch(view.constructor.name) {
                case "timeline":
                    this.timelineInstance = view.timeline;
                    this.setTimeline(this.currentTimeline || "main");

                    this.addExternalEventListener(this.timelineInstance, 'seek', () => {
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
                        if(item.node) {
                            ThreeRendererAdapter.disposeObject(item.node);
                            item.node = null;
                        }
                    });

                    this.quickEmit(this.__seekEventRef, this.timelineInstance.seek);
                    this.emit('duration-changed', [this.timelineInstance.duration]);
                    break;

                case "videoPreview":
                    view.setSource(this.renderer);
                    break;
            }
        });

        // When a view disconnects from the project
        this.project.on("view-disconnected", (view) => {
            switch(view.constructor.name) {
                case "timeline":
                    view.timeline.reset(true);
                    this.timelineInstance.events.clear();
                    this.timelineInstance = null;
                    this.pauseActiveMedia();
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
            }).show();
            throw new Error(e);
        }
    }

    /**
     * The default setup for the video editor flavor.
     * @param {*} app 
     */
    static setupIn(app) {
        // Initialize editor GUI with views for video editing
        const previewView = new PreviewView();
        const timelineView = new TimelineView();
        const assetManagerView = new AssetManagerView();
        const propertyEditorView = new PropertyEditorView();

        app.setIcon(this.iconSet);

        app.layoutManager.add(previewView, timelineView, assetManagerView, propertyEditorView);

        app.flavor = new VideoEditor(app.currentProject || (app.currentProject = new Project()));
        app.focusedPreview = previewView;

        // Connect views to the project when it's ready
        app.currentProject.once('ready', () => {
            app.currentProject.connect(previewView, app.flavor);
            app.currentProject.connect(timelineView, app.flavor);
            app.currentProject.connect(assetManagerView, app.flavor);
            app.currentProject.connect(propertyEditorView, app.flavor);
        });

        // Expose some globals for debugging
        window.timelineView = timelineView;
        window.timeline = timelineView.timeline;
    }

    #exportTo(data) {
        if(!data.savedFlavorId) data.savedFlavorId = "video-editor";

        const exportedTimelines = {};
        for(const [id, timeline] of this.timelines) {
            exportedTimelines[id] = timeline.map(item => {
                return this.timelineInstance.cloneItem(item, true);
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
            this.pauseActiveMedia();
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

    seek(time, moveCamera = false) {
        if(this.timelineInstance) {
            this.timelineInstance.setSeek(time);
            if(moveCamera) {
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
     * THE MAIN VIDEO FRAME RENDERING LOGIC; must be kept well optimized
     * In the future calling WebGL directly could be better, the node based rendering isn't great for videos
     * 
     * Also, the whole setup here is quite temporary and has a lot to be worked on
     * 
     * @param {Number} time Time in seconds
     */
    renderAtTime(time) {
        if(!this.timelineInstance || !this.renderer) return;
        if(time === undefined) time = this.timelineInstance.seek;

        // TODO: optimize
        for(const item of this.activeRenderItems) {
            if(item.node) item.node.visible = false;
        }
        this.activeRenderItems.clear();

        // Clear screen
        this.renderer.clear();

        const renderTargets = this.__renderTargets;
        renderTargets.length = 0;

        const currentMediaItems = this.__currentMediaItems;
        currentMediaItems.clear();

        // First loop to process automation items and values
        // We find intersecting items at the current time via a binary search
        const items = this.timelineInstance.getIntersectingAt(time);

        if(this.editingItem) {
            items.push(this.editingItem);
        }

        for(const item of items) {
            if(item.type === "automation") {
                // Process automation items
                this.processAutomationItemAtTime(item, time);
                continue;
            }

            if(item.data?.enabled === false) {
                if(item.__mediaElement) this.syncMediaItem(item, time, false);
                continue;
            }

            if(item.type === "sound") {
                console.log("TODO: implement sound rendering");
                continue;
            }

            if(item.data?.visible === false) {
                if(item.__mediaElement) this.syncMediaItem(item, time, false);
                continue;
            }

            if(!item.node) this.renderer.createObject(item);
            if(!item.node) continue;

            if(item.resourceUpdated !== false) {
                this.renderer.updateNodeResource(item);
            }

            if(item.data.animations) {
                for(const anim of item.data.animations) {
                    if(anim.enabled === false) continue;
                    this.processAutomationItemAtTime(anim, time);
                }
            }

            if(item.type === "video") {
                this.syncMediaItem(item, time, true);
                currentMediaItems.add(item);
            }

            renderTargets.push(item);
        }

        for(const item of this.activeMediaItems) {
            if(!currentMediaItems.has(item)) {
                this.syncMediaItem(item, time, false);
            }
        }

        this.activeMediaItems.clear();
        for(const item of currentMediaItems) {
            this.activeMediaItems.add(item);
        }

        // TODO: Optimize
        renderTargets.sort((a, b) => (a.data.zIndex || a.row || 0) - (b.data.zIndex || b.row || 0));

        // Render all items to the main renderer
        // TODO: whotf built this
        let renderOrder = 0;
        for(const item of renderTargets) {
            if(!item.node) continue;

            item.node.visible = true;
            item.node.renderOrder = renderOrder;
            item.node.traverse((child) => child.renderOrder = renderOrder);

            // console.log("Rendering item", item.id, "at time", time, "with zIndex", item.data.zIndex, "and row", item.row);

            if(item.data.positionZ === undefined) {
                item.node.position.z = item.data.zIndex || item.row || 0;
            }

            this.activeRenderItems.add(item);
            renderOrder++;
        }

        this.renderer.render(this.activeCamera || this.renderer.camera);
    }

    processAutomationItemAtTime(item, time) {
        if(!item.__automationClip || !item.data || !item.data.targets || item.data.enabled === false || item.data.targets.length === 0) return;

        if (item.data.automationFunction && (item.__dirtyMapping || !item.mappingFn)) {
            try {
                item.mappingFn = mappingCompiler.compile(item.data.automationFunction);
            } catch (e) {
                console.error("Failed to compile automation mapping function:", e);
                item.mappingFn = mappingCompiler.NOOP_FUNCTION;
            }

            item.__dirtyMapping = false;
        } else if(!item.data.automationFunction) {
            item.mappingFn = mappingCompiler.NOOP_FUNCTION;
        }

        const automationValue = item.mappingFn(item.__automationClip.getValueAtTime(time - item.start), time);

        // Use cached targets
        if(item.__cTargets && !item.__dirty) {
            for (const cTarget of item.__cTargets) {
                const baseValue = cTarget.isRelative? cTarget.target.data[cTarget.property] || 0: 0;
                cTarget.setter(cTarget.target, baseValue + cTarget.mappingFn(automationValue, time));
            }
            return;
        }

        // Compile targets
        const compiled = [];
        for (let i = 0; i < item.data.targets.length; i++) {
            const target = item.data.targets[i];

            const targetNode = target.nodeId? this.timelineInstance.getItemById(target.nodeId): null;
            if(!targetNode) continue;
            if(!targetNode.node) ThreeRendererAdapter.createObject(targetNode);
            if(!targetNode.node && targetNode.type !== "sound") continue;

            const setter = this.constructor.nodePropertySetters[target.property];
            if(typeof setter !== "function") continue;
            
            const mappingFn = target.__mappingCache || (target.mapping && target.mapping !== "x"? mappingCompiler.compile(target.mapping): mappingCompiler.NOOP_FUNCTION);
            target.__mappingCache = mappingFn;

            const isRelative = target.isRelative;
            const finalValue = isRelative? (targetNode.data[target.property] || 0) + (mappingFn(automationValue, time)): mappingFn(automationValue, time);

            setter(targetNode, finalValue);

            compiled.push({
                setter,
                target: targetNode,
                property: target.property,
                mappingFn,
                isRelative
            });
        }

        item.__cTargets = compiled;
        item.__dirty = false;
    }

    /**
     * Destroys the project and optionally all connected views
     * @param {Boolean} destroyViews Whether to destroy connected views
     */
    destroy(destroyViews = false) {
        if(this.destroyed) return;

        if(this.timelineInstance) {
            // If destroyViews is true, the timeline has been destroyed already, so we don't need to reset it
            if(!destroyViews) this.timelineInstance.reset(true);
            this.timelineInstance = null;
        }

        this.pauseActiveMedia();

        for(const item of Array.from(this.mediaItems)) {
            this.releaseItemMedia(item);
        }

        if(this.renderer) this.renderer.destroy();
        this.currentTimeline = null;
        this.timelines.clear();
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