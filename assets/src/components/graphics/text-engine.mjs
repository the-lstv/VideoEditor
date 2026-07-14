/**
 * Fast WebGL hardware-accelerated dynamic MSDF text renderer.
 * @copyright 2026 lstv.space
 * @license GPL-3.0
 */

// This is set later and guarantees THREE is available. Or not if not used. Do not blindly replace this with imports, this is correct.
let THREE = window.THREE || null;

/*
TODO:
- Antialiasing
- Font ligatures mapping & rendering
- Line numbers
- Cursor
- Selection
- Input handling
- Fix grid scaling & positions & virtual scroll bounds
- Virtual scrolling
- Performance optimizations (nvm it is fast now? what did i do???)
- Refactor
- Fix & enhance tokenizing & highlighting
- Token decorations & links (for intellisense)
- Decorations
*/

const msdfFragment = `#version 300 es
precision mediump float;
in vec2 v_texCoord;
in vec4 v_color;
uniform sampler2D u_texture;
uniform float u_pxRange;
out vec4 outColor;

float median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
}

void main() {
    vec3 msd = texture(u_texture, v_texCoord).rgb;
    float sd = median(msd.r, msd.g, msd.b);
    vec2 texSize = vec2(textureSize(u_texture, 0));
    vec2 unitRange = vec2(u_pxRange) / texSize;
    vec2 screenTexSize = vec2(1.0) / fwidth(v_texCoord);
    float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);
    float alpha = clamp(screenPxRange * (sd - 0.5) + 0.5, 0.0, 1.0);
    outColor = vec4(v_color.rgb, v_color.a * alpha);
}
`;

const msdfVertex = `#version 300 es

in vec2 a_quad;

in vec2 i_pos;
in vec2 i_size;
in vec4 i_uvRect;
in vec4 i_color;

uniform mat4 uProjection;
uniform vec2 uOffset;

#ifdef USE_THREE_MATRICES
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
#endif

out vec2 v_texCoord;
out vec4 v_color;

void main() {
    vec2 pos = i_pos + (a_quad * i_size);

#ifdef USE_THREE_MATRICES
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + uOffset, 0.0, 1.0);
#else
    gl_Position = uProjection * vec4(pos + uOffset, 0.0, 1.0);
#endif

    vec2 uv = i_uvRect.xy + (a_quad * 0.5 + 0.5) * i_uvRect.zw;

    v_texCoord = uv;
    v_color = i_color;
}
`;

function stripShaderVersion(source) {
    const trimmed = source.trimStart();
    if (!trimmed.startsWith("#version")) return source;
    const firstNewline = source.indexOf("\n");
    if (firstNewline === -1) return "";
    return source.slice(firstNewline + 1);
}

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
    const program = gl.createProgram();
    gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(program));
        return null;
    }
    return program;
}

