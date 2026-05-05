import RendererAdapter from "./adapter-base.mjs";

// import * as THREE from "three";

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