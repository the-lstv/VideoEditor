class Basic extends LS.GL.Renderable {
    constructor(options = {}) {
        super({
            fragment: LS.GL.shaders.basic_color_fragment,
            vertex: `#version 300 es
precision highp float;

in float y;

uniform float samples;
uniform mat4 uProjection;

void main() {
    gl_Position = vec4((float(gl_VertexID) / samples) * 2.0 - 1.0, y, 0.0, 1.0);
}
`,
            vao: true,
            attributes: ["y"],
            uniforms: ["samples", "uColor", "uProjection"],
            ...options
        });

        this.width = options.width || 100;
        this.height = options.height || 100;

        this.style = options.style || {};

        this.element = document.createElement("div");
        this.element.style.width = this.width + "px";
        this.element.style.height = this.height + "px";
        
        const gl = this.renderer.gl;
        
        this.buffer = gl.createBuffer();
        LS.GL.WebGLBuffer.bindToAttribute(gl, this.buffer, false, this.attributes.y, 1, gl.FLOAT, false, 0, 0, 0);
        
        // Bind the div to the renderable
        this.boundingContainer = this.element;
        this.rect = { x: 0, y: 0, width: 0, height: 0 };
    }

    render(delta, now, gl, cw, ch, updatedDimensions, uniforms, attributes, projectionMatrix) {
        const attachment = this.attachedTo || this.parent;
        if(!attachment || !attachment.engine) {
            console.warn("PlaybackPanel: cannot render visualizer without an attachment or parent project with an engine");
            return;
        }

        const samples = attachment.engine.floatView;
        if(!samples || samples.length < sampleCount) {
            console.warn("PlaybackPanel: cannot render visualizer without a valid sample buffer");
            return;
        }

        const count = Math.min(samples.length, sampleCount);

        // Nicely, we can directly upload the Float32Array to the GPU without needing to do further conversions or copies
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, samples, gl.DYNAMIC_DRAW);

        const color = LS.Color.currentAccent;
        gl.uniform4f(uniforms.uColor, color[0] / 255, color[1] / 255, color[2] / 255, 1);

        gl.uniformMatrix4fv(uniforms.uProjection, false, projectionMatrix);
        gl.uniform1f(uniforms.samples, count);
        gl.drawArrays(gl.LINE_STRIP, 0, count);

        console.log("Rendering visualizer with", count, "samples");
    }

    destroy() {
        if(this.buffer) {
            this.renderer.gl.deleteBuffer(this.buffer);
            this.buffer = null;
        }

        super.destroy();
    }
}

export { Basic }