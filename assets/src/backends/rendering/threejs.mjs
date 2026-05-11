import RendererAdapter from "./adapter-base.mjs";
import AcceleratedTextRenderer from "./text.mjs";

// import * as THREE from "three";

/**
 * Note: why don't we use WebGPU?
 * - WebGPU is still not stable enough.
 * - It does not have good Linux support yet.
 * 
 * When will we add WebGPU?
 * - Once it has matured enough and became a standard.
 * - Once it has stable Linux support and is widely supported by browsers & GPUs.
 * 
 * But what does this mean?
 * - For now, there are some rendering limitations and performance concerns imposed by the limits of WebGL.
 * - On the other hand, proper optimizations are still important either way. WebGPU is not a silver bullet.
 * - Transition should not be too difficult once WebGPU is ready.
 * 
 * Why don't we use a native rendering backend?
 * - bro idk
 * - To keep browser support
 */


class ThreeRendererAdapter extends RendererAdapter {
    constructor(options = {}, parent) {
        super();

        if(typeof THREE === "undefined") {
            throw new Error("ThreeRendererAdapter: THREE.js is required");
        }

        this.parent = parent;

        if(!this.parent) {
            throw new Error("ThreeRendererAdapter: Parent Project must be passed in constructor as of now.");
        }

        this.canvas = options.canvas || document.createElement('canvas');
        this.width = options.width || 1280;
        this.height = options.height || 720;
        this.type = "three";

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: options.antialias !== false,
            alpha: options.alpha !== false,
            powerPreference: options.powerPreference || "high-performance",
            preserveDrawingBuffer: !!options.preserveDrawingBuffer
        });

        this.renderer.autoClear = false;
        this.renderer.canvas = this.renderer.domElement;
        this.renderer.width = this.width;
        this.renderer.height = this.height;

        if(THREE.SRGBColorSpace) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        }

        if(options.toneMapping) {
            this.renderer.toneMapping = options.toneMapping;
            this.renderer.toneMappingExposure = options.toneMappingExposure ?? 1;
        }

        this.scene = new THREE.Scene();

        const backgroundColor = options.backgroundColor ?? 0x000000;
        const backgroundAlpha = options.backgroundAlpha ?? 1;
        this.renderer.setClearColor(backgroundColor, backgroundAlpha);

        if(backgroundAlpha >= 1) {
            this.scene.background = new THREE.Color(backgroundColor);
        }

        this.root = new THREE.Group();
        this.root.name = "EditorRenderRoot";
        this.scene.add(this.root);

        this.camera = new THREE.OrthographicCamera(0, this.width, 0, this.height, -10000, 10000);
        this.camera.position.set(0, 0, 1000);
        this.camera.lookAt(0, 0, 0);

        this.ambientLight = new THREE.AmbientLight(0xffffff, options.ambientLightIntensity ?? 0.75);
        this.scene.add(this.ambientLight);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, options.directionalLightIntensity ?? 0.75);
        this.directionalLight.position.set(0, 0, 1000);
        this.scene.add(this.directionalLight);

        this.setSize(this.width, this.height);
    }

    setSize(width, height) {
        this.width = width || this.width;
        this.height = height || this.height;

        this.camera.left = 0;
        this.camera.right = this.width;
        this.camera.top = 0;
        this.camera.bottom = this.height;
        this.camera.updateProjectionMatrix();

        const pixelRatio = Math.min((typeof window !== "undefined"? window.devicePixelRatio: 1) || 1, 2);
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(this.width, this.height, false);
        this.renderer.width = this.width;
        this.renderer.height = this.height;
    }

    /**
     * Create the render-able node for a given item object.
     * The item structure is roughly standardized and can come from host objects such as timeline items.
     * @param {*} item The timeline/project item to create a node for
     * @returns The created node, or null
     */
    createObject(item) {
        if(!item || item.node) return null;
        if(!item.data) item.data = {};

        if(item.type === "automation" || item.type === "events" || item.type === "script") {
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
                const node = this.constructor.createSurfaceNode("graphics", data, this.parent);
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
                item.node = this.constructor.createSurfaceNode(item.type, item.data, this.parent);
                break;

            /* Using the native dynamic text renderer (good for dynamic text) */
            case "text":
                const renderer = new AcceleratedTextRenderer({
                    THREE,
                    threeRenderer: this.renderer,
                    cols: 120,
                    rows: 40,
                    fontSrc: "assets/fonts/JetBrainsMono",
                    init: true
                });

                item.textRenderer = renderer; // Here options could get uploaded, & these could be shared
                item.node = renderer.getObject3D();
                break;

            /* Using canvas text rendering & a static texture (good for static text) */
            case "static_text":
                // TBA
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
        if(this?.root) {
            this.root.add(item.node);
            console.log(`Added node for item ${item.id} to root`);
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

        const resource = this.parent.resources.getResource(item.data.resource);
        if(!resource) return;

        if(item.node) {
            if(resource.type === "image") {
                const texture = await resource.getTexture();
                item.node.userData.material.map = texture;
                item.node.userData.material.needsUpdate = true;
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

    static createSurfaceNode(type, data = {}, parent = null) {
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

        mesh.matrixAutoUpdate = false;

        node.add(mesh);
        node.userData.editorType = type;
        node.userData.surface = mesh;
        node.userData.material = material;
        node.userData.width = data.width ?? data.w ?? 1;
        node.userData.height = data.height ?? data.h ?? 1;

        this.updateNodeLocalShape(node);
        return node;
    }

    static updateNodeLocalShape(node) {
        // TODO: separate dimensions with scale
        node.scale.set(node.userData.width || 1, node.userData.height || 1, 1);

        // const anchorX = node.userData.anchorX || 0;
        // const anchorY = node.userData.anchorY || 0;
        // const skewX = node.userData.skewX || 0;
        // const skewY = node.userData.skewY || 0;

        // geometry.translate(0.5, -0.5, 0); // Anchor but dawg why per gaymetry ts complicates it sum

        node.updateMatrix();                 // local
        node.updateMatrixWorld(true);        // world
    }

    static disposeObject(object) {
        object.removeFromParent();
        if(object.geometry && !object.geometry.userData?.sharedEditorGeometry) {
            object.geometry.dispose();
        }
    }

    // Cached plane geometry for surface nodes (sprites, graphics, text)
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

    static setMaterialColor(item, value) {
        if(!item.node) return;

        // hmm
        const material = item.node.userData.material;
        if(material) {
            material.color.set(value || 0xffffff);
            // material.needsUpdate = true;
        }
    }

    clear() {
        this.renderer.setRenderTarget(null);
        this.renderer.clear(true, true, true);
    }

    render(camera = null) {
        this.renderer.render(this.scene, camera || this.camera);
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
                ThreeRendererAdapter.updateNodeLocalShape(item.node);
            }
        },

        "anchorY": (item, v) => {
            if (item.node?.userData) {
                item.node.userData.anchorY = v;
                ThreeRendererAdapter.updateNodeLocalShape(item.node);
            }
        },

        "skewX": (item, v) => {
            if (item.node?.userData) {
                item.node.userData.skewX = v;
                ThreeRendererAdapter.updateNodeLocalShape(item.node);
            }
        },

        "skewY": (item, v) => {
            if (item.node?.userData) {
                item.node.userData.skewY = v;
                ThreeRendererAdapter.updateNodeLocalShape(item.node);
            }
        },

        "width": (item, v) => {
            if (item.node?.userData) {
                item.node.userData.width = v;
                ThreeRendererAdapter.updateNodeLocalShape(item.node);
            }
        },

        "height": (item, v) => {
            if (item.node?.userData) {
                item.node.userData.height = v;
                ThreeRendererAdapter.updateNodeLocalShape(item.node);
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

    destroy() {
        this.scene.traverse((object) => {
            if(object.geometry && !object.geometry.userData?.sharedEditorGeometry) {
                object.geometry.dispose();
            }

            const material = object.material;
            if(!material) return;

            const disposeMaterial = (mat) => {
                if(mat.map?.userData?.editorOwned) mat.map.dispose();
                if(mat.alphaMap?.userData?.editorOwned) mat.alphaMap.dispose();
                if(mat.emissiveMap?.userData?.editorOwned) mat.emissiveMap.dispose();
                mat.dispose();
            };

            if(Array.isArray(material)) {
                material.forEach(disposeMaterial);
            } else {
                disposeMaterial(material);
            }
        });

        this.renderer.dispose();
    }
}

export default ThreeRendererAdapter;