function ortho(out, left, right, bottom, top, near, far) {
    out[0] = 2 / (right - left);
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 2 / (top - bottom);
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = -2 / (far - near);
    out[11] = 0;
    out[12] = -(right + left) / (right - left);
    out[13] = -(top + bottom) / (top - bottom);
    out[14] = -(far + near) / (far - near);
    out[15] = 1;
    return out;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

const asciiArtCharacterCodes = textEncoder.encode(" .-~:*=%@#");

class Font {
    constructor(gl, fontJson) { }

    static async load(gl, url) {

    }
}

class Brush {
    constructor(getColorFunction) {
        this.getColor = getColorFunction;
    }
}

/**
 * A high-performance text grid renderer using WebGL and MSDF fonts.
 * Can entirely avoid JS string operations and use direct buffers/charcodes, and offers virtual scrolling to avoid re-rendering.
 * 
 * TODO: There is currently quite a lot of bugs and it serves more as a prototype. I will later need to refactor
 */
class AcceleratedTextRenderer extends LS.EventEmitter {
    /**
     * Creates a new accelerated text grid renderer.
     * @param {*} options 
     * @param {any} options.backgroundColor - Background color for the canvas. Can be an instance of LS.Color or any supported color format (hex, rgb, hsl, array, named color, color integer, object, etc.)
     * @param {number} options.fontSize - Base font size in pixels. Default is 16.
     * @param {number} options.limitFPS - Limits the rendering loop to the specified frames per second. Default is unlimited. Set to -1 to disable frame limiting.
     * @param {boolean} options.virtualScrolling - Enables or disables virtual scrolling. When enabled, the grid will render extra rows and columns beyond the viewport to allow smooth scrolling without re-rendering.
     * @param {number} options.virtualScrollBuffer - The number of extra rows and columns to render on each side of the viewport when virtual scrolling is enabled. Default is 32.
     * @param {function} options.onVirtualScroll - Optional callback function that is called whenever a virtual scroll occurs. Receives the new scrollX and scrollY values as parameters.
     * @param {number} options.scrollX - Initial horizontal scroll offset in pixels. Only applicable if virtual scrolling is enabled.
     * @param {number} options.scrollY - Initial vertical scroll offset in pixels. Only applicable if virtual scrolling is enabled.
     * @param {string} options.fontSrc - URL to the font JSON file. The corresponding PNG file should be in the same location with the same name but .png extension. Default is '/assets/fonts/JBMono.json'.
     * @param {object} options.THREE - THREE namespace (required for Three.js mode).
     * @param {object} options.threeRenderer - Existing THREE.WebGLRenderer instance (required for Three.js mode).
     * @param {number} options.cols - Initial grid columns for Three.js mode (optional).
     * @param {number} options.rows - Initial grid rows for Three.js mode (optional).
     * @param {number} options.width - View width in pixels for Three.js mode (optional, used to auto-fit grid).
     * @param {number} options.height - View height in pixels for Three.js mode (optional, used to auto-fit grid).
     * @param {number} options.zoom - Initial zoom level for the text grid. Default is 1 (no zoom).
     * @param {string} options.welcomeMsg - Custom welcome message to display on the welcome screen.
     */
    constructor(options = {}) {
        super();

        this.frameScheduler = new LS.Util.FrameScheduler(this.tick.bind(this));

        this.font = null;
        this.instanceCount = 0;
        this.gridDirty = false;

        this.fontSize = 16;
        this.scale = 1;
        this.pxRange = 4.0;
        this.cellWidth = 0;
        this.cellHeight = 0;

        this.gridOffsetX = 0;
        this.gridOffsetY = 0;

        this.virtualScrolling = false;
        this.virtualScrollBuffer = 32;
        this.scrollX = 0;
        this.scrollY = 0;
        this.virtualCol = 0;
        this.virtualRow = 0;

        this.lineHeight = 1.2; // Line height multiplier for vertical spacing

        this.projMatrix = new Float32Array(16);

        this.usingThree = !!options.threeRenderer;
        this.threeRenderer = options.threeRenderer || null;
        this.threeMesh = null;
        this.threeGeometry = null;
        this.threeMaterial = null;
        this.threeAttributes = null;

        this.pendingResize = [false, 0, 0]; // [needsResize, width, height]

        // -- Welcome screen state
        this.welcomeMsg = "Welcome to the LS terminal!";
        this.startTime = 0;

        this.backgroundColor = new LS.Color(15, 14, 16);

        this.setOptions(options);
        if (options.init !== false) {
            this.init(options);
        }
    }

    static Font = Font;
    static Brush = Brush;

    setOptions(newOptions) {
        if (newOptions.backgroundColor) {
            this.backgroundColor = newOptions.backgroundColor instanceof LS.Color ? newOptions.backgroundColor : new LS.Color(newOptions.backgroundColor);
            if (this.gl) {
                this.gl.clearColor(...this.backgroundColor.floatPixel);
            }
        }

        if (newOptions.fontSize) {
            this.setFontSize(newOptions.fontSize);
        }

        if (newOptions.welcomeMsg) {
            this.welcomeMsg = newOptions.welcomeMsg;
        }

        if (newOptions.limitFPS) {
            this.frameScheduler.limitFPS(newOptions.limitFPS);
        }

        if (newOptions.virtualScrolling !== undefined) {
            this.virtualScrolling = newOptions.virtualScrolling;
            this.resize(); // Recalculate grid size based on new virtual scrolling setting
        }

        if (newOptions.virtualScrollBuffer !== undefined) {
            this.virtualScrollBuffer = newOptions.virtualScrollBuffer;
            this.resize(); // Recalculate grid size based on new virtual scrolling setting
        }

        if (newOptions.scrollX !== undefined && newOptions.scrollY !== undefined) {
            this.scrollX = newOptions.scrollX;
            this.scrollY = newOptions.scrollY;
            this.setOffset(-this.scrollX, -this.scrollY);
        }

        if (newOptions.onVirtualScroll) {
            this.onVirtualScroll = newOptions.onVirtualScroll;
        }

        if (newOptions.fontSrc && this.gl) {
            this.loadFont(newOptions.fontSrc);
        }
    }

    render() {
        if (!this.initialized) return;
        this.frameScheduler.schedule();
    }

    setFontSize(size) {
        this.fontSize = size;
        if (this.font) {
            this.scale = size / this.font.atlas.size;
            this.cellWidth = this.font.baseCellWidth * this.scale;
            this.cellHeight = this.font.baseCellHeight * this.scale;
            this._rebuildGlyphScale();

            if (this.usingThree && this.threeMaterial?.uniforms?.u_pxRange) {
                this.threeMaterial.uniforms.u_pxRange.value = this.pxRange;
            }

            // Rebuild all vertices with the new scale
            if (this.gridBuffer) {
                for (let row = 0; row < this.rows; row++) {
                    for (let col = 0; col < this.cols; col++) {
                        const cellIdx = row * this.cols + col;
                        const charCode = this.gridBuffer[cellIdx];
                        if (!charCode) continue;
                        this._updateVertex(col, row, charCode, undefined, undefined, undefined, undefined, true);
                    }
                }
            }
        }
    }

    setupGrid(cols, rows) {
        this.cols = cols;
        this.rows = rows;

        const numCells = cols * rows;

        // Backing buffers to remember grid state for resizing & skipping updates
        this.gridBuffer = new Uint16Array(numCells);

        if (this.usingThree) {
            // y the fuck is this split? (i did not do that)
            this.instancePos = new Float32Array(numCells * 2);
            this.instanceSize = new Float32Array(numCells * 2);
            this.instanceUvRect = new Float32Array(numCells * 4);
            this.instanceColor = new Uint8Array(numCells * 4);

            this._setupThreeAttributes();
        } else {
            // Per-instance data: i_pos(2), i_size(2), i_uvRect(4), i_color(1) (color is stored as 4 bytes)
            this.vertexData = new Float32Array(numCells * 9);
            this.vertexByteView = new Uint8Array(this.vertexData.buffer);

            const gl = this.gl;
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        }

        this.instanceCount = numCells;
        if (this.usingThree && this.threeGeometry) {
            this.threeGeometry.instanceCount = this.instanceCount;
        }
        this.gridDirty = false;
    }

    fitGrid() {
        // Font dimensions need to be set before calculating grid size

        const cols = Math.ceil(this.canvas.width / this.cellWidth);
        const rows = Math.ceil(this.canvas.height / (this.cellHeight * this.lineHeight));

        if (this.virtualScrolling) {
            this.setupGrid(cols + this.virtualScrollBuffer, rows + this.virtualScrollBuffer);
        } else {
            this.setupGrid(cols, rows);
        }
    }

    fitGridToSize(width, height) {
        const cols = Math.ceil(width / this.cellWidth);
        const rows = Math.ceil(height / (this.cellHeight * this.lineHeight));

        if (this.virtualScrolling) {
            this.setupGrid(cols + this.virtualScrollBuffer, rows + this.virtualScrollBuffer);
        } else {
            this.setupGrid(cols, rows);
        }
    }

    clearGrid() {
        if (!this.gridBuffer) return;
        this.gridBuffer.fill(0);
        if (this.usingThree) {
            if (this.instancePos) this.instancePos.fill(0);
            if (this.instanceSize) this.instanceSize.fill(0);
            if (this.instanceUvRect) this.instanceUvRect.fill(0);
            if (this.instanceColor) this.instanceColor.fill(0);
        } else if (this.vertexData) {
            this.vertexData.fill(0);
        }
        this.gridDirty = true;
    }

    /**
     * Clear a row
     * TODO: Could be more efficient
     * @param {*} row Row to clear
     * @returns {void}
     */
    clearLine(row) {
        if (!this.vertexData || row < 0 || row >= this.rows) return;
        for (let col = 0; col < this.cols; col++) {
            this._updateVertex(col, row, 0);
        }
    }

    /**
     * Clear the screen
    */
    clear() {
        if (!this.gridBuffer) return;
        this.gridBuffer.fill(0);
        if (this.usingThree) {
            if (this.instancePos) this.instancePos.fill(0);
            if (this.instanceSize) this.instanceSize.fill(0);
            if (this.instanceUvRect) this.instanceUvRect.fill(0);
            if (this.instanceColor) this.instanceColor.fill(0);
        } else if (this.vertexData) {
            this.vertexData.fill(0);
        }
        this.gridDirty = true;
    }

    /**
     * Sets a character and color at the specified column and row in the grid if the position is valid.
     * @param {number} col - Column of the cell to update
     * @param {number} row - Row of the cell to update
     * @param {number} charCode - Character code to set at the specified cell
     * @param {number} r - Red color component (0-255)
     * @param {number} g - Green color component (0-255)
     * @param {number} b - Blue color component (0-255)
     * @param {number} a - Alpha component (0-255)
     */
    setChar(col, row, charCode, r = 255, g = 255, b = 255, a = 255) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows || !this.font) return;

        // Clamp color values to [0, 255]
        if (r < 0) r = 0; else if (r > 255) r = 255;
        if (g < 0) g = 0; else if (g > 255) g = 255;
        if (b < 0) b = 0; else if (b > 255) b = 255;
        if (a < 0) a = 0; else if (a > 255) a = 255;

        this._updateVertex(col, row, charCode, r, g, b, a);
    }

    /**
     * Updates the vertex data for a single cell in the grid. Does not clamp values or check bounds.
     * @param {number} col - Column of the cell to update
     * @param {number} row - Row of the cell to update
     * @param {number} charCode - Optional new character code for the cell. If undefined, the character will not be changed.
     * @param {number} r - Optional new red color component (0-255). If undefined, the red component will not be changed.
     * @param {number} g - Optional new green color component (0-255). If undefined, the green component will not be changed.
     * @param {number} b - Optional new blue color component (0-255). If undefined, the blue component will not be changed.
     * @param {number} a - Optional new alpha component (0-255). If undefined, the alpha component will not be changed.
     */
    _updateVertex(col, row, charCode, r, g, b, a, forceGlyph = false) {
        const cellIdx = (row * this.cols + col);

        // Dirty glyph (for now we only care to render if glyph changes through this function)
        let updateChar = false;
        if (charCode !== undefined) {
            updateChar = this.gridBuffer[cellIdx] !== charCode;
            this.gridBuffer[cellIdx] = charCode;

            if (charCode === 61 && this.gridBuffer[cellIdx - 1] === 62) {
                // Handle => ligature as an example
                this._updateVertex(col - 1, row, 65536, r, g, b, a); // Use a char code outside of the normal range to indicate a ligature
                return;
            }
        } else if (r === undefined && g === undefined && b === undefined && a === undefined) {
            return; // No updates needed
        }

        const v = this.vertexData;
        const vIdx = cellIdx * 9;

        // It would be more readable to use inline enums but JS doesn't have that
        // Maybe one day I'll rewrite this in Glitter 🤔

        if (this.usingThree) {
            const colorIdx = cellIdx * 4;
            if (this.instanceColor) {
                if (r !== undefined) this.instanceColor[colorIdx] = r;
                if (g !== undefined) this.instanceColor[colorIdx + 1] = g;
                if (b !== undefined) this.instanceColor[colorIdx + 2] = b;
                if (a !== undefined) this.instanceColor[colorIdx + 3] = a;
            }
        } else {
            const vb = this.vertexByteView;
            const vbIdx = vIdx * 4;
            if (r !== undefined) vb[vbIdx + 32] = r; // i_color.r
            if (g !== undefined) vb[vbIdx + 33] = g; // i_color.g
            if (b !== undefined) vb[vbIdx + 34] = b; // i_color.b
            if (a !== undefined) vb[vbIdx + 35] = a; // i_color.a
        }
        this.gridDirty = true;

        if (forceGlyph) updateChar = true;
        if (!updateChar) return;

        if (charCode === undefined) {
            charCode = this.gridBuffer[cellIdx];
        }

        // Debug updating chars
        // if(updateChar) charCode = 9608; else charCode = 9617;

        const map = this.cmap;
        const x = col * this.cellWidth;
        const y = (row * this.cellHeight) * this.lineHeight;

        let glyphIdx = this.font._missingGlyphIndex;
        if (glyphIdx >= map.length) glyphIdx = 0;
        if (charCode >= this.font._lowestCharCode) {
            const idx = (charCode - this.font._lowestCharCode) * 15;
            if (idx >= 0 && idx < map.length) glyphIdx = idx;
        }

        const u0 = map[glyphIdx + 7];
        const v0 = map[glyphIdx + 8];
        // const u1 = map[glyphIdx + 9];
        // const v1 = map[glyphIdx + 10];
        // const width = map[glyphIdx + 13];
        // const height = map[glyphIdx + 14];
        const x0 = x + map[glyphIdx + 11];
        const y0 = y + map[glyphIdx + 12];

        const uWidth = map[glyphIdx + 9] - u0;
        const vHeight = map[glyphIdx + 10] - v0;
        const halfWidth = map[glyphIdx + 13];
        const halfHeight = map[glyphIdx + 14];

        if (this.usingThree) {
            const posIdx = cellIdx * 2;
            const sizeIdx = cellIdx * 2;
            const uvIdx = cellIdx * 4;

            if (this.instancePos) {
                this.instancePos[posIdx] = x0 + halfWidth;
                this.instancePos[posIdx + 1] = y0 + halfHeight;
            }
            if (this.instanceSize) {
                this.instanceSize[sizeIdx] = halfWidth;
                this.instanceSize[sizeIdx + 1] = halfHeight;
            }
            if (this.instanceUvRect) {
                this.instanceUvRect[uvIdx] = u0;
                this.instanceUvRect[uvIdx + 1] = v0;
                this.instanceUvRect[uvIdx + 2] = uWidth;
                this.instanceUvRect[uvIdx + 3] = vHeight;
            }
        } else {
            v[vIdx] = x0 + halfWidth;       // i_pos.x (center)
            v[vIdx + 1] = y0 + halfHeight;  // i_pos.y (center)
            v[vIdx + 2] = halfWidth;        // i_size.x (half width)
            v[vIdx + 3] = halfHeight;       // i_size.y (half height)
            v[vIdx + 4] = u0;               // uv.x
            v[vIdx + 5] = v0;               // uv.y
            v[vIdx + 6] = uWidth;           // uv.w
            v[vIdx + 7] = vHeight;          // uv.h
        }
    }

    tick() {
        if (this.pendingResize[0]) {
            if (!this.usingThree) {
                this.#resize(this.pendingResize[1], this.pendingResize[2]);
                this.quickEmit("resize", this.canvas.width, this.canvas.height);
            }
            this.pendingResize[0] = false;
        }

        if (this.frameFunction) {
            this.frameFunction();
        }

        if (!this.font || this.instanceCount === 0) return;

        if (this.usingThree) {
            this.updateBuffers();
            return;
        }

        const cw = this.canvas.width;
        const ch = this.canvas.height;

        const gl = this.gl;
        gl.viewport(0, 0, cw, ch);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.CULL_FACE);

        this.updateBuffers();

        const updatedDimensions = cw !== this.lastRenderWidth || ch !== this.lastRenderHeight;
        if (updatedDimensions) {
            this.lastRenderWidth = cw;
            this.lastRenderHeight = ch;
            ortho(this.projMatrix, 0, cw, ch, 0, -1, 1);
        }

        const locations = this.locations;

        // -- Render text grid
        gl.useProgram(this.program);
        if (updatedDimensions) {
            gl.uniformMatrix4fv(locations.projection, false, this.projMatrix);
        }
        gl.uniform2f(locations.offset, this.gridOffsetX, this.gridOffsetY);
        gl.uniform1f(locations.pxRange, this.pxRange || 4.0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(locations.texture, 0);
        gl.bindVertexArray(this.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.instanceCount);
        gl.bindVertexArray(null);
    }

    updateBuffers() {
        if (!this.gridDirty) return;
        if (this.usingThree) {
            if (this.threeAttributes) {
                this.threeAttributes.i_pos.needsUpdate = true;
                this.threeAttributes.i_size.needsUpdate = true;
                this.threeAttributes.i_uvRect.needsUpdate = true;
                this.threeAttributes.i_color.needsUpdate = true;
            }
            if (this.threeGeometry) {
                this.threeGeometry.instanceCount = this.instanceCount;
            }
            this.gridDirty = false;
            return;
        }

        const gl = this.gl;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

        // orphan old storage (avoids stall if GPU is still using it)
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.byteLength, gl.DYNAMIC_DRAW);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData);

        this.gridDirty = false;
    }

    /**
     * Important TODO: Somehow, with the new font map changes (to Chlumsky/msdf-atlas-gen from msdf-bmfont-xml), rendering got really slow (_updateVertex now takes up to 4x the time!!) AND worse quality (scaling issues, bad quality when up close).
     * It has to be refactored at some point.
     */
    async loadFont(src) {
        const imgUrl = src + "/atlas.png";
        const [fontData, image] = await Promise.all([
            fetch(src + "/font.json").then(r => r.json()),
            new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = imgUrl;
            })
        ]);

        if (this.usingThree) {
            const texture = new THREE.Texture(image);
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.flipY = false;

            // if ("colorSpace" in texture && THREE.NoColorSpace) {
            //     texture.colorSpace = THREE.NoColorSpace;
            // }

            texture.needsUpdate = true;
            this.texture = texture;
            this.threeMaterial.uniforms.u_texture.value = texture;
        } else {
            const gl = this.gl;
            this.texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }

        // Number of floats per character in the cmap
        const MAP_SLOTS = 15;

        const baseFontSize = fontData.atlas.size || 24;
        const metrics = fontData.metrics || {};

        const atlasRange = fontData.atlas?.range;
        if (typeof atlasRange === "number" && Number.isFinite(atlasRange)) {
            this.pxRange = atlasRange;
        }

        if (this.usingThree && this.threeMaterial?.uniforms?.u_pxRange) {
            this.threeMaterial.uniforms.u_pxRange.value = this.pxRange;
        }

        const lowestCharCode = Math.min(...fontData.glyphs.map(c => c.code || Infinity));
        const highestCharCode = Math.max(...fontData.glyphs.map(c => c.code || 0));

        // Pack the font data into a single Float32Array for fast access
        const map = new Float32Array((highestCharCode - lowestCharCode + 1) * MAP_SLOTS); // +1 for missing glyph

        const hasBottomOrigin = fontData.atlas?.yOrigin === "bottom";
        const baselinePx = (metrics.ascender || 0) * baseFontSize;

        // Precompute as much as possible
        for (let i = 0; i < fontData.glyphs.length; i++) {
            const charData = fontData.glyphs[i];
            const code = charData.code;

            if (code === undefined || code === null) continue;

            /* x, y, w, h, xoffset, yoffset, xadvance, u0, v0, u1, v1, xOff, yOff, gw, gh */

            const plane = charData.planeBounds || null;
            const atlas = charData.atlasBounds || null;

            const leftPx = plane ? plane.left * baseFontSize : 0;
            const rightPx = plane ? plane.right * baseFontSize : 0;
            const topPx = plane ? plane.top * baseFontSize : 0;
            const bottomPx = plane ? plane.bottom * baseFontSize : 0;

            const gw = rightPx - leftPx;
            const gh = topPx - bottomPx;

            const atlasLeft = atlas ? atlas.left : 0;
            const atlasRight = atlas ? atlas.right : 0;
            const atlasTop = atlas ? atlas.top : 0;
            const atlasBottom = atlas ? atlas.bottom : 0;

            const u0 = atlasLeft / image.width;
            const u1 = atlasRight / image.width;
            const v0 = hasBottomOrigin
                ? (1 - (atlasTop / image.height))
                : (atlasTop / image.height);
            const v1 = hasBottomOrigin
                ? (1 - (atlasBottom / image.height))
                : (atlasBottom / image.height);

            const xOff = leftPx;
            const yOff = baselinePx - topPx;

            // Font atlas data (kept for compatibility with rebuild)
            map[(code - lowestCharCode) * MAP_SLOTS] = atlasLeft;
            map[(code - lowestCharCode) * MAP_SLOTS + 1] = atlasBottom;
            map[(code - lowestCharCode) * MAP_SLOTS + 2] = gw;
            map[(code - lowestCharCode) * MAP_SLOTS + 3] = gh;
            map[(code - lowestCharCode) * MAP_SLOTS + 4] = xOff;
            map[(code - lowestCharCode) * MAP_SLOTS + 5] = yOff;
            map[(code - lowestCharCode) * MAP_SLOTS + 6] = charData.advance || 0;

            // UV coordinates
            map[(code - lowestCharCode) * MAP_SLOTS + 7] = u0;
            map[(code - lowestCharCode) * MAP_SLOTS + 8] = v0;
            map[(code - lowestCharCode) * MAP_SLOTS + 9] = u1;
            map[(code - lowestCharCode) * MAP_SLOTS + 10] = v1;

            // Scale based
            map[(code - lowestCharCode) * MAP_SLOTS + 11] = xOff * this.scale;
            map[(code - lowestCharCode) * MAP_SLOTS + 12] = yOff * this.scale;
            // map[(code - lowestCharCode) * MAP_SLOTS + 13] = gw * this.scale;
            // map[(code - lowestCharCode) * MAP_SLOTS + 14] = gh * this.scale;
            map[(code - lowestCharCode) * MAP_SLOTS + 13] = (gw * this.scale) * 0.5;
            map[(code - lowestCharCode) * MAP_SLOTS + 14] = (gh * this.scale) * 0.5;
        }

        // Font metrics
        const spaceCharData = fontData.glyphs.find(c => c.code === 32) || fontData.glyphs[0];
        const baseCellWidth = (spaceCharData?.advance || 0.6) * baseFontSize;
        const baseCellHeight = baseFontSize;

        this.cmap = map;

        this.font = fontData;
        this.font.baseCellWidth = baseCellWidth;
        this.font.baseCellHeight = baseCellHeight;
        this.font._missingGlyphIndex = (highestCharCode - lowestCharCode + 1) * MAP_SLOTS;
        this.font._lowestCharCode = lowestCharCode;
    }

    _rebuildGlyphScale() {
        if (!this.font) return;
        for (let charCode = this.font._lowestCharCode; charCode < this.font._lowestCharCode + this.cmap.length / 15; charCode++) {
            const glyphIdx = (charCode - this.font._lowestCharCode) * 15;
            this.cmap[glyphIdx + 11] = (this.cmap[glyphIdx + 4] || 0) * this.scale; // xOff
            this.cmap[glyphIdx + 12] = (this.cmap[glyphIdx + 5] || 0) * this.scale; // yOff
            this.cmap[glyphIdx + 13] = (this.cmap[glyphIdx + 2] * this.scale) * 0.5; // gw
            this.cmap[glyphIdx + 14] = (this.cmap[glyphIdx + 3] * this.scale) * 0.5; // gh
        }
    }

    async init(options = {}) {
        if (this.initialized) return;
        this.initialized = true;

        if (this.usingThree) {
            await this.#initThree(options);
            return;
        }

        this.canvas = document.createElement('canvas');
        this.canvas.width = 800;
        this.canvas.height = 600;

        this.container = LS.Create({ class: "ls-textgrid-container" });
        this.container.appendChild(this.canvas);

        this.gl = this.canvas.getContext('webgl2', { antialias: true });
        const gl = this.gl;

        gl.clearColor(...this.backgroundColor.floatPixel);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.CULL_FACE);

        this.canvas.addEventListener("wheel", (e) => {
            if (!this.virtualScrolling) return;
            e.preventDefault();
            this.scrollBy(e.deltaX, e.deltaY);
        });

        this.program = createProgram(gl, msdfVertex, msdfFragment);

        this.locations = {
            // -- Text rendering program locations
            quad: gl.getAttribLocation(this.program, "a_quad"),
            i_pos: gl.getAttribLocation(this.program, "i_pos"),
            i_size: gl.getAttribLocation(this.program, "i_size"),
            i_uvRect: gl.getAttribLocation(this.program, "i_uvRect"),
            i_color: gl.getAttribLocation(this.program, "i_color"),
            projection: gl.getUniformLocation(this.program, "uProjection"),
            texture: gl.getUniformLocation(this.program, "u_texture"),
            pxRange: gl.getUniformLocation(this.program, "u_pxRange"),
            offset: gl.getUniformLocation(this.program, "uOffset"),
        };

        // -- Setup text rendering program
        {
            this.vao = gl.createVertexArray();
            gl.bindVertexArray(this.vao);

            const quadData = new Float32Array([
                -1, -1,
                1, -1,
                -1, 1,
                1, 1
            ]);
            this.quadBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.STATIC_DRAW);

            gl.enableVertexAttribArray(this.locations.quad);
            gl.vertexAttribPointer(this.locations.quad, 2, gl.FLOAT, false, 0, 0);

            this.vertexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

            const stride = (8 * 4) + (4 * 1); // 8 floats (32 bytes, position) + 4 unsigned bytes (4 bytes, color) per instance
            gl.enableVertexAttribArray(this.locations.i_pos);
            gl.vertexAttribPointer(this.locations.i_pos, 2, gl.FLOAT, false, stride, 0);
            gl.vertexAttribDivisor(this.locations.i_pos, 1);

            gl.enableVertexAttribArray(this.locations.i_size);
            gl.vertexAttribPointer(this.locations.i_size, 2, gl.FLOAT, false, stride, 8);
            gl.vertexAttribDivisor(this.locations.i_size, 1);

            gl.enableVertexAttribArray(this.locations.i_uvRect);
            gl.vertexAttribPointer(this.locations.i_uvRect, 4, gl.FLOAT, false, stride, 16);
            gl.vertexAttribDivisor(this.locations.i_uvRect, 1);

            gl.enableVertexAttribArray(this.locations.i_color);
            gl.vertexAttribPointer(this.locations.i_color, 4, gl.UNSIGNED_BYTE, true, stride, 32);
            gl.vertexAttribDivisor(this.locations.i_color, 1);

            gl.bindVertexArray(null);

            await this.loadFont(options.fontSrc || ('assets/fonts/' + (options.fontName || 'JetBrainsMono')));

            if (!this.lineHeight) this.lineHeight = options.lineHeight || this.font.metrics.lineHeight || 1.2;
            this.setFontSize(this.fontSize);
            this.fitGrid();
        }
    }

    setOffset(x, y) {
        this.gridOffsetX = Number.isNaN(x) ? 0 : x;
        this.gridOffsetY = Number.isNaN(y) ? 0 : y;
        if (this.usingThree && this.threeMaterial?.uniforms?.uOffset) {
            this.threeMaterial.uniforms.uOffset.value.set(this.gridOffsetX, this.gridOffsetY);
        }
        this.render();
    }

    #resize(width, height) {
        if (width !== undefined) this.canvas.width = width;
        if (height !== undefined) this.canvas.height = height;

        this.fitGrid();
    }

    resize(width, height) {
        if (!this.initialized) return;
        if (this.usingThree) {
            if (width !== undefined && height !== undefined) {
                this.fitGridToSize(width, height);
            }
            return;
        }
        this.pendingResize[0] = true;
        this.pendingResize[1] = width;
        this.pendingResize[2] = height;
    }

    scrollBy(deltaX, deltaY) {
        this.scrollX = Math.max(0, this.scrollX + deltaX);
        this.scrollY = Math.max(0, this.scrollY + deltaY);

        this.quickEmit("scroll", this.scrollX, this.scrollY);

        const bufferWidth = Math.max(1, this.virtualScrollBuffer) * this.cellWidth;
        const bufferHeight = Math.max(1, this.virtualScrollBuffer) * this.cellHeight;

        const newCol = Math.floor(this.scrollX / bufferWidth) * this.virtualScrollBuffer;
        const newRow = Math.floor(this.scrollY / bufferHeight) * this.virtualScrollBuffer;

        this.setOffset(-(this.scrollX % bufferWidth), -(this.scrollY % bufferHeight));

        if (newCol !== this.virtualCol || newRow !== this.virtualRow) {
            this.virtualCol = newCol;
            this.virtualRow = newRow;
            if (this.onVirtualScroll) this.onVirtualScroll(this.virtualCol, this.virtualRow);
        }
    }

    /**
     * A high-level method to write a string of text to the grid starting at the specified column and row as a box.
     * Supports wrapping, alignment, and custom colors.
     * (For custom rendering, prefer a loop instead)
     * @param {string|StringView} text - The text to write. Can be a regular string or a StringView for zero-copy rendering.
     * @param {object} options - Options for text rendering
     * @param {number} options.startCol - Starting column for the text box (default: 0)
     * @param {number} options.startRow - Starting row for the text box (default: 0)
     * @param {number} options.align - Text alignment within the box: 0 = left, 1 = center, 2 = right (default: 0)
     * @param {number|null} options.boxWidth - Width of the text box in characters. If null, it will be as wide as the longest line (default: null)
     * @param {number} options.maxBoxWidth - Maximum width of the text box in characters. Only applies if boxWidth is null (default: Infinity)
     * @param {number|null} options.boxHeight - Height of the text box in lines. If null, it will be as tall as the number of lines (default: null)
     * @param {number} options.boxAlign - Alignment of the text box relative to the starting position: 0 = top-left, 1 = center, 2 = bottom-right (default: 0)
     * @param {boolean} options.wrap - Whether to wrap text that exceeds the box width (default: true)
     * @param {number} options.paddingH - Horizontal padding inside the box in characters (default: 0)
     * @param {number} options.paddingV - Vertical padding inside the box in lines (default: 0)
     * @param {LS.Color|Brush|[r, g, b, a]} options.color - Color or brush for the text. Can be an LS.Color, a Brush instance, or an array of RGBA values (default: [255, 255, 255, 255])
     * @returns {[number, number, number, number]} - The position and size of the rendered text box as [col, row, width, height]
     */
    writeText(text, { startCol = 0, startRow = 0, align = 0, boxWidth = null, maxBoxWidth = Infinity, boxHeight = null, boxAlign = 0, wrap = true, paddingH = 0, paddingV = 0, color = [255, 255, 255, 255] }) {
        let brush = null;

        // Resolve color or brush
        if (color instanceof LS.Color) {
            color = color.pixel;
        } else if (color instanceof Brush) {
            brush = color;
        }

        let contentWidth = boxWidth !== null ? boxWidth - paddingH * 2 : Infinity;
        if (contentWidth <= 0) contentWidth = 1;

        let lines = [];
        let lineStartIdx = 0;
        let currentLineLen = 0;

        // Scan string and handle wrapping
        for (let i = 0; i < text.length; i++) {
            const charCode = text[i].charCodeAt(0);
            if (charCode === 10) { // Newline
                lines.push([lineStartIdx, currentLineLen]);
                lineStartIdx = i + 1;
                currentLineLen = 0;
            } else {
                if (wrap && boxWidth !== null && currentLineLen >= contentWidth) {
                    lines.push([lineStartIdx, currentLineLen]);
                    lineStartIdx = i;
                    currentLineLen = 1;
                } else {
                    currentLineLen++;
                }
            }
        }

        lines.push([lineStartIdx, currentLineLen]);

        const maxLineWidth = lines.length > 0 ? Math.max(...lines.map(l => l[1])) : 0;
        boxWidth = Math.min(maxBoxWidth, boxWidth !== null ? boxWidth : maxLineWidth + paddingH * 2);
        const actualContentWidth = boxWidth - paddingH * 2;

        const finalBoxHeight = boxHeight !== null ? boxHeight : lines.length + paddingV * 2;

        if (boxAlign === 1) { // Center box
            startCol -= Math.floor(boxWidth / 2);
            startRow -= Math.floor(finalBoxHeight / 2);
        } else if (boxAlign === 2) { // Right/Bottom align box
            startCol -= boxWidth;
            startRow -= finalBoxHeight;
        }

        // Render lines
        for (let rowIdx = 0; rowIdx < lines.length; rowIdx++) {
            // Respect explicitly defined boxHeight
            if (boxHeight !== null && (rowIdx >= boxHeight - paddingV * 2)) {
                break;
            }

            const line = lines[rowIdx];
            const rowY = startRow + paddingV + rowIdx;
            let lineStartCol = startCol + paddingH;

            // Align: 0 = left, 1 = center, 2 = right
            if (align === 1) {
                lineStartCol += Math.floor((actualContentWidth - line[1]) / 2);
            } else if (align === 2) {
                lineStartCol += (actualContentWidth - line[1]);
            }

            for (let c = 0; c < line[1]; c++) {
                const i = line[0] + c;
                const charCode = typeof text === 'string' ? text.charCodeAt(i) : (typeof text[i] === 'number' ? text[i] : text[i].charCodeAt(0));

                if (brush) {
                    brush.getColor(color, i, charCode);
                }

                this.setChar(lineStartCol + c, rowY, charCode, color[0], color[1], color[2], color[3]);
            }
        }

        return [startCol, startRow, boxWidth, finalBoxHeight];
    }

    drawBox(col, row, width, height, r = 255, g = 255, b = 255, a = 255, outset = false) {
        const tr = 9582;
        const tl = 9581;
        const bl = 9584;
        const br = 9583;
        const h = 9472;
        const v = 9474;

        if (outset) {
            col -= 1;
            row -= 1;
            width += 2;
            height += 2;
        }

        // Corners
        this.setChar(col, row, tl, r, g, b, a);
        this.setChar(col + width - 1, row, tr, r, g, b, a);
        this.setChar(col, row + height - 1, bl, r, g, b, a);
        this.setChar(col + width - 1, row + height - 1, br, r, g, b, a);

        // Edges
        for (let c = col + 1; c < col + width - 1; c++) {
            this.setChar(c, row, h, r, g, b, a);
            this.setChar(c, row + height - 1, h, r, g, b, a);
        }
        for (let r = row + 1; r < row + height - 1; r++) {
            this.setChar(col, r, v, r, g, b, a);
            this.setChar(col + width - 1, r, v, r, g, b, a);
        }
    }

    /**
     * Default sample welcome screen with an animated background and a centered message box.
     */
    welcome() {
        this.frameFunction = this.renderWelcomeFrame.bind(this);
        this.startTime = performance.now();
        this.frameScheduler.start();
    }

    renderWelcomeFrame() {
        if (!this.initialized || !this.cols || !this.rows) return;

        let [startCol, startRow, boxWidth, boxHeight] = this.writeText(this.welcomeMsg, { startCol: Math.floor(this.cols / 2), startRow: Math.floor(this.rows / 2), align: 1, boxAlign: 1, maxBoxWidth: this.cols - 4, wrap: true, paddingH: 2, paddingV: 1, color: [204, 229, 255, 255] });
        startCol -= 1;
        startRow -= 1;
        boxWidth += 2;
        boxHeight += 2;

        this.drawBox(startCol, startRow, boxWidth, boxHeight, 204, 229, 255, 255);

        const t = (performance.now() - this.startTime) * 0.001;
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                // Leave a hole for the message box
                if (col >= startCol && col < startCol + boxWidth && row >= startRow && row < startRow + boxHeight) {
                    continue;
                }

                const x = col * 0.07;
                const y = row * 0.09;

                let v = 0;
                v += Math.sin(x * 1.0 + y * 0.4 + t * 1.3);
                v += Math.sin(x * 0.6 - y * 0.8 + t * 0.9 + 1.7);
                v += Math.cos(x * 0.3 + y * 1.1 + t * 0.7 + 4.2) * 0.6;

                v += Math.sin(t * 0.4 + col * 0.13 + row * 0.17) * 0.25;

                const value = (v + 2.2) / 4.4;

                const charIdx = Math.floor(value ** 1.3 * (asciiArtCharacterCodes.length - 1)); // ^1.3 = more contrast
                const char = asciiArtCharacterCodes[charIdx];

                const brightness = value * 0.7 + 0.3;
                this.setChar(col, row, char,
                    (0.6 + brightness * 0.4) * 255,
                    (0.1 + brightness * 0.6) * 255,
                    (0.5 + brightness * 0.4) * 255,
                    128
                );
            }
        }
    }

    /**
     * Returns the current screen text as a single string with newlines. Empty cells are returned as spaces.
     * Use sparingly (it's an expensive operation)
     * @returns {string}
     */
    getScreenText() {
        let text = "";
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const charCode = this.gridBuffer[row * this.cols + col];
                text += charCode ? String.fromCharCode(charCode) : " ";
            }
            text += "\n";
        }
        return text;
    }

    destroy() {
        if (this.destroyed) return;
        if (this.usingThree) {
            if (this.threeGeometry) this.threeGeometry.dispose();
            if (this.threeMaterial) this.threeMaterial.dispose();
            if (this.texture?.dispose) this.texture.dispose();
        } else {
            if (this.vertexBuffer) this.gl.deleteBuffer(this.vertexBuffer);
            if (this.indexBuffer) this.gl.deleteBuffer(this.indexBuffer);
            if (this.quadBuffer) this.gl.deleteBuffer(this.quadBuffer);
            if (this.texture) this.gl.deleteTexture(this.texture);
            if (this.program) this.gl.deleteProgram(this.program);
            if (this.vao) this.gl.deleteVertexArray(this.vao);
        }
        this.vertexData = null;
        this.indexData = null;
        this.gridBuffer = null;
        this.cmap = null;
        this.font = null;
        this.instanceCount = 0;
        this.frameFunction = null;
        this.onVirtualScroll = null;
        this.threeAttributes = null;
        this.threeMesh = null;
        this.threeGeometry = null;
        this.threeMaterial = null;
        this.scrollX = 0;
        this.scrollY = 0;
        this.virtualCol = 0;
        this.virtualRow = 0;
        this.welcomeMsg = null;
        this.gridDirty = null;
        this.initialized = null;
        this.pendingResize = null;
        this.frameScheduler.destroy();
        this.frameScheduler = null;
        this.projMatrix = null;
        this.backgroundColor = null;
        this.gl = null;
        this.canvas = null;
        this.container.remove();
        this.container = null;
        this.program = null;
        this.locations = null;
        this.vao = null;
        this.indexBuffer = null;
        this.quadBuffer = null;
        this.texture = null;
        this.vertexBuffer = null;
        this.destroyed = true;
    }

    async #initThree(options) {
        this.threeRenderer = options.threeRenderer;
        this.threeGeometry = new THREE.InstancedBufferGeometry();

        const quadData = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]);

        this.threeGeometry.setAttribute("a_quad", new THREE.BufferAttribute(quadData, 2));

        this.threeGeometry.setIndex([0, 1, 2, 2, 1, 3]);
        this.threeGeometry.setDrawRange(0, 6);

        this.threeMaterial = new THREE.RawShaderMaterial({
            vertexShader: stripShaderVersion(msdfVertex),
            fragmentShader: stripShaderVersion(msdfFragment),
            uniforms: {
                uProjection: { value: new THREE.Matrix4() },
                uOffset: { value: new THREE.Vector2(0, 0) },
                u_pxRange: { value: this.pxRange },
                u_texture: { value: null }
            },
            transparent: true,
            depthTest: options.depthTest !== undefined ? options.depthTest : true,
            depthWrite: options.depthWrite !== undefined ? options.depthWrite : false,
            glslVersion: THREE.GLSL3,
            defines: { USE_THREE_MATRICES: 1 },
            side: THREE.DoubleSide
        });

        this.threeMesh = new THREE.Mesh(this.threeGeometry, this.threeMaterial);
        this.threeMesh.frustumCulled = false;

        this.threeMesh.onBeforeRender = () => this.updateBuffers();

        const fontSrc = options.fontSrc || ("assets/fonts/" + (options.fontName || "JetBrainsMono"));
        await this.loadFont(fontSrc);

        if (!this.lineHeight) this.lineHeight = options.lineHeight || this.font.metrics.lineHeight || 1.2;

        this.setFontSize(this.fontSize);
        if (options.cols && options.rows) {
            this.setupGrid(options.cols, options.rows);
        } else if (options.width && options.height) {
            this.fitGridToSize(options.width, options.height);
        } else {
            this.setupGrid(80, 25);
        }
    }

    _setupThreeAttributes() {
        if (!this.usingThree || !this.threeGeometry) return;
        const iPos = new THREE.InstancedBufferAttribute(this.instancePos, 2);
        iPos.setUsage(THREE.DynamicDrawUsage);
        const iSize = new THREE.InstancedBufferAttribute(this.instanceSize, 2);
        iSize.setUsage(THREE.DynamicDrawUsage);
        const iUvRect = new THREE.InstancedBufferAttribute(this.instanceUvRect, 4);
        iUvRect.setUsage(THREE.DynamicDrawUsage);
        const iColor = new THREE.InstancedBufferAttribute(this.instanceColor, 4, true);
        iColor.setUsage(THREE.DynamicDrawUsage);

        this.threeGeometry.setAttribute("i_pos", iPos);
        this.threeGeometry.setAttribute("i_size", iSize);
        this.threeGeometry.setAttribute("i_uvRect", iUvRect);
        this.threeGeometry.setAttribute("i_color", iColor);

        this.threeAttributes = {
            i_pos: iPos,
            i_size: iSize,
            i_uvRect: iUvRect,
            i_color: iColor
        };
    }

    getObject3D() {
        return this.threeMesh || null;
    }

    static provideThreeJS(Three) {
        if (!THREE) THREE = Three;
    }
}

export default AcceleratedTextRenderer;