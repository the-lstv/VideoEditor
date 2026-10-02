/**
 * QuickSand Game Engine runtime for JS
 * @see https://github.com/thelstv/editor
 * @see https://github.com/thelstv/ls
 * 
 * Copyright (c) 2026 lstv.space. All rights reserved.
 */

/**
 * QuickSand is a lightweight, low-level, dynamic game engine for JavaScript designed for
 * creating highly performant games with an intuitive API and GUI.
 * 
 * You can use the QuickSand editor to create games with a visual editor, or you can use the QuickSand runtime to create games programmatically.
 */

/**
 * A basic asset loader.
 */
class AssetLoader extends LS.EventEmitter {
    constructor(options = {}, parent = null, nameScope = null) {
        super();

        this.parent = parent;
        this.nameScope = nameScope;

        this.resources = new Map();
        this.assets = new Map();

        if(options.srcPrefix) {
            this.srcPrefix = options.srcPrefix;
        }

        if(options.map) {
            this.registerMany(options.map);
        }

        if(options.autoLoad) {
            this.loadAll();
        }

        if(this.parent) {
            this.parent.once("destroy", () => this.destroy());
        }

        if(options.logger) {
            this.log = options.logger;
        } else this.log = LS.DEFAULT_LOG_OUTPUT;
    }

    /**
     * Registers an asset.
     * @param {*} assetName The name/identifier of the asset to register.
     * @param {*} data Options for the asset. Can include src (URL/data) along with other metadata and configuration.
     */
    register(assetName, data = {}) {
        if(typeof assetName === "object" && data === undefined) {
            data = assetName;
            assetName = data.name || LS.Util.normalizePath(data.src);
        }

        if(!assetName || typeof assetName !== "string") {
            this.log.error("Asset name must be a non-empty string.");
            return;
        }

        if(this.nameScope) {
            assetName = `${this.nameScope}:${assetName}`;
        }

        if(this.assets.has(assetName)) {
            this.log.warn("Asset already registered:", assetName);
            return;
        }

        if(typeof data === "string") {
            data = { src: data };
        }

        if(this.srcPrefix && data.src) {
            data.src = this.srcPrefix + data.src;
        }

        data.src = LS.Util.normalizePath(data.src);

        data.resource = null;

        data.ref = 0;

        this.assets.set(assetName, data);

        if(data.preload) {
            this.load(assetName);
        }
        return data;
    }

    /**
     * Registers multiple assets at once.
     * @param {Object} assets - An object where keys are asset names and values are options.
     */
    registerMany(assets) {
        for(const [assetName, options] of Object.entries(assets)) {
            this.register(assetName, options);
        }
    }

    unregister(assetName) {
        if(this.nameScope) {
            assetName = `${this.nameScope}:${assetName}`;
        }

        if(!this.assets.has(assetName)) {
            this.log.warn("Asset not registered:", assetName);
            return;
        }

        this.dispose(assetName);
        this.assets.delete(assetName);
    }

    /**
     * Unregisters multiple assets at once.
     * @param {string[]} assetNames - An array of asset names to unregister or null to unregister all.
     */
    unregisterMany(assetNames) {
        for(const assetName of assetNames || this.assets.keys()) {
            this.unregister(assetName);
        }
    }

    async loadResource(src, type) {
        src = LS.Util.normalizePath(src);

        if(typeof type !== "function") {
            const extName = src.split(".").pop()?.toLowerCase();
            type = (type === "image"? GlImage: (type === "sound"? Sound: null)) || (extName === "png" || extName === "jpg" || extName === "jpeg" || extName === "gif"|| extName === "webp"? GlImage: (extName === "ogg" || extName === "flac" || extName === "mp3" || extName === "wav"? Sound: null));

            if(typeof type !== "function") {
                throw new Error("Unable to determine resource type for src: " + src);
            }
        }

        if(this.resources.has(src)) {
            return this.resources.get(src);
        }

        const resource = type.fromUrl? await type.fromUrl(src): new type();

        if(!resource) {
            throw new Error("Failed to load resource: " + src);
        }

        this.resources.set(src, resource);
        resource.src = src;
        resource.ref = 0;
        return resource;
    }

    /**
     * Loads an asset. If the asset is already loaded, it will not reload it.
     * @param {*} assetName The name of the asset to load.
     * @returns {Promise<boolean>} Returns true if the asset is playable, false if something went wrong.
     */
    async load(assetName, _fallbackIndex = -1) {
        const asset = this.assets.get(assetName);

        if(!asset) {
            this.log.error("Asset not found:", assetName);
            return false;
        }

        if(this.resources.has(asset.src)) {
            const res = this.resources.get(asset.src);
            if(asset.resource !== res) {
                asset.resource = res;
                res.ref++;
            }
            return true;
        }

        try {
            const src = _fallbackIndex < 0? asset.src: (this.assets.get(asset.fallback[_fallbackIndex])?.src);
            if(!src) throw "No available source";

            asset.resource = this.resources.get(src) || await this.loadResource(src, asset.type);
            if(asset.resource) {
                asset.resource.ref++;
                asset.__lastSrc = src;
                return true;
            }
        } catch (e) {
            if(Array.isArray(asset.fallback) && asset.fallback.length > (_fallbackIndex + 1)) {
                _fallbackIndex ++;
                this.log.error("Failed to load asset:", assetName, ", trying to fallback to next alternative: ", asset.fallback[_fallbackIndex], e);
                return await this.load(assetName, _fallbackIndex);
            }

            asset.__lastSrc = null;
            this.log.error("Failed to load asset:", assetName, e);
        }

        return false;
    }

