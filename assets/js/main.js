// --- Application setup ---

const VERSION = "2.0.0";

/**
 * Central application object
 */
const appContainer = document.querySelector("#editor-container") || LS.Create({ id: 'app-container' }).addTo(document.body);
const layoutContainer = document.querySelector("#layout-container") || LS.Create({ class: 'layout-container' }).addTo(appContainer);
const settingsContent = document.querySelector("#preferences-modal");
const headerContainer = document.querySelector("#editor-header");
const undoButton = document.querySelector("#undoButton");
const redoButton = document.querySelector("#redoButton");
const config = new EditorBaseClasses.ConfigStore();

const MIN_EDITOR_WIDTH = 600;

PIXI.Ticker.shared.autoStart = false;
PIXI.Ticker.shared.stop();
PIXI.Ticker.system.autoStart = false;
PIXI.Ticker.system.stop();

const app = {
    container: appContainer,
    currentProject: new EditorBaseClasses.Project(),

    layoutManager: new EditorBaseClasses.LayoutManager(layoutContainer, {
        layout: config.get("default-layout") || "default",
    }),

    focusedPreview: null,
    shortcutManager: new LS.ShortcutManager(),
    config
}

const mobileWarningSwitch = new LS.Util.Switch(value => {
    if(value) {
        app.container.remove();
        document.body.appendChild(app.mobileDisclaimer || (app.mobileDisclaimer = LS.Create({
            class: 'disclaimer',
            inner: [
                { tag: 'i', class: 'bi-aspect-ratio' },
                { tag: 'h1', inner: 'Your screen is too small' },
                { tag: 'p', innerHTML: `You need at least ${MIN_EDITOR_WIDTH} pixels of screen width to use the Video Editor. There is no mobile support at this time (if there is interest however, I am not opposed for adding it - <a href="https://github.com/the-lstv/videoeditor/issues?q=state%3Aopen%20label%3Aenhancement" target="_blank" rel="noopener noreferrer">let me know</a>).` }
            ]
        })));

        LS.Modal.closeAll();
    } else {
        if(app.mobileDisclaimer) app.mobileDisclaimer.remove();
        document.body.appendChild(app.container);
    }
});


function updateEditorViewport() {
    mobileWarningSwitch.set(window.innerWidth < MIN_EDITOR_WIDTH);
}


// --- Initialization ---

