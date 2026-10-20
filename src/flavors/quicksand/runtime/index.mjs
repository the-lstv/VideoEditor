/**
 * QuickSand Game Engine runtime for JS
 * @see https://github.com/thelstv/editor
 * @see https://github.com/thelstv/ls
 * 
 * Copyright (c) 2026 lstv.space. All rights reserved.
 */

/// <reference path="/www/ls/dist/ls.d.ts" />

// import LS from "/www/ls/dist/ls.mjs";

/**
 * QuickSand is a lightweight, low-level, dynamic game engine for JavaScript designed for
 * creating highly performant games with an intuitive API and GUI.
 * 
 * It is designed to efficiently work for both 2D and 3D graphics.
 * 
 * You can use the QuickSand editor to create games with a visual editor, or you can use the QuickSand runtime to create games programmatically.
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
 * - Dynamic text rendering via LSGL.WebGLTextEngine (MSDF, MTSDF, SDF, or Softmask)
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
 * Basic input handler for web browsers (keyboard, mouse, controller/gamepad).
 * For more advanced input handling or gestures, consider using LS.Util.TouchHandle
 */
class InputHandler extends LS.EventEmitter {
    keyboard = {};
    mouse = [0, 0, false, false, false, false, false, false];
    controller = null;

    enabled = false;

    /**
     * @param {Engine} parent - The engine instance that this input handler is associated with.
     */
    constructor(parent) {
        super();
        this.parent  = parent;

        // i need to think of a better system at some point
        this.keyMap = {};

        Object.defineProperties(this.mouse, {
            x:       { get: () => this.mouse[0] },
            y:       { get: () => this.mouse[1] },
            left:    { get: () => this.mouse[2] },
            middle:  { get: () => this.mouse[3] },
            right:   { get: () => this.mouse[4] },
            back:    { get: () => this.mouse[5] },
            forward: { get: () => this.mouse[6] }
        });
    }

    intersects(x, y, width, height) {
        return x < this.mouse[0] && this.mouse[0] < x + width && y < this.mouse[1] && this.mouse[1] < y + height;
    }

    distanceTo(x, y) {
        const dx = this.mouse[0] - x;
        const dy = this.mouse[1] - y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    map(key, action) {
        this.keyMap[key] = action;
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

        // Letterbox/pillarbox offset inside the DOM rect
        const offsetX = (rect.width  - renderedWidth)  * 0.5;
        const offsetY = (rect.height - renderedHeight) * 0.5;

        // Fit canvas coordinates
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
            this.keyboard[e.code] = true;
            this.quickEmit("keydown", e.code);

            const action = this.keyMap[e.code];
            if(action) {
                this.quickEmit(action, e.code);
            }
        }, options);
        
        target.addEventListener("keyup", (e) => {
            this.keyboard[e.code] = false;
            this.quickEmit("keyup", e.code);

            const action = this.keyMap[e.code];
            if(action) {
                this.quickEmit(action + ":up", e.code);
            }
        }, options);

        target.addEventListener("pointermove", (e) => {
            this.transformCoordinates(e.clientX, e.clientY, this.mouse);
            this.quickEmit("pointermove", this.mouse);
        }, { signal: this.signal.signal, passive: true, });

        target.addEventListener("pointerdown", (e) => {
            this.mouse[e.button + 2] = true;
            this.quickEmit("pointerdown", e.button, this.mouse);
        }, options);

        target.addEventListener("contextmenu", (e) => {
            e.preventDefault();
        }, options);

        target.addEventListener("pointerup", (e) => {
            this.mouse[e.button + 2] = false;
            this.quickEmit("pointerup", e.button, this.mouse);
        }, options);

        target.addEventListener("click", (e) => {
            this.quickEmit("click", e.button, this.mouse);
        }, options);

        // --- Gamepad support (work in progress)

        target.addEventListener("gamepadconnected", (e) => {
            this.controller = e.gamepad;
            this.quickEmit("gamepadconnected", e.gamepad);
        }, options);

        target.addEventListener("gamepaddisconnected", (e) => {
            this.controller = null;
            this.quickEmit("gamepaddisconnected", e.gamepad);
        }, options);

