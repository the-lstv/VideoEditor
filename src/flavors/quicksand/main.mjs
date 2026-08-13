/**
 * Game Engine flavor
 */

import FlavorBase from "../../core/flavor.mjs";
import ThreeRendererAdapter from "../../components/graphics/ThreeJS/index.mjs";

// --- Views
import { AssetManagerView } from "../../views/asset-manager.mjs";
import PreviewView from "../../views/preview.mjs";
import PropertyEditorView from "../../views/property-editor.mjs";

import Project from "../../core/project.mjs";

import { Variable, mappingCompiler } from "../../core/variable.mjs";

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

    constructor(project) {
        super(project);

        // When the projects starts initializing
        this.project.once("initializing", async () => {
            await this.#init();
        });

        // When the project data has loaded
        this.project.on("project-data-loaded", (data) => { });

        // When a view connects to the project
        this.project.on("view-connected", (view) => { });

        // When a view disconnects from the project
        this.project.on("view-disconnected", (view) => { });

        // When the project data is being exported
        this.project.on("export", (data) => { });
    }

    async #init() { }

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
                { inner: [{ type: 'slot', view: 'PropertyEditorView', resize: { width: 600 } }, { type: 'slot', view: 'PreviewView' }], resize: { height: "60%" } },
                { type: "tabs", tabs: [ [{ type: 'slot', view: 'AssetManagerView', resize: { width: 420 } }, { type: 'slot', view: 'TimelineView' }], [{ type: 'slot' }] ] },
            ]
        },
    }

    static {
        LS.Multipane.registerPresets(this.name, this.layoutPresets);
    }
}

export default QuickSand;