/**
 * Base project class.
 * @copyright 2026 lstv.space
 * @license GPL-3.0
 */

import { HistoryManager } from "./base.mjs";
import { ResourceManager } from "./resources.mjs";

/**
 * Abstract project class
 * 
 * It can be used for different types of editors; video editing, daw, game engine, etc.
 */
class Project extends LS.Context {
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

        // The views currently connected to this project
        this.connectedViews = new Map();

        // Resources used in the project
        this.resources = new ResourceManager(this);

        // History manager for undo/redo
        this.historyManager = new HistoryManager(this);

        this.config = {};
        this.initialized = false;

        this.loadPromise = this.init(data);
    }

    async init(data) {
        if(this.initialized) return;

        // Load project data
        await this.loadFrom(data || {});

        // Now do whatever else somethings wants done
        this.prepareEvent("initializing", {
            await: true
        });

        await this.emit("initializing", [this]);

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

    // static repairProjectData(data) {}
    // static backup(project) {}

    /**
     * Destroys the project and optionally all connected views
     * @param {Boolean} destroyViews Whether to destroy connected views (warning: this could destroy more than you expect, and is not always necessary)
     */
    destroy(destroyViews = false) {
        if(this.destroyed) return;

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