    /**
     * Loads and gets an asset.
     * @param {string} assetName - The name of the asset to get.
     * @returns {Promise<*>} - The asset, or null if it's not found.
     */
    async get(assetName) {
        const asset = this.assets.get(assetName);

        if(!asset) {
            this.log.error("Asset not found:", assetName);
            return null;
        }

        if(asset.__lastSrc !== asset.src) {
            const loaded = await this.load(assetName);
            if(!loaded) return null;
        }

        return asset;
    }

    /**
     * Disposes of an asset.
     * @param {string} assetName - The name of the asset to dispose of.
     */
    async dispose(assetName) {
        const asset = this.assets.get(assetName);

        if(!asset) {
            this.log.error("Asset not found:", assetName);
            return;
        }

        if(asset.resource) {
            asset.resource.ref--;
            if(asset.resource.ref <= 0) {
                await this.disposeResource(asset.src);
            }
        }

        console.log("Disposing asset:", assetName, "with src:", asset.src);

        asset.__lastSrc = null;
    }

    async disposeResource(src) {
        src = LS.Util.normalizePath(src);

        if(this.resources.has(src)) {
            const resource = this.resources.get(src);
            for(const [assetName, asset] of this.assets.entries()) {
                if(asset.src === src) {
                    asset.resource = null;
                    asset.__lastSrc = null;
                }
            }

            if(resource.ref > 0) {
                this.log.warn("Disposing resource with non-zero reference count:", src, resource.ref);
            }

            if(resource.destroy) resource.destroy();
            this.resources.delete(src);
        }
    }

    async loadAll() {
        const loadPromises = [];
        for(const assetName of this.assets.keys()) {
            loadPromises.push(this.load(assetName));
        }
        await Promise.all(loadPromises);
    }

    createScope(options, nameScope) {
        return new SoundBox(options, this, nameScope);
    }

    destroy() {
        if(this.destroyed) return;
        this.destroyed = true;

        this.emit("destroy");
        this.events.clear();
        this.assets.clear();
        this.assets = null;

        if(this.ctx) {
            this.ctx.close();
            this.ctx = null;
        }
    }
}

/**
 * Basic input handler for web browsers (keyboard, mouse, controller/gamepad).
 * For more advanced input handling or gestures, consider using LS.Util.TouchHandle
 */
class InputHandler {
    keyboard = new Map();
    mouse = [0, 0, false, false, false, false, false, false];
    controller = null;

    enabled = false;

    constructor(parent) {
        this.parent = parent;
        this.mapping = new Map();
    }

    map(map) {
        for(const [key, value] of Object.entries(map)) {
            this.mapping.set(key, value);
        }
    }

    transformCoordinates(x, y, out = []) {
        const canvas = this.parent.renderer.canvas;
        const rect = canvas.getBoundingClientRect();

        const width  = this.parent.renderer.width;
        const height = this.parent.renderer.height;

        const scale = Math.min(
            rect.width  / width,
            rect.height / height
        );

        const renderedWidth  = width * scale;
        const renderedHeight = height * scale;

        // Letterbox/pillarbox offset inside the DOM rect.
        const offsetX = (rect.width  - renderedWidth)  * 0.5;
        const offsetY = (rect.height - renderedHeight) * 0.5;

        // Client -> fitted canvas coordinates.
        out[0] = (x - rect.left - offsetX) / scale;
        out[1] = (y - rect.top  - offsetY) / scale;

        return out;
    }

    enable(target = window) {
        if(this.enabled) return;
        this.enabled = true;

        this.signal = new AbortController();

        const options = { signal: this.signal.signal };

        target.addEventListener("keydown", (e) => {
            this.keyboard.set(e.code, true);
        }, options);

        target.addEventListener("keyup", (e) => {
            this.keyboard.set(e.code, false);
        }, options);

        target.addEventListener("mousemove", (e) => {
            this.transformCoordinates(e.clientX, e.clientY, this.mouse);
        }, { signal: this.signal.signal, passive: true, });

        target.addEventListener("mousedown", (e) => {
            this.mouse[e.button + 2] = true;
        }, options);

        target.addEventListener("contextmenu", (e) => {
            e.preventDefault();
        }, options);

        target.addEventListener("mouseup", (e) => {
            this.mouse[e.button + 2] = false;
        }, options);
    }

    disable(clearState = true) {
        if(this.signal) {
            this.signal.abort();
            this.signal = null;
        }

        if(clearState) {
            for(const key of this.keyboard.keys()) {
                this.keyboard.set(key, false);
            }
    
            for(let i = 2; i < this.mouse.length; i++) {
                this.mouse[i] = false;
            }
        }

        this.enabled = false;
    }

    destroy() {
        this.disable(false);
        this.keyboard = null;
        this.mouse = null;
        this.controller = null;
        this.mapping = null;
        this.parent = null;
    }
}

/**
 * Basic storage manager for persistent data
 */
class StorageManager {
    constructor() {
        this.storage = window.localStorage;
    }

    set(key, value) {
        try {
            this.storage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.error("Failed to set item in localStorage:", e);
        }
    }

    get(key, defaultValue = null) {
        try {
            const value = this.storage.getItem(key);
            return value !== null ? JSON.parse(value) : defaultValue;
        } catch (e) {
            console.error("Failed to get item from localStorage:", e);
            return defaultValue;
        }
    }

    remove(key) {
        try {
            this.storage.removeItem(key);
        } catch (e) {
            console.error("Failed to remove item from localStorage:", e);
        }
    }

