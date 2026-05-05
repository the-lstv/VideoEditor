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
import AssetManagerView from "../../views/asset-manager.mjs";
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

    constructor(project) {
        super(project);

        // LS.Timeline instance
        this.timelineInstance = null;

        // Current timeline data
        this.currentTimeline = null;

        // Set of currently active render items
        this.activeRenderItems = new Set();

        this.__renderTargets = [];

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
                            this.constructor.disposeObject3D(item.node);
                            item.node.removeFromParent();
                            item.node = null;
                        }
                        this.releaseItemMedia(item);
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
            });
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
        if(!data.flavorId) data.flavorId = "video-editor";

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
                { tag: 'img', src: 'assets/images/icon.svg', style: 'height: 5em; width: 100%; margin: auto' },
                { tag: 'h2', inner: 'Video Editor', style: 'text-align: center' },
                { tag: 'p', inner: `Version ${app.VERSION}, running LS ${LS.version}` },
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
     * @param {Number} time Time in seconds
     */
    renderAtTime(time) {
        if(!this.timelineInstance || !this.renderer) return;
        if(time === undefined) time = this.timelineInstance.seek;

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
                if(item.resourceUpdated !== false) this.updateNodeResource(item);
                this.syncMediaItem(item, time, true);
                currentMediaItems.add(item);
                continue;
            }

            if(item.data?.visible === false) {
                if(item.__mediaElement) this.syncMediaItem(item, time, false);
                continue;
            }

            if(!item.node) this.createItemNode(item);
            if(!item.node) continue;

            if(item.resourceUpdated !== false) {
                this.updateNodeResource(item);
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
        let renderOrder = 0;
        for(const item of renderTargets) {
            if(!item.node) continue;

            item.node.visible = true;
            item.node.renderOrder = renderOrder;
            item.node.traverse((child) => child.renderOrder = renderOrder);

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
            if(!targetNode.node) this.createItemNode(targetNode);
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
     * Create the render-able node for a given item for the given backend.
     * @param {*} item The timeline/project item to create a node for
     * @returns The created node, or null
     */
    createItemNode(item) {
        if(!item || item.node) return null;
        if(!item.data) item.data = {};

        if(item.type === "automation") {
            return null;
        }

        switch(item.type) {
            case "container":
                item.node = new THREE.Group();
                item.node.userData.editorType = "container";
                break;

            /* Vector graphics node */
            case "graphics":
                const data = item.data || {};
                const node = this.constructor.createSurfaceNode("graphics", data);
                const material = node.userData.material;

                material.color.set(data.fill ?? data.color ?? data.tint ?? 0xffffff);
                material.opacity = data.opacity ?? data.alpha ?? 1;
                material.transparent = material.opacity < 1 || data.transparent !== false;

                if(data.shape === "circle") {
                    const radius = data.radius ?? Math.max(data.width ?? 100, data.height ?? 100) / 2;
                    const geometry = new THREE.CircleGeometry(radius, data.segments || 64);
                    geometry.translate(radius, radius, 0);
                    node.userData.surface.geometry = geometry;
                    node.userData.width = radius * 2;
                    node.userData.height = radius * 2;
                }

                item.node = node;
                break;

            /* Sprite/image/video (2D surface) node */
            case "sprite":
            case "image":
            case "video":
                if(item.type === "image") item.type = "sprite"; // Normalize
                item.node = this.constructor.createSurfaceNode(item.type, item.data);
                break;

            case "text":
                // item.node = this.constructor.createTextNode(item);
                // TBA again
                break;

            /* Mesh node */
            case "mesh":
                item.node = this.constructor.createMeshNode(item);
                break;

            /* Camera node */
            case "camera":
                item.node = this.constructor.createCameraNode(item);
                break;

            /* Audio related */
            case "sound":
            case "notes":
                // No visual node, but sound items should carry an audio stream with a connectable output
                return null;

            default:
                console.warn(`this.constructor.createItemNode: Unsupported item type ${item.type}`);
                return null;
        }

        item.node.visible = false;
        item.node.matrixAutoUpdate = true;

        // ! todo: scene editor
        if(this.renderer?.root) {
            this.renderer.root.add(item.node);
        }

        this.applyInitialNodeProperties(item);
        return item.node;
    }

    async applyInitialNodeProperties(item) {
        if(!item) return;
        if(!item.data) item.data = {};

        // Apply all saved properties
        for(const property in item.data) {
            this.constructor.nodePropertySetters[property]?.(item, item.data[property]);
        }

        await this.updateNodeResource(item);
    }

    async updateNodeResource(item) {
        if(!item.data.resource || item.resourceUpdated === false) return;
        item.resourceUpdated = false;

        const resource = await this.project.resources.getAssetObject(item.data.resource);

        if(!resource) return;

        item.__resourceObject = resource;

        if(item.type === "sound") {
            await this.ensureItemMediaElement(item, resource, "audio");
            return;
        }

        if(item.type === "video") {
            const media = await this.ensureItemMediaElement(item, resource, "video");
            if(media && item.node) {
                const texture = item.__videoTexture || this.constructor.createTextureFromMedia(media, true);
                item.__videoTexture = texture;
                this.constructor.setNodeTexture(item, texture, media);
            }
            return;
        }

        if(item.node) {
            const texture = await this.constructor.createTextureFromResource(resource);
            if(texture) {
                this.constructor.setNodeTexture(item, texture);
            }
        }
    }

    applyNodeProperty(item, property, value) {
        if(!item) return;

        const applier = this.constructor.nodePropertySetters[property];
        if(applier) {
            applier(item, value);

            if(property !== "tileColor" && property !== "clipDuration" && property !== "clipStartTime") {
                item.data[property] = value;
            }
        } else {
            console.warn(`this.constructor.applyNodeProperty: Unsupported property ${property}`);
        }
    }

    getNodeProperty(item, property) {
        if(!item) return null;

        const getter = this.constructor.nodePropertyGetters[property];
        if(getter) {
            return getter(item);
        } else {
            console.warn(`this.constructor.getNodeProperty: Unsupported property ${property}`);
            return null;
        }
    }

    getSavedNodeProperty(item, property, fallback = true) {
        if(!item || !item.data) return null;
        return item.data[property] || (fallback ? this.getNodeProperty(item, property) : null); // Fallback to reading from node
    }

    static createSurfaceNode(type, data = {}) {
        const node = new THREE.Group();
        const material = new THREE.MeshBasicMaterial({
            color: data.tint ?? data.materialColor ?? 0xffffff,
            transparent: true,
            opacity: data.opacity ?? data.alpha ?? 1,
            depthTest: !!data.depthTest,
            depthWrite: !!data.depthWrite,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(this.getUnitPlaneGeometry(), material);

        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;

        node.add(mesh);
        node.userData.editorType = type;
        node.userData.surface = mesh;
        node.userData.material = material;
        node.userData.width = data.width ?? data.w ?? 1;
        node.userData.height = data.height ?? data.h ?? 1;
        node.userData.anchorX = data.anchorX ?? 0;
        node.userData.anchorY = data.anchorY ?? 0;
        node.userData.skewX = data.skewX ?? 0;
        node.userData.skewY = data.skewY ?? 0;

        this.updateNodeLocalShape(node);
        return node;
    }

    static UNIT_PLANE_GEOMETRY = null;
    static TEXT_TEXTURE_SCALE = 2;

    static getUnitPlaneGeometry() {
        if(this.UNIT_PLANE_GEOMETRY) return this.UNIT_PLANE_GEOMETRY;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
            0, 0, 0,
            1, 0, 0,
            1, 1, 0,
            0, 1, 0
        ], 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
            0, 1,
            1, 1,
            1, 0,
            0, 0
        ], 2));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        geometry.computeVertexNormals();
        geometry.userData.sharedEditorGeometry = true;

        this.UNIT_PLANE_GEOMETRY = geometry;
        return geometry;
    }

    /**
     * @type {Object.<string, function(AnimatedItem, *): void>}
     */
    static nodePropertySetters = {
        "tileColor": (item, v) => {
            item.color = v;
        },

        "clipDuration": (item, v) => {
            item.duration = v;
        },

        "clipStartTime": (item, v) => {
            item.start = v;
        },

        "positionX": (item, v) => {
            if (item.node) item.node.position.x = v;
        },

        "positionY": (item, v) => {
            if (item.node) item.node.position.y = v;
        },

        "positionZ": (item, v) => {
            if (item.node) item.node.position.z = v;
        },

        "scaleX": (item, v) => {
            if (item.node) item.node.scale.x = v;
        },

        "scaleY": (item, v) => {
            if (item.node) item.node.scale.y = v;
        },

        "scaleZ": (item, v) => {
            if (item.node) item.node.scale.z = v;
        },

        "rotation": (item, v) => {
            if (item.node) item.node.rotation.z = v;
        },

        "rotationX": (item, v) => {
            if (item.node) item.node.rotation.x = v;
        },

        "rotationY": (item, v) => {
            if (item.node) item.node.rotation.y = v;
        },

        "rotationZ": (item, v) => {
            if (item.node) item.node.rotation.z = v;
        },

        "anchorX": (item, v) => {
            if (item.node?.userData) {
                item.node.userData.anchorX = v;
                this.updateNodeLocalShape(item.node);
            }
        },

        "anchorY": (item, v) => {
            if (item.node?.userData) {
                item.node.userData.anchorY = v;
                this.updateNodeLocalShape(item.node);
            }
        },

        "skewX": (item, v) => {
            if (item.node?.userData) {
                item.node.userData.skewX = v;
                this.updateNodeLocalShape(item.node);
            }
        },

        "skewY": (item, v) => {
            if (item.node?.userData) {
                item.node.userData.skewY = v;
                this.updateNodeLocalShape(item.node);
            }
        },

        "width": (item, v) => {
            if (item.node?.userData) {
                item.node.userData.width = v;
                this.updateNodeLocalShape(item.node);
            }
        },

        "height": (item, v) => {
            if (item.node?.userData) {
                item.node.userData.height = v;
                this.updateNodeLocalShape(item.node);
            }
        },

        "depth": (item, v) => {
            item.data.depth = v;
        },

        "visible": (item, v) => {
            v = !!v;
            if (item.node) item.node.visible = v;
        },

        "tint": (item, v) => {
            this.setMaterialColor(item, v);
        },

        "color": (item, v) => {
            this.setMaterialColor(item, v);
        },

        "fill": (item, v) => {
            this.setMaterialColor(item, v);
        },

        "materialColor": (item, v) => {
            this.setMaterialColor(item, v);
        },

        "opacity": (item, v) => {
            this.setMaterialOpacity(item, v);
        },

        "alpha": (item, v) => {
            this.setMaterialOpacity(item, v);
        },

        "blendMode": (item, v) => {
            this.setBlendMode(item, v);
        },

        "wireframe": (item, v) => {
            if(item.node) this.forEachMaterial(item.node, (material) => material.wireframe = !!v);
        },

        "castShadow": (item, v) => {
            if(item.node) item.node.castShadow = !!v;
        },

        "receiveShadow": (item, v) => {
            if(item.node) item.node.receiveShadow = !!v;
        },

        "textContent": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                item.node.userData.textState.text = v;
                this.updateTextNode(item);
            }
        },

        "textStyle": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                item.node.userData.textState.style = v || {};
                item.data.textStyle = v || {};
                this.updateTextNode(item);
            }
        },

        "textStyleWeight": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.fontWeight = v;
                this.updateTextNode(item);
            }
        },

        "textStyleStyle": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.fontStyle = v;
                this.updateTextNode(item);
            }
        },

        "textStyleFontSize": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.fontSize = v;
                this.updateTextNode(item);
            }
        },

        "textStyleFontFamily": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.fontFamily = v;
                this.updateTextNode(item);
            }
        },

        "textStyleFill": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.fill = v;
                this.updateTextNode(item);
            }
        },

        "textStyleAlignment": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.align = v;
                this.updateTextNode(item);
            }
        },

        "textStyleLineHeight": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.lineHeight = v;
                this.updateTextNode(item);
            }
        },

        "textStyleWrapWidth": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.wordWrapWidth = v;
                this.updateTextNode(item);
            }
        },

        "textStyleWrap": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.wordWrap = !!v;
                this.updateTextNode(item);
            }
        },

        "textStyleLetterSpacing": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.letterSpacing = v;
                this.updateTextNode(item);
            }
        },

        "textStyleStroke": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.stroke = v;
                this.updateTextNode(item);
            }
        },

        "textStyleStrokeThickness": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.strokeThickness = v;
                this.updateTextNode(item);
            }
        },

        "textStyleStrokeLinejoin": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.lineJoin = v;
                this.updateTextNode(item);
            }
        },

        "textStyleDropShadow": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.dropShadow = !!v;
                this.updateTextNode(item);
            }
        },

        "textStyleDropShadowColor": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.dropShadowColor = v;
                this.updateTextNode(item);
            }
        },

        "textStyleDropShadowDistance": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.dropShadowDistance = v;
                this.updateTextNode(item);
            }
        },

        "textStyleDropShadowAngle": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.dropShadowAngle = v;
                this.updateTextNode(item);
            }
        },

        "textStyleDropShadowBlur": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.dropShadowBlur = v;
                this.updateTextNode(item);
            }
        },

        "textStyleDropShadowOpacity": (item, v) => {
            if (item.node?.userData?.editorType === "text") {
                this.ensureTextStyle(item);
                item.node.userData.textState.style.dropShadowAlpha = v;
                this.updateTextNode(item);
            }
        },

        "volume": (item, v) => {
            item.data.volume = v;
            if(item.__mediaElement) item.__mediaElement.volume = Math.min(Math.max(v, 0), 1);
        },

        "muted": (item, v) => {
            item.data.muted = !!v;
            if(item.__mediaElement) item.__mediaElement.muted = !!v;
        },

        "playbackRate": (item, v) => {
            item.data.playbackRate = v;
            if(item.__mediaElement && v > 0) item.__mediaElement.playbackRate = v;
        },

        "loop": (item, v) => {
            item.data.loop = !!v;
            if(item.__mediaElement) item.__mediaElement.loop = !!v;
        },

        "mediaStartTime": (item, v) => {
            item.data.mediaStartTime = v;
        },

        "cameraFov": (item, v) => {
            if(item.node?.isPerspectiveCamera) {
                item.node.fov = v;
                item.node.updateProjectionMatrix();
            }
        },

        "cameraNear": (item, v) => {
            if(item.node?.isCamera) {
                item.node.near = v;
                item.node.updateProjectionMatrix();
            }
        },

        "cameraFar": (item, v) => {
            if(item.node?.isCamera) {
                item.node.far = v;
                item.node.updateProjectionMatrix();
            }
        },

        "automationEnabled": (item, v) => item.data.automationEnabled = !!v,

        "automationBaseValue": (item, v) => {
            item.data.automationBaseValue = v;
            if(item.__automationClip) {
                item.__automationClip.startPoint.value = v;
                item.__automationClip.render();
            }
        },

        "automationFunction": (item, v) => {
            if(typeof v === "string") {
                item.data.automationFunction = v;
                item.__dirtyMapping = true;
            } else if (typeof v === "function") {
                item.mappingFn = v;
                item.__dirtyMapping = false;
            }
        }
    }

    /**
     * @property {Object.<string, function>} nodePropertyGetters - A mapping of property names to functions that retrieve those properties from a given item.
     */
    static nodePropertyGetters = {
        "tileColor": (item) => item.color,
        "clipDuration": (item) => item.duration,
        "clipStartTime": (item) => item.start,
        "positionX": (item) => item.node? item.node.position.x: (item.data.positionX || 0),
        "positionY": (item) => item.node? item.node.position.y: (item.data.positionY || 0),
        "positionZ": (item) => item.node? item.node.position.z: (item.data.positionZ || 0),
        "scaleX": (item) => item.node? item.node.scale.x: (item.data.scaleX || 1),
        "scaleY": (item) => item.node? item.node.scale.y: (item.data.scaleY || 1),
        "scaleZ": (item) => item.node? item.node.scale.z: (item.data.scaleZ || 1),
        "rotation": (item) => item.node? item.node.rotation.z: (item.data.rotation || 0),
        "rotationX": (item) => item.node? item.node.rotation.x: (item.data.rotationX || 0),
        "rotationY": (item) => item.node? item.node.rotation.y: (item.data.rotationY || 0),
        "rotationZ": (item) => item.node? item.node.rotation.z: (item.data.rotationZ || item.data.rotation || 0),
        "anchorX": (item) => item.node?.userData? item.node.userData.anchorX: (item.data.anchorX?? 0),
        "anchorY": (item) => item.node?.userData? item.node.userData.anchorY: (item.data.anchorY?? 0),
        "skewX": (item) => item.node?.userData? item.node.userData.skewX: (item.data.skewX || 0),
        "skewY": (item) => item.node?.userData? item.node.userData.skewY: (item.data.skewY || 0),
        "width": (item) => item.node?.userData? item.node.userData.width: (item.data.width || 1),
        "height": (item) => item.node?.userData? item.node.userData.height: (item.data.height || 1),
        "depth": (item) => item.data.depth || 1,
        "visible": (item) => item.node? item.node.visible: (item.data.visible !== undefined? item.data.visible: true),
        "tint": (item) => item.data.tint || item.data.materialColor || 0xFFFFFF,
        "color": (item) => item.data.color || item.data.tint || 0xFFFFFF,
        "fill": (item) => item.data.fill || item.data.color || item.data.tint || 0xFFFFFF,
        "materialColor": (item) => item.data.materialColor || item.data.color || item.data.tint || 0xFFFFFF,
        "opacity": (item) => item.data.opacity !== undefined? item.data.opacity: (item.data.alpha !== undefined? item.data.alpha: 1),
        "alpha": (item) => item.data.alpha !== undefined? item.data.alpha: (item.data.opacity !== undefined? item.data.opacity: 1),
        "blendMode": (item) => item.data.blendMode || 0,
        "wireframe": (item) => !!item.data.wireframe,
        "castShadow": (item) => !!(item.node? item.node.castShadow: item.data.castShadow),
        "receiveShadow": (item) => !!(item.node? item.node.receiveShadow: item.data.receiveShadow),
        "textContent": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.text: (item.data.textContent || ""),
        "textStyle": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style: (item.data.textStyle || {}),
        "textStyleWeight": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.fontWeight: (item.data.textStyleWeight || 'normal'),
        "textStyleStyle": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.fontStyle: (item.data.textStyleStyle || 'normal'),
        "textStyleFontSize": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.fontSize: (item.data.textStyleFontSize || 26),
        "textStyleFontFamily": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.fontFamily: (item.data.textStyleFontFamily || 'Arial'),
        "textStyleFill": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.fill: (item.data.textStyleFill || '#ffffff'),
        "textStyleAlignment": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.align: (item.data.textStyleAlignment || 'left'),
        "textStyleLineHeight": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.lineHeight: (item.data.textStyleLineHeight || 0),
        "textStyleWrapWidth": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.wordWrapWidth: (item.data.textStyleWrapWidth || 100),
        "textStyleWrap": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.wordWrap: (!!item.data.textStyleWrap),
        "textStyleLetterSpacing": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.letterSpacing: (item.data.textStyleLetterSpacing || 0),
        "textStyleStroke": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.stroke: (item.data.textStyleStroke || '#000000'),
        "textStyleStrokeThickness": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.strokeThickness: (item.data.textStyleStrokeThickness || 0),
        "textStyleStrokeLinejoin": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.lineJoin: (item.data.textStyleStrokeLinejoin || 'miter'),
        "textStyleDropShadow": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.dropShadow: (!!item.data.textStyleDropShadow),
        "textStyleDropShadowColor": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.dropShadowColor: (item.data.textStyleDropShadowColor || '#000000'),
        "textStyleDropShadowDistance": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.dropShadowDistance: (item.data.textStyleDropShadowDistance || 5),
        "textStyleDropShadowAngle": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.dropShadowAngle: (item.data.textStyleDropShadowAngle || Math.PI / 6),
        "textStyleDropShadowBlur": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.dropShadowBlur: (item.data.textStyleDropShadowBlur || 0),
        "textStyleDropShadowOpacity": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.dropShadowAlpha: (item.data.textStyleDropShadowAlpha || 1),
        "volume": (item) => item.__mediaElement? item.__mediaElement.volume: (item.data.volume ?? 1),
        "muted": (item) => item.__mediaElement? item.__mediaElement.muted: !!item.data.muted,
        "playbackRate": (item) => item.__mediaElement? item.__mediaElement.playbackRate: (item.data.playbackRate || 1),
        "loop": (item) => item.__mediaElement? item.__mediaElement.loop: !!item.data.loop,
        "mediaStartTime": (item) => item.data.mediaStartTime || 0,
        "cameraFov": (item) => item.node?.isPerspectiveCamera? item.node.fov: (item.data.cameraFov || item.data.fov || 50),
        "cameraNear": (item) => item.node?.isCamera? item.node.near: (item.data.cameraNear || item.data.near || 0.1),
        "cameraFar": (item) => item.node?.isCamera? item.node.far: (item.data.cameraFar || item.data.far || 10000),
        "automationEnabled": (item) => !!item.data.automationEnabled,
        "automationBaseValue": (item) => item.data.automationBaseValue || 0,
        "automationFunction": (item) => item.data.automationFunction || ""
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