window.addEventListener("beforeunload", (e) => {
    if(app.currentProject.unsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});

window.addEventListener('load', async () => {
    try {
        if(!window.getxxhash) {
            throw new Error("getxxhash is missing");
        }

        window.app = app;
        window.xxhash = await getxxhash();

        // Initialize editor GUI
        const previewView = new EditorViews.PreviewView();
        const timelineView = new EditorViews.TimelineView();
        const assetManagerView = new EditorViews.AssetManagerView();
        const propertyEditorView = new EditorViews.PropertyEditorView();
        app.focusedPreview = previewView;

        app.layoutManager.add(previewView, timelineView, assetManagerView, propertyEditorView);

        // Initialize project
        app.currentProject.once('ready', () => {
            app.currentProject.connect(previewView);
            app.currentProject.connect(timelineView);
            app.currentProject.connect(assetManagerView);
            app.currentProject.connect(propertyEditorView);
        });

        window.addEventListener('resize', updateEditorViewport);
        updateEditorViewport();

        window.timelineView = timelineView;
        window.timeline = timelineView.timeline;

        // Shortcuts
        app.shortcutManager.map({
            GLOBAL_PAUSE: 'space',
            GLOBAL_SEEK_HOME: 'home',
            GLOBAL_SEEK_END: 'end',
            GLOBAL_FULLSCREEN: 'f',
            GLOBAL_NEXT_FRAME: 'shift+right',
            GLOBAL_PREVIOUS_FRAME: 'shift+left',
            GLOBAL_SAVE: 'ctrl+s',
            GLOBAL_OPEN: 'ctrl+o',
            GLOBAL_NEW_PROJECT: 'ctrl+n',
            GLOBAL_FOCUS_HEADER: 'alt',
            OPEN_PREFERENCES: 'ctrl+,',
            UNDO: 'ctrl+z',
            REDO: [ 'ctrl+shift+z', 'ctrl+y' ],

            ...app.config.get('shortcuts') || {} // Custom shortcuts
        });

        app.shortcutManager.assign("GLOBAL_SAVE", () => {
            // Temporary
            app.currentProject.exportZip(true);
        });

        app.shortcutManager.assign("GLOBAL_OPEN", () => {
            // Temporary
            EditorBaseClasses.Project.openFromZipFile(project => {
                project.once('ready', () => {
                    if(project) {
                        app.currentProject.replaceWith(project);
                        app.currentProject = project;
                    }
                });
            });
        });

        app.shortcutManager.assign("GLOBAL_NEW_PROJECT", () => {
            // Temporary
            const oldProject = app.currentProject;
            app.currentProject = new EditorBaseClasses.Project();
            app.currentProject.once('ready', () => {
                oldProject.replaceWith(app.currentProject);
            });
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
            document.querySelector("#editor-header .header-menu-category").focus();
        });

        app.shortcutManager.assign("UNDO", () => {
            app.currentProject.historyManager.undo();
        });

        app.shortcutManager.assign("REDO", () => {
            app.currentProject.historyManager.redo();
        });

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

        app.shortcutManager.assign("OPEN_PREFERENCES", () => {
            settingsModal.open();
        });

        undoButton.addEventListener('click', () => {
            app.currentProject.historyManager.undo();
        });

        redoButton.addEventListener('click', () => {
            app.currentProject.historyManager.redo();
        });

        // Setup menus
        const menus = {
            file: [
                { text: "New Project", action() { app.shortcutManager.triggerMapping("GLOBAL_NEW_PROJECT"); } },
                { text: "Open Project...", action() { app.shortcutManager.triggerMapping("GLOBAL_OPEN"); } },
                { text: "Save Project", action() { app.shortcutManager.triggerMapping("GLOBAL_SAVE"); } },
                { type: "separator" },
                { text: "Export Video...", action() {
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
                } },

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
            ],

            layout: [
                { text: "Change Layout", items: app.layoutManager.getAvailableLayouts().map(layout => ({
                    text: layout.title,
                    action() {
                        app.layoutManager.setSchema(layout.schema);
                        app.config.set("default-layout", layout.name);
                    }
                })) },
                
                { type: "separator" },

                { text: "Save Current Layout", action() {} },

                { type: "separator" },
                
                { text: "Save Current Layout To File", action() {} },
                { text: "Load Layout From File", action() {} },
            ],

            help: [
                { text: "Report bug", action() {
                    window.open("https://github.com/the-lstv/videoeditor/issues?q=state%3Aopen%20label%3Abug");
                } },

                { text: "Request feature", action() {
                    window.open("https://github.com/the-lstv/videoeditor/issues?q=state%3Aopen%20label%3Aenhancement");
                } },

                { type: "separator" },

                { text: "About", icon: "bi-stars", action() {
                    LS.Modal.buildEphemeral({
                        content: [
                            { tag: 'img', src: 'assets/images/icon-flat.svg', style: 'height: 4em; width: 100%; margin: auto' },
                            { tag: 'h2', inner: 'Video Editor', style: 'text-align: center; margin-bottom: 8px' },
                            { tag: 'p', inner: `Version ${VERSION} (Alpha)` },
                            { tag: 'p', inner: 'A professional video editor built with web technologies and the LS framework.' },
                            { tag: 'p', inner: ['Created with love and hard work by Lukas (', { tag: 'a', href: 'https://lstv.space', target: '_blank', inner: 'https://lstv.space' }, ')'] },
                            { tag: 'p', inner: ['Source code available on ', { tag: 'a', href: 'https://github.com/the-lstv/videoeditor', target: '_blank', inner: 'GitHub' }] },
                        ],
                        buttons: [ { label: "Close" } ]
                    });
                } },
            ],
        };

        for(const menuCategoryElement of headerContainer.querySelectorAll(".header-menu-category")) {
            const menuTitle = menuCategoryElement.innerText.toLowerCase();
            const menuItems = menus[menuTitle] || [];

            if(menuItems.length > 0) {
                new LS.Menu({
                    adjacentElement: menuCategoryElement,
                    items: menuItems,
                    group: "ls-editor-header-menu"
                })
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
        document.querySelector("#logo").classList.add("jump");

        app.container.style.display = 'flex';
        setTimeout(() => {
            app.container.classList.add('loaded');
        }, 0);

    }
});