    clear() {
        try {
            this.storage.clear();
        } catch (e) {
            console.error("Failed to clear localStorage:", e);
        }
    }

    destroy() {
        this.storage = null;
    }
}

class GameRuntime extends LS.EventEmitter {
    /**
     * @type {AssetLoader}
     */
    assets = null;

    /**
     * @type {LS.GL.WebGLRenderer}
     */
    renderer = null;

    /**
     * @type {LS.SoundBox}
     */
    soundbox = null;

    /**
     * @type {InputHandler}
     */
    input = new InputHandler(this);

    /**
     * @type {StorageManager}
     */
    storage = new StorageManager();

    initialized = false;

    constructor(options = {}){
        super();

        this.options = options;
    }

    animate(sprite, keyframes, options = {}) {
        return LS.Animation2.animate(sprite, keyframes, options);
    }

    animationTimeline(animations, options = {}) {
        return new LS.Animation2.Timeline(animations, options);
    }

    createScene() {
        return new Scene(this);
    }

    async init(){
        if(this.initialized) return;
        this.initialized = true;

        if(typeof this.options.renderer === "string") {
            if(this.options.renderer === "LS.GL.WebGLRenderer") {
                this.options.renderer = LS.GL.WebGLRenderer;
            } else {
                throw new Error("Unknown or unsupported renderer type: " + this.options.renderer);
            }
        }

        if(!this.renderer) {
            this.renderer = typeof this.options.renderer === "function" ? new this.options.renderer(this.options.rendererOptions) : this.options.renderer || new LS.GL.WebGLRenderer(this.options.rendererOptions);
            delete this.options.renderer;
            delete this.options.rendererOptions;
    
            this.renderer.options.preRender = this.frameCallback.bind(this);
        } else {
            this.renderer.setOptions(this.options.rendererOptions);
        }

        const soundbox = this.options.soundbox;
        if(soundbox) {
            this.soundbox = soundbox instanceof LS.SoundBox? soundbox: new LS.SoundBox(typeof soundbox === "object"? soundbox: this.options.soundboxOptions || {}, null, this.options.nameScope || null);
            delete this.options.soundbox;
        }

        this.assets = new AssetLoader(this.options.assets || {}, null, this.options.nameScope || null);
        delete this.options.assets;
        delete this.options.nameScope;

        if(this.options.input) {
            this.input.map(this.options.input);
            delete this.options.input;
        }
    }

    async resume() {
        await this.init();

        this.input.enable();
        this.renderer.frameScheduler.start();
    }

    async pause() {
        this.input.disable();
        this.renderer.frameScheduler.stop();
    }

    async destroy() {
        if(this.renderer) {
            this.renderer.destroy();
            this.renderer = null;
        }

        if(this.assets) {
            this.assets.destroy();
            this.assets = null;
        }

        if(this.soundbox) {
            this.soundbox.destroy();
            this.soundbox = null;
        }

        if(this.input) {
            this.input.destroy();
            this.input = null;
        }

        if(this.storage) {
            this.storage.destroy();
            this.storage = null;
        }

        super.destroy();
    }

    /**
     * Re-initialize the engine with different options without destroying the renderer and events
     * @param {*} options New runtime options
     * @returns {Promise}
     */
    reinitialize(options, clearEvents = false) {
        if(options) this.options = options;

        this.initialized = false;

        if(this.assets) {
            this.assets.destroy();
            this.assets = null;
        }

        if(this.soundbox) {
            this.soundbox.destroy();
            this.soundbox = null;
        }

        if(this.input) {
            this.input.destroy();
            this.input = null;
        }

        if(this.storage) {
            this.storage.destroy();
            this.storage = null;
        }

        if(clearEvents) {
            this.events.clear();
        }

        return this.init();
    }

    frameCallback(delta, now) {
        // Override this method
    }

    requestFrame() {
        this.renderer.render();
    }
}

/**
 * QuickSand separates Images from Textures.
 * An Image is a raw image resource, while a Texture is a wrapper around an Image that defines a specific region of the image.
 * 
 * A texture thus doesn't necessarily own the image resource itself.
 */
class GlImage {
    /**
     * @type {Image|HTMLCanvasElement}
     */
    image = null;

    textures = new WeakMap();

    constructor(image = null) {
        this.image = image;
    }

    static async fromUrl(src) {
        const glImageI = new GlImage();
        await glImageI.loadFromURL(src);
        return glImageI;
    }

    static fromCanvas(canvas = document.createElement("canvas")) {
        const glImageI = new GlImage();
        glImageI.image = canvas;
        return glImageI;
    }

    static fromImage(image = new Image()) {
        const glImageI = new GlImage();
        glImageI.image = image;
        return glImageI;
    }

    async loadFromURL(src) {
        return await new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => {
                this.image = image;
                resolve(image);
            };

            image.onerror = (e) => { reject(e) };
            image.src = src;
        });
    }

    updateGLTexture(gl, texture, options = {}) {
        if(!this.image) {
            this.log.error("Empty asset provided for texture creation.");
            return null;
        }

        gl.bindTexture(gl.TEXTURE_2D, texture);

        if(options.region) {
            const [x, y, width, height] = options.region;
            gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
        }

        if(options.nearestFilter || this.pixelated) {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        } else {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        }

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        this.textures.set(gl, texture);
        return texture;
    }

    getGLTexture(gl, options = {}) {
        if(this.textures.has(gl)) {
            return this.textures.get(gl);
        }

        const texture = gl.createTexture();
        return this.updateGLTexture(gl, texture, options);
    }

    get width() {
        return this.image ? this.image.width : 0;
    }

    get height() {
        return this.image ? this.image.height : 0;
    }

    unloadImage() {
        if(this.image) {
            this.image.src = "";
            this.image = null;
        }
    }

    destroy() {
        this.unloadImage();
        this.textures = null; // Note that this still keeps the GL textures alive
    }
}

