/**
 * Slides flavor
 */

import FlavorBase from "../../core/flavor.mjs";

// --- Views
import { AssetManagerView } from "../../views/asset-manager.mjs";
import PreviewView from "./views/preview.mjs";
import SlidesView from "./views/slides.mjs";
import PropertyEditorView from "../../views/property-editor.mjs";

import Project from "../../core/project.mjs";

import { Variable, mappingCompiler } from "../../core/variable.mjs";

import SlidesRuntime from "./runtime/index.mjs";

const CATEGORY_NAME = "Presentation";

// --- Slides flavor
class Slides extends FlavorBase {
    static name = "slides";

    static iconSet = {
        icon: 'src/flavors/slides/images/icon.svg',
        small: 'src/flavors/slides/images/icon.svg',
        favicon: 'src/flavors/slides/images/icon.svg',
        desktopIcon: 'src/flavors/slides/images/icon.png'
    };

    static version = "0.3.0-alpha";

    static meta = {
        name: "Slides",
        title: "Slides Editor",
        category: CATEGORY_NAME,
        engine_version: ">=2.3.0-alpha",
    };

    async #init() {
        this.runtime = new SlidesRuntime();

        // --- ! Debug
        globalThis.presentation = this.runtime;
    }

    /**
     * @param {Project} project
     */
    constructor(project) {
        super(project);

        const previewView        = new PreviewView();
        const slidesView         = new SlidesView();
        const propertyEditorView = new PropertyEditorView();
        const assetManagerView   = new AssetManagerView(this, {
            library: {
                'objects': [
                    { i18n: "assets.base.container", icon: "bi-archive", label: "Container", type: "container", item: { type: "container", label: "Container", tileColor: "white" } },
                ]
            }
        });

        app.focusedPreview = previewView;

        this.project.on("ready", () => {
            app.layoutManager.add(previewView, slidesView, assetManagerView, propertyEditorView);
            this.project.connect(previewView);
            this.project.connect(slidesView);
            this.project.connect(assetManagerView);
            this.project.connect(propertyEditorView);
        });

        // When the projects starts initializing
        this.project.once("initializing", async () => {
            await this.#init();
        });

        // When the project data has loaded
        this.project.on("project-data-loaded", async (data) => {
            if(this.flavorConfig.config) {
                this.runtime.reinitialize(this.flavorConfig.config);
            }
        });

        // When a view connects to the project
        this.project.on("view-connected", (view) => {
            if(view.attachedTo == null) {
                view.attachedTo = this;
            }
            
            switch(view.constructor.name) {
                case "slidesPreviewPanel":
                    view.setSource(this.runtime);
                    break;
            }
        });

        // When a view disconnects from the project
        this.project.on("view-disconnected", (view) => { });

        // When the project data is being exported
        this.project.on("export", (data) => {
            this.#exportTo(data);
        });

        LS.emit("flavor-ready", [this]);
    }

    /**
     * Export the project data into an object
     */
    async #exportTo(data) {
        if(!data.savedFlavorId) data.savedFlavorId = "slides";
        this.flavorConfig.config = LS.Util.clone(this.runtime.options);

        // ...
    }

    static layoutPresets = {
        'default': {
            title: "Classic",
            direction: 'column',
            category: CATEGORY_NAME,
            inner: [
                // Two horizontal rows
                { inner: [
                    { type: 'slot', view: 'AssetManagerView', resize: { width: 350 } },
                    { type: 'slot', view: 'PreviewView' },
                    { type: 'slot', view: 'PropertyEditorView', resize: { width: 350 } }
                ], resize: { height: "60%" } },

                { type: 'slot', view: 'SlidesView' }
            ]
        },
    }

    static {
        LS.Multipane.registerPresets(this.name, this.layoutPresets);
    }

    /**
     * Destroys the flavor and optionally all connected views
     * @param {Boolean} destroyViews Whether to destroy connected views
     */
    destroy(destroyViews = false) {
        if(this.destroyed) return;

        this.runtime.destroy();

        super.destroy();
    }
}

export default Slides;