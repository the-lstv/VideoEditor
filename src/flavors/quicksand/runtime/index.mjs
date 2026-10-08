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
 * It is designed to efficiently work for both 2D and 3D graphics.
 * 
 * You can use the QuickSand editor to create games with a visual editor, or you can use the QuickSand runtime to create games programmatically.
 * 
 * 
 * 
 * What QuickSand currently supports:
 * - 2D sprites
 * - 3D meshes (in progress)
 * - Custom shaders
 * - Audio file playback (for sfx and music) via SoundBox
 * - Input handling (keyboard, mouse, controller/gamepad)
 * - Asset management (images, audio, etc.)
 * - Basic storage management for persistent data
 * - Static text (via Canvas2D to texture)
 * - Dynamic text rendering via LS.GL.WebGLTextEngine (MSDF, MTSDF, SDF, or Softmask)
 * 
 * When to use dynamic vs static text rendering:
 * - Use static text rendering for text that doesn't change often and doesn't scale (eg. UI labels), as it is more efficient (generated once, then rendered as any other standard texture). Bonus: You can generate a text texture atlas with multiple text entries easily with TextureAtlas.fromTextList({ key: "value" }) to reduce the amount of texture switches. The QuickSand builder can also pre-generate text textures to save time at runtime. Downside: Uses more memory the more text you render, doesn't support per-character styling, and text can't be updated or resized after rendering.
 * - Use dynamic text rendering for text that changes frequently or needs special effects. Individual characters can be changed, colored or moved independently each frame. Additionally, with font formats like MTSDF, you can scale the text without losing quality and keeping anti-aliasing, of course at some performance cost. Downside is that it requires converting your font to a special format first.
 * QuickSand's dynamic text rendering is designed to be very efficient and performant and is designed for large amounts of text, but static text rendering is still more efficient for text that doesn't change.
 * 
 * Note: QuickSand is a low-level engine, and as such it assumes you have an understanding of how graphics rendering works and how to use it effectively, for which it provides more advanced features and control.
 * If you aren't familiar with graphics programming, it is recommended to use the QuickSand editor to create your game visually.
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

class GameRuntime extends LS.Context {
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

    // --- Utilities

    animate(target, keyframes, options = {}) {
        return LS.Animation2.animate(target, keyframes, options);
    }

    animationTimeline(animations, options = {}) {
        return new LS.Animation2.Timeline(animations, options);
    }

