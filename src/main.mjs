/**
 * Main entry point.
 * This is an independent launcher.
 * It doesn't care if you are loading which flavors and how; they can be setup as needed.
 * 
 * It manages:
 * - Global state
 * - Global shortcuts
 * - Menus
 * - Command Palette
 * - Basic main structure and logic
 * 
 * It can't contain any flavor-specific code
 */

// Check if we're running in Electron/Node.js environment
globalThis.isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;

// --- Core imports
import StatusBar from "./core/statusbar.mjs";
import ConfigStore from "./core/configstore.mjs";
import Project from "./core/project.mjs";

import Version from "./utils/version.mjs";

import WelcomeView from "./views/welcome.mjs";

// Experimental
import * as settings from "./core/settings.mjs";
import loadPaletteOverlay from "./core/commandpalette.js";

if(!globalThis.LS) {
    alert("Fatal error: LS library is missing or failed to load. This software cannot run without it.");
    if(globalThis.isNode) process.exit(1);
    throw new Error("LS library is missing");
} else if(LS.v < 6) {
    alert("Fatal error: LS library version is too old. This software requires LS version 6 or higher.");
    if(globalThis.isNode) process.exit(1);
    throw new Error("LS library is outdated");
}

// Small miscellaneous helpers
function selectOrCreate(selector, parent = document.body) { return document.querySelector(selector) || LS.Create({ emmet: selector, parent }) }
function invokeAndReturn(method) { method(); return method }

const config = new ConfigStore();
await config.open();

/**
 * Entry UI elements
 */
const appContainer       = selectOrCreate("#editor-container", document.body);
const layoutContainer    = selectOrCreate("#layout-container", appContainer);
const settingsContent    = selectOrCreate("#preferences-modal");
const headerContainer    = selectOrCreate("#editor-header");
const statusBarContainer = selectOrCreate("#editor-footer");
const palleteOverlay     = selectOrCreate("#topOverlay");
const undoButton         = selectOrCreate("#undoButton");
const redoButton         = selectOrCreate("#redoButton");

const minimizeButton = selectOrCreate("#minimizeButton");
const maximizeButton = selectOrCreate("#maximizeButton");
const closeButton    = selectOrCreate("#closeButton");

if(!globalThis.isNode) {
    // todo: use toolbarcomponents
    const windowControls = document.querySelector(".window-controls");
    if(windowControls) {
        windowControls.remove();
    }
}

// We use this to composite all gl components in one context:
LS.GL.createGlobalWebGLRenderer({
    compositeLayerParent: appContainer
});