/**
 * A Texture is a wrapper around an Image asset or other source that can be used for surfaces.
 * 
 * You can create a Texture from an Image, a Canvas or any Color.
 */
class Texture {
    static WHITE = Texture.fromColor("#fff");

    constructor(asset, region = null) {
        if(!asset || (!(asset.resource instanceof GlImage) && !(asset instanceof LS.Color))) {
            throw new Error("Texture must be created with a valid image asset.");
        }

        this.asset = asset;

        if(this.asset.resource instanceof GlImage) {
            this.asset.ref++;
        }

        this.region = region || [0, 0, asset.resource.width, asset.resource.height];
    }

    get width() {
        return this.region[2];
    }

    get height() {
        return this.region[3];
    }

    get imageWidth() {
        return this.asset?.resource?.width || 0;
    }

    get imageHeight() {
        return this.asset?.resource?.height || 0;
    }

    getGLTexture(gl) {
        if(this.asset instanceof LS.Color) {
            // todo!
            if(this.texture) return this.texture;
            return (this.texture = this.asset.toTexture(gl));
        }

        if(!this.asset || !this.asset.resource) {
            throw new Error("Texture's asset is not loaded or has been destroyed.");
        }

        return this.asset.resource.getGLTexture(gl);
    }

    // Shared canvas would be neat but has an issue as textures sadly can't be shared and have to be made per GL context.

    /**
     * @experimental
     */
    static fromText(text, { font = "serif", color = "white", backgroundColor = null, fontSize = 20 } = {}) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = fontSize * text.length;
        canvas.height = fontSize;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
    
        if(backgroundColor) {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        ctx.fillStyle = color;
        ctx.font = fontSize + "px " + font;
        ctx.fillText(text, 0, fontSize);

        return Texture.fromCanvas(canvas);
    }

    static fromImage(image, region = null) {
        const glImage = GlImage.fromImage(image);
        const asset = { resource: glImage, ref: 1 };
        return new Texture(asset, region);
    }

    static fromCanvas(canvas, region = null) {
        const glImage = GlImage.fromCanvas(canvas);
        const asset = { resource: glImage, ref: 1 };
        return new Texture(asset, region);
    }

    static fromColor(color = "white") {
        return new Texture(new LS.Color(color), [0, 0, 1, 1]);
    }

    static async fromURL(src, region = null) {
        const glImage = await GlImage.fromUrl(src);
        const asset = { resource: glImage, ref: 1 };
        return new Texture(asset, region);
    }

    destroy() {
        if(this.asset instanceof GlImage) {
            this.asset.ref--;
            if(this.asset.ref <= 0) {
                this.asset.resource.destroy();
            }
        }

        this.asset  = null;
        this.region = null;
    }
}

class TextureAtlas {
    regions = {};

    constructor(imageAsset, regions = null) {
        regions ??= imageAsset.atlasData || null;

        if(regions) {
            this.loadFromRegions(imageAsset, regions);
        } else {
            console.warn("No regions provided for TextureAtlas.");
        }

        this.addRegion(imageAsset, "full", [0, 0, imageAsset.resource.width, imageAsset.resource.height]);
    }

    loadFromRegions(atlasImage, regions) {
        if(Array.isArray(regions)) {
            for(const region of regions) {
                this.addRegion(atlasImage, region.name, region.region || region);
            }
        } else if(typeof regions === "object") {
            for(const [name, data] of Object.entries(regions)) {
                this.addRegion(atlasImage, name, data);
            }
        }
    }

    addRegion(atlasImage, name, region) {
        if(typeof region === "object" && !Array.isArray(region) && region !== null) {
            region = [region.x || 0, region.y || 0, region.width || 0, region.height || 0];
        }

        if(!name || !Array.isArray(region) || region.length !== 4) {
            throw new Error("Invalid region format.");
        }

        this.regions[name] = new Texture(atlasImage, region);
    }

    destroy() {
        for(const region of Object.values(this.regions)) {
            region.destroy();
        }
        this.regions = null;
    }

    static from(atlasImage, regions) {
        return new TextureAtlas(atlasImage, regions);
    }

    /**
     * @experimental
     */
    static fromTextList(textMap, { font = "serif", color = "white", fontSize = 16 } = {}) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = 1000;
        canvas.height = 1000;

        const asset = { resource: GlImage.fromCanvas(canvas), ref: 1 };

        let canvasWidth = 0, canvasHeight = 0, textMetrics = [];

        const textEntries = Object.entries(textMap);

        ctx.fillStyle = color;
        ctx.font = fontSize + "px " + font;

        for(const [name, text] of textEntries) {
            const metrics = ctx.measureText(text);
            const h = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;

            textMetrics.push(metrics);

            canvasWidth = Math.max(canvasWidth, metrics.width);
            canvasHeight += h;
        }

        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        // for whatever reason everything resets after resizing
        ctx.fillStyle = color;
        ctx.font = fontSize + "px " + font;

        let yOffset = 0;
        const atlas = new TextureAtlas(asset);

        for(const [name, text] of textEntries) {
            const metrics = textMetrics.shift();
            const h = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;

            ctx.fillText(text, 0, yOffset + metrics.actualBoundingBoxAscent);
            atlas.addRegion(asset, name, [0, yOffset, metrics.width, h]);

            yOffset += h;
        }

        document.body.appendChild(canvas);

