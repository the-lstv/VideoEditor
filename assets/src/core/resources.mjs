/**
 * Resources/assets management module.
 * 
 * Resources can be embedded in the project file or stored externally.
 * It used to always store files by hash though that is no longer the case, only for embedded resources.
 * 
 * Provides various utility functions for working with resources and loading in various ways.
 */

import Project from "./project.mjs";
import { VideoDecoder } from "../backends/video/index.mjs";

// import * as THREE from "three";

const MAX_EMBED_RESOURCE_SIZE = 50 * 1024 * 1024; // 50 MB

const RESOURCE_DEFAULT_COLORS = {
    sound: "purple",
    video: "blue",
    sprite: "green",
    image: "green"
};

const RESOURCE_MIME_TYPES = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    avif: "image/avif",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    m4v: "video/x-m4v",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
    aac: "audio/aac",
    m4a: "audio/mp4",
    default: "application/octet-stream"
};

const textureLoader = new THREE.TextureLoader();

let fs, path, electron;
if(typeof require !== "undefined") {
    fs = require("fs");
    path = require("path");
    electron = require("electron");
}

class Resource {
    constructor(options) {
        this.id = options.id || LS.Misc.uid();
        this.path = options.path || "Unnamed Resource" + this.id;

        this.mimeType = options.mimeType || (options.name && RESOURCE_MIME_TYPES[options.name.split(".").pop()]) || RESOURCE_MIME_TYPES.default;

        this.type = options.type || ({ audio: "sound", video: "video", image: "image" }[this.mimeType.split("/")[0]] || "asset");

        // Whether the resource is stored externally (not embedded)
        this.isExternal = options.isExternal || false;

        // Cache for related loaded assets (textures, audio buffers, etc.)
        this.assets = {};
    }

    getURI() {
        if(this.isExternal) {
            return "file://" + this.path;
        }

        // For embedded resources, we need to get an object URL
        // ! todo
    }

    async getTexture() {
        if(this.type !== "image") {
            throw new Error("Resource.getTexture: resource is not an image/sprite");
        }
        
        if(this.assets.texture) {
            return this.assets.texture;
        }

        // Create a new texture for this resource
        const texture = await textureLoader.loadAsync(this.getURI());
        this.assets.texture = texture;
        return texture;
    }

    getVideoDecoder() {
        if(this.type !== "video") {
            throw new Error("Resource.getVideoDecoder: resource is not a video");
        }

        if(this.assets.videoDecoder) {
            return this.assets.videoDecoder;
        }

        // Create a new video decoder for this resource
        const videoDecoder = new VideoDecoder(this);
        this.assets.videoDecoder = videoDecoder;
        return videoDecoder;
    }

    getAudioBuffer() {
        if(this.type !== "sound") {
            throw new Error("Resource.getAudioBuffer: resource is not a sound");
        }

        // ...
    }

    export() {
        return {
            id: this.id,
            name: this.path,
            type: this.type,
            mimeType: this.mimeType,
            isExternal: this.isExternal
        };
    }

    destroy() {
        // Dispose cached assets
        for(const asset of Object.values(this.assets)) {
            if(asset.dispose) asset.dispose();
            if(asset.destroy) asset.destroy();
        }

        this.assets = null;
    }
}

/**
 * Resource management class
 * Handles access to folders and resources within the project
 * Abstracts browser APIs vs Node.js APIs
 */
class ResourceManager extends LS.EventEmitter {
    constructor(project) {
        if(!(project instanceof Project)) {
            throw new Error("ResourceManager.constructor: project must be an instance of Project");
        }

        super();
        this.project = project;

        // Map of local resources by hash or path
        this.resources = new Map();

        // Project folders
        // Map<string, { path: string }>
        // The key is the unique folder name/identifier.
        // Note that the name is not fixed and does not have to match the actual folder path on disk.
        // Eg. incase the folder moves, the linked folder can easily be updated without breaking the project file structure.
        this.projectFolders = new Map();

        // Cache for created asset objects (textures, etc.)
        this.assetCache = new Map();
    }

    /**
     * Get a resource by it's reference.
     * Reference can be a string (a hash or a path; path can be absolute or relative to project folders when starting with "~/"), a resource object, or an object containing identifying information (id, path, or name).
     * @param {*} ref Resource reference
     * @returns {Resource|null} The resource object or null if not found
     * 
     * @example
     * const res1 = resourceManager.getResource("~/assets/myVideo.mp4");
     */
    getResource(ref) {
        if(typeof ref === "string") {
            if(ref.startsWith("~/")) {
                // Search in project folders
                const folderName = ref.slice(2, ref.indexOf("/", 2));
                const folder = this.projectFolders.get(folderName);

                if(folder) {
                    const relativePath = ref.slice(2 + folderName.length);
                    return { path: path.join(folder.path, relativePath) };
                } else {
                    console.warn("ResourceManager.getResource: folder not found for path", ref);
                    return null;
                }
            }

            return this.resources.get(ref);
        } else if(ref instanceof Resource) {
            return ref;
        } else if(ref && typeof ref === "object") {
            if(ref.id) {
                return this.resources.get(ref.id);
            } else if(ref.path) {
                return this.resources.get(ref.path);
            } else if(ref.name) {
                // Search by name
                for(const resource of this.resources.values()) {
                    if(resource.name === ref.name) return resource;
                }
            }
        }
    }

    async listDirectory(name, path) {
        if(isNode) {
            const folder = this.projectFolders.get(name);
            if(!folder) {
                console.warn("ResourceManager.listDirectory: folder not found", name);
                return [];
            }

            const fullPath = path ? ResourceManager.normalizePath(folder.path + "/" + path, true) : folder.path;
            const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });

            return entries.map(entry => ({
                name: entry.name,
                isDirectory: entry.isDirectory(),
            }));
        } else {
            // Currently not implemented, later could use the some blah blah file api i really don't know
            console.warn("ResourceManager.listDirectory: listing directories is not supported in this environment at this time.");
            return [];
        }
    }

    removeResource(ref) {
        const resource = this.getResource(ref);
        if(resource) {
            this.resources.delete(resource.id);
            this.emit("resource-removed", [resource]);
        }
    }

    /**
     * Load from project's resource data
     * @param {object|array} data Array of resource data or project data containing resources and folders
     */
    loadFrom(data) {
        this.disposeAll();

        if(!Array.isArray(data)) {
            if(typeof data === "object" && data !== null) {
                this.projectFolders = new Map(Object.entries(data.folders || {}));
                data = data.resources || [];
            } else {
                console.warn("ResourceManager.loadFrom: expected array of resources, got", data);
                data = [];
            }
        }

        for(const resData of data) {
            const resource = new Resource(resData);
            this.resources.set(resource.id, resource);
        }
    }

    /**
     * Add project resources (located directly in the project file) from dropped files
     * @param {File[]} files Array of File objects
     * @param {number} row Optional if adding to timeline
     * @param {number} offset Optional if adding to timeline
     */
    async addProjectResources(files, row, offset) {
        console.log("Adding project resources from files", files);
    }

    disposeAll() {
        for(const resource of this.resources.values()) {
            this.disposeResource(resource);
        }

        this.resources.clear();
    }

    disposeResource(resource) {
        const resourceObj = this.getResource(resource);

        // ! todo
        if(resourceObj) {
            resourceObj.destroy();
            this.resources.delete(resourceObj.id);
            this.emit("resource-disposed", [resourceObj]);
            return true;
        }

        return false;
    }

    export() {
        const exportedResources = [];
        for(const resource of this.resources.values()) {
            exportedResources.push(resource.export());
        }
        return exportedResources;
    }

    /**
     * Open the folder picker to pick a folder to add to the project folder list.
     * If folderPath is provided, it will be added directly without showing the folder picker.
     * @param {string} folderPath Optional path to the folder to add.
     */
    async addFolder(folderPath) {
        // Show the proper folder picker
        if(isNode) {
            if(typeof folderPath !== "string") folderPath = await electron.ipcRenderer.invoke('select-directory', 'export');

            if(!folderPath) {
                console.warn("ResourceManager.addFolder: folder selection cancelled");
                return;
            }

            let folderName = path.basename(folderPath);

            if(this.projectFolders.has(folderName)) {
                // If a folder with the same name already exists, append a number to the name
                let counter = 1;
                while(this.projectFolders.has(folderName + " (" + counter + ")")) {
                    counter++;
                }

                folderName = folderName + " (" + counter + ")";
            }

            this.projectFolders.set(folderName, { path: folderPath });
            this.emit("folder-added", [{ name: folderName, path: folderPath }]);
            return;
        }
        
        // Currently not implemented.
        LS.Modal.buildEphemeral({
            title: "Add Folder",
            content: "Sorry, browsing folders is currently only supported in the desktop version.",
            buttons: [
                { label: "OK" }
            ]
        }).show();
    }

    /**
     * Remove a folder by it's name from the project folder list.
     * @param {string} folderName 
     */
    removeFolder(folderName) {
        if(this.projectFolders.has(folderName)) {
            this.projectFolders.delete(folderName);
            this.emit("folder-removed", [{ name: folderName }]);
        }
    }

    /**
     * Rename a folder in the project folder list.
     * It is recommended to listen to the "folder-renamed" event to keep track of folder name changes
     * @param {string} oldName 
     * @param {string} newName 
     */
    renameFolder(oldName, newName) {
        if(this.projectFolders.has(oldName)) {
            const folderData = this.projectFolders.get(oldName);
            this.projectFolders.delete(oldName);

            if(this.projectFolders.has(newName)) {
                console.warn("ResourceManager.renameFolder: a folder with the new name already exists");
                return;
            }

            this.projectFolders.set(newName, folderData);
            this.emit("folder-renamed", [{ oldName, newName }]);
        }
    }

    destroy() {
        // Destroy all resources
        this.disposeAll();

        // Clear asset cache
        this.assetCache.clear();

        // Clear folders
        this.projectFolders.clear();

        this.emit("destroy");
        this.events.clear();
        this.project = null;
    }

    /**
     * Normalizes a file path
     * @param {string} path Path to normalize
     * @param {boolean|null} isAbsolute Whether path is absolute
     * @returns {string} Normalized path
     * 
     * I think this is from LinuxJS lmao
     */
    static normalizePath(path, isAbsolute = null) {
        path = String(path || "").replace(/\\/g, "/").trim();

        const parts = path.split("/");
        const normalizedParts = [];

        for(const part of parts) {
            if(part === "..") {
                normalizedParts.pop();
            } else if(part !== "." && part !== "") {
                normalizedParts.push(part);
            }
        }

        const normalizedPath = normalizedParts.join("/");

        if(isAbsolute === null) isAbsolute = path.startsWith("/");
        return (isAbsolute ? "/" : "") + normalizedPath;
    }
}

export { Resource, ResourceManager, RESOURCE_MIME_TYPES, RESOURCE_DEFAULT_COLORS, MAX_EMBED_RESOURCE_SIZE };