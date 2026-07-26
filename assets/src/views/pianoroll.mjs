// Cap out at this many notes when rendering (for now)
// All of those are currently pre-allocated in the buffers
const MAX_RENDER_NOTES = 512000;
        
/**
 * Hardware-accelerated piano roll view class
 * @experimental
 */
export default class PianoRollView extends LS.View {
    static name = "PianoRollView";

    constructor(options = {}) {
        super({
            name: "PianoRollView",
            title: "Piano Roll",
            container: LS.Create()
        });

        // -- More or less constant values:
        this.baseBeatWidth = Math.max(1, options.baseBeatWidth ?? 96);
        this.baseRowHeight = Math.max(1, options.baseRowHeight ?? 24);
        this.sidebarWidth = 84;
        this.labelBarHeight = 32;

        this.totalNotes = 132; // 11 octaves (C0 to C10) + 1

        this.timeSignature = {
            beatsPerBar: Math.max(1, options.timeSignature?.beatsPerBar ?? 4),
            beatUnit: Math.max(1, options.timeSignature?.beatUnit ?? 4)
        };

        // --- The LS.GL renderer is the core of the piano roll
        this.renderer = options.renderer || new LS.GL.WebGLRenderer({
            ...options,
            backgroundColor: "transparent",
            resizeTo: this.container,
            blockIfHidden: true
        });

        // --- Camera
        this._scrollX = 0;
        this._scrollY = (this.totalNotes / 2) * this.baseRowHeight - 200;
        this._zoomX = 1;
        this._zoomY = 1;

        // --- Items
        // this.items = [...Array(MAX_RENDER_NOTES)].map((_, i) => ({ start: (i * 0.5) * MAX_RENDER_NOTES / 1000000, duration: 200, row: Math.floor((Math.sin(i) * this.totalNotes - 1 + 0.5)), color: [Math.random(), Math.random(), Math.random()] }));
        this.items = [];

        this.__needsSort = false;
        this.notesDirty = true;

        this.previousNote = null;
        this.selectionRect = [false, 0, 0, 0, 0];
        this.tool = "draw"; // draw, freedraw, erase, select, pan, mute, preview

        const self = this;

        // -- Text engine for labels
        this.textEngine = new LS.GL.WebGLTextEngine({
            renderer: this.renderer,

            // fontName: "JetBrainsMonoLite",
            fontName: "UbuntuMonoLite",
            // mtsdf: true,

            // The amount of characters that can be rendered at once
            // We reserve 3 characters per note and some extra
            // (All will be instances!)
            bufferSize: 1024 //MAX_RENDER_NOTES * 4 + 256
        });

        // 512 should be enough for labels
        const numberLabels = this.textEngine.createText(512);

        // Labels for notes, shared text block
        const noteLabels = this.textEngine.createText(MAX_RENDER_NOTES * 4);

        this.textEngine.loadPromise.then(() => {
            this.__prevScrollX = null;
            this.__prevZoomX = null;
            this.renderer.render();
        });

        // --- Renderables (parts of the piano roll)
        this.gridBackground = this.renderer.createRenderable({
            vertex: `#version 300 es

out vec2 vUV;

uniform vec2 resolution;

const vec2 positions[3] = vec2[](
    vec2(-1.0, -1.0),
    vec2( 3.0, -1.0),
    vec2(-1.0,  3.0)
);

void main() {
    vec2 pos = positions[gl_VertexID];
    vUV = pos * 0.5 + 0.5;
    gl_Position = vec4(pos, 0.0, 1.0);
}`,
            fragment: `#version 300 es
precision highp float;

uniform vec2 offset;
uniform vec2 resolution;
uniform vec2 zoom;
uniform vec2 timeSignature;
uniform vec2 gridSize;
uniform float contrast;

uniform float sidebarWidth;

in vec2 vUV;
out vec4 fragColor;

vec3 drawPiano(vec2 uv)
{
    float keyHeight = gridSize.y * zoom.y;

    // White key index
    float whitePos = (uv.y + offset.y) * (1.0 / keyHeight);
    float whiteIndex = floor(whitePos);
    float whiteFrac = fract(whitePos);
    float note = floor(mod(whiteIndex, 12.0));

    vec3 color = note == 11.0? vec3(0.72) : vec3(0.92);

    // White key border
    if (whiteFrac < 0.1 && (note == 0.0 || note == 7.0) && whiteIndex > 0.0)
        color = vec3(0.55);

    // Horizontal separator
    if (uv.x > sidebarWidth - 0.003)
        color = vec3(0.2);

    float x = uv.x / sidebarWidth;

    float blackWidth = 0.62;
    float blackHeight = 0.85;

    bool drawBlack = false;
    if (x < blackWidth) {
             if (note == 1.0)
            drawBlack = true;          // C#
        else if (note == 3.0)
            drawBlack = true;          // D#
        else if (note == 5.0)
            drawBlack = true;          // F#
        else if (note == 8.0)
            drawBlack = true;          // G#
        else if (note == 10.0)
            drawBlack = true;          // A#
    }

    if (drawBlack)
        color = vec3(0.2);

    return mix(vec3(color), vec3(uv.x / (sidebarWidth - 10.0)), 0.2 * contrast);
}

void main() {
    // Here we have the coordinates of the current pixel
    vec2 uv = vUV * resolution;

    // Flip the y-axis so that 0,0 is at the top left
    uv.y = resolution.y - uv.y;
    
    if(uv.y < 32.0) {
        if(uv.y > 30.0) {
            fragColor = vec4(vec3(0.2), 0.8 * contrast);
            return;
        }

        // Draw the top bar area
        fragColor = vec4(vec3(0.05), 0.8 * contrast);
        return;
    }

    if(uv.x < sidebarWidth) {
        if(uv.x > sidebarWidth - 2.0) {
            fragColor = vec4(vec3(0.0), 0.8 * contrast);
            return;
        }

        float mixFactor = 1.0;
        if(uv.x > sidebarWidth - 4.0) {
            mixFactor = 1.0 - (uv.x - (sidebarWidth - 4.0)) * 0.25;
        }

        vec3 pianoColor = drawPiano(uv);

        fragColor = vec4(mix(vec3(0.0), pianoColor, mixFactor), 1.0);
        return;
    }

    // Lines
    if(mod(uv.y + offset.y, gridSize.y * zoom.y) < 1.0 || uv.x < sidebarWidth + 1.0) {
        float keyHeight = gridSize.y * zoom.y;
        float posY = (uv.y + offset.y) * (1.0 / keyHeight);
        float gIndexY = floor(posY);
        float note = floor(mod(gIndexY, 12.0));
        float factor = 0.6;

        if(note == 0.0 || note == 7.0) {
            factor = 1.0;
        }

        fragColor = vec4(0.0, 0.0, 0.0, factor * contrast);
        return;
    }

    if(mod(uv.x + offset.x, gridSize.x * zoom.x) < 1.0 || uv.x < sidebarWidth + 1.0) {
        float factor = 0.6;

        // if we are on a bar line, make it more visible
        if(mod(uv.x + offset.x, gridSize.x * zoom.x * timeSignature.x) < 1.0) {
            factor = 1.0;
        }

        fragColor = vec4(0.0, 0.0, 0.0, factor * contrast);
        return;
    }

    // fract = modulo 1

    // Segments
    float cell = (uv.x + offset.x) * 1.0 / (64.0 * gridSize.x * zoom.x);
    float segmentHighlight = step(0.5, fract(cell)) * 0.5;

    // Rows
    float row = (uv.y + offset.y) * 1.0 / (2.0 * gridSize.y * zoom.y);
    float rowHighlight = step(0.5, fract(row)) * (segmentHighlight > 0.0 ? 0.2 : 0.5);

    fragColor = vec4(0.0, 0.0, 0.0, (segmentHighlight + rowHighlight) * contrast);
}
            `,

            uniforms: ["offset", "resolution", "zoom", "timeSignature", "gridSize", "contrast", "sidebarWidth"],
            attributes: [],

            bindVAO: true,

            onRender(delta, now, gl, cw, ch, updatedDimensions, uniforms, attributes) {
                gl.uniform2f(uniforms.offset, self._scrollX - self.sidebarWidth, self._scrollY - self.labelBarHeight);
                gl.uniform2f(uniforms.resolution, cw, ch);
                gl.uniform2f(uniforms.zoom, self._zoomX, self._zoomY);
                gl.uniform2f(uniforms.timeSignature, self.timeSignature.beatsPerBar, self.timeSignature.beatUnit);
                gl.uniform2f(uniforms.gridSize, self.baseBeatWidth, self.baseRowHeight);
                gl.uniform1f(uniforms.contrast, self.contrast ?? 1.0);
                gl.uniform1f(uniforms.sidebarWidth, self.sidebarWidth);

                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }
        }, false);

        this.notesRenderable = this.renderer.createRenderable({
            vertex: `#version 300 es

in float a_size;
in vec2 a_position;

in vec3 a_color;

uniform float rowHeight;
uniform vec2 offset;
uniform vec2 resolution;
uniform vec2 zoom;

out float v_size;
out vec3 v_color;
out vec2 v_uv;
out vec2 v_position;

const vec2 positions[6] = vec2[](
    vec2(-1.0, -1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0,  1.0),

    vec2(-1.0,  1.0),
    vec2( 1.0, -1.0),
    vec2( 1.0,  1.0)
);

void main() {
    // Calculate the position of the note in screen space
    vec2 pos = a_position + (positions[gl_VertexID] * vec2(a_size, rowHeight));

    // Apply zoom and offset
    pos = (pos * zoom) - offset;

    // Convert to normalized device coordinates
    vec2 ndc = (pos / resolution) * 2.0 - 1.0;
    ndc.y = -ndc.y; // Flip y-axis for WebGL

    gl_Position = vec4(ndc, 0.0, 1.0);

    v_color = a_color;
    v_size = a_size;
    v_position = a_position;

    v_uv = positions[gl_VertexID];
}`,
            fragment: `#version 300 es
precision highp float;

in float v_size;
in vec3 v_color;
in vec2 v_uv;
in vec2 v_position;

out vec4 fragColor;

uniform vec2 resolution;
uniform vec2 zoom;
uniform vec2 offset;
uniform float rowHeight;

uniform float sidebarWidth;

float roundedBoxSDF(vec2 CenterPosition, vec2 Size, float Radius) {
    return length(max(abs(CenterPosition)-Size+Radius,0.0))-Radius;
}

void main() {
    if(gl_FragCoord.x < sidebarWidth || (resolution.y - gl_FragCoord.y) < 32.0) {
        discard;
    }

    // Apply non-uniform zoom
    vec2 size = vec2(v_size, rowHeight) * zoom;

    float d = roundedBoxSDF((v_uv - 0.5) * size, size * 0.5, 4.0);

    float aa = fwidth(d); // Anti-aliasing factor
    float alpha = 1.0 - smoothstep(0.0, 0.0, d);
    
    vec3 color = v_color.rgb - (v_uv.y * 0.2);

    float edge1 = -3.5;
    float edge2 = -1.5;
    float border1 = smoothstep(edge1 - aa, edge1 + aa, d);
    float border2 = smoothstep(edge2 - aa, edge2 + aa, d);
    color = mix(color, vec3(1.0), border1 * 0.15);
    color = mix(color, vec3(0.0), border2 * 0.6);




    fragColor = vec4(color, alpha);
}`,

            uniforms: ["offset", "resolution", "zoom", "rowHeight", "sidebarWidth"],
            attributes: ["a_position", "a_size", "a_color"],

            bindVAO: true,

            onSetup(gl, program, uniforms, attributes) {
                this.positionBuffer = this.createBufferForAttribute(attributes.a_position, MAX_RENDER_NOTES, 2);
                this.sizeBuffer = this.createBufferForAttribute(attributes.a_size, MAX_RENDER_NOTES, 1);
                this.colorBuffer = this.createBufferForAttribute(attributes.a_color, MAX_RENDER_NOTES, 3);
            },

            onRender(delta, now, gl, cw, ch, updatedDimensions, uniforms, attributes) {
                const viewWidth = cw / self._zoomX;

                if (self.notesDirty) {// || self.__prevScrollX !== self._scrollX || self.__prevZoomX !== self._zoomX || self.__prevScrollY !== self._scrollY || self.__prevZoomY !== self._zoomY) {
                    const firstVisibleRow = Math.floor(self._scrollY / (self.baseRowHeight * self._zoomY));
                    const lastVisibleRow = Math.ceil((self._scrollY + ch) / (self.baseRowHeight * self._zoomY));

                    let j = 0;
                    for (let i = 0; i < Math.min(self.items.length, MAX_RENDER_NOTES); i++) {
                        // this.once = true;
                        const note = self.items[i];

                        // if(note.row < firstVisibleRow || note.row > lastVisibleRow || (note.start + note.duration) * self._zoomX < self._scrollX || note.start * self._zoomX > self._scrollX + viewWidth) {
                        //     continue;
                        // }

                        this.positionBuffer.set(j * 2, note.start);
                        this.positionBuffer.set(j * 2 + 1, note.row * self.baseRowHeight);

                        this.sizeBuffer.set(j * 2, Math.max(1, note.duration));

                        const [r, g, b] = note.color ?? [0.8, 0.5, 1.0];
                        this.colorBuffer.set(j * 3, r);
                        this.colorBuffer.set(j * 3 + 1, g);
                        this.colorBuffer.set(j * 3 + 2, b);

                        j++;

                        // noteLabels.writeTextAt("test", i * 4, 4, note.start * self._zoomX - self._scrollX, note.row * self.baseRowHeight * self._zoomY - self._scrollY, 255, 0, 0, 255);
                    }

                    this.__visibleNotes = j;

                    this.positionBuffer.update();
                    this.sizeBuffer.update();
                    this.colorBuffer.update();
                    self.notesDirty = false;
                }

                if(updatedDimensions) {
                    // If the dimensions have changed
                    self.scrollX = self._scrollX;
                    self.scrollY = self._scrollY;
                }

                let reserved = 0;

                // Top bar labels
                if (self.__prevScrollX !== self._scrollX || self.__prevZoomX !== self._zoomX || self.__prevScrollY !== self._scrollY || self.__prevZoomY !== self._zoomY || updatedDimensions) {
                    self.__prevScrollX = self._scrollX;
                    self.__prevScrollY = self._scrollY;
                    self.__prevZoomX = self._zoomX;
                    self.__prevZoomY = self._zoomY;

                    const pixelsPerBeat = self.baseBeatWidth * self._zoomX;
                    let labelSpacing = self.textEngine.cellWidth * 5; // minimum space between labels

                    let labelStep = Math.max(1, Math.ceil(labelSpacing / pixelsPerBeat));

                    let labelCount = ((self.renderer.width - self.sidebarWidth) / pixelsPerBeat);
                    let preBuffer = Math.floor(self.sidebarWidth / pixelsPerBeat);

                    const y = (self.labelBarHeight / 2) - (self.textEngine.cellHeight / 2);

                    for (let i = 0; i < labelCount + preBuffer + 1; i++) {
                        const number = i - preBuffer + Math.floor(self._scrollX / pixelsPerBeat);

                        if (number < 0 || number % labelStep !== 0) continue;

                        const label = number.toString();
                        const length = label.length;

                        numberLabels.writeTextAt(
                            label,
                            reserved,
                            length,
                            (self.sidebarWidth - self._scrollX % pixelsPerBeat) + (i - preBuffer) * pixelsPerBeat,
                            y,
                            255, 255, 255, 255
                        );

                        reserved += length;
                    }
                    
                    // Key labels
                    // Sadly we have to do both as of now since the text block is shared
                    // In the future we should not generate per frame at all but use offsets

                    const pixelsPerRow = self.baseRowHeight * self._zoomY;
                    if(pixelsPerRow > self.textEngine.cellHeight + 2) {
                        labelStep = Math.max(1, Math.ceil(self.textEngine.cellHeight / pixelsPerRow));
                        labelCount = ((self.renderer.height - self.labelBarHeight) / pixelsPerRow);
                        preBuffer = Math.floor(self.labelBarHeight / pixelsPerRow);
                        const padding = 4;
                        const renderedC = [];

                        // First pass: render C labels only
                        for (let i = 0; i < labelCount + preBuffer + 1; i++) {
                            const row = i - preBuffer + Math.floor(self._scrollY / pixelsPerRow);

                            if (row < 0 || row >= self.totalNotes || row % labelStep !== 0)
                                continue;

                            const noteName = self.getNoteName(row);
                            const isC = noteName.charCodeAt(0) === 67 && noteName.charCodeAt(1) !== 35;
                            const isBlack = noteName.charCodeAt(1) === 35;

                            if(isBlack) continue;

                            const y =
                                (self.labelBarHeight - self._scrollY % pixelsPerRow) +
                                (i - preBuffer) * pixelsPerRow +
                                (pixelsPerRow / 2) -
                                (self.textEngine.cellHeight / 2);

                            if (y < self.labelBarHeight)
                                continue;

                            const length = noteName.length;
                            const x = self.sidebarWidth - padding - (self.textEngine.cellWidth * length);

                            numberLabels.writeTextAt(
                                noteName,
                                reserved,
                                length,
                                x - 5,
                                y,
                                0, 0, 0, isC? 200: 64
                            );

                            reserved += length;
                            renderedC.push(y);
                        }
                    }
                }

                if(reserved) {
                    // // Clear remaining space
                    // numberLabels.clear(reserved);

                    // Clear remaining space by changing the range (faster when rendering in ranges (standalone), otherwise clear must be used to actually clear the text block)
                    numberLabels.clip(0, reserved);
                }

                // noteLabels.setText(`Scroll: (${self._scrollX.toFixed(2)}, ${self._scrollY.toFixed(2)}), Zoom: (${self._zoomX.toFixed(2)}, ${self._zoomY.toFixed(2)})`, self.contrast < 0.8 ? "black" : "white");

                gl.uniform2f(uniforms.offset, self._scrollX - self.sidebarWidth, self._scrollY - self.labelBarHeight);
                gl.uniform2f(uniforms.zoom, self._zoomX, self._zoomY);
                gl.uniform2f(uniforms.resolution, cw, ch);
                gl.uniform1f(uniforms.rowHeight, self.baseRowHeight);
                gl.uniform1f(uniforms.sidebarWidth, self.sidebarWidth);

                gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.__visibleNotes);
                numberLabels.render();
            }
        }, false);