        return atlas;
    }
}

// todo
class Sound {
    static async load(parent, asset, src) {
    }

    destroy(asset) {
        this.buffer = null;
    }
}

/**
 * BatchedSpriteRenderer efficiently renders multiple sprites in a single draw call, with a few limitations:
 * - All sprites share one texture atlas.
 * - All sprites use the same shader program.
 * - All sprites have the same blending mode.
 * - All sprites are rendered in order and can't be easile interleaved with other renderables, and aren't recursive.
 * 
 * Good for:
 * - Rendering many sprites with the same atlas on one layer, eg. UI elements.
 * 
 * Supported sprite properties: x, y, w, h, texture, texture region, color/transparency and xyz rotation
 */
class BatchedSpriteRenderer extends LS.GL.Renderable {
    /**
     * @param {LS.GL.WebGLRenderer} lsgli The WebGL renderer instance.
     * @param {Object} [param1={}] Options
     * @param {null} [param1.frag=null] Custom fragment shader.
     * @param {null} [param1.vert=null] Custom vertex shader.
     * @param {null} [param1.uniforms=null] Additional custom uniforms.
     * @param {null} [param1.attributes=null] Additional custom attributes.
     * @param {null} [param1.binds=null] Extra custom attribute bindings.
     * @param {number} [param1.batchSize=512] How many slots to pre-allocate. Higher numbers improve performance for large amounts of sprites and allow for better optimization potential (eg. buffer reuse) but increase memory usage (~36 bytes per slot on both CPU and GPU). I recommend setting this to about or slightly above the average amount of sprites you expect to draw. More sprites can be drawn (up to as many as you can fit in one frame), but will cost additional buffer updates and draw calls.
     * 
     * @example
     * const spriteRenderer = new BatchedSpriteRenderer(renderer, { batchSize: 3 });
     * const container = new Container([ sprite1, sprite2, sprite3 ]);
     * 
     * // In your frame callback, or whenever you want to render, call:
     * spriteRenderer.render(container); // container, optional x, y offset and opacity (defaults to the container opacity)
     * 
     * // You can also draw directly without updating buffers if your sprite data didn't change from the
     * // last frame and your sprite count is at or below the batchSize:
     * // This way you can also generate custom data if you wish.
     * spriteRenderer.draw(3, atlasTexture, 0, 3, 1.0); // count, texture, low, high, opacity, x, y
     * // The above will draw whatever container was last stored in the buffers with render()
     */
    constructor(lsgli, { frag = null, vert = null, uniforms = null, attributes = null, binds = null, batchSize = 512 } = {}) {
        super({
            version: 0,

            parent: lsgli,

            uniforms: ["uProjection", "uOffset", "uTexture", "uOpacity", ...(uniforms || [])],
            attributes: ["iOffset", "iSize", "iUVRect", "iColor", "iRotate", ...(attributes || [])],
 
            vao: true,
            bind: {
                iOffset:  { cellSize: 2, type: "float", size: batchSize },
                iRotate:  { cellSize: 3, type: "float", size: batchSize },
                iSize:    { cellSize: 2, type: "float", size: batchSize },
                iColor:   { cellSize: 4, type: "ubyte", size: batchSize, normalized: true },
                iUVRect:  { cellSize: 4, type: "float", size: batchSize },
                ...binds
            },

            frag: frag || `#version 300 es
precision mediump float;

in vec2 v_texCoord;
in vec4 v_color;

out vec4 fragColor;

uniform sampler2D uTexture;

uniform float uOpacity;

void main() {
    vec4 texColor = texture(uTexture, v_texCoord);
    fragColor = texColor * v_color;
    fragColor.a *= uOpacity;
    //fragColor = (texColor * 0.1)  + vec4(1.0, 1.0, 1.0, 1.0) + (v_color * 0.1);
}`,
            vert: vert || `#version 300 es

${LS.GL.utils.quad}

in vec2 iOffset;
in vec3 iRotate;
in vec4 iUVRect;
in vec4 iColor;
in vec2 iSize;

uniform mat4 uProjection;
uniform vec2 uOffset;

out  vec2 v_texCoord;
out  vec4 v_color;

mat3 rotationXYZ(vec3 r) {
    float cx = cos(r.x);
    float sx = sin(r.x);
    float cy = cos(r.y);
    float sy = sin(r.y);
    float cz = cos(r.z);
    float sz = sin(r.z);

    mat3 Rx = mat3(
        1.0, 0.0, 0.0,
        0.0, cx,  -sx,
        0.0, sx,   cx
    );

    mat3 Ry = mat3(
         cy, 0.0, sy,
        0.0, 1.0, 0.0,
        -sy, 0.0, cy
    );

    mat3 Rz = mat3(
        cz, -sz, 0.0,
        sz,  cz, 0.0,
        0.0, 0.0, 1.0
    );

    return Rz * Ry * Rx;
}

void main() {
    vec2 quadCoord = positions[gl_VertexID] * 0.5 + 0.5;
    vec2 local = (quadCoord - 0.5) * iSize;

    vec3 p = rotationXYZ(iRotate) * vec3(local, 0.0);

    p.xy += iOffset + 0.5 * iSize + uOffset;

    gl_Position = uProjection * vec4(p, 1.0);

    v_texCoord = iUVRect.xy + quadCoord * iUVRect.zw;
    v_color = iColor;
}`
        });

        this.maxBatchSize = batchSize;
    }

