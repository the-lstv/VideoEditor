/**
 * Three.js rendering backend adapter.
 * @copyright 2026 lstv.space
 * @license GPL-3.0
 */

import RendererAdapter from "../adapter-base.mjs";
// import AcceleratedTextRenderer from "../text-engine.mjs";

import * as THREE from "three";

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
 * - Transition should not be too difficult once WebGPU is ready (i want to make it agnostic anyway).
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

        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

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

        this.defaultCamera = new THREE.OrthographicCamera(0, this.width, 0, this.height, 0.1, 10000);
        this.defaultCamera.position.set(0, 0, 1000);
        this.defaultCamera.lookAt(0, 0, 0);

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

        this.defaultCamera.left = 0;
        this.defaultCamera.right = this.width;
        this.defaultCamera.top = 0;
        this.defaultCamera.bottom = this.height;
        this.defaultCamera.updateProjectionMatrix();

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
        item.data ??= {};

        if(item.type === "automation" || item.type === "events" || item.type === "script") {
            return null;
        }

        switch(item.type) {
            case "container":
                item.node = new THREE.Group();
                item.node.userData.editorType = "container";
                break;

            /* Sprite/image/video (2D surface) node */
            case "sprite":
            case "image":  // technically, this type is identical to sprite, and should not be used
            case "video":  // technically, this type is identical to sprite, and should not be used
                if(item.type !== "sprite") item.type = "sprite"; // Normalize to prefer sprite
                item.node = this.constructor.createSurfaceNode(item, this.parent);
                break;

            /* Using the native dynamic text renderer (good for dynamic text) */
            case "text":
                AcceleratedTextRenderer.provideThreeJS(THREE);

                const renderer = new AcceleratedTextRenderer({
                    threeRenderer: this.renderer,
                    fontSrc: item.data.fontSrc || "assets/fonts/JetBrainsMono",
                    cols: item.data.cols || 120,
                    rows: item.data.rows || 40,
                    fontSize: item.data.textStyleFontSize || 24,
                });

                item.textRenderer = renderer; // Here options could get uploaded, & these could be shared
                item.node = renderer.getObject3D();
                break;

            /* Using canvas text rendering & a static texture (good for static text) */
            /* Technically also just a sprite with a text canvas as its texture */
            case "static_text":
                // TBA
                break;

            /* Vector graphics node */
            case "graphics":
                // Container
                item.node = new THREE.Group();

                // Then shapes will be added or SVG
                break;

            /* Mesh node */
            case "mesh":
                item.node = this.constructor.createMeshNode(item);
                break;

            /* Camera node */
            case "camera":
                item.node = this.constructor.createCameraNode(item, this.width, this.height);
                break;

            /* Audio related */
            case "audio":
            case "notes":
                // No visual node, but audio items should carry an audio stream with a connectable output
                return null;

            default:
                console.warn(`this.constructor.createItemNode: Unsupported item type ${item.type}`);
                return null;
        }

        if(!item.node) return null;

        item.node.visible = false;
        item.node.matrixAutoUpdate = true;

        // ! todo: scene editor
        if(this?.root) {
            this.root.add(item.node);
            console.log(`Added node for item ${item.id} to root`);
        }

        this.applyInitialNodeProperties(item);
        this.constructor.updateItemPosition(item);
        return item.node;
    }

    static createCameraNode(item, width = 1280, height = 720) {
        const data = item.data || {};

        const camera = data.cameraType === "orthographic"?
            new THREE.OrthographicCamera(data.cameraLeft ?? 0, data.cameraRight ?? width, data.cameraTop ?? 0, data.cameraBottom ?? height, data.cameraNear ?? 0.1, data.cameraFar ?? 10000):
            new THREE.PerspectiveCamera (data.cameraFov ?? 50, data.cameraAspect ?? width / height, data.cameraNear ?? 0.1, data.cameraFar ?? 10000);

        camera.lookAt(0, 0, 0);
        return camera;
    }

    static createSurfaceNode(item, parent = null) {
        const node = new THREE.Group();

        const material = new THREE.MeshBasicMaterial({
            color: item.data.tint ?? item.data.materialColor ?? 0xffffff,
            transparent: true,
            opacity: item.data.opacity ?? item.data.alpha ?? 1,
            depthTest: !!item.data.depthTest,
            depthWrite: !!item.data.depthWrite,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(this.getUnitPlaneGeometry(), material);

        mesh.matrixAutoUpdate = false;

        node.add(mesh);
        node.userData.editorType = item.type;
        node.userData.surface = mesh;
        node.userData.material = material;
        node.userData.width = item.data.width ?? item.data.w ?? 1;
        node.userData.height = item.data.height ?? item.data.h ?? 1;

        item.node = node;
        return node;
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
                const texture = await resource.getImageTexture();
                item.node.userData.material.map = texture;
                item.node.userData.material.needsUpdate = true;
            }

            if(resource.type === "video") {
                const videoDecoder = resource.getVideoDecoder();

                if(!item.node.userData.canvasTexture) {
                    const texture = new THREE.CanvasTexture(videoDecoder.canvas);
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.generateMipmaps = false;
                    texture.colorSpace = THREE.SRGBColorSpace;
                    // texture.needsUpdate = false;

                    item.node.userData.canvasTexture = texture;
                }

                if(videoDecoder) {
                    item.node.userData.material.map = item.node.userData.canvasTexture;
                    item.node.userData.material.needsUpdate = true;
                }
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

    static #tempOffset = new THREE.Vector3();
    static #tempEuler = new THREE.Euler();
    static updateItemPosition(item) {
        // TODO: optimization
        // Sadly due to there being no way to do a proper anchor in THREE.js we have to recalculate everything every time anything changes
        // Even if 90% of this does NOTHING 90 of the time

        item.data ??= {};

        const data = item.data;
        const node = item.node;

        item.__dirtyPosition = false;

        if(item.type === "camera") {
            node.position.x = data.positionX || 0;
            node.position.y = data.positionY || 0;
            node.position.z = data.positionZ || 0;
            node.rotation.x = data.rotationX || 0;
            node.rotation.y = data.rotationY || 0;
            node.rotation.z = data.rotationZ || 0;
            return;
        }
    
        const w = data.width                 ?? 1;
        const h = data.height                ?? 1;
        const d = data.depth                 ?? 1;

        const x = data.positionX             || 0;
        const y = data.positionY             || 0;
        const z = data.positionZ             || 0;

        const rotationX = data.rotationX     || 0;
        const rotationY = data.rotationY     || 0;
        const rotationZ = data.rotationZ     || 0;

        const scaleX = data.scaleX           ?? 1;
        const scaleY = data.scaleY           ?? 1;
        const scaleZ = data.scaleZ           ?? 1;

        const anchorX = data.anchorX         || 0;
        const anchorY = data.anchorY         || 0;
        const anchorZ = data.anchorZ         || 0;

        // final scaled size
        const sx = w * scaleX;
        const sy = h * scaleY;
        const sz = d * scaleZ;

        // local anchor offset
        const offset = this.#tempOffset.set(
            anchorX * sx,
            anchorY * sy,
            anchorZ * sz
        );

        // rotate offset
        const euler = this.#tempEuler.set(
            rotationX,
            rotationY,
            rotationZ
        );

        offset.applyEuler(euler);

        // subtract rotated offset
        if(data.preserveAnchorPosition) {
            // restore original position while keeping anchor for rotation & scale
            node.position.set(
                x - offset.x + anchorX * sx,
                y - offset.y + anchorY * sy,
                z - offset.z + anchorZ * sz,
            );
        } else {
            node.position.set(
                x - offset.x,
                y - offset.y,
                z - offset.z
            );
        }

        node.rotation.set(
            rotationX,
            rotationY,
            rotationZ
        );

        node.scale.set(
            sx,
            sy,
            sz
        );

        // // is this needed?
        // node.updateMatrix();                  // local
        // node.updateMatrixWorld(true);         // world
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

        // Ideally this would be better but sadly we can't set this per-mesh
        // geometry.translate(-0.5, -0.5, -0.5);

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

    static setMaterialOpacity(item, value) {
        if(!item.node) return;
        // this.forEachMaterial(item.node, (material) => {
        // });

        const material = item.node.userData.material;
        if(material) {
            material.opacity = value;
            material.transparent = value < 1 || !!material.map;
            material.needsUpdate = true;
        }
    }

    clear() {
        this.renderer.setRenderTarget(null);
        this.renderer.clear(true, true, true);
    }

    render(camera = null) {
        this.renderer.render(this.scene, camera || this.defaultCamera);
    }

    /**
     * @type {Object.<string, function(AnimatedItem, *): void>}
     */
    static nodePropertySetters = {
        "tileColor": (item, v) => {
            item.tileColor = v;
        },

        "clipDuration": (item, v) => {
            item.duration = v;
        },

        "clipStartTime": (item, v) => {
            item.start = v;
        },

        "positionX": (item, v) => {
            item.data.positionX = v;
            item.__dirtyPosition = true;
        },

        "positionY": (item, v) => {
            item.data.positionY = v;
            item.__dirtyPosition = true;
        },

        "positionZ": (item, v) => {
            item.data.positionZ = v;
            item.__dirtyPosition = true;
        },

        "scaleX": (item, v) => {
            item.data.scaleX = v;
            item.__dirtyPosition = true;
        },

        "scaleY": (item, v) => {
            item.data.scaleY = v;
            item.__dirtyPosition = true;
        },

        "scaleZ": (item, v) => {
            item.data.scaleZ = v;
            item.__dirtyPosition = true;
        },

        "rotationX": (item, v) => {
            item.data.rotationX = v;
            item.__dirtyPosition = true;
        },

        "rotationY": (item, v) => {
            item.data.rotationY = v;
            item.__dirtyPosition = true;
        },

        "rotationZ": (item, v) => {
            item.data.rotationZ = v;
            item.__dirtyPosition = true;
        },

        "anchorX": (item, v) => {
            item.data.anchorX = v;
            item.__dirtyPosition = true;
        },

        "anchorY": (item, v) => {
            item.data.anchorY = v;
            item.__dirtyPosition = true;
        },

        "anchorZ": (item, v) => {
            item.data.anchorZ = v;
            item.__dirtyPosition = true;
        },

        "width": (item, v) => {
            item.data.width = v;
            item.__dirtyPosition = true;
        },

        "height": (item, v) => {
            item.data.height = v;
            item.__dirtyPosition = true;
        },

        "depth": (item, v) => {
            item.data.depth = v;
            item.__dirtyPosition = true;
        },

        "visible": (item, v) => {
            v = !!v;
            if (item.node) item.node.visible = v;
        },

        "fadeIn": (item, v) => {
            item.data.fadeIn = v;
        },

        "fadeOut": (item, v) => {
            item.data.fadeOut = v;
        },

        "materialColor": (item, v) => {
            this.setMaterialColor(item, v);
        },

        "sourceFitMode": (item, v) => {
            if (item.node?.userData) {
                item.node.userData.sourceFitMode = v;
                ThreeRendererAdapter.updateItemPosition(item);
            }
        },

        "opacity": (item, v) => {
            this.setMaterialOpacity(item, v);
        },

        "alpha": (item, v) => {
            this.setMaterialOpacity(item, v);
        },

        // todo: handle other blending modes
        "blendMode": (item, v) => {
            if(item.node) {
                const material = item.node.userData.material;
                if(material) {
                    // Reset blending settings
                    material.blendEquation = null;
                    material.blendSrc = null;
                    material.blendDst = null;

                    switch(v) {
                        case "normal":
                            material.blending = THREE.NormalBlending;
                            break;

                        case "additive":
                            material.blending = THREE.AdditiveBlending;
                            break;

                        case "subtractive":
                            material.blending = THREE.CustomBlending;
                            material.blendEquation = THREE.ReverseSubtractEquation;
                            material.blendSrc = THREE.OneFactor;
                            material.blendDst = THREE.OneFactor;
                            break;

                        case "multiply":
                            material.premultipliedAlpha = true;
                            material.blending = THREE.MultiplyBlending;
                            break;

                        case "screen":
                            material.blending = THREE.CustomBlending;
                            material.blendEquation = THREE.AddEquation;
                            material.blendSrc = THREE.OneMinusDstColorFactor;
                            material.blendDst = THREE.OneFactor;
                            break;

                        case "lighten":
                            material.blending = THREE.CustomBlending;
                            material.blendEquation = THREE.MaxEquation;
                            break;

                        case "darken":
                            material.blending = THREE.CustomBlending;
                            material.blendEquation = THREE.MinEquation;
                            break;
                            
                        case "custom":
                            // todo: Handle custom blending settings
                            material.blending = THREE.CustomBlending;
                            break;

                        default:
                            material.blending = THREE.NormalBlending;
                    }
                    material.needsUpdate = true;
                }
            }
        },

        "wireframe": (item, v) => {
            if(item.node) {
                const material = item.node.userData.material;
                if(material) {
                    material.wireframe = !!v;
                    material.needsUpdate = true;
                }
            }
        },

        "dithering": (item, v) => {
            if(item.node) {
                const material = item.node.userData.material;
                if(material) {
                    material.dithering = !!v;
                    material.needsUpdate = true;
                }
            }
        },

        "castShadow": (item, v) => {
            if(item.node) item.node.castShadow = !!v;
        },

        "receiveShadow": (item, v) => {
            if(item.node) item.node.receiveShadow = !!v;
        },

        "textContent": (item, v) => {},
        "textStyle": (item, v) => {},
        "textStyleWeight": (item, v) => {},
        "textStyleStyle": (item, v) => {},
        "textStyleFontSize": (item, v) => {
            if(item.textRenderer) {
                item.textRenderer.setFontSize(v);
                item.data.textStyleFontSize = v;
            }
        },
        "textStyleFontFamily": (item, v) => {},
        "textStyleFill": (item, v) => {},
        "textStyleAlignment": (item, v) => {},
        "textStyleLineHeight": (item, v) => {},
        "textStyleWrapWidth": (item, v) => {},
        "textStyleWrap": (item, v) => {},
        "textStyleLetterSpacing": (item, v) => {},
        "textStyleStroke": (item, v) => {},
        "textStyleStrokeThickness": (item, v) => {},
        "textStyleStrokeLinejoin": (item, v) => {},
        "textStyleDropShadow": (item, v) => {},
        "textStyleDropShadowColor": (item, v) => {},
        "textStyleDropShadowDistance": (item, v) => {},
        "textStyleDropShadowAngle": (item, v) => {},
        "textStyleDropShadowBlur": (item, v) => {},
        "textStyleDropShadowOpacity": (item, v) => {},

        "audioVolume": (item, v) => {
            item.data.audioVolume = v;
        },

        "audioPan": (item, v) => {
            item.data.audioPan = v;
        },

        "playbackRate": (item, v) => {
            item.data.playbackRate = v;
        },

        "mediaOffset": (item, v) => {
            item.data.mediaOffset = v;
        },

        "loopMode": (item, v) => {
            item.data.loopMode = v;
        },

        "videoFrameRate": (item, v) => {
            item.data.videoFrameRate = v;
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
        },

        "preserveAnchorPosition": (item, v) => {
            item.data.preserveAnchorPosition = !!v;
            item.__dirtyPosition = true;
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
        "anchorZ": (item) => item.node?.userData? item.node.userData.anchorZ: (item.data.anchorZ?? 0),
        "width": (item) => item.node?.userData? item.node.userData.width: (item.data.width || 1),
        "height": (item) => item.node?.userData? item.node.userData.height: (item.data.height || 1),
        "depth": (item) => item.data.depth || 1,
        "visible": (item) => item.node? item.node.visible: (item.data.visible !== undefined? item.data.visible: true),
        "materialColor": (item) => item.data.materialColor || item.data.color || item.data.tint || 0xFFFFFF,
        "opacity": (item) => item.data.opacity !== undefined? item.data.opacity: (item.data.alpha !== undefined? item.data.alpha: 1),
        "alpha": (item) => item.data.alpha !== undefined? item.data.alpha: (item.data.opacity !== undefined? item.data.opacity: 1),
        "blendMode": (item) => item.data.blendMode || 0,
        "wireframe": (item) => !!item.data.wireframe,
        "castShadow": (item) => !!(item.node? item.node.castShadow: item.data.castShadow),
        "receiveShadow": (item) => !!(item.node? item.node.receiveShadow: item.data.receiveShadow),
        "dithering": (item) => !!item.data.dithering,

        "textContent": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.text: (item.data.textContent || ""),
        "textStyleFontSize": (item) => item.textRenderer? item.textRenderer.fontSize: (item.data.textStyleFontSize || 24),

        "textStyle": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style: (item.data.textStyle || {}),
        "textStyleWeight": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.fontWeight: (item.data.textStyleWeight || 'normal'),
        "textStyleStyle": (item) => item.node?.userData?.editorType === "text"? item.node.userData.textState.style.fontStyle: (item.data.textStyleStyle || 'normal'),
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

        "audioVolume": (item) => (item.data.audioVolume ?? 1),
        "audioPan": (item) => (item.data.audioPan ?? 0),
        "playbackRate": (item) => (item.data.playbackRate || 1),
        "loopMode": (item) => item.data.loopMode || "loop",
        "mediaOffset": (item) => item.data.mediaOffset || 0,
        "videoFrameRate": (item) => item.data.videoFrameRate || -1,

        "cameraFov": (item) => item.node?.isPerspectiveCamera? item.node.fov: (item.data.cameraFov || item.data.fov || 50),
        "cameraNear": (item) => item.node?.isCamera? item.node.near: (item.data.cameraNear || item.data.near || 0.1),
        "cameraFar": (item) => item.node?.isCamera? item.node.far: (item.data.cameraFar || item.data.far || 10000),

        "automationEnabled": (item) => !!item.data.automationEnabled,
        "automationBaseValue": (item) => item.data.automationBaseValue || 0,
        "automationFunction": (item) => item.data.automationFunction || "",

        "fadeIn": (item) => item.data.fadeIn || 0,
        "fadeOut": (item) => item.data.fadeOut || 0,

        "preserveAnchorPosition": (item) => !!item.data.preserveAnchorPosition,
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