/**
 * Resources/assets management module.
 * 
 * Resources can be embedded in the project file or stored externally.
 * It used to always store files by hash though that is no longer the case, only for embedded resources.
 * 
 * Provides various utility functions for working with resources and loading in various ways.
 * 
 * @copyright 2026 lstv.space
 * @license GPL-3.0
 */

import Project from "./project.mjs";
import { VideoDecoder } from "../components/video/index.mjs";

import * as THREE from "three";

const MAX_EMBED_RESOURCE_SIZE = 50 * 1024 * 1024; // 50 MB

const RESOURCE_DEFAULT_COLORS = {
    audio: "purple",
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

let fs, nodePath, electron;
if(typeof require !== "undefined") {
    fs = require("fs");
    nodePath = require("path");
    electron = require("electron");
}

class Resource {
    constructor(options, resourceManager) {
        if(!(resourceManager instanceof ResourceManager)) {
            throw new Error("Resource.constructor: resourceManager must be an instance of ResourceManager");
        }

        this.id = options.id || window?.crypto?.randomUUID?.() || LS.Misc.uid();
        this.path = options.path || this.id;
        this.folderName = options.folderName || null;
        this.label = options.name || this.path.split("/").pop();

        this.mimeType = options.mimeType || (options.path && RESOURCE_MIME_TYPES[options.path.split(".").pop()]) || RESOURCE_MIME_TYPES.default;

        this.type = options.type || ({ audio: "audio", video: "video", image: "image" }[this.mimeType.split("/")[0]] || "asset");

        // Whether the resource is stored externally (not embedded)
        this.isExternal = options.isExternal || false;

        // Cache for related loaded assets (textures, audio buffers, etc.)
        this.assets = {};

        this.resourceManager = resourceManager;
    }

    getURI() {
        if(this.isExternal) {
            return "file://" + this.fullPath;
        }

        // For embedded resources, we need to get an object URL
        // ! todo
    }

    get fullPath() {
        if(this.destroyed) throw new Error("Resource.fullPath: resource is destroyed");

        if(this.folderName) {
            const folder = this.resourceManager.projectFolders.get(this.folderName);
            if(folder) {
                return nodePath.join(folder.path, this.path);
            } else {
                console.warn("Resource.fullPath: folder not found for resource", this);
                return this.path;
            }
        }

        return this.path;
    }

    /**
     * A bit of a silly helper method for when we want to create a node out of a resource without making it manually.
     * Technically this is not standard as nodes can be whatever they want and are not locked into a specific resource type, they only reference other resources.
     * @returns 
     */
    guessNodeType() {
        switch(this.type) {
            case "audio": return "audio";
            default: return "sprite";
            // case "video": case "image": return "sprite";
        }
    }

    async getImageTexture() {
        if(this.type !== "image") {
            throw new Error("Resource.getImageTexture: resource is not an image/sprite");
        }

        if(this.assets.texture) {
            return this.assets.texture;
        }

        // Create a new texture for this resource
        const texture = await textureLoader.loadAsync(this.getURI());
        this.assets.texture = texture;

        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.colorSpace = THREE.SRGBColorSpace;

        return texture;
    }

    getVideoDecoder() {
        if(this.assets.videoDecoder) {
            return this.assets.videoDecoder;
        }

        if(this.type !== "video") {
            throw new Error("Resource.getVideoDecoder: resource is not a video");
        }

        // Create a new video decoder for this resource
        const videoDecoder = new VideoDecoder(this);
        this.assets.videoDecoder = videoDecoder;
        return videoDecoder;
    }

    async getVideoMetadata(estimateFPS = false, extractTags = false, extractAudioInfo = false) {
        const decoder = this.getVideoDecoder();
        return await decoder.getMetadata(estimateFPS, extractTags, extractAudioInfo);
    }

    async getImageDimensions() {
        if(this.type !== "image") {
            throw new Error("Resource.getImageDimensions: resource is not an image/sprite");
        }

        if(this.assets.dimensions) {
            return this.assets.dimensions;
        }

        if(isNode && this.isExternal && !this.assets.texture) {
            // We can simply read only the dimensions, which could be faster when we don't need the texture yet
            const { imageSizeFromFile } = require('image-size/fromFile');
            return (this.assets.dimensions = await imageSizeFromFile(this.fullPath));
        }

        // Fallback to reading the image and getting dimensions from the texture
        const texture = await this.getImageTexture();
        return (this.assets.dimensions = { width: texture.image.width, height: texture.image.height });
    }

    getAudioBuffer() {
        if(this.type !== "audio") {
            throw new Error("Resource.getAudioBuffer: resource is not an audio file");
        }

        // ...
    }

    async readAsArrayBuffer() {
        if(this.isExternal) {
            return await fs.promises.readFile(this.fullPath);
        }

        // For embedded resources
        // ! todo
    }

    async readAsText() {
        if(this.isExternal) {
            return await fs.promises.readFile(this.fullPath, "utf-8");
        }

        // For embedded resources
        // ! todo
    }

    /**
     * Reference value for nodes or the resource itself in the project file.
     * @returns {string|object} Reference value or exportable object for this resource
     */
    export(full = false) {
        if(full) {
            return {
                id: this.id,
                path: this.path,
                folderName: this.folderName,
                type: this.type,
                mimeType: this.mimeType,
                label: this.label,
                isExternal: this.isExternal
            };
        }

        return this.id;
    }

    /**
     * Unload from memory but keep the resource available for use
     */
    unload() {
        // Dispose cached assets
        for(const asset of Object.values(this.assets)) {
            if(typeof asset.dispose === "function") asset.dispose();
            if(typeof asset.destroy === "function") asset.destroy();
        }

        console.log("Unloaded resource", this);
        this.assets = {};
    }

    destroy() {
        if(this.destroyed) return;

        this.unload();

        this.assets = null;
        this.resourceManager = null;
        this.destroyed = true;
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
            const byId = this.resources.get(ref);
            if(byId) return byId;

            this.getResourceByPath(ref);
        } else if(ref instanceof Resource) {
            return ref;
        } else if(ref && typeof ref === "object") {
            if(ref.id) {
                return this.resources.get(ref.id);
            } else if(ref.path) {
                return this.getResourceByPath(ref);
            } else if(ref.name) {
                // Search by name
                for(const resource of this.resources.values()) {
                    if(resource.name === ref.name) return resource;
                }
            }
        }

        return null;
    }

    getResourceByPath(path) {
        console.log(path)
        if(typeof path === "object") {
            const folderName = path.folderName;

            if(folderName) {
                const folder = this.projectFolders.get(folderName);
                if(folder) {
                    return this.getResourceByPath(nodePath.join(folder.path, path.path));
                }
            } else {
                return this.getResourceByPath(path.path);
            }

            return null;
        }

        if(path.startsWith("~/")) {
            // Search in project folders
            const folderName = path.slice(2, path.indexOf("/", 2));
            const folder = this.projectFolders.get(folderName);

            return folder ? this.getResourceByPath(nodePath.join(folder.path, relativePath)) : null;
        }

        path = nodePath.normalize(path);

        // Search by absolute path
        for(const resource of this.resources.values()) {
            if(resource.fullPath === path) return resource;
        }
        return null;
    }

    /**
     * Resolve the project folder a path belongs to, if any.
     * Returns the best matching folder when multiple folders overlap.
     * @param {string} path
     * @returns {{ folderName: string, path: string, fullPath: string } | null}
     */
    getProjectFolderForPath(path) {
        if(typeof path !== "string" || !path) return null;
        if(typeof nodePath === "undefined") return null;

        const normalizedPath = ResourceManager.normalizePath(path, true);
        let bestMatch = null;

        for(const [folderName, folder] of this.projectFolders.entries()) {
            if(!folder?.path) continue;

            const folderPath = ResourceManager.normalizePath(folder.path, true);
            const relativePath = nodePath.relative(folderPath, normalizedPath).replace(/\\/g, "/");
            const isInsideFolder = relativePath === "" || (!relativePath.startsWith("..") && !nodePath.isAbsolute(relativePath));

            if(!isInsideFolder) continue;

            if(!bestMatch || folderPath.length > bestMatch.fullPath.length) {
                bestMatch = {
                    folderName,
                    path: relativePath,
                    fullPath: folderPath
                };
            }
        }

        return bestMatch;
    }

    async listDirectory(name, path) {
        console.log("ResourceManager.listDirectory: listing directory", name, path);
        
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
                path: fullPath + "/" + entry.name,
                relativePath: fullPath.replace(folder.path, "") + "/" + entry.name,
                isDirectory: entry.isDirectory(),
                mimeType: entry.isDirectory() ? null : RESOURCE_MIME_TYPES[entry.name.split(".").pop()] || RESOURCE_MIME_TYPES.default
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
            const resource = new Resource(resData, this);
            this.resources.set(resource.id, resource);
        }
    }

    /**
     * Add project resources (located directly in the project file) from dropped files
     * @param {File[]} files Array of File objects
     * @param {number} row Optional if adding to timeline
     * @param {number} offset Optional if adding to timeline
     */
    // TODO: row/offset doesn't belong here
    async addProjectResources(files, row, offset) {
        console.log("Adding project resources from files", files);

        const addedResources = [];
        for(const file of Array.from(files || [])) {
            const filePath = typeof file === "string" ? file : file?.path || file?.fullPath || file?.name;
            if(!filePath) continue;

            const normalizedPath = typeof nodePath !== "undefined" ? ResourceManager.normalizePath(filePath, true) : filePath;
            const folderInfo = this.getProjectFolderForPath(normalizedPath);
            const resource = this.addResource({
                path: folderInfo?.path || normalizedPath,
                folderName: folderInfo?.folderName || null,
                name: typeof file === "string" ? String(filePath).split(/[\\/]/).pop() : (file.name || String(filePath).split(/[\\/]/).pop()),
                mimeType: file?.type,
                isExternal: true
            });

            if(resource) addedResources.push(resource);
        }

        if(addedResources.length) {
            this.emit("resources-added", [addedResources]);
        }

        return addedResources;
    }

    /**
     * Add a resource to the project.
     * @param {*} resource Resource object
     * @param {string} resource.id Optional id
     * @param {string} resource.path Path or name (for internal resources) of the resource.
     * @param {string} resource.mimeType Optional mime type
     * @param {string} resource.type Optional type (audio, video, image, etc.)
     * @param {boolean} resource.isExternal Optional whether the resource is stored externally
     * @returns {Resource} The added resource object
     */
    addResource(resource) {
        if(this.getResource(resource)) {
            console.log("ResourceManager.addResource: resource added twice", resource);
            return this.getResource(resource);
        }

        if(!(resource instanceof Resource)) {
            resource = new Resource(resource, this);
        }

        if(!resource) {
            console.warn("ResourceManager.addResource: failed to create resource from", resource);
            return null;
        }

        this.resources.set(resource.id, resource);
        this.emit("resource-added", [resource]);
        return resource;
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
            exportedResources.push(resource.export(true));
        }

        const exportedFolders = {};
        for(const [name, folderData] of this.projectFolders.entries()) {
            exportedFolders[name] = folderData;
        }

        return {
            resources: exportedResources,
            folders: exportedFolders
        };
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

            let folderName = nodePath.basename(folderPath);

            if(this.projectFolders.has(folderName)) {
                // If a folder with the same name already exists, append a number to the name
                let counter = 1;
                while(this.projectFolders.has(folderName + " (" + counter + ")")) {
                    counter++;
                }

                folderName = folderName + " (" + counter + ")";
            }

            const folderData = { path: folderPath, name: folderName };
            this.projectFolders.set(folderName, folderData);
            this.emit("folder-added", [folderData]);
            return;
        }
        
        // Currently not implemented.
        LS.Modal.buildEphemeral({
            title: "Add Folder",
            content: "Sorry, browsing folders is currently only supported in the desktop version.",
            buttons: [
                { label: "OK" }
            ]
        });
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

    static addFolder(folderPath) {
    }

    static removeFolder(folderName) {
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

    /**
     * Creates a unique reference object for a resource
     * @param {Object} resource Resource object
     * @returns {Object} Reference object
     */
    static createReference(resource) {
        if(!resource) return null;
        
        const ref = { id: resource.id };

        if(resource.path) {
            ref.path = resource.path;
        }

        return ref;
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
        console.log("Normalizing path", path);
        if(isAbsolute === null) isAbsolute = path.startsWith("/");
        const isMicroslopShitdows = !!path.match(/^([a-zA-Z]:)(\/?)/);

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

        console.log("Normalized path:", (isAbsolute ? (isMicroslopShitdows? "": "/") : "") + normalizedPath, "isAbsolute:", isAbsolute, "isMicroslopShitdows:", isMicroslopShitdows);
        return (isAbsolute ? (isMicroslopShitdows? "": "/") : "") + normalizedPath;
    }
}

export { Resource, ResourceManager, RESOURCE_MIME_TYPES, RESOURCE_DEFAULT_COLORS, MAX_EMBED_RESOURCE_SIZE };