    /**
     * Update buffer data and render a sprite container.
     * @param {Container} container Container to render
     * @param {*} x Optional x offset override
     * @param {*} y Optional y offset override
     * @param {*} opacity Optional opacity override
     */
    render(container, x = container.data[0], y = container.data[1], opacity = container.opacity, _skipSetup = false) {
        if(!container || !container.children || container.children.length === 0 || (opacity !== null && opacity <= 0)) return;

        let low = 0, high = 0, atlas = null;

        const gl = this.renderer.gl;

        const buffers    = this.buffers;
        const colorData  = buffers.iColor.data;
        const uvRectData = buffers.iUVRect.data;
        const offsetData = buffers.iOffset.data;
        const sizeData   = buffers.iSize.data;
        const rotateData = buffers.iRotate.data;

        let currentContainer = container, parentI = 0, parent = null, offsetX = 0, offsetY = 0;

        for(let i = 0; i < currentContainer.children.length + (parent ? 1 : 0); i++) {
            if(i >= currentContainer.children.length) {
                offsetX -= currentContainer.data[0];
                offsetY -= currentContainer.data[1];

                currentContainer = parent;
                i = parentI;
                parent = null;
                continue;
            }

            const child = currentContainer.children[i];

            // Enter container
            if(child.isContainer) {
                parent = currentContainer;
                parentI = i;
                currentContainer = child;
                i = -1;

                offsetX += child.data[0];
                offsetY += child.data[1];
                continue;
            }

            if(!child || !child.texture) continue;

            const data       = child.data;
            const mixOpacity = data[9] * data[13];

            if(mixOpacity <= 0) continue;

            const texture   = child.texture;
            const uvRect    = texture.region || [0, 0, texture.imageWidth, texture.imageHeight];
            const glTexture = texture.getGLTexture(gl);

            if(atlas && atlas !== glTexture) {
                this.draw(high, atlas, low, high, opacity, x, y, _skipSetup);
                _skipSetup = true;

                high  = 0;
                atlas = null;
            }

            atlas = glTexture;

            offsetData[high * 2 + 0] = data[0] + offsetX;
            offsetData[high * 2 + 1] = data[1] + offsetY;

            sizeData  [high * 2 + 0] = child.width;
            sizeData  [high * 2 + 1] = child.height;
    
            rotateData[high * 3 + 0] = data[10];
            rotateData[high * 3 + 1] = data[11];
            rotateData[high * 3 + 2] = data[12];
    
            colorData [high * 4 + 0] = data[6];
            colorData [high * 4 + 1] = data[7];
            colorData [high * 4 + 2] = data[8];
            colorData [high * 4 + 3] = mixOpacity;

            uvRectData[high * 4 + 0] = uvRect[0] / texture.imageWidth;
            uvRectData[high * 4 + 1] = uvRect[1] / texture.imageHeight;
            uvRectData[high * 4 + 2] = uvRect[2] / texture.imageWidth;
            uvRectData[high * 4 + 3] = uvRect[3] / texture.imageHeight;

            high++;

            // If we reach the max batch size, draw the current batch and reset for the next one
            if(high > this.maxBatchSize) {
                this.draw(high, atlas, low, high, opacity, x, y, _skipSetup);
                _skipSetup = true;

                high = 0;
                atlas = null;
            }
        }

        if(high > 0) {
            this.draw(high, atlas, low, high, opacity, x, y, _skipSetup);
        }
    }

    draw(count, atlas, low = 0, high = 0, opacity = null, x = null, y = null, _skipSetup = false) {
        if(!atlas || count === 0 || (opacity !== null && opacity <= 0)) return;

        const gl = this.renderer.gl;
        if(!_skipSetup) {
            gl.useProgram(this.program);
            gl.bindVertexArray(this.vao);
        }

        const projectionMatrix = this.renderer.activeCamera.projectionMatrix;
        const uniforms = this.uniforms;
        const buffers = this.buffers;

        // -- Upload changed buffers
        if(high) {
            buffers.iOffset.updateWithStride (low, high);
            buffers.iSize.updateWithStride   (low, high);
            buffers.iColor.updateWithStride  (low, high);
            buffers.iUVRect.updateWithStride (low, high);
            buffers.iRotate.updateWithStride (low, high);
        }

        // -- Atlas texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, atlas);
        gl.uniform1i(uniforms.uTexture, 0);

        // -- Uniforms
        if(x !== null || y !== null) gl.uniform2f(uniforms.uOffset, x || 0, y || 0);
        // if(opacity !== null)         gl.uniform1f(uniforms.uOpacity, opacity);
        gl.uniform1f(uniforms.uOpacity, 1);

        // -- Projection matrix
        gl.uniformMatrix4fv(uniforms.uProjection, false, projectionMatrix);
    
        // -- Draw
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);

        // Todo: sadly, drawArraysInstanced does not support low, meaning the only way would be to rebind the array, which i am yet to test the performance of.
        // This means that we are sadly forced to rebuid nearly every time which limits the optimization potential a lot.
    }

    renderCallback(delta, now, gl, width, height, updatedDimensions, uniforms, attributes, projectionMatrix) {
        // this.render(this.container, true);
    }
}

class DynamicRenderer extends LS.GL.Renderable {
    constructor(lsgli) {
        super();
        this.renderer = lsgli;
    }
}

class Sprite {
    /**
     * @type {Texture}
     */
    texture = null;

    /**
     * @type {number[]} data Packed array of x, y, z, width, height, depth, r, g, b, a, rx, ry, rz, alphaMultiplier, sx, sy, sz
     * its efficient i guess; also could later be linked to subarrays
     */
    data = [0, 0, 0, -1, -1, 1, 255, 255, 255, 255, 0, 0, 0, 1.0, 0, 0, 0];