        this.selectionRectRenderable = this.renderer.createRenderable({
            vertex: LS.GL.shaders.basic_quad,
            fragment: `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform vec2 uScale;
uniform vec2 resolution;

void main() {
    fragColor = vec4(0.4, 0.6, 0.8, 0.4);
}`,
            uniforms: ["uOffset", "uScale", "pxSize", "resolution"],
            attributes: [],

            bindVAO: true,

            // i spent SO MUCH fucking time and nerves on this bullshit
            onRender(delta, now, gl, cw, ch, updatedDimensions, uniforms, attributes) {
                if(!self.selectionRect[0]) return;
                let x = self.selectionRect[1] + self.sidebarWidth  - self._scrollX;
                let y = self.selectionRect[2] + self.labelBarHeight - self._scrollY;
                let w = self.selectionRect[3] + self.sidebarWidth  - self._scrollX;
                let h = self.selectionRect[4] + self.labelBarHeight - self._scrollY;

                const row  = Math.floor((y - self.labelBarHeight + self._scrollY) / (self.baseRowHeight * self._zoomY));
                const row2 = Math.floor((h - self.labelBarHeight + self._scrollY) / (self.baseRowHeight * self._zoomY));
                const isNegative = (y > h);

                y = (row + (isNegative ? 1 : 0)) * self.baseRowHeight * self._zoomY - self._scrollY + self.labelBarHeight;
                h = row2 * self.baseRowHeight * self._zoomY - self._scrollY + self.labelBarHeight;

                console.log(`Selection rect: (${x}, ${y}, ${w}, ${h}), rows: (${row}, ${row2})`);

                w -= x;
                h -= y;

                h = isNegative? Math.min(self.baseRowHeight * self._zoomY, h): Math.max(self.baseRowHeight * self._zoomY, h);

                y *= 2.0;
                x *= 2.0;

                gl.uniform2f(uniforms.uOffset, (x + w - cw) / cw, ((y + h - ch) / ch));
                gl.uniform2f(uniforms.uScale, Math.abs(w) / cw, Math.abs(h) / ch);
                gl.uniform2f(uniforms.pxSize, x, y);

                if(updatedDimensions) {
                    gl.uniform2f(uniforms.resolution, cw, ch);
                }

                this.renderer.scissor(self.sidebarWidth, self.labelBarHeight);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
                this.renderer.endScissor();
            }
        }, false);

