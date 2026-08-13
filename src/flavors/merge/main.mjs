/**
 * MergeDAW flavor
 * 
 * 
 * Planned features:
 * - Cross-platform processing engine (can be sourced from the original MergeDAW VST)
 * - Native plugins & DSP
 * - Programmable and scriptable interface & JS integrations
 * - Builtin optimized plugins (generators, effects, samplers, parametric EQ, modular synthesis) & workflow
 * - Patch anything anywhere across the whole workflow
 * - ...
 * 
 * More crazy ideas:
 * - Using Windows plugins on Linux via a Wine wrapper
 * - Mobile support (though probably no native plugins)
 * - Integration with the VideoEditor flavor allowing to both edit visuals and a track in one project
 */

import FlavorBase from "../../core/flavor.mjs";

// --- Views
import { AssetManagerView } from "../../views/asset-manager.mjs";
import PropertyEditorView   from "../../views/property-editor.mjs";
import TimelineView         from "../../views/timeline.mjs";
import MixerView            from "../../views/mixer.mjs";
import LogsView             from "../../views/logs.mjs";
import PianoRollView        from "../../views/pianoroll.mjs";
import PlaybackPanelView    from "../../views/playback-panel.mjs";
import PatcherView          from "../../views/patcher.mjs";

import Project from "../../core/project.mjs";

import { Variable, mappingCompiler } from "../../core/variable.mjs";
import { ResourceManager, Resource } from "../../core/resources.mjs";

import * as AudioEngine from "../../components/audio/index.mjs";
import AudioCompiler from "./compiler.mjs";

const { webUtils } = typeof require !== "undefined" ? require("electron") : {};

const CATEGORY_NAME = "MergeDaw";

function scanPlugins(params) {
    const paths = [
        // Windows
        "C:/Program Files/Common Files/VST3",
        "C:/Program Files/VSTPlugins",

        // MacOS
        "/Library/Audio/Plug-Ins/VST3",
        "/Library/Audio/Plug-Ins/Components",

        // Linux
        "~/.vst3",
        // "~/.clap",
        // "~/.lv2",
        // "~/.vst",
        // "~/.vst2",
        "/usr/lib/vst3",

        // User-defined
        "./plugins"
    ];
}


// --- Digital Audio Workstation flavor
class MergeDaw extends FlavorBase {
    static name = "merge";

    AudioEngine = AudioEngine;

    static iconSet = {
        icon: 'src/flavors/merge/images/icon.svg',
        small: 'src/flavors/merge/images/favicon.svg',
        favicon: 'src/flavors/merge/images/favicon.svg',
        desktopIcon: 'src/flavors/merge/images/favicon.png'
    };

    static version = "0.0.1-alpha";

    async #init() { }

    static async prepare() {
        try {
            await AudioEngine.userInitializeEngine();
        } catch(e) {
            console.error("MergeDaw: Failed to initialize audio engine:", e);
            return e.message || e.toString() || "Unknown error";
        }
        return true;
    }

    #getFilePath(file) {
        if(!file) return null;

        if(webUtils?.getPathForFile) {
            return webUtils.getPathForFile(file);
        }

