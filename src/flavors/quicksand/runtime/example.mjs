// QuickSand example

import * as QuickSand from "./index.mjs";

// Create a new game instance
const game = new QuickSand.GameRuntime({
    // Renderer to use for the game; QuickSand works with LS.GL
    renderer: "LS.GL.WebGLRenderer",

    // Renderer options for the selected renderer
    rendererOptions: {
        width: 800,
        height: 600,
    },

    // Describe sounds
    soundbox: {
        srcPrefix: "./assets/audio/",
        sounds: {
            "mew": { src: "meow.ogg" }
        }
    },

    // Describe assets that can be loaded
    assets: {
        srcPrefix: "./assets/",

        map: {
            // Example of adding a texture
            "example": { src: "images/example.png" },

            // Example of adding a texture atlas
            "player": { src: "images/atlas.png", atlasData: [
                { name: "stand", region: [0, 100, 286, 62] },
                { name: "walk",  region: [486, 100, 131, 113] },
                { name: "idle",  region: [0, 0, 649, 100] },
            ] },
        }
    },

    modules: []
});

game.init().then(async () => {
    // Load a texture atlas (.get() or .load() reads/downloads the image once, and our atlas is automatically created as defined above.)
    const atlas = QuickSand.TextureAtlas.from(await game.assets.get("player"));

    // A "TextureAtlas" can be created from any texture, and it either uses the atlas from the asset definition if there is one, or you can add your own regions. A "full" region is created by default.
    // The regions are then treated as any other Texture() object; an "atlas.region.walk" is just like a regular Texture() object.
    // You can also create standalone Texture() objects with any region by simply doing new QuickSand.Texture(atlas.texture, [x, y, width, height])

    // Create a simple sprite
    const player = new QuickSand.Sprite({ texture: atlas.regions.stand, position: [100, 100] });

    // And a container (this will be our "scene"; QuickSand doesn't manage a global scene by default, instead you draw anything you want whenever you want.)
    const container = new QuickSand.Container([ player ]);
    
    // QuickSand is a lower-level engine, so we also need to create a sprite renderer (something that will draw the sprites to the screen)
    // There are various options available, as QuickSand allows you to directly create custom WebGL renderables.

    // BatchedSpriteRenderer is efficient, but highly preffers that all sprites use the same layer, texture and shader.
    // You can use different types based on your use case to get the best performance/feature balance.
    // Keep in mind that renderers are expensive, so reuse them whenever you can.
    const spriteRenderer = new QuickSand.BatchedSpriteRenderer(game.renderer, { batchSize: 2 });

    // Playing audio is built in with LS.SoundBox
    game.soundbox.play("mew");
    // There is of course a whole lot more this can do; see LS.SoundBox


    // Scenes are fully optional but provide simpler resource isolation.
    const scene = game.createScene();
    scene.onFrame((delta, now) => {
        // Move the player to the mouse position
        player.setPosition(game.input.mouse);

        // Changing the texture is also straightforward
        // (Optionally, you can also add a new named region and the update that region's values, eg. for animated tiles, etc.)
        player.texture = atlas.regions.walk;

        // Render the container with the sprite renderer
        spriteRenderer.render(container);
    });

    // Scenes can be enabled or disabled.
    scene.enable();

    // Finally, we can resume the runtime, which will start the render loop and enable input.
    // You can control the render loop yourself (game.renderer.frameScheduler -> LS.Util.FrameScheduler) but this is the simplest way to get started.
    // It also allows you to monitor or limit the framerate & controls the global time, so you can implement custom timing logic.
    game.resume();

    // We can link resources to the scene for easier cleanup.
    scene.assignResource(spriteRenderer, container, player);
    setTimeout(() => {
        // After 5 seconds, we can destroy the scene and all its resources.
        scene.destroy();
    }, 5000);



    // --- Rendering text with LS.GL.WebGLTextEngine
    const textEngine = new LS.GL.WebGLTextEngine({
        renderer: game.renderer,
        fontName: "UbuntuMono/softmask",

        // The type of the font (softmask, sdf, msdf, mtsdf)
        // See the docs to learn more about the differences between these types
        type: "softmask",

        // How many characters can be rendered at once. You can think of this as the total "memory" size.
        bufferSize: 512,

        // Remove if you want to have per-character coloring
        staticColor: [255, 255, 255, 255],
    });

    // Wait for the font to load. One font can be loaded at a time per engine instance.
    await textEngine.loadPromise;

    // Create a text block
    // This is a "block" of text that we can write to. It allocates a chunk of the total buffer size.
    // (Note that the buffer is where you store characters, but you can render however many times you want, so if you need to render more (up to infinity), you can overwrite the data and render again, though of course at a performance cost.)
    const text = textEngine.createText(512);

    // We can then write text to it in various ways. This does not need to be done every frame.
    // One way is to write a full string of text:
    text.writeTextAt("Hello world!", /*start*/0, /*length*/null, /*x*/0, /*y*/0, /*r*/null, /*g*/null, /*b*/null, /*a*/null, /*size*/16);

    // Or we can write individual characters to specific slots.

    // There is also a very extensive typer utility:
    this.typeText(text, "Hello, world!", { x: 10, y: 32, delay: 100, index: 12 });
    // There's a lot more it can do, check out the docs for more.

    // We can render the text whenever we want with text.render().
    game.renderer.addRenderable({
        renderCallback: (delta, now) => {
            text.render();
        }
    });
});

// Optimization; skip rebuilding the buffers if the sprite didnt change
// const diff = sub(game.input.mouse, lastMouse);

// if(diff[0] !== 0 || diff[1] !== 0 || container.opacity < 0.1) {
//     bg.setPosition(game.input.mouse);
//     this.spriteRenderer.render(container);
// } else {
//     this.spriteRenderer.draw(1, backgroundTexture.getGLTexture(this.renderer.gl), 0, 0, container.opacity);
// }

// lastMouse[0] = game.input.mouse[0];
// lastMouse[1] = game.input.mouse[1];

// const sub = (a, b) => typeof b === "object"? [a[0] - b[0], a[1] - b[1]]: [a[0] - b, a[1] - b];
// const mul = (a, b) => typeof b === "object"? [a[0] * b[0], a[1] * b[1]]: [a[0] * b, a[1] * b];
// const add = (a, b) => typeof b === "object"? [a[0] + b[0], a[1] + b[1]]: [a[0] + b, a[1] + b];
// const div = (a, b) => typeof b === "object"? [a[0] / b[0], a[1] / b[1]]: [a[0] / b, a[1] / b];