        let activeNote = null, initial = [0, 0], mode = 0, edgeScrollOffset = [0, 0];
        this.touchHandle = new LS.Util.TouchHandle(this.renderer.canvas, {
            calculateBounds: true,

            frameTimed: true,
            fluentFrames: true,

            edgeScroll: true,

            transformBounds: (rect) => {
                return {
                    x: rect.x + this.sidebarWidth,
                    y: rect.y + this.labelBarHeight,
                    width: rect.width - this.sidebarWidth,
                    height: rect.height - this.labelBarHeight
                }
            },

            onStart: (event) => {
                activeNote = null;
                mode = 0;

                this.renderer.canvas.style.cursor = "";

                const button = +event.domEvent.button ?? 0;
                this.touchHandle.edgeScroll = button !== 1;
                this.touchHandle.inertia = false;
                edgeScrollOffset[0] = 0;
                edgeScrollOffset[1] = 0;

                event.__scrolled = false;

                if (event.boundX < 0) {
                    // Clicking on the piano key area, ignore for now
                    return event.cancel();
                }

                if (button === 0) for (const note of this.getIntersectingNotesAt(event.boundX, event.boundY, [4, 4])) {
                    activeNote = note;
                    initial[0] = note.start;
                    initial[1] = note.duration;

                    const noteX = note.start * this.zoomX - this.scrollX;
                    const noteY = note.row * this.baseRowHeight * this.zoomY - this.scrollY;
                    const noteW = note.duration * this.zoomX;
                    const noteH = this.baseRowHeight * this.zoomY;

                    console.log(`Note bounds: (${noteX}, ${noteY}, ${noteW}, ${noteH})`);
                    console.log(`Mouse position: (${event.boundX}, ${event.boundY})`);

                    if (event.boundX > noteX + 4 && event.boundX < noteX + noteW - 4) {
                        mode = 1; // Dragging the note
                    } else {
                        // Resizing the note
                        mode = (event.boundX < noteX + 10) ? 2 : 3;
                    }

                    this.touchHandle.cursor = mode === 1 ? "var(--ls-timeline-cursor-move)" : "ew-resize";
                    return;
                }

                if (button === 1) {
                    if (event.domEvent.altKey || event.domEvent.ctrlKey) {
                        this.touchHandle.cursor = "none";
                        mode = event.domEvent.altKey ? 6 : 7;
                    } else {
                        this.touchHandle.cursor = "grabbing";
                        this.touchHandle.inertia = true;
                        mode = 0;
                    }
                } else if (button === 0) {
                    if (event.domEvent.ctrlKey) {
                        // Selection
                        mode = 8;
                        this.touchHandle.cursor = "crosshair";
                        this.selectionRect[0] = 1;
                        this.selectionRect[1] = event.boundX + this.scrollX;
                        this.selectionRect[2] = event.boundY + this.scrollY;
                        this.selectionRect[3] = event.boundX + this.scrollX;
                        this.selectionRect[4] = event.boundY + this.scrollY;
                        this.renderer.render();
                        return;
                    }

                    mode = 4;

                    if (this.tool === "draw") {
                        const row = Math.floor((event.boundY + this.scrollY) / (this.baseRowHeight * this.zoomY));
                        const startPos = (event.boundX + this.scrollX) / this.zoomX;
                        const start = event.domEvent?.altKey === true ? startPos : this._snap(startPos, this.baseBeatWidth);

                        const paintingSize = event.domEvent?.shiftKey === true;

                        activeNote = {
                            start: start,
                            duration: paintingSize ? (event.domEvent?.altKey === true ? 1 : this.baseBeatWidth) : (this.previousNote ? this.previousNote.duration || this.baseBeatWidth : this.baseBeatWidth),
                            row: row
                        };

                        this.items.push(activeNote);
                        this.touchHandle.cursor = "var(--ls-timeline-cursor-move)";
                        initial[0] = activeNote.start;
                        initial[1] = activeNote.duration;
                        this.notesDirty = true;

                        // Dragging the note
                        mode = paintingSize ? 3 : 1;

                        this.renderer.render();
                    }
                } else if (button === 2) {
                    this.touchHandle.cursor = "var(--ls-timeline-cursor-erase)";
                    mode = 5;
                }
            },

            onScroll: (deltaX, deltaY, event) => {
                // Clamp the edge scroll offset
                const scrollDeltaX = Math.max(-this._scrollX, deltaX);
                const scrollDeltaY = Math.max(-this._scrollY, deltaY);

                if (scrollDeltaX) {
                    this.scrollX += scrollDeltaX;
                    edgeScrollOffset[0] += scrollDeltaX;
                    event.__scrolled = true;
                }

                if (scrollDeltaY) {
                    this.scrollY += scrollDeltaY;
                    edgeScrollOffset[1] += scrollDeltaY;
                    event.__scrolled = true;
                }
            },

            onMove: (event) => {
                if (!event.hasMoved && !event.__scrolled) return;
                event.__scrolled = false;

                let nothingToDo = false;

                const unlockedSnap = (event.domEvent && event.domEvent.altKey) || this._zoomX > 2.0;
                let snapDistance = unlockedSnap ? 1 : this.baseBeatWidth;
                const snapOffset = initial[0] % snapDistance;

                const keepRelative = event.domEvent && !event.domEvent.shiftKey;

                switch (mode) {
                    case 0: // Panning the view
                        this.scrollX -= event.dx;
                        this.scrollY -= event.dy;
                        nothingToDo = true;
                        break;

                    case 1: // Dragging the note
                        let start = initial[0] + (event.offsetX + edgeScrollOffset[0]) / this.zoomX;

                        if (snapDistance > 0) {
                            if (keepRelative) {
                                start = this._snap(start, snapDistance, snapOffset);
                            } else {
                                start = Math.round(start / snapDistance) * snapDistance;
                            }
                        }

                        activeNote.start = Math.max(0, start);
                        activeNote.row = Math.max(0, Math.min(this.totalNotes - 1, Math.floor((event.boundY + this.scrollY) / (this.baseRowHeight * this.zoomY))));
                        this.notesDirty = true;
                        break;

                    case 2: { // Resize left
                        let start = initial[0] + (event.offsetX + edgeScrollOffset[0]) / this.zoomX;
                        const end = initial[0] + initial[1];

                        if (snapDistance > 0) {
                            if (keepRelative) {
                                start = this._snap(start, snapDistance, snapOffset);
                            } else {
                                start = this._snap(start, snapDistance);
                            }
                        }

                        start = Math.max(0, Math.min(start, end - (unlockedSnap ? 1 : this.baseBeatWidth)));

                        activeNote.start = start;
                        activeNote.duration = Math.max(1, end - start);
                        this.notesDirty = true;

                        LS.Tooltips.position(this.touchHandle.boundingRect.left + 10, this.touchHandle.boundingRect.top + 10);
                        LS.Tooltips.set(`Start: ${(activeNote.start / this.baseBeatWidth).toFixed(2)} steps, Length: ${(activeNote.duration / this.baseBeatWidth).toFixed(2)} steps`);
                        LS.Tooltips.show();
                        break;
                    }

                    case 3: { // Resize right
                        let end = initial[0] + initial[1] + (event.offsetX + edgeScrollOffset[0]) / this.zoomX;

                        if (snapDistance > 0) {
                            const offset = keepRelative
                                ? (initial[0] + initial[1]) % snapDistance
                                : 0;

                            if (keepRelative) {
                                end = this._snap(end, snapDistance, offset);
                            } else {
                                end = this._snap(end, snapDistance);
                            }
                        }

                        activeNote.duration = Math.max(1, unlockedSnap ? 1 : Math.min(this.baseBeatWidth, initial[1]), end - activeNote.start);
                        this.notesDirty = true;

                        LS.Tooltips.position(this.touchHandle.boundingRect.left + 10, this.touchHandle.boundingRect.top + 10);
                        LS.Tooltips.set(`Start: ${(activeNote.start / this.baseBeatWidth).toFixed(2)} steps, Length: ${(activeNote.duration / this.baseBeatWidth).toFixed(2)} steps`);
                        LS.Tooltips.show();
                        break;
                    }

                    case 4: // Tool
                        break;

                    case 5: // Remove
                        nothingToDo = true;
                        for (const note of this.getIntersectingNotesAt(event.boundX, event.boundY, [4, 4])) {
                            const index = this.items.indexOf(note);
                            if (index !== -1) {
                                this.items.splice(index, 1);
                                this.notesDirty = true;
                                nothingToDo = false;
                            }
                        }
                        break;

                    case 6: // Zoom X
                        this.zoomFrom(event.boundX, 0, event.dy, 1.1, 1.0);
                        break;

                    case 7: // Zoom Y
                        this.zoomFrom(0, event.boundY, event.dy, 1.0, 1.1);
                        break;

                    case 8: // Selection
                        this.selectionRect[3] = event.boundX + this.scrollX;
                        this.selectionRect[4] = event.boundY + this.scrollY;
                        break;
                }

                if (!nothingToDo) {
                    this.renderer.render();
                }
            },

            onEnd: (event) => {
                this.previousNote = {
                    start: activeNote?.start,
                    duration: activeNote?.duration,
                    row: activeNote?.row
                }

                if(this.selectionRect[0]) {
                    this.selectionRect[0] = false;
                    this.renderer.render();
                }

                LS.Tooltips.hide();

                activeNote = null;
            }
        });

