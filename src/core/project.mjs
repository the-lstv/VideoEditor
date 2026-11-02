/**
 * Base project class.
 * @copyright 2026 lstv.space
 * @license GPL-3.0
 * 
 * There is a lot to do here
 */

import { HistoryManager }  from "./base.mjs";
import { ResourceManager } from "./resources.mjs";

import { RootFs } from "./kernel/fs.mjs";

/**
 * Abstract project class
 */
class Project extends LS.Context {
    /**
     * The name of the project
     * @type {string}
     */
    name = null;

    /**
     * The location of the project
     * @type {string}
     */
    location = null;

    /**
     * The configuration of the project
     * @type {Object}
     */
    config = {};

    /**
     * Resources used in the project
     * @type {ResourceManager}
     */
    resources = new ResourceManager(this);

    /**
     * History manager for undo/redo
     * @type {HistoryManager}
     */
    historyManager = new HistoryManager(this);

    /**
     * The views currently connected to this project
     * @type {Map<string, LS.View>}
     */
    connectedViews = new Map();

    /**
     * Whether the project has been loaded
     * @type {boolean}
     */
    loaded = false;

    /**
     * Whether the project has been initialized
     * @type {boolean}
     */
    initialized = false;

    /**
     * Promise that resolves when the project has finished loading and initializing
     * @type {Promise<void>}
     */
    loadPromise = null;

    /**
     * Create a new project instance.
     * @param {Object} data - The data to initialize the project with.
     * @param {string} flavor - The flavor to use for the project.
     */
    constructor(data, flavor) {
        super();

        // if(app.flavorInstance) {
        //     throw new Error("A flavor instance already exists. Creating a new project instance will replace it.");
        // }

        if(app.flavor || flavor) {
            if(app.flavorInstance) {
                app.flavorInstance.destroy();
            }

            app.flavorInstance = new (flavor || app.flavor)(this);
            console.log("Project: Created flavor instance:", app.flavorInstance);
        }

        if(app.currentProject) {
            console.warn("Another project is already loaded, and at this moment it is sadly not possible to open multiple projects simultaneously. Destroying the existing project.", app.currentProject);
            app.currentProject.destroy(true);
        }

        app.currentProject = this;

        this.loadPromise = this.init(data);
    }

    async init(data) {
        if(this.initialized) return;

        // Now do whatever else somethings wants done
        this.configureEvent("initializing", {
            await: true
        });

        await this.emit("initializing", [this]);

        // Load project data
        await this.loadFrom(data || {});

        this.initialized = true;
        this.completed('ready');
    }

    connect(view) {
        if(view.parent) {
            view.parent?.disconnect?.(view);
        }

        view.parent = this;
        
        this.emit("view-connected", [view]);

        this.connectedViews.set(view.constructor.name, view);

        if(view.onAttached) view.onAttached(this);

        view.once("destroy", view.__parentDestroyHandler = () => {
            this.disconnect(view, true);
        });

        return this;
    }

    disconnect(view, destroyed = false) {
        if(typeof view === "string") {
            view = this.connectedViews.get(view);
        }

        if(!view) {
            console.warn(`Project.disconnect: View not found: ${view}`);
            return;
        }

        if(view.__parentDestroyHandler) {
            view.off("destroy", view.__parentDestroyHandler);
            delete view.__parentDestroyHandler;
        }

        this.emit("view-disconnected", [view]);

        this.connectedViews.delete(view.constructor.name);

        if(!destroyed && view.onDetached) view.onDetached(this);

        view.parent = null;
        view.attachedTo = null;
        this.loaded = false;
    }

