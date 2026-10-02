// QuickSand example

import * as QuickSand from "../engine/runtime.mjs";

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

    // BatchedSpriteRenderer is very efficient (uses a single drawcall to draw everything), but requires that all sprites use the same layer, texture and shader.
    // SpriteRenderer is a higher-level renderer. You can use different types based on your use case to get the best performance/feature balance.
    const spriteRenderer = new QuickSand.BatchedSpriteRenderer(game.renderer, { batchSize: 2 });

    // Playing audio is built in with LS.SoundBox
    game.soundbox.play("mew");
    // There is of course a whole lot more this can do; see LS.SoundBox

    // And for simplicity, we will add a simple renderable, which runs a callback every frame
    game.renderer.addRenderable({
        renderCallback: (delta, now) => {

            // Move the player to the mouse position
            player.setPosition(game.input.mouse);

            // Changing the texture is also straightforward
            // (Optionally, you can also add a new named region and the update that region's values, eg. for animated tiles, etc.)
            player.texture = atlas.regions.walk;
            // Render the container with the sprite renderer
            spriteRenderer.render(container);
        }
    });

    // Finally, we can resume the runtime, which will start the render loop and enable input.
    game.resume();
});

// Optimization test; skip rebuilding the buffers if the sprite didnt change
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