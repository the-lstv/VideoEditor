const vertex = `#version 300 es

out vec2 Pozice;

const vec2 positions[3] = vec2[](
    vec2(-1.0, -1.0),
    vec2( 3.0, -1.0),
    vec2(-1.0,  3.0)
);

void main() {
    vec2 pos = positions[gl_VertexID];
    Pozice = pos * 0.5 + 0.5;
    gl_Position = vec4(pos, 0.0, 1.0);
}`;







const fragment = `#version 300 es

precision highp float;

out vec4 fragColor;
in  vec2 Pozice;

uniform float time;

void main() {
    float animace = sin(time * 0.001) * 0.5 + 0.5;
    
    fragColor = vec4(0.0, 1.0, Pozice.x * Pozice.y, 1.0);
    // if(Pozice.x < animace) {
    //     fragColor = vec4(0.0, 0.0, Pozice.x * Pozice.y, 1.0);
    // } else {
    // }
}
`;






export default class TestView extends LS.View {
    constructor(options = {}) {
        super({
            name: "TestView",
            title: "Test View",
            container: LS.Create()
        });

        this.renderer = new LS.GL.Renderer({
            ...options,
            backgroundColor: "transparent",
            resizeTo: this.container,
            blockIfHidden: true
        });

        this.textEngine = new LS.GL.TextEngine({
            renderer: this.renderer,
            fontName: "UbuntuMono",
            mtsdf: true,
            bufferSize: 1024
        });

        const textBlock = this.textEngine.createText(256);
        const self = this;

        this.test = this.renderer.createRenderable({
            vertex,
            fragment,

            uniforms: ["time"],
            attributes: [],

            onSetup(gl, program, uniforms, attributes) {
                // An empty VAO is required in WebGL2
                this.vao = gl.createVertexArray();
            },

            onRender(delta, now, gl, cw, ch, updatedDimensions, uniforms, attributes) {
                gl.bindVertexArray(this.vao);

                gl.uniform1f(uniforms.time, now);

                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }
        }, false);

        // Things to render (order matters)
        this.renderer.renderables = [this.test, this.textEngine];

        this.container.appendChild(this.renderer.canvas);

        this.renderer.frameScheduler.start();
        window.f = this.renderer.frameScheduler;

        this.textEngine.loadPromise.then(() => {
            this.renderer.render();
        });
    }

    destroy() {
        if(this.destroyed) return;
        this.renderer.destroy();
        super.destroy();
    }
}