    async loadFrom(data = {}) {
        this.loaded = false;
        let resourcesLoaded = false;

        // Handle zip file
        if (data instanceof Blob || data instanceof ArrayBuffer) {
            try {
                const buffer = data instanceof Blob? await data.arrayBuffer(): data;
                const unzipped = await new Promise((resolve, reject) => {
                    fflate.unzip(new Uint8Array(buffer), (err, files) => {
                        if (err) reject(err);
                        else resolve(files);
                    });
                });

                if (unzipped['project.json']) {
                    const projectJson = new TextDecoder().decode(unzipped['project.json']);
                    data = JSON.parse(projectJson);

                    await this.resources.loadFrom(data.resources || []);
                    resourcesLoaded = true;
                } else {
                    throw new Error('project.json not found in zip');
                }
            } catch (err) {
                console.error('Failed to load zip file:', err);
                return;
            }
        }

        if (typeof data === "string") {
            data = JSON.parse(data);
        }

        this.config = data.config || {};

        if(!resourcesLoaded) await this.resources.loadFrom(data.resources || {
            resources: [],
            folders: {}
        });

        this.emit("project-data-loaded", [data]);
        this.loaded = true;
    }

    export(asString = false) {
        // ! Todo
        const data = {
            config: this.config,
            resources: this.resources.export(),
        };

        // Let other parts of the application add something to the exported data
        this.emit("export", [data, this]);

        return asString? JSON.stringify(data): data;
    }

    static randomName() {
        const adjectives = [
            "Swift", "Neon", "Crimson", "Silent", "Lunar", "Cyber", "Fuzzy", "Vivid",
            "Glitchy", "Quantum", "Fractal", "Shattered", "Prismatic", "Static",
            "Hyper", "Zero", "Binary", "Pixelated", "Chromatic", "Noisy", "Psycho",
            "Turbo", "Aero", "Sonic", "Electric", "Holo", "Infra", "Ultra", "Nano",
            "Mega", "Giga", "Omega", "Rapid", "Frozen", "Burning", "Radiant", "Dark",
            "Void", "Spectral", "Phase", "Echoing", "Warped", "Distorted", "Jagged",
            "Sharp", "Blazing", "Icy", "Molten", "Toxic", "Viral", "Encrypted",
            "Obsidian", "Aurora", "Shiny", "Cursed", "Blessed", "Chaotic", "Lucid",
            "Mystic", "Phantom", "Ethereal", "Celestial", "Galactic", "Stellar",
            "Cosmic", "Astral", "Temporal", "Spatial", "Dimensional", "Virtual",
            "Augmented", "Synthetic", "Organic", "Mechanical", "Robotic", "Alien",
            "Mutant", "Hybrid", "Sentient", "Artificial", "Digital", "Analog",
            "Retro", "Futuristic", "Postmodern", "Minimalist", "Maximalist",
            "Abstract", "Concrete", "Surreal", "Realistic"
        ];

        const nouns = [
            "Falcon", "Pixel", "Nova", "Echo", "Shadow", "Circuit", "Pulse", "Glitch",
            "Fragment", "Spectrum", "Core", "Drive", "Signal", "Frame", "Loop",
            "Phase", "Drop", "Blast", "Surge", "Wave", "Stream", "Flow", "Beat",
            "Rhythm", "Synth", "Bass", "Kick", "Snare", "Lead", "Pad", "Drone",
            "Sample", "Track", "Mix", "Layer", "Chain", "Patch", "Bit", "Byte",
            "Packet", "Node", "Port", "Link", "Grid", "Mesh", "Axis", "Vector",
            "Pulsewave", "Overdrive", "Underflow", "Overflow", "Crash", "Stack",
            "Buffer", "Kernel", "Thread", "Process", "Cluster", "Shard", "Crystal",
            "Prism", "Mirror", "Lens", "Scope", "Ray", "Beam", "Flash", "Spark",
            "Bolt", "Storm", "Tempest", "Cyclone", "Vortex", "Tornado", "Quake",
            "Tremor", "Rift", "Abyss", "Void", "Eclipse", "Aurora", "Comet",
            "Meteor", "Asteroid", "Planet", "Star", "Galaxy", "Universe", "Dimension",
            "Reality", "Dream", "Nightmare", "Vision", "Illusion", "Phantom",
            "Specter", "Wraith", "Shade", "Spirit", "Soul", "Entity", "Being",
            "Creature", "Monster", "Beast", "Dragon", "Phoenix", "Griffin",
            "Unicorn", "Pegasus", "Centaur", "Minotaur", "Sphinx"
        ];

        return (
            adjectives[Math.floor(Math.random() * adjectives.length)] +
            nouns[Math.floor(Math.random() * nouns.length)] +
            Math.floor(Math.random() * 1000)
        );
    }

