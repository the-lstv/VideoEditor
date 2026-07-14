/**
 * Main entry point.
 */

// Check if we're running in Electron
window.isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;

// --- Core imports
import * as EditorBaseClasses from "./core/base.mjs";
import StatusBar from "./core/statusbar.mjs";
import ConfigStore from "./core/configstore.mjs";
import Project from "./core/project.mjs";

import Version from "./utils/version.mjs";

import WelcomeView from "./views/welcome.mjs";

// --- Preloading some flavors
import GlitterPlayground from "./flavors/glitter-playground/index.mjs";
import MetaDAW from "./flavors/metadaw/main.mjs";
import VideoEditor from "./flavors/video-editor/main.mjs";

const SHOW_WELCOME_SCREEN = true;

// --- QuickSand flavor
// import QuickSand from "./flavors/quicksand/main.mjs";

// Small miscellaneous helpers
function createIfNotExists(selector, parent = document.body) { return document.querySelector(selector) || LS.Create({ emmet: selector, parent }) }
function selfInvoke(method) { method(); return method }

const config = new ConfigStore();


/**
 * Entry UI elements
 */
const appContainer       = createIfNotExists("#editor-container", document.body);
const layoutContainer    = createIfNotExists("#layout-container", appContainer);
const settingsContent    = createIfNotExists("#preferences-modal");
const headerContainer    = createIfNotExists("#editor-header");
const statusBarContainer = createIfNotExists("#editor-footer");
const undoButton         = createIfNotExists("#undoButton");
const redoButton         = createIfNotExists("#redoButton");

/**
 * Global persistent application state
 */
const app = globalThis.app = {
    container: appContainer,
    config,

    // Layout & shortcuts
    layoutManager: new LS.Multipane(layoutContainer),
    shortcutManager: new LS.ShortcutManager(),
    statusBar: new StatusBar(statusBarContainer),

    GITHUB_REPO: "https://github.com/the-lstv/videoeditor",
    VERSION: new Version("2.3.0-alpha"),

    /**
     * Enters the loading/transition shade
     */
    enterShade() {
        app.container.classList.remove('loaded');
        document.querySelector("#logo").classList.remove("jump");
    },

    /**
     * Leaves the loading/transition shade & plays the logo animation
     */
    leaveShade() {
        app.container.style.display = 'flex';
        document.querySelector("#logo").classList.add("jump");
        setTimeout(() => app.container.classList.add('loaded'), 0);
    },

    /**
     * Sets the application icon/iconSet
     */
    setIcon(iconSet) {
        if(typeof iconSet === "string") {
            iconSet = {
                icon: iconSet
            };
        }

        app.iconSet = iconSet;
        LS.Select(".flavor-icon, #logo").forEach(el => el.src = el.id === "logo" ? iconSet.icon: iconSet.small || iconSet.favicon || iconSet.icon);
    },

    /**
     * @experimental
     */
    async setFlavor(flavorClass, options = {}) {
        app.enterShade();

        if(app.flavorInstance) {
            console.warn("Destroying previous flavor instance");
            app.flavorInstance.destroy();
            app.flavorInstance = null;
        }

        const requiredVersion = flavorClass?.meta?.engine_version;
        if(requiredVersion && !app.VERSION.compare(requiredVersion)) {
            LS.Modal.buildEphemeral({
                title: "Flavor engine version mismatch",
                content: { html: `The selected flavor <code>${flavorClass.name}</code> requires engine version <code>${requiredVersion}</code>, but the current engine version is <code>${app.VERSION}</code>. Please update the LS engine to use this flavor.` },
                buttons: [ { label: "Close" } ]
            }, { closeable: false });

            throw new Error(`Flavor ${flavorClass.name} requires engine version ${requiredVersion}, but current version is ${app.VERSION}`);
        }

        const flavorId = flavorClass.name;

        app.flavor = flavorClass;

        if(flavorClass.layoutPresets?.default) {
            app.layoutManager.setSchema(flavorClass.layoutPresets.default);
        }

        app.currentProject = new Project();

        if(app.currentProject && app.currentProject.loaded) {
            throw new Error("The current project is already loaded. The flavor must be set up while loading a project.");
        }

        await new Promise(resolve => setTimeout(resolve, 250));
        app.setIcon(flavorClass.iconSet);
        app.leaveShade();
    },

    registeredFlavors: [
        GlitterPlayground,
        MetaDAW,
        VideoEditor
    ]
}