        this.addExternalEventListener(this.renderer.canvas, "pointermove", (event) => {
            if (this.touchHandle.seeking || activeNote) return;

            const rect = this.renderer.canvas.getBoundingClientRect();

            // TODO: zIndex & optimize
            const wX = event.clientX - rect.left - this.sidebarWidth;
            const wY = event.clientY - rect.top - this.labelBarHeight;

            const note = this.getIntersectingNotesAt(wX, wY, [4, 4], true);
            if (!note) {
                this.renderer.canvas.style.cursor = "";
                return;
            }

            const noteX = note.start * this.zoomX - this.scrollX;
            const noteY = note.row * this.baseRowHeight * this.zoomY - this.scrollY;
            const noteW = note.duration * this.zoomX;
            const noteH = this.baseRowHeight * this.zoomY;

            if (wX > noteX + 4 && wX < noteX + noteW - 4) {
                this.renderer.canvas.style.cursor = "var(--ls-timeline-cursor-move)";
            } else {
                this.renderer.canvas.style.cursor = "ew-resize";
            }
        });

        this.addExternalEventListener(this.container, "wheel", (event) => {
            if (event.ctrlKey) {
                const rect = this.renderer.canvas.getBoundingClientRect();
                const mouseX = event.clientX - rect.left;
                this.zoomFrom(mouseX, 0, event.deltaY, 1.1, 1.0);
            } else if (event.altKey) {
                const rect = this.renderer.canvas.getBoundingClientRect();
                const mouseY = event.clientY - rect.top;
                this.zoomFrom(0, mouseY, event.deltaY, 1.0, 1.1);
            } else {
                if (event.shiftKey) {
                    this.scrollX += event.deltaY;
                } else {
                    this.scrollY += event.deltaY;
                }
            }

            event.preventDefault();
        });