    static SAVE_MODAL_SHOWN = false;

    /**
     * User-facing save function.
     */
    async save(newLocation = false) {
        if(typeof __dirname === "undefined") globalThis.__dirname = "/home/user/.editor";

        if(newLocation || !this.location) {
            // Ask the user for a location to save the project

            if(Project.SAVE_MODAL_SHOWN) return;

            this.config.name ??= Project.randomName();

            const projectnameInput   = LS.Create("input.ls-modal-input[placeholder='Project name']", { value: this.config.name });
            const locationElement    = LS.Create({ tag: "span", text: __dirname + "/user/projects/" });
            const projectnameElement = LS.Create({ tag: "span", text: this.config.name });

            const modal = new LS.Modal({
                // closeable: false,
                ephemeral: true,
            }, {
                title: "Save project" + (newLocation? " as" : ""),
                content: [
                    { emmet: "label{Name}", inner: {
                        class: "ls-text-input-container",
                        inner: [projectnameInput, {
                            class: "ls-text-input-bar",
                            inner: { emmet: "button[aria-label='Random name'].elevated>i.bi-dice-5-fill", onclick: () => {
                                const randomName = Project.randomName();
                                this.config.name = randomName;
                                projectnameInput.value = randomName;
                                projectnameElement.textContent = randomName;
                            } }
                        }]
                    } },
                    { tag: "br" },
                    { text: "Location" },
                    { inner: [locationElement, projectnameElement], style: "font-size: smaller; color: var(--surface-10); padding-top: 8px; white-space: pre-wrap; word-break: break-word" },
                    { tag: "br" },
                    { emmet: "button{Choose location}", onclick: async () => {
                        const result = await require("electron").ipcRenderer.invoke('select-directory', 'export');
                        if (result) {
                            this.location = result;
                            locationElement.textContent = this.location;
                        } else {
                            console.error('No location selected for saving the project');
                            return;
                        }
                    } }
                ],

                buttons: [{ label: "Cancel", class: "elevated" }, { label: "Save as .zip", class: "outline" }, { label: "Save", onClick: async () => {
                    if(!this.location) {
                        this.location = __dirname + "/user/projects/";
                    }

                    if(await app.fileSystem.access(this.location + "/" + this.config.name + "/project.json").then(() => true).catch(() => false)) {
                        const overwrite = new LS.Modal({
                            closeable: false,
                            ephemeral: true,
                        }, {
                            title: "Overwrite?",
                            content: "A project with this name already exists. Do you want to overwrite it?",
                            buttons: [
                                { label: "Cancel", class: "elevated" },
                                { label: "Overwrite", onClick: async () => {
                                    await this.saveToLocation();
                                    modal.destroy();
                                    overwrite.destroy();
                                } }
                            ]
                        }).open();
                    } else {
                        await this.saveToLocation();
                        modal.destroy();
                    }
                }}]
            }).open();

            Project.SAVE_MODAL_SHOWN = true;
            modal.once("destroy", () => {
                Project.SAVE_MODAL_SHOWN = false;
            });

            projectnameInput.addEventListener("input", () => {
                this.config.name = projectnameInput.value || "new-project";
                projectnameElement.textContent = this.config.name;
            });

            return;
        }

        await this.saveToLocation();
    }

    async saveToLocation(location = null) {
        location ??= this.location;

        if(!location) {
            LS.Toast.show("Project.saveToLocation: Project location is not set. Cannot save.");
            return;
        }

        const data = this.export();

        // Let other parts of the application handle saving
        this.emit("save", [data, this]);

        await app.fileSystem.mkdir    (location, { recursive: true });
        await app.fileSystem.mkdir    (location + "/assets");
        await app.fileSystem.mkdir    (location + "/backups");
        await app.fileSystem.writeFile(location + "/project.json", JSON.stringify(data));
    }