/**
 * --- Global persistent application state ---
 * Should be the only source of persistent state, everything else should follow a lifecycle pattern
*/
const app = globalThis.app = {
    container: appContainer,
    config,

    // Layout & shortcuts
    layoutManager:   new LS.Multipane(layoutContainer),
    shortcutManager: new LS.ShortcutManager(),
    statusBar:       new StatusBar(statusBarContainer),

    GITHUB_REPO: "https://github.com/the-lstv/videoeditor",
    VERSION: new Version("2.3.0-alpha"),

    /**
     * Enters the loading/transition shade
     */
    async enterShade() {
        app.container.classList.remove('loaded');
        const logo = document.querySelector("#logo");
        logo.classList.remove("jump");

        await app.container.animate([
            { transform: "none" },
            { transform: "scale(0.95)" },
        ], {
            duration: 1500,
            easing: "ease-out"
        }).finished;
    },

    /**
     * Leaves the loading/transition shade & plays the logo animation
     */
    async leaveShade() {
        app.container.style.display = 'flex';
        app.container.style.transform = 'none';

        await new Promise(resolve => setTimeout(resolve, 0));

        document.querySelector("#logo").classList.add("jump");
        app.container.classList.add('loaded');

        await new Promise(resolve => setTimeout(resolve, 10));

        await app.container.animate([
            { transform: "scale(0.95)" },
            { transform: "none" },
        ], {
            duration: 1500,
            easing: "ease-out"
        }).finished;
    },

    /**
     * Sets the application icon/iconSet
     */
    setIcon(iconSet, animate = true) {
        if(typeof iconSet === "string") {
            iconSet = {
                icon: iconSet
            };
        }

        app.iconSet = iconSet;

        LS.Select(".flavor-icon, #logo").forEach(el => {
            el.src = el.id === "logo" ? iconSet.icon: iconSet.small || iconSet.favicon || iconSet.icon;
            if(animate) {
                LS.Animation.fadeIn(el, "left");
                console.log("Animating icon change");
            }
        });
    },

    /**
     * @experimental
     */
    async setFlavor(flavorClass, options = {}) {
        if(options.delay) {
            app.enterShade();
        }

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

        try {
            const flavorId = flavorClass.name;
    
            app.flavor = flavorClass;

            const loaded = flavorClass?.prepare? await flavorClass?.prepare?.(): true;
            if(loaded !== true) {
                throw new Error(`preparation of ${flavorClass.name} failed because ${loaded}`);
            }

            const layout = app.config.get("layout-for-" + flavorId);
            app.layoutManager.setSchema((typeof layout === "string"? flavorClass.layoutPresets?.[layout]: layout) || flavorClass.layoutPresets?.default || LS.Multipane.PRESETS.default);

            app.currentProject = new Project();
            if(app.currentProject && app.currentProject.loaded) {
                throw new Error("The current project is already loaded. The flavor must be set up while loading a project.");
            }

            await app.currentProject.loadPromise;
            await app.flavorInstance?.loadPromise;
    
        } catch(e) {
            console.error("Error setting flavor:", e);
            LS.Modal.alert("Error setting flavor: " + e.message);
            throw e;
        } finally {
            if (typeof options.delay === "undefined" || typeof options.delay === "number") await new Promise(resolve => setTimeout(resolve, options.delay || 250));
            app.setIcon(flavorClass.iconSet, false);
            document.querySelector("#app-loading")?.remove?.();
            await app.leaveShade();
        }

    },

    /**
     * @experimental
     */
    async dynamicLoadFlavor(flavorName, options = {}) {
        const flavorPath = (isNode ? __dirname : "") + "/src/flavors/" + flavorName + "/main.mjs";
        console.log("Loading flavor from", flavorPath);

        if(isNode) {
            const fs = require("fs");
            if (!fs.existsSync(flavorPath)) {
                throw new Error(`Flavor module not found: ${flavorPath}`);
            }
        }

        const flavorModule = await import(flavorPath);
        const flavorClass = flavorModule.default;

        if(!flavorClass) {
            throw new Error(`Flavor module ${flavorPath} does not export a default class`);
        }

        await app.setFlavor(flavorClass, options);
    },

    aboutDialog() {
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
    },

    /**
     * @experimental
     */
    newWindow() {
        if(isNode) {
            app.ipc.send("new-window");
        } else {
            window.open(window.location.href, "_blank");
        }
    },

    openExternal(url) {
        if(isNode) {
            app.ipc.send("open-external", url);
        } else {
            window.open(url, "_blank");
        }
    }
}

window.app_config = {};

if(isNode) {
    const fs = require("fs");
    const path = require("path");
    const electron = require("electron");

    app.ipc = electron.ipcRenderer;

    const configPath = path.join(__dirname, "config.jsonc");
    if (fs.existsSync(configPath)) {
        window.app_config = LS.Util.parseJSONC(fs.readFileSync(configPath, "utf-8"));
    }

    if(window.app_config?.flavor) {
        app.dynamicLoadFlavor(window.app_config.flavor, { delay: false });
    }
}