        // Things to render (order matters)
        this.renderer.renderables = [this.gridBackground, this.notesRenderable, this.selectionRectRenderable];

        // Expose some things for debugging
        window.textBlock = numberLabels;
        window.test = this.renderer;
        window.pianoRollView = this;

        this.container.appendChild(this.renderer.canvas);

        // Undo/Redo action events (history management is external)
        this.__actionEventRef = this.prepareEvent("action");

        // Set initial contrast based on theme
        this.contrast = LS.Color.theme === "dark" ? 1.0 : 0.6;
        this.addExternalEventListener(LS.Color, "theme-changed", (theme) => {
            this.contrast = theme === "dark" ? 1.0 : 0.6;
            this.renderer.render();
        });
    }

    #duration = 0;

    set scrollX(value) {
        value = Math.max(0, value);
        if (value === this._scrollX) return;
        this._scrollX = value;
        this.renderer.render();
    }

    get scrollX() {
        return this._scrollX;
    }

    set scrollY(value) {
        const maxScrollY = Math.max(0, ((this.totalNotes * this.baseRowHeight) * this._zoomY) - ((this.renderer.height - this.labelBarHeight)));
        value = Math.max(0, Math.min(Number(value), maxScrollY));

        if (value === this._scrollY) return;

        this._scrollY = value;
        this.renderer.render();
    }

    get scrollY() {
        return this._scrollY;
    }

    set zoomX(value) {
        value = Math.max(0.1, Math.min(5, value));
        if (value === this._zoomX) return;
        this._zoomX = value;
        this.renderer.render();
    }

    get zoomX() {
        return this._zoomX;
    }

    set zoomY(value) {
        value = Math.max(0.5, Math.min(5, value));
        if (value === this._zoomY) return;
        this._zoomY = value;
        this.renderer.render();
    }

    get zoomY() {
        return this._zoomY;
    }

    binarySearch(time) {
        const items = this.items;
        let low = 0;
        let high = items.length - 1;

        while (low <= high) {
            const mid = (low + high) >>> 1;
            if (items[mid].start < time) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return low;
    }

    sortItems() {
        this.items.sort((a, b) => (a.start || 0) - (b.start || 0));

        this.itemMap.clear();

        let totalDuration = 0;
        this.maxDuration = 0;

        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (!item.id) {
                item.id = LS.Misc.uid();
            }

            this.itemMap.set(item.id, item);

            item.start = Math.max(0, num(item.start));
            item.duration = Math.max(0, num(item.duration));
            item.row = Math.max(0, Math.floor(num(item.row)));

            if (!item.data) item.data = {};
            if (item.duration > this.maxDuration) this.maxDuration = item.duration;
            const end = item.start + item.duration;
            if (end > totalDuration) totalDuration = end;
        }

        this.__needsSort = false;

        if (totalDuration !== this.#duration) {
            this.#duration = totalDuration;
            this.quickEmit("duration-changed", this.#duration);
        }
    }

    /**
     * Emit an action event for external history management.
     * External code should listen to the "action" event and store the action for undo/redo.
     * @param {Object} action - The action data to emit
     */
    emitAction(action) {
        action.source = this;
        this.quickEmit(this.__actionEventRef, action);
    }

    _snap(value, snapDistance, snapOffset = 0) {
        return Math.round((value - snapOffset) / snapDistance) * snapDistance + snapOffset;
    }

    zoomFrom(mouseX = 0, mouseY = 0, delta = 0, zoomFactorX = 1.1, zoomFactorY = 1.1) {
        if (zoomFactorX && zoomFactorX !== 1.0) {
            const oldZoomX = this._zoomX;
            let newZoomX = oldZoomX;
            if (delta < 0) {
                newZoomX *= zoomFactorX;
            } else {
                newZoomX /= zoomFactorX;
            }

            this.zoomX = newZoomX;
            this.scrollX = this._scrollX; // Ensure scrollX is clamped
            if (this._zoomX === newZoomX) this.scrollX = (mouseX + this.scrollX) * (newZoomX / oldZoomX) - mouseX;
        }

        if (zoomFactorY && zoomFactorY !== 1.0) {
            const oldZoomY = this._zoomY;
            let newZoomY = oldZoomY;
            if (delta < 0) {
                newZoomY *= zoomFactorY;
            } else {
                newZoomY /= zoomFactorY;
            }

            this.zoomY = newZoomY;
            this.scrollY = this._scrollY; // Ensure scrollY is clamped
            if (this._zoomY === newZoomY) this.scrollY = (mouseY + this.scrollY) * (newZoomY / oldZoomY) - mouseY;
        }
    }

    getNoteName(row) {
        row = this.totalNotes - 1 - row; // Invert
        const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const octave = Math.floor(row / 12);
        const noteIndex = row % 12;
        return `${noteNames[noteIndex]}${octave}`;
    }

    render(delta, now, gl, cw, ch, updatedDimensions) {
        if (this.destroyed) return;
    }

    getIntersectingNotesAt(x, y, buffer = [0, 0], topOnly = false) {
        const row = Math.floor((y + this.scrollY) / (this.baseRowHeight * this.zoomY));
        const start = (x + this.scrollX) / this.zoomX;

        let notes = this.items[topOnly ? "find" : "filter"](note => note.row === row && start >= note.start - buffer[0] && start <= note.start + note.duration + buffer[1]);
        return notes;
    }

    setNotes(notes) {
        this.items = notes;
        this.notesDirty = true;
        this.renderer.render();
    }

    destroy() {
        if (this.destroyed) return;
        this.renderer.destroy();
        this.touchHandle.destroy();
        this.__actionEventRef = null;
        this.items = null;
        this.itemMap = null;
        super.destroy();
    }
}

// document.head.appendChild(document.createElement("style")).textContent = `
// canvas.ls-draggable {
//     transform: scale(7.5) translate(-50px, -10px);
//     transform-origin: top left;
//     image-rendering: pixelated;
// }
// `;