    async saveBackup(location = null) {
        location ??= this.location;

        if(!location) {
            LS.Toast.show("Project.saveBackup: Project location is not set. Cannot save backup.");
            return;
        }

        const exists = await app.fileSystem.exists(location + "/backups");
        if(!exists) {
            await app.fileSystem.mkdir(location + "/backups", { recursive: true });
        }

        const data = this.export();

        // Let other parts of the application handle saving
        this.emit("save", [data, this]);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `backup-${timestamp}.json`;
        const backupFilePath = `${this.location}/backups/${backupFileName}`;

        await app.fileSystem.writeFile(backupFilePath, JSON.stringify(data));
    }

    /**
     * Packages the project as a zip file.
     * This is mainly useful for small projects only in the browser where native file access or directory access is not possible.
     * Don't use this for large projects
     * @param {*} download 
     * @warning This should not be used most of the time
     * @returns {fflate.Zip} The zip object
     */
    exportZip(download = false, callback = null) {
        const chunks = [];
        const zip = new fflate.Zip((err, data, final) => {
            if (err) {
                console.error("Error generating zip:", err);
                if(callback) callback(err);
                return;
            }

            if (data) chunks.push(data);

            if (final && download) {
                const blob = new Blob(chunks, { type: 'application/zip' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = (this.config.name || 'project') + '.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                chunks.length = 0;

                if(callback) callback();
            }
        });

        const project = new fflate.ZipDeflate("project.json", {
            level: 9
        });

        zip.add(project);
        project.push(new TextEncoder().encode(this.export(true)), true);

        for (const resource of this.resources.resources.values()) {
            // Zip will only include resources explicitly set in the project folder, others are external
            if(resource.isExternal) continue;

            const file = new fflate.ZipDeflate("assets/" + resource.hash, {
                level: 9
            });

            zip.add(file);
            file.push(resource.data, true);
        }
        zip.end();
        return zip;
    }

    /**
     * Replaces this project with another one
     * @param {*} otherProject 
     * @returns {Project} The other project
     */
    replaceWith(otherProject) {
        if(!(otherProject instanceof Project)) {
            throw new Error("Project.replaceWith: otherProject must be an instance of Project");
        }

        // TODO: Replace only views that support it; otherwise destroy and recreate
        for(const view of this.connectedViews.values()) {
            this.disconnect(view);
            otherProject.connect(view);
        }

        this.destroy();
        return otherProject;
    }

    static openFromZipFile(callback) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,application/zip';
        input.onchange = async () => {
            if (input.files.length > 0) {
                // ! tempoarary
                app.currentProject && app.currentProject.destroy(true);

                const file = input.files[0];
                const project = new Project(file);
                if(callback) callback(project);
                return project;
            }
        };
        input.click();
    }

    static openFromFile(callback) {
        app.ipc.invoke('select-file', {
            filters: [
                { name: 'Project Files', extensions: ['json', 'zip'] },
            ],

            defaultPath: __dirname + "/user/projects"
        }).then(filePath => {
            if(!filePath) return callback(null);

            // ! tempoarary
            app.currentProject && app.currentProject.destroy(true);

            try {
                const project = new Project(LS.Util.parseJSONC(require("fs").readFileSync(filePath, "utf-8")));
                project.location = RootFs.dirname(filePath);
                if(callback) callback(project);
            } catch (error) {
                console.error("Error opening project file:", error);

                if(error.message.includes("Unexpected token")) {
                    error = "The project file doesn't seem to be valid JSON";
                }

                callback(null, error);
            }
        });
    }

    // static repairProjectData(data) {}

    /**
     * Destroys the project and optionally all connected views
     * @param {Boolean} destroyViews Whether to destroy connected views (warning: this could destroy more than you expect, and is not always necessary)
     */
    destroy(destroyViews = false) {
        if(this.destroyed) return;

        if(app.flavorInstance) {
            app.flavorInstance.destroy();
        }

        // TODO: Proper destruction

        for(const view of this.connectedViews.values()) {
            this.disconnect(view);
            if(destroyViews) {
                view.destroy();
            }
        }

        this.connectedViews.clear();

        this.resources.destroy();
        this.resources = null;

        this.historyManager.destroy();
        this.config = null;

        this.loadPromise = null;

        if(app.currentProject === this) {
            app.currentProject = null;
        }

        super.destroy();
    }
}

export default Project;