// --- Setup welcome screen if enabled
if(SHOW_WELCOME_SCREEN) {
    const welcomeScreen = new WelcomeView();

    LS.Multipane.PRESETS.default.welcome = {
        title: "Default",
        direction: 'column',
        inner: [{ type: 'slot', view: 'WelcomeView' }]
    };

    app.layoutManager.add(welcomeScreen);
    app.layoutManager.setSchema(LS.Multipane.PRESETS.default.welcome);
}

// Currently this is just the defaults
LS.i18n.loadLocale({ code: "en", translations: {} });
LS.i18n.changeLocale(app.config.get("language") || "en");

// --- Workspace initialization

window.addEventListener('load', async () => {
    try {
        // Setup the video editor flavor (prepares views, rendering, etc. for video editing)
        // This is now the only thing workflow specific in this file

        // Flavor could be determined by project file.
        // A project file could contain multiple flavors in which case the user decides which one to load.

        app.setFlavor(VideoEditor);

        function getLayouts() {
            // const layouts = app.layoutManager.getAvailableLayouts().filter(layout => layout.name !== "empty").map(layout => ({
            //         text: layout.title,
            //         action() {
            //             app.layoutManager.setSchema(layout.schema);
            //             app.config.set("default-layout", layout.name);
            //         }
            //     }))

            // TODO: Show layouts from flavors
            const result = [];
            return result;
        }

        // Global shortcuts
        app.shortcutManager.map({
            GLOBAL_PAUSE: 'space',
            GLOBAL_SEEK_HOME: 'home',
            GLOBAL_SEEK_END: 'end',
            GLOBAL_FULLSCREEN: 'f',
            GLOBAL_NEXT_FRAME: 'shift+right',
            GLOBAL_PREVIOUS_FRAME: 'shift+left',
            GLOBAL_SAVE: 'ctrl+s',
            GLOBAL_OPEN: 'ctrl+o',
            GLOBAL_PROJECT_MANAGER: 'ctrl+shift+o',
            GLOBAL_PROJECT_MANAGER: 'ctrl+shift+o',
            GLOBAL_NEW_PROJECT: 'ctrl+n',
            GLOBAL_FOCUS_HEADER: 'alt',
            GLOBAL_EXPORT_MENU: 'ctrl+e',
            OPEN_PREFERENCES: 'ctrl+,',
            UNDO: 'ctrl+z',
            REDO: [ 'ctrl+shift+z', 'ctrl+y' ],
            TIMELINE_TOOL_SELECT: 'v',
            TIMELINE_TOOL_SLICE: 'c',
            TIMELINE_TOOL_PREVIEW: 'p',
            TIMELINE_TOOL_GROUP: 'g',
            TIMELINE_TOOL_ERASE: 'e',
            TIMELINE_TOOL_PAINT: 'b',
            TIMELINE_TOOL_SLIDE: 's',
            TIMELINE_TOOL_RIPPLE: 'r',

            ...app.config.get('shortcuts') || {} // Custom shortcuts
        });

        // --- Shortcut actions

        app.shortcutManager.assign("GLOBAL_SAVE", () => {
            // Temporary
            app.currentProject.exportZip(true);
        });

        app.shortcutManager.assign("GLOBAL_OPEN", () => {
            // Temporary
            Project.openFromZipFile(project => {
                // project.once('ready', () => {
                //     if(!project) return;

                    // app.currentProject.replaceWith(project);
                    app.currentProject = project;
                // });
            });
        });

        app.shortcutManager.assign("GLOBAL_NEW_PROJECT", () => {
            // Temporary
            app.currentProject && app.currentProject.destroy(true);
            app.currentProject = new Project();

            // const oldProject = app.currentProject;
            // app.currentProject = new Project();
            // app.currentProject.once('ready', () => {
            //     oldProject.replaceWith(app.currentProject);
            // });
        });

        app.shortcutManager.assign("GLOBAL_PAUSE", () => {
            if(app.focusedPreview) {
                app.focusedPreview.togglePlay();
            }
        });

        app.shortcutManager.assign("GLOBAL_SEEK_HOME", () => {
            if(app.focusedPreview) {
                app.focusedPreview.seek(0, true);
            }
        });

        app.shortcutManager.assign("GLOBAL_SEEK_END", () => {
            if(app.focusedPreview) {
                app.focusedPreview.seek(-1);
            }
        });

        app.shortcutManager.assign("GLOBAL_FULLSCREEN", () => {
            if(app.focusedPreview) {
                app.focusedPreview.toggleFullscreen();
            }
        });

        app.shortcutManager.assign("GLOBAL_NEXT_FRAME", () => {
            if(app.focusedPreview) {
                app.focusedPreview.seek();
            }
        });

        app.shortcutManager.assign("GLOBAL_PREVIOUS_FRAME", () => {
            if(app.focusedPreview) {
                app.focusedPreview.seek();
            }
        });

        let previousActive;
        app.shortcutManager.assign("GLOBAL_FOCUS_HEADER", () => {
            if(previousActive) {
                previousActive.focus();
                previousActive = null;
                return;
            }

            previousActive = document.activeElement;
            document.querySelector("#editor-header .nav-menu-item").focus();
        });

        app.shortcutManager.assign("UNDO", () => {
            app.currentProject.historyManager.undo();
        });

        app.shortcutManager.assign("REDO", () => {
            app.currentProject.historyManager.redo();
        });

        app.shortcutManager.assign("OPEN_PREFERENCES", () => {
            settingsModal.open();
        });

        app.shortcutManager.assign("TIMELINE_TOOL_SELECT",  () => { app.flavorInstance.timelineInstance.tool = "select"  });
        app.shortcutManager.assign("TIMELINE_TOOL_SLICE",   () => { app.flavorInstance.timelineInstance.tool = "slice"   });
        app.shortcutManager.assign("TIMELINE_TOOL_PREVIEW", () => { app.flavorInstance.timelineInstance.tool = "preview" });
        app.shortcutManager.assign("TIMELINE_TOOL_GROUP",   () => { app.flavorInstance.timelineInstance.tool = "group"   });
        app.shortcutManager.assign("TIMELINE_TOOL_ERASE",   () => { app.flavorInstance.timelineInstance.tool = "erase"   });
        app.shortcutManager.assign("TIMELINE_TOOL_PAINT",   () => { app.flavorInstance.timelineInstance.tool = "paint"   });
        app.shortcutManager.assign("TIMELINE_TOOL_SLIDE",   () => { app.flavorInstance.timelineInstance.tool = "slide"   });

        undoButton.addEventListener('click', () => {
            app.currentProject.historyManager.undo();
        });

        redoButton.addEventListener('click', () => {
            app.currentProject.historyManager.redo();
        });


        // --- Setup settings modal

        const settingsModal = LS.Modal.build({
            content: settingsContent
        }, {
            width: '960px'
        });

        settingsContent.style.display = 'flex';
        settingsModal.container.classList.add('preferences-modal');

        settingsContent.querySelector(".menu-button").addEventListener('click', () => {
            settingsModal.container.toggleClass("sidebar-menu-visible");
        });


        // --- Setup menus

        const menus = {
            file: [
                { text: "Project manager", action() {
                    // ... Open project manager
                } },
                { type: "separator" },
                { text: "New Project", action() { app.shortcutManager.triggerMapping("GLOBAL_NEW_PROJECT"); } },
                { text: "Open Project...", action() { app.shortcutManager.triggerMapping("GLOBAL_OPEN"); } },
                { text: "Save Project", action() { app.shortcutManager.triggerMapping("GLOBAL_SAVE"); } },
                { type: "separator" },
                { text: "Render...", icon: "bi-box-arrow-right", action() {
                    // ... Open export dialog
                } },

                ...isNode? [{ type: "separator" }, { text: "Exit", action() {
                    window.close();
                } }] : [],
            ],

            options: [
                // TODO
                { text: "Preferences", action() {
                    app.shortcutManager.triggerMapping("OPEN_PREFERENCES");
                }, icon: "bi-sliders" },

                { type: "separator" },
                
                { text: "Set editor theme", items: [
                    { icon: "bi-sun", text: "Light", action() { LS.Color.setTheme('light'); localStorage.setItem("ls-theme", "light"); } },
                    { icon: "bi-moon", text: "Dark", action() { LS.Color.setTheme('dark'); localStorage.setItem("ls-theme", "dark"); } },
                    { icon: "bi-laptop", text: "Auto", action() { localStorage.removeItem("ls-theme"); LS.Color.setAdaptiveTheme(); } },
                ] },
                
                { text: "Set editor accent", items: [
                    { text: "Default", action() { LS.Color.setAccent('white'); localStorage.removeItem("ls-accent"); } },
                    { text: "Blue", action() { LS.Color.setAccent('blue'); localStorage.setItem("ls-accent", "blue"); } },
                    { text: "Red", action() { LS.Color.setAccent('red'); localStorage.setItem("ls-accent", "red"); } },
                    { text: "Green", action() { LS.Color.setAccent('green'); localStorage.setItem("ls-accent", "green"); } },
                    { text: "Purple", action() { LS.Color.setAccent('purple'); localStorage.setItem("ls-accent", "purple"); } },
                    { text: "Orange", action() { LS.Color.setAccent('orange'); localStorage.setItem("ls-accent", "orange"); } },
                    { text: "Pink", action() { LS.Color.setAccent('pink'); localStorage.setItem("ls-accent", "pink"); } },
                    { text: "Teal", action() { LS.Color.setAccent('teal'); localStorage.setItem("ls-accent", "teal"); } },
                    { text: "Yellow", action() { LS.Color.setAccent('yellow'); localStorage.setItem("ls-accent", "yellow"); } },
                ] },

                { type: "separator" },

                { text: "Set editor language", items: [
                        { code: "en", text: "English" },
                        { code: "cs", text: "Čeština (Czech)" },
                        // { code: "de", text: "Deutsch (German) (Auto-Translated!)" },
                        // { code: "es", text: "Español (Spanish) (Auto-Translated!)" },
                        // { code: "fr", text: "Français (French) (Auto-Translated!)" },
                        // { code: "zh", text: "中文 (Mandarin Chinese) (Auto-Translated!)" },
                    ].map(lang => ({
                        text: lang.text,
                        type: "radio",
                        group: "language",
                        checked: LS.i18n.locale === lang.code,

                        action() {
                            LS.i18n.changeLocale(lang.code);
                            app.config.set("language", lang.code);
                        },
                    }))
                },
            ],

            layout: [
                { text: "Layout presets", items: getLayouts() },
                { text: "Saved layouts", items: [] },

                { type: "separator" },

                { text: "Save Current Layout", action() {} },

                { type: "separator" },
                
                { text: "Save Current Layout To File", action() {} },
                { text: "Load Layout From File", action() {} },
            ],

            help: [
                { text: "Report bug", action() {
                    window.open(app.GITHUB_REPO + "/issues?q=state%3Aopen%20label%3Abug");
                } },

                { text: "Request feature", action() {
                    window.open(app.GITHUB_REPO + "/issues?q=state%3Aopen%20label%3Aenhancement");
                } },

                { type: "separator" },

                // { text: "Tutorials", action() {
                //     // ! todo
                //     window.open();
                // } },

                { type: "separator" },

                { text: "About", icon: "bi-stars", action() {
                    if(app.flavorInstance && app.flavorInstance.onAboutDialog) {
                        app.flavorInstance.onAboutDialog();
                        return;
                    }

                    LS.Modal.buildEphemeral({
                        content: [
                            { tag: 'img', src: app.flavorInstance ? app.flavorInstance.icon : document.getElementById('logo').src || 'assets/images/icon.svg', style: 'height: 5em; width: 100%; margin: auto' },
                            { tag: 'h2', inner: app.flavorInstance ? app.flavorInstance.constructor.name : 'LS interface', style: 'text-align: center' },
                            { tag: 'p', inner: `Version ${app.VERSION}, running LS ${LS.version}` },
                            { tag: 'p', inner: ['Created with love and hard work by Lukas (', { tag: 'a', href: 'https://lstv.space', target: '_blank', inner: 'https://lstv.space' }, ')'] },
                            { tag: 'p', inner: ['Source code available on ', { tag: 'a', href: app.GITHUB_REPO, target: '_blank', inner: 'GitHub' }] },
                        ],
                        buttons: [ { label: "Close" } ]
                    });
                } }
            ]
        };

        for(const menuCategoryElement of headerContainer.querySelectorAll(".nav-menu-item")) {
            const menuTitle = menuCategoryElement.classList.contains("flavor-icon") ? "flavor" : menuCategoryElement.innerText.toLowerCase();
            const menuItems = menus[menuTitle] || [];

            if(menuItems.length > 0) {
                new LS.Menu({
                    adjacentElement: menuCategoryElement,
                    items: menuItems,
                    group: "ls-editor-header-menu"
                });
            }
        }

    } catch(e) {

        console.error(e);

        LS.Modal.buildEphemeral({
            title: "Fatal error",
            content: "We're sorry, the editor failed to initialize due to this error: " + ( e.message || e.toString() ),
            buttons: [ { label: "Reload", onclick () { location.reload() } } ]
        }, { closeable: false });

    } finally {

        // Remove loading screen
        document.querySelector("#app-loading").remove();
        app.leaveShade();

    }
});