    createScene() {
        return new Scene(this);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Very comprehensive utility for typing out text into a text block with a delay between each character & callback for dynamic changes.
     * 
     * @param {LS.GL.WebGLTextEngine.Text} textBlock - The text block to type into.
     * @param {string|number|Array<number|string>|Uint8Array|Uint16Array|Uint32Array} text - Text to type (can be as an array of codes), or the number of characters to type if you provide your own via the callback. If a character is 0 (NULL), it will stop.
     * @param {Object} options - The options for the typing animation.
     * @param {number} [options.x=0] - The starting x position for the text.
     * @param {number} [options.y=0] - The starting y position for the text.
     * @param {number} [options.index=0] - The starting index in the text block to type into.
     * @param {number} [options.maxIndex=textBlock.size] - The maximum index in the text block to type into.
     * @param {number} [options.maxWidth=this.renderer.width] - The maximum width for the text before wrapping to the next line.
     * @param {number} [options.delay=50] - The delay in milliseconds between each character.
     * @param {function} [options.callback] - A callback function that is called for each character typed. It receives the character code, index, x, y, delay, and i as arguments and can return an object to modify the typing behavior.
     * @param {Array} [options.color=[255, 255, 255, 255]] - The color of the text in RGBA 0-255 format.
     * @param {number} [options.size=null] - The size of the text.
     * @param {string} [options.style=null] - The style enum of the text.
     * @param {string} [options.weight=null] - The weight of the text.
     * @param {boolean} [options.culling=true] - Whether to stop rendering characters that are outside the visible area.
     * @param {number} [options.lineHeight=1.2] - The line height multiplier for the text.
     * @param {AbortSignal} [options.signal=null] - An abort signal
     * @returns {Promise}
     * 
     * @example
     * await this.typeText(textBlock, "Hello, world!");
     * 
     * @example
     * await this.typeText(textBlock, "Hello, world!", { x: 10, y: 10, delay: 100, color: [255, 0, 0, 255], callback(code, index, x, y, delay) {
     *     if(code === 32) { // Space character
     *         return { delay: 200 };
     *     }
     * } });
     * 
     * @example
     * // You can also capture the character information for later changes or animation.
     * 
     * const chars = [];
     * this.typeText(text, "Hello world!", { x: 50, y: 50, size: 45, callback(code, index, x, y, delay, i) {
     *     if(i >= 6) chars.push({ index, x, y, code, color: new LS.Color("#f00").hueShift(chars.length * 30) });
     * } });
     * 
     * // The below example draws a gradient animation + shaking on the "world!" part of the text.
     * function animate(chars) {
     *     // Note: updateChar requires x, y, charCode and size to be all specified due to statelessness of the text engine (since it needs them to update eachother but doesn't store them)
     *     for(const char of chars) {
     *         text.updateChar(char.index, {
     *             x: char.x + Math.floor(Math.random() * 2 - 1),
     *             y: char.y + Math.floor(Math.random() * 2 - 1),
     *             charCode: char.code,
     *             color: char.color,
     *             size: 45,
     *         });
     *
     *         char.color.hueShift(1);
     *     }
     * }
     * 
     * @example
     * // If you want to type out a specific number of characters, you can provide a number, and use the callback to provide the character codes:
     * const myText = "Hello World!\u0000";
     * await this.typeText(textBlock, -1, { callback(code, index, x, y, delay, i) {
     *     return { code: myText.charCodeAt(i) };
     * } });
     */
    async typeText(textBlock, text, options = {}) {
        let { x: ix, y: iy, index, maxIndex, maxWidth, delay, callback, color, size, style, weight, culling, signal, lineHeight } = options;

        index      ??= 0;
        ix         ??= 0;
        iy         ??= 0;
        maxWidth   ??= this.renderer.width;
        delay      ??= 50;
        lineHeight ??= textBlock.engine?.lineHeight || 1.2;

        color    ??= [255, 255, 255, 255];
        size     ??= textBlock.engine?.defaultFontSize || 16;
        style    ??= null;
        weight   ??= null;

        // Disable culling if you scroll or transform text
        culling  ??= true;
        signal   ??= null;

        const textIsText   = typeof text !== "number";
        const textIsString = textIsText && typeof text === "string";

        maxIndex ??= textIsText? Math.min(text.length + index, textBlock.size - index): textBlock.size - index;

        let x = ix, y = iy;
        for(let i = 0; text === -1? true: (i < (textIsText? text.length: text)); i++) {
            let code = textIsString? text.charCodeAt(i): textIsText? text[i]: 0;

            if(callback) {
                const result = callback(code, i + index, x, y, delay, i);
                if(result === false) {
                    break;
                } else if(typeof result === "object") {
                    if(result.skip) continue;
                    if(result.x          !== undefined) x          = result.x;
                    if(result.y          !== undefined) y          = result.y;
                    if(result.delay      !== undefined) delay      = result.delay;
                    if(result.index      !== undefined) index      = result.index;
                    if(result.callback   !== undefined) callback   = result.callback;
                    if(result.color      !== undefined) color      = result.color;
                    if(result.size       !== undefined) size       = result.size;
                    if(result.style      !== undefined) style      = result.style;
                    if(result.weight     !== undefined) weight     = result.weight;
                    if(result.lineHeight !== undefined) lineHeight = result.lineHeight;
                    if(result.code       !== undefined) code       = result.code;
                }
            }

            if(code === 0 || i + index >= maxIndex || (culling && y > this.renderer.height) || (signal && signal.aborted)) {
                break;
            }

            x += textBlock.setChar(i + index, x, y, code, color[0], color[1], color[2], color[3], size, style, weight);

            if(delay > 0) {
                await this.sleep(delay);
            }

            if(code === 10 || x >= maxWidth - ix) {
                x = ix;
                y += size * lineHeight;
            }
        }
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

        // document.body.appendChild(canvas);

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
 * Draws 2D sprites with batching, reducing the number of draw calls when possible. Possible to switch sprite shaders.
 * For best performance, put sprites that share the same texture next to eachother, as every texture switch causes a new draw call and removes the possibilty of reusing buffers.
 * 
 * It is also recommended to reuse the BatchedSpriteRenderer instance when you can, as it is relatively expensive.
 * 
 * Supported sprite properties: x, y, w, h, texture and region, color/transparency and xyz rotation
 * 
 * Doesn't render 3D objects
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
     * // But will only work if you don't have multiple textures in the batch.
     */
    constructor(lsgli, { frag = null, vert = null, uniforms = null, attributes = null, binds = null, batchSize = 512 } = {}) {
        super({
            version: 0,

            parent: lsgli,

            uniforms:   ["uProjection", "uOffset", "uTexture", "uOpacity",   ...(uniforms || [])  ],
            attributes: ["iSize", "iUVRect", "iColor", "iMatrix", ...(attributes || [])],
 
            vao: true,
            bind: {
                iMatrix:  { type: "mat4", size: batchSize },
                iSize:    { cellSize: 2,  type: "float", size: batchSize },
                iColor:   { cellSize: 4,  type: "ubyte", size: batchSize, normalized: true },
                iUVRect:  { cellSize: 4,  type: "float", size: batchSize },
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
}`,
            vert: vert || `#version 300 es

${LS.GL.utils.quad}

in vec4 iUVRect;
in vec4 iColor;
in vec2 iSize;
in mat4 iMatrix;

uniform mat4 uProjection;
uniform vec2 uOffset;

out  vec2 v_texCoord;
out  vec4 v_color;

void main() {
    vec2 quadCoord = positions[gl_VertexID] * 0.5 + 0.5;
    vec3 p = vec3((quadCoord - 0.5) * iSize, 0.0);

    p.xy += 0.5 * iSize + uOffset;

    gl_Position = uProjection * iMatrix * vec4(p, 1.0);

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
        const sizeData   = buffers.iSize.data;
        const matrixData = buffers.iMatrix.data;

        let currentContainer = container, parentI = 0, parent = null;
        let offsetX = 0, offsetY = 0, rotationX = 0, rotationY = 0, rotationZ = 0;

        for(let i = 0; i < currentContainer.children.length + (parent ? 1 : 0); i++) {
            if(i >= currentContainer.children.length) {
                offsetX -= currentContainer.data[0];
                offsetY -= currentContainer.data[1];
                rotationX -= currentContainer.data[10];
                rotationY -= currentContainer.data[11];
                rotationZ -= currentContainer.data[12];

                currentContainer = parent;
                i = parentI;
                parent = null;
                continue;
            }

            const child = currentContainer.children[i];
            if(!child || !child.visible) continue;

            // Enter container
            if(child.isContainer) {
                if(child.children.length === 0 || child.opacity <= 0) continue;

                parent = currentContainer;
                parentI = i;
                currentContainer = child;
                i = -1;

                offsetX += child.data[0];
                offsetY += child.data[1];
                rotationX += child.data[10];
                rotationY += child.data[11];
                rotationZ += child.data[12];
                continue;
            }

            if(!child.texture) continue;

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

            // offsetData[high * 2 + 0] = data[0]  + offsetX;
            // offsetData[high * 2 + 1] = data[1]  + offsetY;
    
            // rotateData[high * 3 + 0] = data[10] + rotationX;
            // rotateData[high * 3 + 1] = data[11] + rotationY;
            // rotateData[high * 3 + 2] = data[12] + rotationZ;

            sizeData  [high * 2 + 0] = child.width;
            sizeData  [high * 2 + 1] = child.height;
    
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
            buffers.iMatrix.updateWithStride (low, high);
            buffers.iSize.updateWithStride   (low, high);
            buffers.iColor.updateWithStride  (low, high);
            buffers.iUVRect.updateWithStride (low, high);
        }

        // -- Atlas texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, atlas);
        gl.uniform1i(uniforms.uTexture, 0);

        // -- Uniforms
        if(x !== null || y !== null) gl.uniform2f(uniforms.uOffset, x || 0, y || 0);
        gl.uniform1f(uniforms.uOpacity, 1);

        // -- Projection matrix
        gl.uniformMatrix4fv(uniforms.uProjection, false, projectionMatrix);
    
        // -- Draw
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);

        // Todo: sadly, drawArraysInstanced does not support low, meaning the only way would be to rebind the array, which i am yet to test the performance of.
        // This means that we are sadly forced to rebuid nearly every time which limits the optimization potential a lot.
    }
}

/**
 * Renderer capable of rendering 3D objects.
 */
class Renderer3D extends LS.GL.Renderable {
    constructor(lsgli, { frag = null, vert = null, uniforms = null, attributes = null, binds = null, batchSize = 2048 } = {}) {
        super({
            version: 0,

            parent: lsgli,

            uniforms:   ["uProjection", "uOffset", "uTexture", "uOpacity",   ...(uniforms || [])  ],
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
    }

    render(container, x = container.data[0], y = container.data[1], opacity = container.opacity, _skipSetup = false) {
        if(!container || !container.children || container.children.length === 0 || (opacity !== null && opacity <= 0)) return;
        

    }

    draw() {

    }
}

class Sprite {
    /**
     * @type {Texture}
     */
    texture = null;

    /**
     * @type {number[]} data Packed array of x, y, z, width, height, depth, r, g, b, a, rx, ry, rz, alphaMultiplier, sx, sy, sz, visible
     * its efficient i guess; also could later be linked to subarrays
     */
    data = [0, 0, 0, -1, -1, 1, 255, 255, 255, 255, 0, 0, 0, 1.0, 0, 0, 0, 1];

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
        if(options.visible !== undefined) this.visible = options.visible? 1: 0;
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

    set visible(value) {
        this.data[17] = value? 1: 0;
    }

    get visible() {
        return this.data[17] === 1;
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

        if(typeof width  === "number") this.data[3] = width;
        if(typeof height === "number") this.data[4] = height;
        if(typeof depth  === "number") this.data[5] = depth;
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
 * It is just like a regular sprite but holds geometry data.
 */
class Mesh extends Sprite {
    /**
     * Positions of vectors in 3D space.
     * These are more of an indexed collection for reuse
     * 
     * Eg.
     * (0, 0, 0), (10, 10, 0), (0, 10, 0)
     */
    positions = new Float32Array();

    /**
     * Makes triangles out of positions.
     * It is a list of indices that define the triangles in the geometry.
     * Not sure why this is separated but it is how it is
     * 
     * Eg.
     * (0, 1, 2)
     */
    indices   = new Uint16Array();

    /**
     * Normals are used for lighting calculations, and are usually perpendicular to the surface of the geometry.
     */
    normals   = new Float32Array();

    /**
     * UVs define how a texture maps to geometry, simillarly to a 2D texture region.
     */
    uvs       = new Float32Array();

    /**
     * Creates a new Mesh instance.
     * @param {Array} data - The data for the object.
     * @param {Object} options - The options for the object.
     */
    constructor(data, options) {
        super(options);
    }
}

function op(a, b, op) {
    switch(op) {
        case op.add: return a + b;
        case op.sub: return a - b;
        case op.mul: return a * b;
        case op.div: return a / b;
        default: throw new Error("Invalid operation");
    }
}

op.add = 0;
op.sub = 1;
op.mul = 2;
op.div = 3;

class MeshBuilder {
    /**
     * A builder for programmatically creating Mesh instances.
     * This should likely not be used in bulids
     * 
     * @example
     * // The following makes a 1x1 cube
     * const builder = new MeshBuilder().box(0, 0, 0, 1, 1, 1);
     * 
     * // Convert to a 3D object
     * const myObject = builder.toObject();
     * 
     * builder.reset();
     * // you can build another object after that
     * builder.destroy();
     */
    constructor() {
        this.cursor    = new Vector(0, 0, 0);
        this.triangles = [];
        this.normals   = [];
        this.uvs       = [];
    }

    beginRecording (name) { return this }
    endRecording   (name) { return this }
    paste          (name) { return this }

    move    (x, y, z) { this.cursor.set(x, y, z); return this }
    vto     (x, y, z) { return this }

    triangle(x1, y1, z1, x2, y2, z2, x3 = this.cursor.x, y3 = this.cursor.y, z3 = this.cursor.z) {
        this.triangles.push([x1, y1, z1, x2, y2, z2, x3, y3, z3]);
        return this;
    }

    plane(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4) {
        this.triangle(x1, y1, z1, x2, y2, z2, x3, y3, z3);
        this.triangle(x3, y3, z3, x4, y4, z4, x1, y1, z1);
        return this;
    }

    planeTo(x, y, z) {
        const x1 = this.cursor.x, y1 = this.cursor.y, z1 = this.cursor.z;
        this.plane(x1, y1, z1, x, y1, z1, x, y, z, x1, y, z);
        return this;
    }

    box(x, y, z, width, height, depth) {
        const x1 = x, y1 = y, z1 = z;
        const x2 = x + width, y2 = y + height, z2 = z + depth;

        // Bottom
        this.plane(x1, y1, z1, x2, y1, z1, x2, y2, z1, x1, y2, z1);
        // Top
        this.plane(x1, y1, z2, x2, y1, z2, x2, y2, z2, x1, y2, z2);
        // Left
        this.plane(x1, y1, z1, x1, y1, z2, x1, y2, z2, x1, y2, z1);
        // Right
        this.plane(x2, y1, z1, x2, y1, z2, x2, y2, z2, x2, y2, z1);
        // Front
        this.plane(x1, y1, z1, x2, y1, z1, x2, y1, z2, x1, y1, z2);
        // Back
        this.plane(x1, y2, z1, x2, y2, z1, x2, y2, z2, x1, y2, z2);

        return this;
    }

    toObject() {
        const positions = [];
        const indices   = [];

        // Yes this is very slow
        for(const triangle of this.triangles) {
            for(const vertex of triangle) {
                const index = positions.indexOf(vertex);
                if(index === -1) {
                    positions.push(vertex);
                    indices.push(positions.length - 1);
                } else {
                    indices.push(index);
                }
            }
        }

        const obj = new Mesh();
        obj.indices   = new Uint16Array (indices);
        obj.positions = new Float32Array(positions);
        obj.normals   = new Float32Array(this.normals);
        obj.uvs       = new Float32Array(this.uvs);
        return obj;
    }

    reset() {
        this.cursor.set(0, 0, 0);
        this.positions.reset();
        this.normals.length = 0;
        this.uvs.length     = 0;
        return this;
    }

    destroy() {
        this.cursor    = null;
        this.positions = null;
        this.normals   = null;
        this.uvs       = null;
    }
}

/**
 * Dynamic vector with arbitrary size and offset, backed by either Array or any TypedArray.
 * Note that this is heavier than a normal { x, y, z } object but allows more efficient browsing of vector arrays.
 */
class Vector {
    data = [0, 0, 0];
    size = 3;
    offset = 0;

    /**
     * Creates a new Vector instance. Number of arguments matters; it can be a 2D vector, 3D vector, etc.
     * @param {number|Array|TypedArray} x x or data - Data array
     * @param {number} y y or offset - Offset into the data array
     * @param {number} z z or size - Size of the vector
     * 
     * @example
     * new Vector(1, 2, 3); // x=1, y=2, z=3
     * 
     * @example
     * new Vector(1, 2); // x=1, y=2
     * 
     * @example
     * new Vector([1, 2, 3, 4, 5], 1, 3); // data=[1, 2, 3, 4, 5], offset=1, size=3 (y=2, z=3, w=4)
     * 
     * @example
     * new Vector(object.positions, 0, 3); // View into the positions array of an Mesh
     */
    constructor(x = 0, y = 0, z = 0) {
        if(Array.isArray(x)) {
            this.data = x;
            this.offset = y;
            this.size = z || 3;
        } else {
            this.size = arguments.length || 3;
            this.data = new Array(this.size);

            for(let i = 0; i < this.size; i++) {
                this.data[i] = arguments[i] || 0;
            }
        }
    }

    get x() { return this.data[this.offset + 0] }
    get y() { return this.data[this.offset + 1] }
    get z() { return this.data[this.offset + 2] }
    get w() { return this.data[this.offset + 2] }
    get h() { return this.data[this.offset + 3] }
    set x(value) { this.data[this.offset + 0] = value }
    set y(value) { this.data[this.offset + 1] = value }
    set z(value) { this.data[this.offset + 2] = value }
    set w(value) { this.data[this.offset + 2] = value }
    set h(value) { this.data[this.offset + 3] = value }

    set(x, y, z) {
        if(x !== undefined) this.data[this.offset + 0] = x;
        if(y !== undefined) this.data[this.offset + 1] = y;
        if(z !== undefined) this.data[this.offset + 2] = z;
    }

    /**
     * Returns an iterator for the vector's components.
     * @returns {Iterator} An iterator for the vector's components.
     */
    *iterator() {
        for(let i = 0; i < this.size; i++) {
            yield this.data[this.offset + i];
        }
    }

    [Symbol.iterator]() {
        return this.iterator();
    }

    toArray() {
        return this.data.slice(this.offset, this.offset + this.size);
    }

    /**
     * Perform an operation on the vector with either a scalar or another vector.
     * @param {number|Vector} scalarOrVector The scalar or vector to operate with.
     * @param {number} operation The operation to perform (0: add, 1: sub, 2: mul, 3: div).
     * @returns {Vector} The modified vector.
     */
    op(scalarOrVector, operation = op.add) {
        const offset = this.offset;
        const data   = this.data;

        if(scalarOrVector instanceof Vector) {
            for(let i = 0; i < this.size; i++) {
                const index = offset + i;
                data[index] = op(data[index], scalarOrVector.data[scalarOrVector.offset + i], operation);
            }
            return this;
        }

        for(let i = 0; i < this.size; i++) {
            const index = offset + i;
            data[index] = op(data[index], scalarOrVector, operation);
        }
        return this;
    }

    add(scalarOrVector) {
        return this.op(scalarOrVector, op.add);
    }

    sub(scalarOrVector) {
        return this.op(scalarOrVector, op.sub);
    }

    mul(scalarOrVector) {
        return this.op(scalarOrVector, op.mul);
    }

    div(scalarOrVector) {
        return this.op(scalarOrVector, op.div);
    }

    static fromSize(size) {
        return new Vector(Array(size).fill(0), 0, size);
    }

    clone() {
        const newVector = new Vector(Array(this.size), 0, this.size);

        for(let i = 0; i < this.size; i++) {
            newVector.data[i] = this.data[this.offset + i];
        }

        return newVector;
    }

    compare(otherVector) {
        if(this.size !== otherVector.size) return false;

        for(let i = 0; i < this.size; i++) {
            if(this.data[this.offset + i] !== otherVector.data[otherVector.offset + i]) {
                return false;
            }
        }

        return true;
    }

    /**
     * Return vector as a string if you must (it's slow)
     */
    id()  { return this.data.slice(this.offset, this.offset + this.size).join(",") }


    /**
     * Generate a hash for the vector
     * Faster than id()
     */
    hash() {
        let h = 0;
        for (let i = 0; i < this.size; i++) {
            const n = this.data[this.offset + i] || 0;
            h = Math.imul(h ^ n, 0x45d9f3b);
            h ^= h >>> 16;
        }
        return h >>> 0;
    }

    /**
     * Return vector as a string "x,y,z"
     * Faster than id()
     */
    id3() { return `${this.data[this.offset + 0]},${this.data[this.offset + 1]},${this.data[this.offset + 2]}` }
}

class VectorView extends Vector {
    constructor(data, offset, size) {
        super(data, offset, size);
    }

    get index() {
        return this.offset / this.size;
    }

    at(index = 0) {
        const offset = this.size * index;
        if(offset + this.size > this.data.length) throw new Error("Index out of bounds");
        this.offset = offset;
        return this;
    }

    consolidate() {
        const newData = [];

        const hashes = new Set();

        for(let i = 0; i < this.data.length / this.size; i++) {
            this.at(i);
            const hash = this.hash();

            if(hashes.has(hash)) {
                // Skip duplicates
                continue;
            }

            hashes.add(hash);
            newData.push(...this);
        }

        this.data = newData;
        this.offset = 0;
        return this;
    }

    reset() {
        this.data.length = 0;
        this.offset = 0;
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
        this.recompute();
    }

    /**
     * Layout the children of the container
     * @param {Object} layoutOptions Options for the layout (e.g., spacing, padding)
     */
    recompute() {
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
        this.recompute();
    }

    removeChild(child) {
        super.removeChild(child);
        this.recompute();
    }

    replaceChildren(newChildren) {
        super.replaceChildren(newChildren);
        this.recompute();
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
    Mesh,
    Container,
    LayoutContainer,
    Scene
};

export { GameRuntime, Scene, AssetLoader, InputHandler, StorageManager, BatchedSpriteRenderer, Renderer3D, Texture, TextureAtlas, Sound, Sprite, Mesh, Container, LayoutContainer };