    /**
     * @typedef SpriteOptions
     * @property {Texture} [texture] The texture object to use for the sprite
     * @property {number[]} [position] The position of the sprite [x, y, z]
     * @property {number[]} [size] The size of the sprite [width, height, depth]
     * @property {number[]} [color] The color of the sprite [r, g, b, a]
     * @property {number[]} [rotation] The rotation of the sprite [rx, ry, rz]
     * @property {number} [opacity] The opacity of the sprite (0.0 - 1.0); Warning; this currently sets the alpha on the color
    */
   
    /**
     * Abstract base sprite class for 2D/3D sprites.
     * In QuickSand, most surfaces/groups/3d objects resolve to sprites which handle their position, how they are then actually rendered is up to individual renderers.
     * This class on it's own is mostly virtual, only holds a single number array & texture reference, which makes it a low-overhead object.
     * 
     * @param {SpriteOptions} options Options for the sprite
     * 
     * @example
     * const mySprite = new Sprite({ texture: new Texture(myAsset), position: [100, 200], size: [50, 50] });
     */
    constructor(options) {
        if(options) this.setOptions(options);
    }

    /**
     * @param {SpriteOptions} options Options to apply to the sprite
     */
    setOptions(options) {
        if(options.texture)               this.texture = options.texture;
        if(options.position)              this.setPosition(options.position);
        if(options.x !== undefined)       this.x = options.x;
        if(options.y !== undefined)       this.y = options.y;
        if(options.z !== undefined)       this.z = options.z;
        if(options.size)                  this.setSize(options.size);
        if(options.color)                 this.setColor(options.color);
        if(options.rotation)              this.setRotation(options.rotation);
        if(options.scale)                 this.setScale(options.scale);
        // if(options.anchor)                this.setAnchor(options.anchor);
        if(options.texture)               this.texture = options.texture;
        if(options.opacity !== undefined) this.opacity = options.opacity;
    }

    get width() {
        return this.data[3] < 0 && this.texture? this.texture.width: this.data[3];
    }

    get height() {
        return this.data[4] < 0 && this.texture? this.texture.height: this.data[4];
    }

    set width(value) {
        this.data[3] = value;
    }

    set height(value) {
        this.data[4] = value;
    }

    get x() {
        return this.data[0];
    }

    set x(value) {
        this.data[0] = value;
    }

    get y() {
        return this.data[1];
    }

    set y(value) {
        this.data[1] = value;
    }

    get z() {
        return this.data[2];
    }

    set z(value) {
        this.data[2] = value;
    }

    get depth() {
        return this.data[5];
    }

    set depth(value) {
        this.data[5] = value;
    }

    get opacity() {
        return this.data[13];
    }

    set opacity(value) {
        this.data[13] = value;
    }

    set rotateX(value) {
        this.data[10] = value;
    }

    get rotateX() {
        return this.data[10];
    }

    set rotateY(value) {
        this.data[11] = value;
    }

    get rotateY() {
        return this.data[11];
    }

    set rotateZ(value) {
        this.data[12] = value;
    }

    get rotateZ() {
        return this.data[12];
    }

    set scaleX(value) {
        this.data[14] = value;
    }

    get scaleX() {
        return this.data[14];
    }

    set scaleY(value) {
        this.data[15] = value;
    }

    get scaleY() {
        return this.data[15];
    }

    set scaleZ(value) {
        this.data[16] = value;
    }

    get scaleZ() {
        return this.data[16];
    }

    setPosition(x, y, z) {
        if(Array.isArray(x)) {
            [x, y, z] = x;
        }

        if(typeof x === "number") this.data[0] = x;
        if(typeof y === "number") this.data[1] = y;
        if(typeof z === "number") this.data[2] = z;
    }

    setSize(width, height, depth) {
        if(Array.isArray(width)) {
            [width, height, depth] = width;
        }

        if(typeof width === "number")  this.data[3] = width;
        if(typeof height === "number") this.data[4] = height;
        if(typeof depth === "number")  this.data[5] = depth;
    }

    setRotation(x, y, z) {
        if(Array.isArray(x)) {
            [x, y, z] = x;
        }

        if(typeof x === "number") this.data[10] = x;
        if(typeof y === "number") this.data[11] = y;
        if(typeof z === "number") this.data[12] = z;
    }

    setScale(x, y, z) {
        if(Array.isArray(x)) {
            [x, y, z] = x;
        }

        if(typeof x === "number") this.data[14] = x;
        if(typeof y === "number") this.data[15] = y;
        if(typeof z === "number") this.data[16] = z;
    }

    setColor(r, g, b, a) {
        if(typeof r === "string") {
            LS.Color.parse(r, null, null, null, this.data, 6);
            return;
        }

        if(r instanceof LS.Color) {
            this.data[6] = r.r;
            this.data[7] = r.g;
            this.data[8] = r.b;
            this.data[9] = r.a;
            return;
        }

        if(Array.isArray(r)) {
            [r, g, b, a] = r;
        }

        this.data[6] = r;
        this.data[7] = g;
        this.data[8] = b;
        this.data[9] = a;
    }

    /**
     * Clones the sprite
     * @returns {Sprite} The cloned sprite
     */
    clone(options = {}) {
        const newSprite = new Sprite();

        for(let i = 0; i < this.data.length; i++) {
            newSprite.data[i] = this.data[i];
        }

        newSprite.texture = this.texture;
        newSprite.setOptions(options);
        return newSprite;
    }