window.addEventListener("beforeunload", (e) => {
    if(app.currentProject.unsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});


// --- Mobile screen warning (temporary until mobile support is implemented)

const MIN_EDITOR_WIDTH = 600;
const mobileWarningSwitch = new LS.Util.Switch(value => {
    if(value) {
        app.container.remove();
        document.body.appendChild(app.mobileDisclaimer || (app.mobileDisclaimer = LS.Create({
            class: 'disclaimer',
            inner: [
                { tag: 'i', class: 'bi-aspect-ratio' },
                { tag: 'h1', inner: 'Your screen is too small' },
                { tag: 'p', innerHTML: `You need at least ${MIN_EDITOR_WIDTH} pixels of screen width to use the editor. There is no mobile support at this time (if there is interest however, I am not opposed for adding it - <a href="${app.GITHUB_REPO}/issues?q=state%3Aopen%20label%3Aenhancement" target="_blank" rel="noopener noreferrer">let me know</a>).` }
            ]
        })));

        LS.Modal.closeAll();
    } else {
        if(app.mobileDisclaimer) app.mobileDisclaimer.remove();
        document.body.appendChild(app.container);
    }
});

window.addEventListener('resize', selfInvoke(() => {
    mobileWarningSwitch.set(window.innerWidth < MIN_EDITOR_WIDTH);
}));

// --- Debug
window.Project = Project;
window.VideoEditor = VideoEditor;
// window.QuickSand = QuickSand;