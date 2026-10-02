/**
 * Game Engine flavor
 */

import FlavorBase from "../../core/flavor.mjs";
import ThreeRendererAdapter from "../../components/graphics/ThreeJS/index.mjs";

// --- Views
import { AssetManagerView } from "../../views/asset-manager.mjs";
import PreviewView from "./views/preview.mjs";
import PropertyEditorView from "../../views/property-editor.mjs";

import Project from "../../core/project.mjs";

import { Variable, mappingCompiler } from "../../core/variable.mjs";

import * as QuickSandRuntime from "./runtime/index.mjs";

const CATEGORY_NAME = "Game Engine";

// --- Game engine flavor
class QuickSand extends FlavorBase {
    static name = "quicksand";

    static iconSet = {
        icon: 'src/flavors/quicksand/images/icon.svg',
        small: 'src/flavors/quicksand/images/icon-flat.svg',
        favicon: 'src/flavors/quicksand/images/favicon.svg',
        desktopIcon: 'src/flavors/quicksand/images/favicon.png'
    };

    static version = "0.1.0-alpha";

    static meta = {
        name: "Quicksand",
        title: "Quicksand Game Engine Editor",
        category: CATEGORY_NAME,
        engine_version: ">=2.3.0-alpha",
    };

    async #init() {
        /**
         * The GameRuntime accepts options that configure the entire game environment, which this interface constructs
         */
        this.runtime = new QuickSandRuntime.GameRuntime();

        await this.runtime.init();

        // --- ! Debug
        globalThis.game = this.runtime;

        console.log("QuickSand runtime initialized");
    }

    /**
     * @param {Project} project
     */
    constructor(project) {
        super(project);

        const previewView        = new PreviewView();
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
            app.layoutManager.add(previewView, assetManagerView, propertyEditorView);
            this.project.connect(previewView);
            this.project.connect(assetManagerView);
            this.project.connect(propertyEditorView);
        });

        // When the projects starts initializing
        this.project.once("initializing", async () => {
            await this.#init();
        });

        // When the project data has loaded
        this.project.on("project-data-loaded", async (data) => {
            if(data.qsGameConfig) {
                this.runtime.reinitialize(data.qsGameConfig);
            }
        });

        // When a view connects to the project
        this.project.on("view-connected", (view) => {
            if(view.attachedTo == null) {
                view.attachedTo = this;
            }
            
            switch(view.constructor.name) {
                case "gamePreviewPanel":
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
        if(!data.savedFlavorId) data.savedFlavorId = "video-editor";
        data.qsGameConfig = LS.Util.clone(this.runtime.options);

        // ...
    }

    onAboutDialog() {
        LS.Modal.buildEphemeral({
            content: [
                { tag: 'img', src: this.constructor.iconSet.icon, style: 'height: 5em; width: 100%; margin: auto' },
                { tag: 'h2', inner: 'Quicksand', style: 'text-align: center' },
                { tag: 'p', html: `Version <code>${this.constructor.version}</code><br>Editor version <code>${app.VERSION}</code><br>LS version <code>${LS.version}</code>` },
                { tag: 'p', inner: '' },
                { tag: 'p', inner: ['Created with love and hard work by Lukas (', { tag: 'a', href: 'https://lstv.space', target: '_blank', inner: 'https://lstv.space' }, ')'] },
                { tag: 'p', inner: ['Source code available on ', { tag: 'a', href: app.GITHUB_REPO, target: '_blank', inner: 'GitHub' }] },
            ],
            buttons: [ { label: "Close" } ]
        });
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

                { type: "tabs", tabs: [
                    [{ type: 'slot', view: '', resize: { width: 420 } }, { type: 'slot', view: '' }], [{ type: 'slot' }]
                ] },
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

export default QuickSand;