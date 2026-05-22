/**
 * Video Editor flavor
 */

import FlavorBase from "../../core/flavor.mjs";
import ThreeRendererAdapter from "../../backends/graphics/ThreeJS/index.mjs";

// --- Views
import { AssetManagerView } from "../../views/asset-manager.mjs";
import PreviewView from "../../views/preview.mjs";
import PropertyEditorView from "../../views/property-editor.mjs";
import TimelineView from "../../views/timeline.mjs";

import Project from "../../core/project.mjs";

import { Variable, mappingCompiler } from "../../core/variable.mjs";

// --- Video editor flavor
class QuickSand extends FlavorBase {
    static name = "quicksand";

    static iconSet = {
        icon: 'assets/src/flavors/quicksand/images/icon.svg',
        small: 'assets/src/flavors/quicksand/images/icon-flat.svg',
        favicon: 'assets/src/flavors/quicksand/images/favicon.svg',
        desktopIcon: 'assets/src/flavors/quicksand/images/favicon.png'
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

    /**
     * The default setup for the video editor flavor.
     * @param {*} app 
     */
    static setupIn(app) {
        app.setIcon(this.iconSet);
        app.flavorInstance = new QuickSand(app.currentProject || (app.currentProject = new Project()));
    }
}


// TODO: separate layouts

// --- Layout presets for the video editor

const CATEGORY_NAME = "Video Editing";
Object.assign(LS.Multipane.PRESETS,  {
    /**
     * |   |   |
     * |-------|
     * |   |   |
     */
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

    /**
     * |   | | |
     * |   |---|
     * |   |   |
     */
    'vertical-split': {
        title: "Timeline Focused",
        direction: 'row',
        category: CATEGORY_NAME,
        inner: [
            { type: 'slot', view: 'TimelineView' },
            {
                inner: {
                    direction: 'column',
                    inner: [{ direction: "row", inner: [{ type: 'slot', view: 'PreviewView' }, { type: 'slot', view: 'PropertyEditorView' }] }, { type: 'slot', view: 'AssetManagerView' }]
                }
            }
        ]
    },

    // /**
    // * |       |
    // * |-------|
    // * |       |
    // */
    // 'simple-horizontal': {
    //     title: "Simple Horizontal",
    //     direction: 'column',
    //     category: CATEGORY_NAME,
    //     inner: [
    //         { type: 'slot', view: 'PreviewView', resize: { height: "50%" } },
    //         { type: 'slot', view: 'TimelineView' }
    //     ]
    // },

    // /**
    // * |   |   |
    // * |   |   |
    // * |   |   |
    // */
    // 'simple-vertical': {
    //     title: "Simple Vertical",
    //     category: CATEGORY_NAME,
    //     direction: 'row',
    //     inner: [
    //         { type: 'slot', view: 'PreviewView', resize: { width: "50%" } },
    //         { type: 'slot', view: 'TimelineView' }
    //     ]
    // },

    /**
    * |       |
    * |-------|
    * | | | | |
    */
    'preview-focused': {
        title: "Preview Focused",
        direction: 'column',
        category: CATEGORY_NAME,
        inner: [
            { type: 'slot', view: 'PreviewView', resize: { height: "70%" } },
            {
                direction: 'row',
                inner: [
                    { type: 'slot', view: 'AssetManagerView', resize: { width: "20%" } },
                    { type: 'slot', view: 'TimelineView', resize: { width: "60%" } },
                    { type: 'slot', view: 'PropertyEditorView' }
                ]
            }
        ]
    },

    /**
    * | |     |
    * | |-----|
    * | |     |
    */
    'sidebar-left': {
        title: "Sidebar Left",
        direction: 'row',
        category: CATEGORY_NAME,
        inner: [
            { type: 'slot', view: 'AssetManagerView', resize: { width: 250 } },
            {
                direction: 'column',
                inner: [
                    { type: 'slot', view: 'PreviewView', resize: { height: "60%" } },
                    {
                        direction: 'row',
                        inner: [
                            { type: 'slot', view: 'TimelineView', resize: { width: "60%" } },
                            { type: 'slot', view: 'PropertyEditorView' }
                        ]
                    }
                ]
            }
        ]
    },

    /**
    * |     |  |
    * |-----|--|
    * |     |  |
    */
    'sidebar-right': {
        title: "Property Editor Focused",
        direction: 'row',
        category: CATEGORY_NAME,
        inner: [
            {
                direction: 'column',
                inner: [
                    { type: 'slot', view: 'PreviewView', resize: { height: "60%" } },
                    { 
                        direction: 'row',
                        inner: [
                            { type: 'slot', view: 'TimelineView', resize: { width: "60%" } },
                            { type: 'slot', view: 'AssetManagerView' }
                        ]
                    }
                ]
            },
            { type: 'slot', view: 'PropertyEditorView', resize: { width: 300 } }
        ]
    },

    /**
    * | |   | |
    * | |   | |
    * | |   | |
    */
    'three-column': {
        title: "Three Columns (vertical video)",
        direction: 'row',
        category: CATEGORY_NAME,
        inner: [
            { type: 'slot', view: 'PropertyEditorView', resize: { width: "30%" } },
            { type: 'slot', view: 'PreviewView', resize: { width: "30%" } },
            {
                direction: 'column',
                inner: [
                    { type: 'slot', view: 'TimelineView' },
                    { type: 'slot', view: 'AssetManagerView', resize: { height: "25%" } },
                ], resize: { width: "40%" }
            }
        ]
    },

    /**
    * |   |   |
    * |-------|
    * |   |   |
    * |-------|
    * |   |   |
    */
    'grid-2x3': {
        title: "Grid 2x3",
        direction: 'column',
        category: CATEGORY_NAME,
        inner: [
            { inner: [{ type: 'slot', view: 'PreviewView', resize: { width: "50%" } }, { type: 'slot', view: 'PropertyEditorView' }], resize: { height: "33%" } },
            { inner: [{ type: 'slot', resize: { width: "50%" } }, { type: 'slot' }], resize: { height: "34%" } },
            { inner: [{ type: 'slot', view: 'AssetManagerView', resize: { width: "50%" } }, { type: 'slot', view: 'TimelineView' }] }
        ]
    },

    /**
     * |   |   |
     * |-------|
     * |   |   |
     */
    'default-but-better': {
        title: "Secret",
        direction: 'column',
        category: CATEGORY_NAME,
        tilt: Math.floor(Math.random() * 17 + 28),
        inner: [
            // Two horizontal rows
            { inner: [{ type: 'slot', view: 'PreviewView', resize: { width: 600 } }, { type: 'slot', view: 'PropertyEditorView' }], resize: { height: "65%" } },
            { inner: [{ type: 'slot', view: 'TimelineView', resize: { width: 420 } }, { type: 'slot', view: 'AssetManagerView' }] },
        ]
    },
});

export default QuickSand;