    /**
     * Destroys the sprite
     * @param {boolean} destroyTexture Whether to destroy the texture as well
     */
    destroy(destroyTexture = false) {
        this.data = null;

        if(destroyTexture && this.texture && typeof this.texture.destroy === "function") {
            this.texture.destroy();
        }

        this.texture = null;
    }
}

/**
 * Abstract class for 3D objects, or sprites with geometry support.
 */
class Object3D extends Sprite {
    indices   = new Uint32Array();
    positions = new Float32Array();
    normals   = new Float32Array();
    uvs       = new Float32Array();

    constructor(data, options) {
        super(options);
    }
}

/**
 * Scene isolates resources and lifetime to a specific context to help you clean up separated game segments easier.
 * It is basically an optional container for whatever resources you need to manage; not specifically required to be used.
 * 
 * @example
 * class MyScene extends Scene {
 *     constructor() {
 *         super();
 * 
 *         this.container = new Container([]);
 *         this.addDestroyable(this.container);
 *     }
 * 
 *     renderCallback(delta, now) {
 *         something.render(this.container);
 *     }
 * }
 * 
 * const scene = new MyScene();
 * scene.destroy();
 */
class Scene extends LS.Context {
    constructor(parent) {
        super();

        this.parent = parent;

        parent.once("destroy", () => {
            this.destroy();
        });
    }

    onFrame(callback) {
        this.renderCallback = callback;
        return this;
    }

    enable() {
        this.parent.renderer.addRenderable(this);
        return this;
    }

    disable() {
        this.parent.renderer.removeRenderable(this);
        return this;
    }

    assignResource(...resource) {
        for(const res of resource) {
            this.addDestroyable(res);
        }
        return this;
    }

    renderCallback() {}

    destroy() {
        this.disable();
        this.parent = null;
        super.destroy();
    }
}

/**
 * Abstract container class, or sprite with children support.
 * How it is handled is up to the renderer; not all properties have to be respected.
 */
class Container extends Sprite {
    /**
     * @type {Sprite[]} Children sprites
     */
    children = [];

    isContainer = true;

    /**
     * Create a container
     * @param {Sprite[]} children Children sprites
     * @param {SpriteOptions} options Options
     */
    constructor(children = [], options) {
        super(options);
        if(children) this.children = children;
    }

    /**
     * Replaces the children of the container
     * @param {Sprite[]} newChildren The new children
     */
    replaceChildren(newChildren) {
        this.children = newChildren;
    }

    /**
     * Appends a child to the container
     * @param {Sprite} child The child to append
     */
    appendChild(child) {
        this.children.push(child);
    }

    /**
     * Removes a child from the container
     * @param {Sprite} child The child to remove
     */
    removeChild(child) {
        const index = this.children.indexOf(child);
        if(index !== -1) {
            this.children.splice(index, 1);
        }
    }

    /**
     * Creates a copy of the container
     * @param {Object} options Options for the new container
     * @returns {Container} A new container with the same children
     */
    clone(options = {}) {
        const newContainer = new Container([], options);

        for(const child of this.children) {
            if(child.clone) {
                newContainer.appendChild(child.clone());
            } else {
                newContainer.appendChild(child);
            }
        }

        return newContainer;
    }

    get width() {
        let maxWidth = 0;
        for(const child of this.children) {
            const childRight = child.x + child.width;
            if(childRight > maxWidth) {
                maxWidth = childRight;
            }
        }
        return maxWidth;
    }

    get height() {
        let maxHeight = 0;
        for(const child of this.children) {
            const childBottom = child.y + child.height;
            if(childBottom > maxHeight) {
                maxHeight = childBottom;
            }
        }
        return maxHeight;
    }

    /**
     * Destroys the container
     * @param {boolean} children Whether to destroy the children as well
     */
    destroy(children = true) {
        if(children) {
            for(const child of this.children) {
                if(child.destroy) child.destroy();
            }
        }

        super.destroy();
        this.children = null;
    }
}

/**
 * LayoutContainer is just like a Container, but supports processing automatic layout.
 */
class LayoutContainer extends Container {
    constructor(children = [], options, layoutOptions = {}) {
        super(children, options);
        this.layoutOptions = layoutOptions;
        this.layout();
    }

    /**
     * Layout the children of the container
     * @param {Object} layoutOptions Options for the layout (e.g., spacing, padding)
     */
    layout() {
        let x = this.x, y = this.y;

        const layoutOptions = this.layoutOptions;
        const len = this.children.length;

        for(let i = 0; i < len; i++) {
            const child = this.children[i];

            child.x = x;
            child.y = y;

            if(layoutOptions.direction === "horizontal") {
                x += child.width  + (i == len - 1? 0: (layoutOptions.gap || 0));
            } else {
                y += child.height + (i == len - 1? 0: (layoutOptions.gap || 0));
            }
        }
    }

    appendChild(child) {
        super.appendChild(child);
        this.layout();
    }

    removeChild(child) {
        super.removeChild(child);
        this.layout();
    }

    replaceChildren(newChildren) {
        super.replaceChildren(newChildren);
        this.layout();
    }

    destroy() {
        super.destroy();
        this.layoutOptions = null;
    }
}

window.QuickSand = {
    GameRuntime,
    AssetLoader,
    InputHandler,
    StorageManager,
    BatchedSpriteRenderer,
    Texture,
    TextureAtlas,
    Sound,
    Sprite,
    Object3D,
    Container,
    LayoutContainer,
    Scene
};

export { GameRuntime, Scene, AssetLoader, InputHandler, StorageManager, BatchedSpriteRenderer, Texture, TextureAtlas, Sound, Sprite, Object3D, Container, LayoutContainer };