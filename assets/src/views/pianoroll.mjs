// Cap out at this many notes when rendering (for now)
// All of those are currently pre-allocated in the buffers
// const MAX_RENDER_NOTES = 512000;
const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Hardware-accelerated piano roll
 * @experimental
 */
class PianoRoll extends LS.Timeline {
    constructor(options = {}) {
        super({
            backgroundFragment: `#version 300 es
precision highp float;

uniform vec2 offset;
uniform vec2 resolution;
uniform vec2 zoom;
uniform vec2 timeSignature;
uniform vec2 gridSize;
uniform float contrast;

uniform float sidebarWidth;
uniform float labelBarHeight;

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
    
    if(uv.y < labelBarHeight) {
        if(uv.y > labelBarHeight - 2.0) {
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
            itemFragment: `#version 300 es
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

float roundedBoxSDF(vec2 CenterPosition, vec2 Size, float Radius) {
    return length(max(abs(CenterPosition)-Size+Radius,0.0))-Radius;
}

void main() {
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
            grid: { w: 96, h: 24 },
            sidebarWidth: 84,
            maxRows: 132, // 11 octaves (C0 to C10) + 1
            timeSignature: { x: 4, y: 4 },
            tool: "paint",
            minZoomY: 0.25,
            ...options
        });

        this.totalNotes = this.maxRows;
        this.scrollY = (this.totalNotes / 2) * this.baseRowHeight - 200;
    }

    getNoteName(row) {
        row = this.totalNotes - 1 - row; // Invert
        const octave = Math.floor(row / 12);
        const noteIndex = Math.abs(row) % 12;
        return `${noteNames[noteIndex]}${octave}`;
    }

    getRowLabel(row) {
        const noteName = this.getNoteName(row);
        const isBlack = noteName.charCodeAt(1) === 35;
        const isMajor = noteName.charCodeAt(0) === 67 && !isBlack;

        if(isBlack) return [null];

        const align = 2;
        const padding = 10;

        const c = isMajor? 64: 160;
        return [noteName, 0, 0, align, padding, c, c, c, 255];
    }

    getLabel(item) {
        return [item.label || this.getNoteName(item.row), 48];
    }
}

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

        this.pianoRoll = new PianoRoll({
            container: this.container,
            ...options
        });
    }

    setNotes(notes) {
        this.items = notes;
        this.pianoRoll.renderer.render();
    }

    destroy() {
        if (this.destroyed) return;
        this.pianoRoll.destroy();
        this.pianoRoll = null;
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