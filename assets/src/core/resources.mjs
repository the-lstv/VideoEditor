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

let fs, path;
if(typeof require !== "undefined") {
    fs = require("fs");
    path = require("path");
}

class Resource {
    constructor(options) {
        this.id = options.id || LS.Misc.uid();
        this.path = options.path || "Unnamed Resource" + this.id;

        this.mimeType = options.mimeType || (options.name && RESOURCE_MIME_TYPES[options.name.split(".").pop()]) || RESOURCE_MIME_TYPES.default;

        this.type = { audio: "sound", video: "video", image: "sprite" }[this.mimeType.split("/")[0]] || "asset";

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
        this.projectFolders = new Map();

        // Cache for created asset objects (textures, etc.)
        this.assetCache = new Map();
    }

    getResource(ref) {
        if(typeof ref === "string") {
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

    removeResource(ref) {
        const resource = this.getResource(ref);
        if(resource) {
            this.resources.delete(resource.id);
            this.emit("resource-removed", [resource]);
        }
    }

    /**
     * Load from project's resource data
     */
    loadFrom(data) {
        this.disposeAll();

        if(!Array.isArray(data)) {
            console.warn("ResourceManager.loadFrom: expected array of resources, got", data);
            data = [];
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