import RendererAdapter from "./adapter-base.mjs";

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
    constructor(options = {}) {
        super();

        if(typeof THREE === "undefined") {
            throw new Error("ThreeRendererAdapter: THREE.js is required");
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

    static updateNodeLocalShape(node) {
    }

    static disposeObject(object) {
        object.removeFromParent();
        if(object.geometry && !object.geometry.userData?.sharedEditorGeometry) {
            object.geometry.dispose();
        }
    }

    clear() {
        this.renderer.setRenderTarget(null);
        this.renderer.clear(true, true, true);
    }

    render(camera = null) {
        this.renderer.render(this.scene, camera || this.camera);
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