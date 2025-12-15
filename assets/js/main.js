// --- Application setup ---
const { LayoutManager, Project, Renderer, ConfigStore } = EditorBaseClasses;

/**
 * Central application object
 */
const appContainer = document.querySelector("#editor-container") || LS.Create({ id: 'app-container' }).addTo(document.body);
const layoutContainer = document.querySelector("#layout-container") || LS.Create({ class: 'layout-container' }).addTo(appContainer);
const config = new ConfigStore();

const app = {
    container: appContainer,
    currentProject: new Project(),

    layoutManager: new LayoutManager(layoutContainer, {
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
                { tag: 'p', inner: 'You need at least 600 pixels of screen width to use the Video Editor. There is no mobile support at this time (if there is interest however, I am not opposed for adding it - let me know).' }
            ]
        })));
    } else {
        if(app.mobileDisclaimer) app.mobileDisclaimer.remove();
        document.body.appendChild(app.container);
    }
});


function updateEditorViewport() {
    mobileWarningSwitch.set(window.innerWidth < 600);
}


// --- Initialization ---

LS.Color.autoScheme();
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
        app.currentProject.init();
        app.currentProject.once('ready', () => {
            previewView.setSource(app.currentProject.renderer);
        });
    
        window.addEventListener('resize', updateEditorViewport);
        updateEditorViewport();

        //  --- DEBUG, testing timeline ---
        app.layoutManager.setSchema({
            inner: { type: "slot", name: "bottom-right-row" }
        })

        for(let i = 0; i < 100; i++)
        timelineView.timeline.add({
            start: i * 5,
            duration: Math.random() * 5 + 10,
            row: i % 3,
            label: `Clip ${i+1}`,
            color: `hsl(${(i / 10) * 360}deg 80% 60%)`
        });

        window.timelineView = timelineView;
        window.timeline = timelineView.timeline;
    
        // Shortcuts
        app.shortcutManager.map({
            GLOBAL_PAUSE: 'space',
            GLOBAL_SEEK_HOME: 'home',
            GLOBAL_SEEK_END: 'end',
            GLOBAL_FULLSCREEN: 'f',
    
            ...app.config.get('shortcuts') || {} // Custom shortcuts
        });
    
        app.shortcutManager.assign("GLOBAL_PAUSE", () => {
            if(app.focusedPreview) {
                app.focusedPreview.togglePlay();
            }
        });
    
        app.shortcutManager.assign("GLOBAL_SEEK_HOME", () => {
            if(app.focusedPreview) {
                app.focusedPreview.seek(0);
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

document.addEventListener('fullscreenchange', () => {});