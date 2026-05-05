# Development Reference

This interface is designed to be fully modular.<br>
Nearly everything is workflow agnostic, and specific workflows are defined in "flavors".<br>
A flavor contains logic for a given workflow and a set of tools and a setup for that specific use case.<br>
For example, a "video editing" flavor would contain tools and a UI setup specifically designed for editing videos, and so on, for nearly any type of workflow you can think of.<br>
The advantage of this is that you can easily create custom workflows and share resources between them, including mixing and matching tools.<br>

# File structure:

- `index.html`: The entry HTML file that holds the base structure.
- `assets/src/main.mjs`: The main JavaScript file that loads the flavor.
  - `assets/src/flavors/`: Directory for different flavors
  - `assets/src/core/`: Directory for core modules.
  - `assets/src/views/`: Directory for UI views
  <!-- - `assets/src/libraries/`: Directory for external library files. -->
  - `assets/src/backends/`: Directory for different backends that are commonly used by flavors
- `assets/css/`: Directory for CSS stylesheets.
- `assets/audio/`: Contains sound files the application uses.
- `assets/images/`: Contains images.

Flavors may have their own additional files and directories as they need.

The core manages base resources & loading, project data, views, while the flavor defines how it all operates.

Thanks to the flexibility of the system, it is possible to interop between tools & flavors.

For example, you could be working on a game, and make videos/sound for it in the same project file, and make them interact. Or work on a song and a visual for it at the same time. Share assets from one interface to another.. The possibilities are endless.

Project files are flavor agnostic and can be technically loaded in any flavor, and the interface is capable of swapping between them, given they are well built (and do not introduce conflicts or leaks).

---

## Built in views:

These are the officially maintained views. You can use any of those in your flavor, and or include them as needed.

### Asset Browser

A view for browsing and managing assets & folders.<br>
Assets can be drag-and-dropped.

### Video Preview

A view for video previews of any kind. Features simple video controls & supports various sources.

### Mixer (experimental)

### Code editor

Note: depends on CodeMirror

### Patcher (experimental)

### Animation editor (experimental)

### Piano roll (experimental)

### Property Editor

Property editor for editing properties of an object.

### Timeline / playlist

### Log viewer

Log viewer

### AST Viewer (experimental)

Browser for viewing Abstract Syntax Trees.

### Grid text renderer (experimental)

Hardware-accelerated grid text renderer, useful for terminals etc.<br>
Note: depends on LS.GL

---

## Built in flavors:
- `flavors/video-editor/`: Video editor.

---

## Core modules:

These are the core modules that provide essential functionality for the interface and all flavors.

### `resources.mjs`

Resource manager.
This gets created per-project and is responsible for loading and managing resources that the project uses.<br>
Can be excluded from flavors that don't need it.

### `project.mjs`

Holds the project data and manages saving and loading projects.

### `flavor.mjs`

Simple base class & utils for flavors.

### `variable.mjs`

Utilities for universal variable mapping & data pipelines.

### `statusbar.mjs`

Manages the bottom status bar UI.

### `configstore.mjs`

Manages configuration.

### `base.js`

Extra utilities and base classes, including HistoryManager, etc.

---

## Backends:

Backends are modules that provide an interface to a specific API or technology.

Included backends:

- `video/`: Video encoding and decoding; this module handles video data processing.
- `audio/`: Basic audio encoding and decoding.
- `rendering/`: Rendering adapters
- `compilers/`: Various compiler tools

---

Other core features such as layout management, UI & UI components, themes, etc. are handled by [LS](https://github.com/thelstv/ls).

---

## How to run:

You will need Node.js, npm, and electron installed.

### Electron:
- Install node modules (run `npm install` in the project directory).
- Then run `electron .`, done.

### Browser:
- Simply host the directory contaning `index.html` using a HTTP server and open in a modern browser. A very quick way to do that is to run `npx http-server` in the project directory. No extra setup should be needed.
- Alternatively, run `akeno host` or `akeno host --permanent` in the project directory if you have Akeno installed. This will use the app.conf config file.

Note that not all features may be fully available or functional in the browser (including filesystem access, accelerated processing, audio DSP, certain encoding features, etc.).

There used to be an experimental filesystem access module for browsers, but it was removed due to complexity of keeping it reliable and efficient, and lack of Firefox support.

### Packaging for production:
Work in progress