const SHOW_WELCOME_SCREEN = (!window.app_config?.flavor) && window.app_config?.welcomeScreen !== false;

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
window.addEventListener('DOMContentLoaded', async () => {
    if(window.app_config && window.app_config.flavor) {
        // TODO: Don't guess
        const icon = document.querySelector("#logo");
        icon.src = "./src/flavors/" + window.app_config.flavor + "/images/icon.svg";
    }

    app.layoutManager.on("resize", (event, child) => {
        // TODO: Temporary, there should be a proper position update listener
        // schedule render on resize
        LS.GlobalWebGLRenderer.render(false, true);
    });

    try {
        // --- Global shortcuts
        app.shortcutManager.map({
            GLOBAL_PAUSE: 'space',
            GLOBAL_SEEK_HOME: 'home',
            GLOBAL_SEEK_END: 'end',
            GLOBAL_FULLSCREEN_VIEW: 'f',
            GLOBAL_FULLSCREEN_WINDOW: ['f11'],
            GLOBAL_NEXT_FRAME: 'shift+right',
            GLOBAL_PREVIOUS_FRAME: 'shift+left',
            GLOBAL_SAVE: 'ctrl+s',
            GLOBAL_OPEN: 'ctrl+o',
            GLOBAL_PROJECT_MANAGER: 'ctrl+shift+o',
            GLOBAL_PROJECT_MANAGER: 'ctrl+shift+o',
            GLOBAL_NEW_PROJECT: 'ctrl+n',
            GLOBAL_FOCUS_HEADER: 'alt',
            GLOBAL_EXPORT_MENU: 'ctrl+e',
            GLOBAL_NEW_WINDOW: 'ctrl+shift+n',
            GLOBAL_OPEN_COMMAND_PALETTE: ['ctrl+shift+p', 'ctrl+k'],

            LAYOUT_NEXT: 'ctrl+shift+right',
            LAYOUT_PREVIOUS: 'ctrl+shift+left',

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


            DEBUG_TOGGLE_DEVTOOLS: 'ctrl+shift+i',
            DEBUG_HARD_RELOAD: 'ctrl+shift+r',
            DEBUG_RELOAD: 'ctrl+r',

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

        app.shortcutManager.assign("GLOBAL_NEW_WINDOW", () => {
            app.newWindow();
        });

        app.shortcutManager.assign("GLOBAL_PAUSE", () => {
            if(app.focusedPreview) {
                app.focusedPreview.togglePlay();
            } else if(app.flavorInstance?.togglePlay) {
                app.flavorInstance.togglePlay();
            }
        });

        app.shortcutManager.assign("GLOBAL_SEEK_HOME", () => {
            if(app.focusedPreview) {
                app.focusedPreview.seek(0, true);
            } else if(app.flavorInstance?.seek) {
                app.flavorInstance.seek(0, true);
            }
        });

        app.shortcutManager.assign("GLOBAL_SEEK_END", () => {
            if(app.focusedPreview) {
                app.focusedPreview.seek(-1);
            } else if(app.flavorInstance?.seek) {
                app.flavorInstance.seek(-1);
            }
        });

        app.shortcutManager.assign("GLOBAL_FULLSCREEN_VIEW", () => {
            if(app.focusedPreview) {
                app.focusedPreview.toggleFullscreen();
            }
        });

        app.shortcutManager.assign("GLOBAL_FULLSCREEN_WINDOW", () => {
            document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
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

        app.shortcutManager.assign("GLOBAL_OPEN_COMMAND_PALETTE", () => {
            if(!app.pallette) {
                LS.Toast.show("Command palette is not available in this flavor or is still loading.");
                return;
            }
            app.pallette.open();
        });

        app.shortcutManager.assign("UNDO", () => {
            app.currentProject.historyManager.undo();
        });

        app.shortcutManager.assign("REDO", () => {
            app.currentProject.historyManager.redo();
        });

        app.shortcutManager.assign("OPEN_PREFERENCES", () => {
            settingsModal.toggle();
        });

        app.shortcutManager.assign("TIMELINE_TOOL_SELECT",  () => { app.flavorInstance.timelineInstance.tool = "select"  });
        app.shortcutManager.assign("TIMELINE_TOOL_SLICE",   () => { app.flavorInstance.timelineInstance.tool = "slice"   });
        app.shortcutManager.assign("TIMELINE_TOOL_PREVIEW", () => { app.flavorInstance.timelineInstance.tool = "preview" });
        app.shortcutManager.assign("TIMELINE_TOOL_GROUP",   () => { app.flavorInstance.timelineInstance.tool = "group"   });
        app.shortcutManager.assign("TIMELINE_TOOL_ERASE",   () => { app.flavorInstance.timelineInstance.tool = "erase"   });
        app.shortcutManager.assign("TIMELINE_TOOL_PAINT",   () => { app.flavorInstance.timelineInstance.tool = "paint"   });
        app.shortcutManager.assign("TIMELINE_TOOL_SLIDE",   () => { app.flavorInstance.timelineInstance.tool = "slide"   });
        app.shortcutManager.assign("TIMELINE_TOOL_RIPPLE",  () => { app.flavorInstance.timelineInstance.tool = "ripple"  });

        app.shortcutManager.assign("DEBUG_TOGGLE_DEVTOOLS", () => {
            if(isNode) {
                app.ipc.send("toggle-devtools");
            }
        });

        app.shortcutManager.assign("DEBUG_HARD_RELOAD", () => {
            if(isNode) {
                app.ipc.send("hard-reload");
            }
        });

        app.shortcutManager.assign("DEBUG_RELOAD", () => {
            window.location.reload();
        });


        let layoutIndex = 0;
        function getLayouts() {
            const result = [];

            console.log("Getting layouts from flavor", app.flavorInstance?.constructor?.name, app.flavorInstance?.constructor?.layoutPresets);

            if(!app.flavorInstance || !app.flavorInstance.constructor.layoutPresets) return result;

            for(const presetName in app.flavorInstance.constructor.layoutPresets) {
                result.push({
                    text: presetName,
                    action() {
                        const preset = app.flavorInstance.constructor.layoutPresets[presetName];
                        layoutIndex = Object.keys(app.flavorInstance.constructor.layoutPresets).indexOf(presetName);

                        if(!preset) {
                            LS.Toast.show(`Layout preset "${presetName}" not found in flavor ${app.flavorInstance.constructor.name}`);
                            return;
                        }

                        app.config.set("layout-for-" + app.flavorInstance.constructor.name, presetName);
                        app.layoutManager.setSchema(preset);
                    }
                });
            }

            return result;
        }

        // --- Layout preset switching (TODO)
        app.shortcutManager.assign("LAYOUT_NEXT", () => {
            console.log("Switching to next layout preset");
            if(!app.flavorInstance || !app.flavorInstance.constructor.layoutPresets) return;
            layoutIndex = (layoutIndex + 1) % Object.keys(app.flavorInstance.constructor.layoutPresets).length;
            const layoutName = Object.keys(app.flavorInstance.constructor.layoutPresets)[layoutIndex];
            app.config.set("layout-for-" + app.flavorInstance.constructor.name, layoutName);
            app.layoutManager.setSchema(app.flavorInstance.constructor.layoutPresets[layoutName]);
        });

        app.shortcutManager.assign("LAYOUT_PREVIOUS", () => {
            if(!app.flavorInstance || !app.flavorInstance.constructor.layoutPresets) return;
            layoutIndex = (layoutIndex - 1 + Object.keys(app.flavorInstance.constructor.layoutPresets).length) % Object.keys(app.flavorInstance.constructor.layoutPresets).length;
            const layoutName = Object.keys(app.flavorInstance.constructor.layoutPresets)[layoutIndex];
            app.config.set("layout-for-" + app.flavorInstance.constructor.name, layoutName);
            app.layoutManager.setSchema(app.flavorInstance.constructor.layoutPresets[layoutName]);
        });

        // --- Setup window control buttons
        minimizeButton.addEventListener('click', () => {
            if(isNode) {
                app.ipc.send("minimize-window");
            }
        });

        maximizeButton.addEventListener('click', () => {
            if(isNode) {
                app.ipc.send("maximize-window");
            }
        });

        closeButton.addEventListener('click', () => {
            window.close();
        });

        // --- Setup undo/redo buttons
        undoButton.addEventListener('click', () => {
            app.currentProject.historyManager.undo();
        });

        redoButton.addEventListener('click', () => {
            app.currentProject.historyManager.redo();
        });


        // --- Setup settings modal

        const settingsModal = settings.createModal(settingsContent);

        // --- Setup top menus
        // TODO: Load menus based on flavor

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
                { text: "Preferences", action() {
                    app.shortcutManager.triggerMapping("OPEN_PREFERENCES");
                }, icon: "bi-sliders" },

                { type: "separator" },

                { text: "Open command palette", icon: "bi-command", action() {
                    app.shortcutManager.triggerMapping("GLOBAL_OPEN_COMMAND_PALETTE");
                } },

                { type: "separator" },

                { text: "Set editor theme", items: [
                    { icon: "bi-sun", text: "Light", action() { LS.Color.setTheme('light'); localStorage.setItem("ls-theme", "light"); } },
                    { icon: "bi-moon", text: "Dark", action() { LS.Color.setTheme('dark'); localStorage.setItem("ls-theme", "dark"); } },
                    { icon: "bi-laptop", text: "Auto", action() { localStorage.removeItem("ls-theme"); LS.Color.setAdaptiveTheme(); } },
                    { type: "separator" },
                    { text: "More...", action() {
                        settings.openPage("appearance");
                    }}
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
                    { type: "separator" },
                    { text: "More...", action() {
                        settings.openPage("appearance");
                    }}
                ] },

                { type: "separator" },

                { text: "Set editor language", items: [
                        { code: "en", text: "English" },
                        { code: "cs", text: "Čeština (Czech)" },
                        // { code: "de", text: "Deutsch (German)" },
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
                }
            ],

            layout: [
                { text: "Flavor layout presets", items: getLayouts },
                { text: "Saved layouts", items: [] },

                // { type: "separator" },

                // { text: "Save Current Layout", action() {} },

                // { type: "separator" },
                
                // { text: "Save Current Layout To File", action() {} },
                // { text: "Load Layout From File", action() {} },
            ],

            help: [
                { text: "Report bug", action() {
                    app.openExternal(app.GITHUB_REPO + "/issues?q=state%3Aopen%20label%3Abug");
                } },

                { text: "Request feature", action() {
                    app.openExternal(app.GITHUB_REPO + "/issues?q=state%3Aopen%20label%3Aenhancement");
                } },

                { type: "separator" },

                // { text: "Tutorials", action() {
                //     // ! todo
                //     app.openExternal("https://example.com/tutorials");
                // } },

                // { type: "separator" },

                { text: "About", icon: "bi-stars", action() {
                    app.aboutDialog();
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

        loadPaletteOverlay(app, palleteOverlay);

        if(isNode) {
            if(app.config.get("linuxWaylandSwitchedToX11")) {
                if(process.argv.includes("--ozone-platform=x11") && process.env.DISPLAY.startsWith(":")) {
                    LS.Modal.buildEphemeral({
                        title: "Switched to X11",
                        content: "The application should now use X11 instead of Wayland. To switch back to Wayland at any time, delete the <code>.use-x11</code> file in the application directory and restart the application.",
                        buttons: [
                            { label: "Okay thanks", onclick() { LS.Modal.closeFromElement(this); app.config.set("linuxWaylandSwitchedToX11", false) } }
                        ]
                    }, { closeable: false });
                } else {
                    LS.Modal.buildEphemeral({
                        title: "Failed switching to X11",
                        content: "The application didn't seem to switch correctly or your environment may not be set up correctly for X11 or have an X server running. Try restarting the application.",
                        buttons: [
                            { label: "OK", onclick() { LS.Modal.closeFromElement(this); app.config.set("linuxWaylandSwitchedToX11", false) } }
                        ]
                    }, { closeable: false });
                }
            } else  if (
                process.platform === "linux" &&
                process.env.XDG_SESSION_TYPE === "wayland" &&
                !process.argv.includes("--ozone-platform=x11")
            ) {
                if (!app.config.get("linuxWaylandWarningShown")) {
                    LS.Modal.buildEphemeral({
                        title: "Wayland detected",
                        content: "Hello fellow Wayland user!<br><br>The Pointer Lock API used for things like knobs currently has major issues on Wayland.<br><br>You may experience issues/bugs with certain controls that I sadly have no control over. If you encounter problems, please consider switching to X11.<br><br>You can use the button below to try switching to X11 autoamtically for this app <b>(won't affect your system settings)</b>. If this improves in the future, Wayland will be officially supported again.",
                        buttons: [
                            { label: "OK", onclick() { LS.Modal.closeFromElement(this); app.config.set("linuxWaylandWarningShown", true) } },
                            { label: "Try switching to X11", onclick() {
                                const fs = require("fs");
                                fs.writeFileSync(".use-x11", `true`);
                                app.config.set("linuxWaylandSwitchedToX11", true);
                                app.ipc.send("restart-app");
                            } },
                        ]
                    }, { closeable: false });
                }
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
        if(SHOW_WELCOME_SCREEN) {
            document.querySelector("#app-loading")?.remove();
            app.leaveShade();
        }

    }
});

// --- Warn about unsaved changes on exit
window.addEventListener("beforeunload", (e) => {
    if(app?.currentProject?.unsavedChanges) {
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
                { emmet: 'i.bi-aspect-ratio' },
                { emmet: 'h1{Your screen is too small}' },
                { emmet: 'p', html: `You need at least ${MIN_EDITOR_WIDTH} pixels of screen width to use the editor. There is no full mobile support at this time (But I am not opposed to adding it - <a href="${app.GITHUB_REPO}/issues?q=state%3Aopen%20label%3Aenhancement" target="_blank" rel="noopener noreferrer">let me know</a>).` }
            ]
        })));

        LS.Modal.closeAll();
    } else {
        if(app.mobileDisclaimer) app.mobileDisclaimer.remove();
        document.body.appendChild(app.container);
    }
});

window.addEventListener('resize', invokeAndReturn(() => {
    mobileWarningSwitch.set(window.innerWidth < MIN_EDITOR_WIDTH);
}));

// --- Debug
window.Project = Project;

export default app;