        const gamepadHandler = (e) => {
            const gamepads = navigator.getGamepads();
            if(!gamepads) return;

            for(const gamepad of gamepads) {
                if(!gamepad) continue;
                this.controller = gamepad;
            }
        };
    }

    disable(clearState = true) {
        if(this.signal) {
            this.signal.abort();
            this.signal = null;
        }

        if(clearState) {
            for(const key of Object.keys(this.keyboard)) {
                this.keyboard[key] = false;
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
     * @type {InstanceType<typeof LS.GL.AssetLoader>}
     */
    assets = null;

    /**
     * @type {InstanceType<typeof LS.GL.WebGLRenderer>}
     */
    renderer = null;

    /**
     * @type {InstanceType<typeof LS.SoundBox>}
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

        const options = this.options;
        options.assets ??= {};

        const directory = options.assetDirectory || "./";

        if(typeof options.renderer === "string") {
            if(options.renderer === "LS.GL.WebGLRenderer") {
                options.renderer = LSGL.WebGLRenderer;
            } else {
                throw new Error("Unknown or unsupported renderer type: " + options.renderer);
            }
        }

        if(!this.renderer) {
            this.renderer = typeof options.renderer === "function" ? new options.renderer(options.rendererOptions) : options.renderer || new LSGL.WebGLRenderer(options.rendererOptions);
            // delete options.renderer;
            // delete options.rendererOptions;
    
            this.renderer.options.preRender = this.frameCallback.bind(this);
        } else if(options.rendererOptions) {
            // TODO: reset
            this.renderer.setOptions(options.rendererOptions);
        }

        const soundbox = options.soundbox;
        if(soundbox) {
            this.soundbox = (soundbox instanceof LS.SoundBox)? soundbox: new LS.SoundBox(typeof soundbox === "object"? soundbox: options.soundboxOptions || {}, null, options.nameScope || null, directory);
            // delete options.soundbox;
        }
        // delete options.soundbox;

        this.assets = new LSGL.AssetLoader(options.assets, null, options.nameScope || null, directory);
        // delete options.assets;
        // delete options.nameScope;

        if(options.input) {
            this.input.map(options.input);
            // delete options.input;
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

    frameCallback(delta, now) { }

    requestFrame() {
        this.renderer.render();
    }

    // --- Utilities

    /** @type {typeof LS.Animation2.animate} */
    animate(target, keyframes, options = {}) {
        return LS.Animation2.animate(target, keyframes, options);
    }

    animationTimeline(animations, options = {}) {
        return new LS.Animation2.Timeline(animations, options);
    }

    createScene(options = {}) {
        return new LSGL.Scene(this, options);
    }

    sleep(ms, signal = null) {
        return new Promise((resolve) => {
            let timeout;
            if (signal) {
                if (signal.aborted) {
                    resolve();
                    return;
                }

                signal.addEventListener('abort', () => {
                    clearTimeout(timeout);
                    resolve();
                }, { once: true });

                if(ms < 0) {
                    return;
                }
            }

            timeout = setTimeout(resolve, ms);
        });
    }

    /**
     * A very comprehensive utility for typing out text into a text block with a delay between each character & callback for dynamic changes.
     * 
     * @param {typeof LS.GL.WebGLTextEngine.TextBlock} textBlock - The text block to type into.
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
     * @param {AbortSignal} [options.skipSignal=null] - An abort signal that skips the typing animation and immediately types the rest of the text.
     * @param {boolean} [options.hang=false] - Whether to hang the typing animation indefinitely after finishing.
     * @param {Array<Object>} [options.animation=null] - Optional array of keyframes for animating each character after it is typed. Supported properties are x, y, r, g, b, a, size, style, weight, ox (offset x), oy (offset y).
     * @param {Object} [options.animationOptions={}] - Options for the animation, such as duration and easing.
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
        let { x: ix, y: iy, index, clear, maxIndex, maxWidth, delay, callback, color, size, style, weight, culling, signal, skipSignal, hang, lineHeight, animation, animationOptions } = options;

        index      ??= 0;
        ix         ??= 0;
        iy         ??= 0;
        maxWidth   ??= this.renderer.width;
        delay      ??= 35;
        lineHeight ??= textBlock.engine?.lineHeight || 1.2;

        color    = LS.Color.parse(color ?? [255, 255, 255, 255]);
        size     ??= textBlock.engine?.defaultFontSize || 16;
        style    ??= null;
        weight   ??= null;


        // Disable culling if you scroll or transform text
        culling    ??= true;
        signal     ??= null;
        skipSignal ??= null;
        hang       ??= false;
        clear      ??= true;

        animation ??= null;
        animationOptions ??= {};

        if(clear) {
            textBlock.clear();
        }

        const textIsText   = typeof text !== "number";
        const textIsString = textIsText && typeof text === "string";

        maxIndex ??= textIsText? Math.min(text.length + index, textBlock.size - index): textBlock.size - index;

        let state = 0, arg = "", namedGroup = "", command = 0; // 0 = normal, 1 = waiting for argument
        let x = ix, y = iy;

        for(let i = 0; text === -1? true: (i < (textIsText? text.length: text)); i++) {
            let code = textIsString? text.charCodeAt(i): textIsText? text[i]: 0;

            if(state === 1) {
                if(code === 59) { // 59 = ;
                    state = 0;

                    switch(command) {
                        case 119: // Wait (w)
                            const waitTime = parseInt(arg);
                            if(!isNaN(waitTime) && waitTime > 0) await this.sleep(waitTime, skipSignal);
                            break;
                        case 100: // Delay (d)
                            const delayTime = parseInt(arg);
                            if(!isNaN(delayTime) && delayTime >= 0) delay = delayTime;
                            break;
                        case 99: // Color (c)
                            color = LS.Color.parse(arg);
                            break;
                        case 115: // Size (s)
                            const sizeValue = parseFloat(arg);
                            if(!isNaN(sizeValue) && sizeValue > 0) size = sizeValue;
                            break;
                        case 120: // X position (x)
                            const xValue = parseFloat(arg);
                            if(!isNaN(xValue)) x = xValue;
                            break;
                        case 121: // Y position (y)
                            const yValue = parseFloat(arg);
                            if(!isNaN(yValue)) y = yValue;
                            break;
                        case 103: // Group (g)
                            namedGroup = arg;
                            break;
                        case 114: // Reset (r)
                            x = ix;
                            y = iy;
                            color = [255, 255, 255, 255];
                            size = textBlock.engine?.defaultFontSize || 16;
                            style = null;
                            weight = null;
                            lineHeight = textBlock.engine?.lineHeight || 1.2;
                            break;
                    }
                } else {
                    arg += String.fromCharCode(code);
                }
                continue;
            }

            // Command syntax: \<command><arg>; (eg. \w1000; = wait 1000ms), or just \<command> for commands without arguments.
            if(code === 92) {
                const nextCode = textIsString? text.charCodeAt(i + 1): textIsText? text[i + 1]: 0;
                switch(nextCode) {
                    case 119: // \w - Wait command
                    case 100: // \d - Delay command
                    case 99 : // \c - Color command
                    case 115: // \s - Size command
                    case 120: // \x - X position command
                    case 121: // \y - Y position command
                    case 103: // \g - Group command
                    case 114: // \r - Reset command
                        command = nextCode;
                        state = 1;
                        arg = "";
                        i++;
                        continue;

                    case 110: // \n - Newline
                        code = 10;
                        i++;
                        break;

                    case 92: // \\ - Escape
                        code = 92;
                        i++;
                        break;
                }
            }

            if(callback) {
                const result = callback(code, i + index, x, y, delay, i, namedGroup);
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

            const ogX = x;
            x += textBlock.setChar(i + index, x, y, code, color[0], color[1], color[2], color[3], size, style, weight);

            if(animation) {
                const idx = i + index;
                const object = { char: code, x: ogX, y, r: color[0], g: color[1], b: color[2], a: color[3], size, style, weight, ox: 0, oy: 0 };

                this.animate((key, value) => {
                    if(signal?.aborted || skipSignal?.aborted) return;

                    object[key] = value;
                    textBlock.setChar(idx, object.x + object.ox, object.y + object.oy, object.char, object.r, object.g, object.b, object.a, object.size, object.style, object.weight);
                }, animation, { duration: 1000, ...animationOptions, signal });
            }

            if(delay > 0 && !signal?.aborted && !skipSignal?.aborted) {
                await this.sleep(delay, skipSignal);
            }

            if(code === 10 || x >= maxWidth - ix) {
                x = ix;
                y += size * lineHeight;
            }
        }

        if(hang) {
            await this.sleep(-1, skipSignal);
        }
    }

    /**
     * @template T
     * @typedef {Promise<T> & {
     *   abort: () => void,
     *   skip: () => void
     * }} AbortablePromise
     */

    /**
     * Same as typeText(), but returns a Promise object with abort and skip methods to control the typing process easier.
     * @param {*} textBlock 
     * @param {*} text 
     * @param {*} options 
     * @returns {AbortablePromise<void>} A Promise that resolves when typing is complete, with abort and skip methods.
     * 
     * @example
     * const typingPromise = this.typeTextWithAbort(textBlock, "Hello, world!", { delay: 100 });
     * 
     * // To skip and immediately display the full text:
     * typingPromise.skip();
     * 
     * // To abort typing entirely:
     * typingPromise.abort();
     */
    typeWithAbort(textBlock, text, options = {}) {
        const controller = new AbortController();
        options.signal = controller.signal;

        const skipController = new AbortController();
        options.skipSignal = skipController.signal;

        /** @type {AbortablePromise<void>} */
        const promise = this.typeText(textBlock, text, options);
        promise.abort = () => controller.abort();
        promise.skip  = () => skipController.abort();

        return promise;
    }
}

// debug
globalThis.QuickSand = {
    GameRuntime,
    InputHandler,
    StorageManager
};


// Conveniences
globalThis.sleep ??= (ms) => new Promise(resolve => setTimeout(resolve, ms));
globalThis.T     ??= String.raw;

export { GameRuntime, InputHandler, StorageManager };