        return file.path || file.fullPath || null;
    }

    constructor(project) {
        super(project);

        // Attached LS.Timeline instance
        this.timelineInstance = null;

        // Current timeline data
        this.currentTimeline = null;

        this.editingItem = null;

        this.tempo = 120;

        // Cache event references that are emitted frequently (small benefit but skips event lookup)
        // In general this doesn't do much BUT in high-perf scenarios any detail matters so why not do it
        this.__seekEventRef = this.prepareEvent('seek');

        // ! ---- todo: move elsewhere
        // Initialize editor GUI with views for audio editing
        const timelineView = new TimelineView({
            timelineOptions: {
                markerMetric(time, step) {
                    const d = (time * 1000) / 1024;
                    if((d - Math.floor(d)) > 0.1) return null;
                    return String(Math.floor(d) + 1);
                }
            }
        });

        const propertyEditorView = new PropertyEditorView();
        const mixerView = new MixerView();
        const pianoRollView = new PianoRollView();
        const playbackPanelView = new PlaybackPanelView();
        const patcherView = new PatcherView();
        const logsView = new LogsView();

        this.loadPromise = Promise.all([
            timelineView.loadPromise,
        ]);

        const assetManagerView = new AssetManagerView(null, {
            library: {
                objects: [
                    { i18n: "assets.base.automation_clip", icon: "bi-bezier2", label: "Automation clip", type: "automation", item: { type: "automation", label: "Automation clip" } },
                    { i18n: "assets.base.sound", icon: "bi-music-note-beamed", label: "Sound", type: "audio", item: { type: "audio", label: "Sound", tileColor: "purple" } },
                    { i18n: "assets.base.timeline_script", icon: "bi-braces-asterisk", label: "Timeline script", type: "script", item: { type: "script", label: "Timeline script", tileColor: "pastel-indigo" } },
                    { i18n: "assets.base.anotherTimeline", icon: "bi-bar-chart-steps", label: "Another arrangement", type: "timeline", item: { type: "timeline", label: "Timeline" } },
                    { i18n: "assets.base.effect", icon: "bi-sliders", label: "Effect", type: "effect", item: { type: "effect", label: "Effect" } },
                    { i18n: "assets.base.pattern", icon: "bi-music-note-list", label: "Pattern", type: "pattern", item: { type: "pattern", label: "Pattern" } },
                    // { i18n: "assets.base.events", icon: "bi-toggles", label: "Events", type: "events", item: { type: "events", label: "Events" } },
                    { i18n: "assets.base.empty_item", icon: "bi-file-earmark", label: "Empty item", type: "empty", item: { type: "empty", label: "Empty item" } },
                ]
            }
        });

        this.project.on("ready", () => {
            app.layoutManager.add(timelineView, assetManagerView, propertyEditorView, mixerView, pianoRollView, playbackPanelView, patcherView, logsView);
            this.project.connect(timelineView);
            this.project.connect(assetManagerView);
            this.project.connect(propertyEditorView);
            this.project.connect(mixerView);
            this.project.connect(pianoRollView);
            this.project.connect(playbackPanelView);
            this.project.connect(patcherView);
            this.project.connect(logsView);

            patcherView.patcher.on("change", () => {
                // Recompile the patcher program and send it to the audio engine
                try {
                    const program = this.compileProgram(patcherView.patcher);
                    this.engine.uploadProgram(program);
                } catch (error) {
                    // todo: handle error, show in logs view/status bar
                    console.error("Error compiling patcher program:", error);
                }
            });

            const program = this.compileProgram(patcherView.patcher);
            this.engine.uploadProgram(program);
        });

        // Treat the close button as a suspend button since we keep windows alive in the background
        LS.WindowManager.SUSPEND_ON_CLOSE = true;

        const pianoRollWindow = new LS.Window({
            transparent: true,
            content: pianoRollView,
            show: false
        });

        pianoRollWindow.on("move", () => {
            LS.GlobalWebGLRenderer.render(false, true);
        });

        if(!AudioEngine.module) {
            throw new Error("MergeDaw: AudioEngine module is not loaded. Audio engine will not work.");
        }

        this.engine = new AudioEngine.module.Engine({
            start: true,
        });

        // Expose some globals for debugging
        window.timelineView = timelineView;
        window.timeline = timelineView.timeline;
        window.mergedaw = this;
        window.engine = this.engine;
        window.AudioEngine = AudioEngine;
        // ! ----

        this.updateTicker = new LS.Util.FrameScheduler(() => {
            if(!this.timelineInstance) return;

            const time = this.engine.currentTime();
            this.timelineInstance.setSeek(this.samplesToTime(time), true, false);

            const selection = this.timelineInstance.selectionRange;

            // Loop the selection
            if(Math.abs(selection[0] - selection[1]) > 0) {
                if(time > this.timeToSamples(selection[1])) {
                    this.engine.setTime(this.timeToSamples(selection[0]));
                }
            }
        });

        // --- Project hooks

        // When the project data has loaded
        this.project.on("project-data-loaded", (data) => {
            // Here we can initialize some flavor-specific project data
            if(!this.flavorConfig.rendererOptions) {
                this.flavorConfig.rendererOptions = {
                    width: 1280,
                    height: 720
                };
            }

            this.timelines = new Map(Object.entries(data.timelines || {
                "main": []
            }));

            // ! todo; rename to activeTimeline
            this.setTimeline(this.project.config.timeline || "main");
        });

        // When the projects starts initializing
        this.project.once("initializing", async () => {
            await this.#init();
        });

        // When a view connects to the project
        this.project.on("view-connected", async (view) => {
            if(view.attachedTo == null) {
                view.attachedTo = this;
            }

            switch(view.constructor.name) {
                case "timeline":
                    this.timelineInstance = view.timeline;
                    this.setTimeline(this.currentTimeline || "main");

                    this.addExternalEventListener(this.timelineInstance, 'seek', (value, _updateEngineTime) => {
                        if(this.destroyed) return console.error("Timeline emitted seek event for a destroyed instance! This is a bug!", this);

                        this.quickEmit(this.__seekEventRef, value);

                        if (_updateEngineTime !== false) {
                            this.engine.setTime(this.timeToSamples(value));
                        }
                    });

                    this.addExternalEventListener(this.timelineInstance, 'duration-changed', (duration) => {
                        this.quickEmit('duration-changed', duration);
                    });

                    this.addExternalEventListener(this.timelineInstance, 'item-select', (item) => {
                        const itemEditor = this.project.connectedViews.get('propertyEditor');
                        if(itemEditor) {
                            itemEditor.setTarget(item);
                            this.editingItem = item;
                        }

                        console.log("Timeline item selected:", item);
                    });

                    this.addExternalEventListener(this.timelineInstance, 'item-dblclick', (item) => {
                        if(item.type === "notes" || item.type === "pattern") {
                            const pianoRoll = this.project.connectedViews.get('PianoRollView');
                            if(pianoRoll) {
                                pianoRoll.setNotes((item.data.notes ??= []));
                            }

                            pianoRollWindow.show();
                        }
                    });

                    this.addExternalEventListener(this.timelineInstance, 'item-deselect', () => {
                        const itemEditor = this.project.connectedViews.get('propertyEditor');
                        if(itemEditor) {
                            itemEditor.setTarget(null);
                        }

                        this.editingItem = null;
                    });

                    this.addExternalEventListener(this.timelineInstance, "drag-start", (type) => {
                        if(type === "seek") {
                            this.prevPlayState = this.playing;
                            this.pause();
                        }
                    });

                    this.addExternalEventListener(this.timelineInstance, "drag-end", (type) => {
                        if(type === "seek" && this.prevPlayState) {
                            this.play();
                        }
                    });

                    this.addExternalEventListener(this.timelineInstance, 'file-dropped', async (files, row, offset) => {
                        await this.fileDrop({ data: { files } }, this.timelineInstance, offset, row);
                    });

                    this.addExternalEventListener(this.timelineInstance, 'action', (action) => {
                        this.project.historyManager.execute(action);
                    });

                    this.addExternalEventListener(this.timelineInstance, "item-cleanup", (item) => {
                    });

                    this.quickEmit(this.__seekEventRef, this.timelineInstance.seek);
                    this.emit('duration-changed', [this.timelineInstance.duration]);
                    break;

                case "assetManager":
                    this.addExternalEventListener(view, 'asset-dropped', async (event) => {
                        this.fileDrop(event, true);
                    });
            }
        });

        // When a view disconnects from the project
        this.project.on("view-disconnected", (view) => {
            switch(view.constructor.name) {
                case "timeline":
                    view.timeline.reset(null, true);
                    if(this.timelineInstance) {
                        this.timelineInstance.events.clear();
                    }
                    this.timelineInstance = null;
                    break;

                case "propertyEditor":
                    this.editingItem = null;
                    view.setTarget(null);
                    break;
            }

            if(view.attachedTo === this) {
                view.attachedTo = null;
            }
        });

        // When the project data is being exported
        this.project.on("export", (data) => {
            this.#exportTo(data);
        });

        LS.emit("flavor-ready", [this]);
    }

    timeToSamples(time) {
        const tempo = this.tempo || 120;
        return Math.floor((time / 1000) * (tempo / 60) * this.engine.sampleRate);
    }

    samplesToTime(samples) {
        const tempo = this.tempo || 120;
        return (samples / this.engine.sampleRate) * (60 / tempo) * 1000;
    }

    #exportTo(data) {
        if(!data.savedFlavorId) data.savedFlavorId = "merge";

        const exportedTimelines = {};
        for(const [id, timeline] of this.timelines) {
            exportedTimelines[id] = timeline.map(item => {
                return this.timelineInstance.cloneItem(item, true, true);
            });
        }

        data.timelines = exportedTimelines;
    }

    onAboutDialog() {
        const modal = LS.Modal.buildEphemeral({
            content: [
                { tag: 'img', src: this.constructor.iconSet.icon, style: 'height: 5em; width: 100%; margin: auto; animation: yoyo3d 20s ease-in-out infinite alternate;--scale: 0.2' },
                { tag: 'p', html: `Version <code>${this.constructor.version}</code><br>Editor version <code>${app.VERSION}</code><br>LS version <code>${LS.version}</code>` },
                { tag: 'p', inner: 'A work-in progress intuitive, open and hackable digital audio workstation.' },
                { tag: 'p', html: `Created with love and hard work by Lukas (<a href='https://lstv.space' target='_blank'>https://lstv.space</a>)<br><br><strong>Credits:</strong><br>Lukas - <span style=color:var(--surface-10)>Programming, engine (platform, audio engine, UI framework), components, design, libraries, artwork</span><br>Chrome and Node.JS authors - <span style=color:var(--surface-10)>Browser APIs & runtime</span>` },
                { tag: 'p', inner: ['Engine source code available on ', { tag: 'a', href: app.GITHUB_REPO, target: '_blank', inner: 'GitHub' }] },
            ],
            buttons: [ { label: "Close" } ]
        });

        modal.container.classList.add("ls-flavor-about-dialog");
    }

    // --- General setters/getters

    get playing() {
        return this._playing;
    }

    set playing(value) {
        value = !!value;

        this.emit('playing-changed', [value]);
        this.emit(value? 'play': 'pause');

        // todo
        this._playing = value;

        if(value) {
            this.engine.start();
            this.updateTicker.start();
        } else {
            this.engine.pause();
            this.updateTicker.stop();
        }

        console.log("MergeDaw: playing state changed to", value);
    }

    get duration() {
        return this.timelineInstance? this.timelineInstance.duration: 0;
    }

    get time() {
        return this.timelineInstance? this.timelineInstance.seek: 0;
    }

    togglePlay() {
        this.playing = !this.playing;
    }

    play() {
        this.playing = true;
    }

    pause() {
        this.playing = false;
    }

    stop() {
        this.playing = false;
        this.engine.stop();
        this.seek(0);
    }

    seek(time, moveTimelineView = false) {
        if(this.timelineInstance) {
            if(time < 0) {
                time = this.timelineInstance.duration || 0;
            }

            this.timelineInstance.setSeek(time);
            if(moveTimelineView) {
                this.timelineInstance.scrollX = time * this.timelineInstance.zoomX;
            }
        }
    }

    setTimeline(timelineId) {
        const timeline = Array.isArray(timelineId)? timelineId: this.timelines.get(timelineId);
        this.currentTimeline = timeline;

        if(this.timelineInstance) {
            // Set the timeline in the view
            this.timelineInstance.reset(timeline, true);
        }
    }

    compileProgram(patcher) {
        const program = AudioCompiler.compileProgram(patcher || this.patcher);
        return program;
    }

    /**
     * Handles drops on the timeline, either as new resources or as timeline items.
     * @param {*} event The file drop event
     * @param {*} event.data The data associated with the drop, which can be a Resource or raw file data
     * @param {*} event.data.item If the dropped data is a timeline item template, it will be included here for cloning
     * @param {*} event.data.label A label for the dropped item
     * @param {*} event.data.path File path may be included here
     * @param {*} event.data.folderName If a file and belongs to a project folder, the folder name may be included here for better resource organization
     * @param {*} event.data.mimeType Optional MIME type may be included here
     * @param {*} timeline The timeline the file was dropped on, or null if not dropped on a timeline. OR set to true to try to detect based on event coordinates.
     * @param {*} time Optional custom time the file was dropped at, if applicable.
     * @param {*} row Optional custom row the file was dropped on, if applicable.
     * @returns 
     */
    async fileDrop(event, timeline, time, row) {
        if(timeline === true) {
            const dropX = event.x ?? event.clientX ?? event.data?.x;
            const dropY = event.y ?? event.clientY ?? event.data?.y;
            const elementsFromPoint = document.elementsFromPoint(dropX, dropY);
            timeline = elementsFromPoint.find(el => el.classList.contains('ls-timeline'))?.__lsComponent || null;

            if(timeline && !(timeline instanceof LS.Timeline)) {
                LS.Toast.show("Sorry, something went wrong while adding the item to a timeline.", { timeout: 3000, accent: "red" });
                return;
            }
        }

        if(timeline && (time === undefined || row === undefined)) {
            const dropX = event.x ?? event.clientX ?? event.data?.x;
            const dropY = event.y ?? event.clientY ?? event.data?.y;
            const coords = timeline.transformCoords(dropX, dropY);
            time = coords.time;
            row = coords.row;
        }

        console.log("Adding item to timeline at time", time, "row", row);

        const droppedFiles = event?.data?.files || event?.files || event?.dataTransfer?.files;
        if(droppedFiles && typeof droppedFiles.length === "number") {
            const files = Array.from(droppedFiles).map(file => {
                if(typeof file === "string") return file;

                const filePath = this.#getFilePath(file);
                return filePath || file?.name || null;
            }).filter(Boolean);

            if(files.length === 0) return;

            const resources = await this.project.resources.addProjectResources(files, row, time);

            if(!timeline) {
                return resources;
            }

            if(time === undefined) time = this.timelineInstance?.seek || 0;
            if(row === undefined) row = 0;

            for(let index = 0; index < resources.length; index++) {
                const resource = resources[index];
                if(!resource) continue;

                // Now we need to make an item for the asset
                const newItem = {
                    type: resource.guessNodeType(),
                    data: { resource },
                    label: resource.label,
                    start: time,
                    row: row + index,
                    duration: 1000
                };

                const isVideo = resource.type === "video";
                if(resource.type === "image" || isVideo) {
                    const meta = isVideo ? await resource.getVideoMetadata() : await resource.getImageDimensions();

                    if(isVideo) newItem.duration = meta.duration * 1000;

                    const viewportWidth = this.flavorConfig.rendererOptions.width || 1280;
                    const viewportHeight = this.flavorConfig.rendererOptions.height || 720;
                    const resourceWidth = meta.width;
                    const resourceHeight = meta.height;

                    const scale = Math.min(
                        viewportWidth / resourceWidth,
                        viewportHeight / resourceHeight
                    );

                    newItem.data.scaleX = resourceWidth * scale;
                    newItem.data.scaleY = resourceHeight * scale;

                    newItem.data.positionX = (viewportWidth - newItem.data.scaleX) * 0.5;
                    newItem.data.positionY = (viewportHeight - newItem.data.scaleY) * 0.5;
                }

                if(resource.type === "audio") {
                    const meta = await resource.getAudioMetadata();
                    newItem.duration = meta.duration;
                }

                timeline.add(newItem);
            }

            return resources;
        }

        // It is a timeline item/template, we can simply clone it.
        if(event?.data?.item) {
            if(!timeline) return;

            const newItem = timeline.cloneItem(event.data.item);
            newItem.start = time;
            newItem.row = row;
            newItem.duration = newItem.duration || 1000;

            timeline.add(newItem);
        }

        // External file dropped, so we need to ensure it is saved as a resource,
        // and then create a new timeline item.
        else {
            const data = event?.data || {};
            const isResource = data instanceof Resource;

            if(!isResource) {
                data.isExternal = true;
                data.type = null; // :shrug:
                data.id = null; // :shrug:
            }

            const resource = isResource? data: this.project.resources.addResource(data);

            // If not dropping to a timeline, then all we need to do is add the resource to the project
            if(!timeline) {
                LS.Toast.show("Resource added: " + data.label || resource.name || resource.path, { timeout: 3000 });
                return;
            }

            // Now we need to make an item for the asset
            const newItem = {
                type: resource.guessNodeType(),
                // resource: ResourceManager.createReference(resource),
                data: { resource },
                label: data.label || resource.name,
                start: time,
                row,
                duration: 1000
            };

            const isVideo = resource.type === "video";
            if(resource.type === "image" || isVideo) {
                const meta = isVideo? await resource.getVideoMetadata(): await resource.getImageDimensions();

                if(isVideo) newItem.duration = meta.duration * 1000;

                // todo: use w/h
                // newItem.data.scaleX = meta.width;
                // newItem.data.scaleY = meta.height;

                const viewportWidth = this.flavorConfig.rendererOptions.width || 1280;
                const viewportHeight = this.flavorConfig.rendererOptions.height || 720;
                const resourceWidth = meta.width;
                const resourceHeight = meta.height;

                // TODO: temporary, this should later be done by the renderer based on fitMode
                const scale = Math.min(
                    viewportWidth / resourceWidth,
                    viewportHeight / resourceHeight
                )

                newItem.data.scaleX = resourceWidth * scale;
                newItem.data.scaleY = resourceHeight * scale;

                newItem.data.positionX = (viewportWidth - newItem.data.scaleX) * 0.5;
                newItem.data.positionY = (viewportHeight - newItem.data.scaleY) * 0.5;

                // newItem.data.layoutSnap = "fit"; // Snap to video viewport.

                // newItem.data.loopMode = "loop"; // default to enabled looping for videos

                // newItem.data.layoutSnap = "fit"; // Snap to video viewport.
            }

            if(resource.type === "audio") {
                // todo: handle audio resource

                const meta = await resource.getAudioMetadata();
                newItem.duration = meta.duration * 1000;
            }

            timeline.add(newItem);
        }
    }

    /**
     * Destroys the flavor and optionally all connected views
     * @param {Boolean} destroyViews Whether to destroy connected views
     */
    destroy(destroyViews = false) {
        if(this.destroyed) return;

        if(this.timelineInstance) {
            // If destroyViews is true, the timeline has been destroyed already, so we don't need to reset it
            if(!destroyViews) this.timelineInstance.reset(null, true);
            this.timelineInstance = null;
        }

        if(this.renderer) this.renderer.destroy();
        this.currentTimeline = null;

        if(this.timelines) this.timelines.clear();
        super.destroy();
    }

    static layoutPresets = {
        'default': {
            title: "Classic",
            direction: 'column',
            category: CATEGORY_NAME,
            inner: [

                // Two horizontal rows
                { type: "tabs", tabs: [
                    {
                        title: "Arrangement",
                        inner: [
                            {
                                direction: 'column',
                                resize: { width: 350 },
                                inner: [
                                    { type: 'slot', view: 'PlaybackPanelView', minHeight: 110, resize: { height: 200 } },
                                    { type: 'slot', view: 'AssetManagerView' },
                                ]
                            },
                            {
                                direction: 'column',
                                inner: [
                                    {
                                        direction: 'row',
                                        inner: [
                                            {
                                                direction: 'column',
                                                inner: [
                                                    { type: 'slot', view: 'TimelineView' }
                                                ], resize: { width: "75%" }
                                            },
                                            { type: 'slot', view: 'PropertyEditorView', minWidth: 350 }
                                        ], resize: { height: "75%" }
                                    },
                                    { type: 'slot', view: 'MixerView' }
                                ]
                            }
                        ]
                    },

                    {
                        title: "Patcher",
                        inner: [
                            {
                                direction: 'row',
                                inner: [
                                    { type: 'slot', view: 'LogsView', resize: { width: "360px" } },
                                    { type: 'slot', view: 'PatcherView' },
                                ]
                            }
                        ]
                    }
                ] },
            ]
        },
    }

    static {
        LS.Multipane.registerPresets(this.name, this.layoutPresets);
    }
}

export default MergeDaw;