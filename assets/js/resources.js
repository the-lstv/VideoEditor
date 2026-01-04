const MAX_RESOURCE_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * Resource management class
 * Handles access to folders and resources within the project
 * Abstracts browser APIs vs Node.js APIs
 */
class ResourceManager extends LS.EventHandler {
    constructor(project) {
        if(!(project instanceof EditorBaseClasses.Project)) {
            throw new Error("ResourceManager.constructor: project must be an instance of Project");
        }

        super();
        this.project = project;

        // Map of local resources by hash
        this.resources = new Map();

        // Project folders that we can access via browser APIs
        // This is not needed when having access to Node.js
        this.projectFolders = new Map();

        // Cache for created asset objects (textures, etc.)
        this.assetCache = new Map();

        // Permission modal reference
        this.permissionModal = null;

        // IndexedDB database name and store
        this.dbName = 'VideoEditorResourceManager';
        this.dbStoreName = 'folderHandles';
        this._db = null;
    }

    /**
     * Opens or returns the IndexedDB database
     * @returns {Promise<IDBDatabase>}
     */
    async _openDB() {
        if (this._db) return this._db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.dbStoreName)) {
                    db.createObjectStore(this.dbStoreName, { keyPath: 'name' });
                }
            };

            request.onsuccess = (event) => {
                this._db = event.target.result;
                resolve(this._db);
            };

            request.onerror = (event) => {
                console.warn('ResourceManager: Failed to open IndexedDB', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * Stores a directory handle in IndexedDB
     * @param {string} name Folder name
     * @param {FileSystemDirectoryHandle} handle Directory handle
     * @returns {Promise<void>}
     */
    async _storeHandleInIDB(name, handle) {
        if (isNode || !handle) return;

        try {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(this.dbStoreName, 'readwrite');
                const store = transaction.objectStore(this.dbStoreName);
                const request = store.put({ name, handle });

                request.onsuccess = () => resolve();
                request.onerror = (event) => {
                    console.warn('ResourceManager: Failed to store handle in IndexedDB', event.target.error);
                    reject(event.target.error);
                };
            });
        } catch (e) {
            console.warn('ResourceManager: Failed to store handle in IndexedDB', e);
        }
    }

    /**
     * Retrieves a directory handle from IndexedDB
     * @param {string} name Folder name
     * @returns {Promise<FileSystemDirectoryHandle|null>}
     */
    async _getHandleFromIDB(name) {
        if (isNode) return null;

        try {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(this.dbStoreName, 'readonly');
                const store = transaction.objectStore(this.dbStoreName);
                const request = store.get(name);

                request.onsuccess = (event) => {
                    const result = event.target.result;
                    resolve(result ? result.handle : null);
                };

                request.onerror = (event) => {
                    console.warn('ResourceManager: Failed to get handle from IndexedDB', event.target.error);
                    resolve(null);
                };
            });
        } catch (e) {
            console.warn('ResourceManager: Failed to get handle from IndexedDB', e);
            return null;
        }
    }

    /**
     * Removes a directory handle from IndexedDB
     * @param {string} name Folder name
     * @returns {Promise<void>}
     */
    async _removeHandleFromIDB(name) {
        if (isNode) return;

        try {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(this.dbStoreName, 'readwrite');
                const store = transaction.objectStore(this.dbStoreName);
                const request = store.delete(name);

                request.onsuccess = () => resolve();
                request.onerror = (event) => {
                    console.warn('ResourceManager: Failed to remove handle from IndexedDB', event.target.error);
                    reject(event.target.error);
                };
            });
        } catch (e) {
            console.warn('ResourceManager: Failed to remove handle from IndexedDB', e);
        }
    }

    /**
     * Restores a folder handle from IndexedDB and updates the projectFolders map
     * @param {string} name Folder name
     * @returns {Promise<boolean>} Whether the handle was restored successfully
     */
    async _restoreHandleFromIDB(name) {
        const handle = await this._getHandleFromIDB(name);
        if (!handle) return false;

        const folderData = this.projectFolders.get(name);
        if (folderData) {
            folderData.handle = handle;
            folderData.needsReconnect = false;
        } else {
            this.projectFolders.set(name, {
                handle,
                name,
                needsReconnect: false
            });
        }
        return true;
    }

    /**
     * Gets a resource by reference object or path/hash string
     * @param {string|Object} refObject Reference string (path/hash) or object with hash/path
     * @returns {Object|null} Resource object or null
     */
    getResource(refObject) {
        if(typeof refObject === "string") {
            // Try as hash first, then as path
            if(this.resources.has(refObject)) {
                return this.resources.get(refObject);
            }
            return this.resources.get(this.normalizePath(refObject));
        }

        if(refObject.hash) {
            return this.resources.get(refObject.hash);
        }

        if(refObject.path) {
            const normalizedPath = this.normalizePath(refObject.path);
            // Search by path in resources
            for(const [key, res] of this.resources) {
                if(res.path === normalizedPath || res.path === refObject.path) {
                    return res;
                }
            }
        }

        return null;
    }

    /**
     * Creates a unique reference object for a resource
     * @param {Object} resource Resource object
     * @returns {Object} Reference object containing hash and optionally folder/path
     */
    createReference(resource) {
        if(!resource) return null;

        const ref = { hash: resource.hash };

        if(resource.sourceType === 'folder') {
            ref.folder = resource.folderName || resource.folder;
            ref.path = this.project.resources.normalizePath(resource.path);
        }

        return ref;
    }

    /**
     * Resolves a reference object to get the actual resource
     * @param {Object} ref Reference object
     * @returns {Object|null} Resource object or null
     */
    resolveReference(ref) {
        if(!ref) return null;
        return this.getResource(ref);
    }

    /**
     * Checks if a folder has permission to be accessed
     * @param {FileSystemDirectoryHandle} handle Directory handle
     * @returns {Promise<'granted'|'denied'|'prompt'>} Permission state
     */
    async checkFolderPermission(handle) {
        if(!handle || !handle.queryPermission) return 'denied';

        try {
            const permission = await handle.queryPermission({ mode: 'read' });
            return permission;
        } catch(e) {
            console.warn("ResourceManager.checkFolderPermission: Failed to query permission", e);
            return 'denied';
        }
    }

    /**
     * Requests permission for a folder
     * @param {FileSystemDirectoryHandle} handle Directory handle
     * @returns {Promise<boolean>} Whether permission was granted
     */
    async requestFolderPermission(handle) {
        if(!handle || !handle.requestPermission) return false;

        try {
            const permission = await handle.requestPermission({ mode: 'read' });
            return permission === 'granted';
        } catch(e) {
            console.warn("ResourceManager.requestFolderPermission: Failed to request permission", e);
            return false;
        }
    }

    /**
     * Validates all folder permissions and shows modal if any need attention
     * @returns {Promise<boolean>} Whether all folders have valid permissions
     */
    async validateFolderPermissions() {
        if(isNode || this.projectFolders.size === 0) return true;

        const folderStatuses = [];
        let hasIssues = false;

        for(const [name, folderData] of this.projectFolders) {
            const handle = folderData.handle;
            let status = 'unknown';
            let canRequest = false;

            if(!handle) {
                status = 'lost';
                hasIssues = true;
            } else {
                const permission = await this.checkFolderPermission(handle);
                if(permission === 'granted') {
                    status = 'granted';
                } else if(permission === 'prompt') {
                    status = 'prompt';
                    canRequest = true;
                    hasIssues = true;
                } else {
                    status = 'denied';
                    hasIssues = true;
                }
            }

            folderStatuses.push({
                name,
                handle,
                status,
                canRequest,
                folderData
            });
        }

        if(hasIssues) {
            return this.showPermissionModal(folderStatuses);
        }

        return true;
    }

    /**
     * Shows the folder permission modal
     * @param {Array} folderStatuses Array of folder status objects
     * @returns {Promise<boolean>} Whether all permissions were resolved
     */
    showPermissionModal(folderStatuses) {
        return new Promise((resolve) => {
            if(this.permissionModal) {
                this.permissionModal.close();
            }

            const statusIcons = {
                'granted': { icon: 'bi-check-circle-fill', color: 'green', text: 'Granted' },
                'prompt': { icon: 'bi-question-circle-fill', color: 'orange', text: 'Permission Required' },
                'denied': { icon: 'bi-x-circle-fill', color: 'red', text: 'Denied' },
                'lost': { icon: 'bi-exclamation-triangle-fill', color: 'red', text: 'Handle Lost' },
                'unknown': { icon: 'bi-question-circle', color: 'gray', text: 'Unknown' }
            };

            const folderListContainer = N({ class: 'folder-permission-list', style: 'max-height: 300px; overflow-y: auto;' });

            const renderFolderList = () => {
                folderListContainer.innerHTML = '';

                for(const folder of folderStatuses) {
                    const statusInfo = statusIcons[folder.status] || statusIcons.unknown;

                    const folderRow = N({ class: 'folder-permission-row', style: 'display: flex; align-items: center; padding: 8px; border-bottom: 1px solid var(--border-color, #333);', inner: [
                        { tag: 'i', class: statusInfo.icon, style: `color: ${statusInfo.color}; margin-right: 10px; font-size: 18px;` },
                        { style: 'flex: 1;', inner: [
                            { tag: 'div', style: 'font-weight: bold;', inner: folder.name },
                            { tag: 'div', style: `font-size: 12px; color: ${statusInfo.color};`, inner: statusInfo.text }
                        ]},
                        { style: 'display: flex; gap: 5px;' }
                    ]});

                    const buttonContainer = folderRow.lastChild;

                    if(folder.status === 'prompt' && folder.canRequest) {
                        buttonContainer.appendChild(N({
                            tag: 'button',
                            class: 'small primary',
                            inner: 'Grant Access',
                            onclick: async () => {
                                const granted = await this.requestFolderPermission(folder.handle);
                                folder.status = granted ? 'granted' : 'denied';
                                folder.canRequest = false;
                                renderFolderList();
                                checkAllResolved();
                            }
                        }));
                    }

                    if(folder.status === 'lost' || folder.status === 'denied') {
                        buttonContainer.appendChild(N({
                            tag: 'button',
                            class: 'small',
                            inner: 'Re-select Folder',
                            onclick: async () => {
                                try {
                                    const newHandle = await window.showDirectoryPicker();
                                    folder.handle = newHandle;
                                    folder.folderData.handle = newHandle;
                                    this.projectFolders.set(folder.name, folder.folderData);
                                    
                                    // Update handle in IndexedDB
                                    await this._storeHandleInIDB(folder.name, newHandle);

                                    const permission = await this.checkFolderPermission(newHandle);
                                    folder.status = permission === 'granted' ? 'granted' : (permission === 'prompt' ? 'prompt' : 'denied');
                                    folder.canRequest = permission === 'prompt';
                                    renderFolderList();
                                    checkAllResolved();
                                } catch(e) {
                                    console.warn("User cancelled folder selection");
                                }
                            }
                        }));

                        buttonContainer.appendChild(N({
                            tag: 'button',
                            class: 'small danger',
                            inner: 'Remove',
                            onclick: () => {
                                this.removeFolder(folder.name);
                                const idx = folderStatuses.indexOf(folder);
                                if(idx !== -1) folderStatuses.splice(idx, 1);
                                renderFolderList();
                                checkAllResolved();
                            }
                        }));
                    }

                    folderListContainer.appendChild(folderRow);
                }

                if(folderStatuses.length === 0) {
                    folderListContainer.appendChild(N({ style: 'padding: 20px; text-align: center; color: gray;', inner: 'No folders configured' }));
                }
            };

            const checkAllResolved = () => {
                const allResolved = folderStatuses.every(f => f.status === 'granted') || folderStatuses.length === 0;
                if(allResolved && this.permissionModal) {
                    setTimeout(() => {
                        if(this.permissionModal) {
                            this.permissionModal.close();
                            this.permissionModal = null;
                        }
                        resolve(true);
                    }, 500);
                }
            };

            renderFolderList();

            this.permissionModal = LS.Modal.build({
                title: 'Folder Permissions Required',
                content: N({ inner: [
                    { tag: 'p', inner: 'Some project folders require permission to access. Please grant access or re-select folders that have lost their handles.' },
                    folderListContainer
                ]}),
                buttons: [
                    {
                        label: 'Continue Anyway',
                        onclick: () => {
                            this.permissionModal.close();
                            this.permissionModal = null;
                            resolve(false);
                        }
                    },
                    {
                        label: 'Grant All',
                        class: 'primary',
                        onclick: async () => {
                            for(const folder of folderStatuses) {
                                if(folder.status === 'prompt' && folder.canRequest) {
                                    const granted = await this.requestFolderPermission(folder.handle);
                                    folder.status = granted ? 'granted' : 'denied';
                                    folder.canRequest = false;
                                }
                            }
                            renderFolderList();
                            checkAllResolved();
                        }
                    }
                ],
                onClose: () => {
                    this.permissionModal = null;
                    resolve(false);
                }
            });

            checkAllResolved();
        });
    }

    /**
     * Adds a folder to the project
     * @returns {Promise<FileSystemDirectoryHandle>} Directory handle
     */
    async addFolder() {
        if(isNode) {
            // Node.js implementation would use fs module
            console.warn("ResourceManager.addFolder: Node.js folder adding not implemented");
            return Promise.reject(new Error("Node.js folder adding not implemented"));
        }

        if(!window.showDirectoryPicker) {
            LS.Modal.buildEphemeral({
                title: "Directory Picker Not Supported",
                content: "Your browser does not support the Directory Picker API. Please use a compatible browser (such as Chrome, or the desktop version of this app).\nFirefox sadly does not support this API yet.",
                buttons: [ { label: "OK" } ]
            });
            return Promise.reject(new Error("Directory Picker API not supported in this browser"));
        }

        try {
            const dirHandle = await window.showDirectoryPicker();
            const permission = await this.requestFolderPermission(dirHandle);

            if(!permission) {
                return Promise.reject(new Error("Permission denied for folder"));
            }

            const folderData = {
                handle: dirHandle,
                name: dirHandle.name,
                addedAt: Date.now()
            };

            this.projectFolders.set(dirHandle.name, folderData);
            
            // Store handle in IndexedDB for persistence
            await this._storeHandleInIDB(dirHandle.name, dirHandle);
            
            this.emit('folder-added', folderData);
            return dirHandle;
        } catch (e) {
            return Promise.reject(e);
        }
    }

    /**
     * Removes a folder from the project
     * @param {string} name Folder name
     */
    removeFolder(name) {
        const folderData = this.projectFolders.get(name);
        if(folderData) {
            // Remove all resources from this folder
            for(const [hash, resource] of this.resources) {
                if(resource.sourceType === 'folder' && resource.folderName === name) {
                    this.destroyResource(resource);
                    this.resources.delete(hash);
                }
            }
            this.projectFolders.delete(name);
            
            // Remove handle from IndexedDB
            this._removeHandleFromIDB(name);
            
            this.emit('folder-removed', name);
        }
    }

    /**
     * Normalizes a file path
     * @param {string} path Path to normalize
     * @param {boolean|null} isAbsolute Whether path is absolute
     * @returns {string} Normalized path
     */
    normalizePath(path, isAbsolute = null) {
        path = path.replace(/\\/g, "/").trim();

        const parts = path.split('/');
        const normalizedParts = [];

        for (const part of parts) {
            if (part === '..') {
                normalizedParts.pop();
            } else if (part !== '.' && part !== '') {
                normalizedParts.push(part);
            }
        }

        const normalizedPath = normalizedParts.join('/');

        if(isAbsolute === null) isAbsolute = path.startsWith('/');
        return (isAbsolute ? '/' : '') + normalizedPath;
    }

    /**
     * Reads a file from a folder or embedded resource
     * @param {Object|string} refObject Reference to the resource
     * @returns {Promise<ArrayBuffer>} File contents
     */
    async readFile(refObject) {
        const resource = this.getResource(refObject);
        if(!resource) {
            return Promise.reject(new Error("Resource not found"));
        }

        // Embedded resource
        if(resource.sourceType === 'project_folder' && resource.data) {
            if(resource.data instanceof Uint8Array) {
                return resource.data.buffer;
            }
            return resource.data;
        }

        // Folder-based resource
        if(resource.sourceType === 'folder') {
            const folderData = this.projectFolders.get(resource.folderName);
            if(!folderData || !folderData.handle) {
                return Promise.reject(new Error(`Folder "${resource.folderName}" not found or handle lost`));
            }

            const permission = await this.checkFolderPermission(folderData.handle);
            if(permission !== 'granted') {
                await this.validateFolderPermissions();
                const newPermission = await this.checkFolderPermission(folderData.handle);
                if(newPermission !== 'granted') {
                    return Promise.reject(new Error(`Permission denied for folder "${resource.folderName}"`));
                }
            }

            try {
                const fileHandle = await this.getFileHandle(folderData.handle, resource.path);
                const file = await fileHandle.getFile();
                return await file.arrayBuffer();
            } catch(e) {
                return Promise.reject(new Error(`Failed to read file: ${e.message}`));
            }
        }

        return Promise.reject(new Error("Unknown resource source type"));
    }

    /**
     * Gets a file handle from a directory handle by path
     * @param {FileSystemDirectoryHandle} dirHandle Directory handle
     * @param {string} path Relative path to file
     * @returns {Promise<FileSystemFileHandle>} File handle
     */
    async getFileHandle(dirHandle, path) {
        const parts = this.normalizePath(path).split('/').filter(p => p);
        let currentHandle = dirHandle;

        for(let i = 0; i < parts.length - 1; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
        }

        return await currentHandle.getFileHandle(parts[parts.length - 1]);
    }

    /**
     * Creates a Blob URL for a resource
     * @param {Object|string} refObject Reference to the resource
     * @returns {Promise<string>} Blob URL
     */
    async createBlobURL(refObject) {
        const resource = this.getResource(refObject);
        if(!resource) {
            return Promise.reject(new Error("Resource not found"));
        }

        // Return cached URL if available
        if(resource._blobURL) {
            return resource._blobURL;
        }

        const data = await this.readFile(refObject);
        const blob = new Blob([data], { type: resource.mimeType || 'application/octet-stream' });
        resource._blobURL = URL.createObjectURL(blob);
        return resource._blobURL;
    }

    /**
     * Creates an asset object (texture, audio, etc.) for a resource
     * @param {Object|string} refObject Reference to the resource
     * @returns {Promise<Object>} Asset object (PIXI.Texture, HTMLAudioElement, etc.)
     */
    async getAssetObject(refObject) {
        const resource = this.getResource(refObject);
        if(!resource) {
            return Promise.reject(new Error("Resource not found"));
        }

        // Return cached asset if available
        const cacheKey = resource.hash;
        if(this.assetCache.has(cacheKey)) {
            return this.assetCache.get(cacheKey);
        }

        const blobURL = await this.createBlobURL(refObject);
        let asset = null;

        switch(resource.type) {
            case 'sprite':
            case 'image':
                asset = await PIXI.Assets.load({
                    src: blobURL,
                    loadParser: 'loadTextures'
                });
                break;

            case 'video':
                asset = await new Promise((resolve, reject) => {
                    const video = document.createElement('video');
                    video.crossOrigin = 'anonymous';
                    video.preload = 'auto';
                    video.muted = true;

                    video.onloadedmetadata = () => {
                        const texture = PIXI.Texture.from(video);
                        resolve({ video, texture });
                    };

                    video.onerror = () => reject(new Error("Failed to load video"));
                    video.src = blobURL;
                });
                break;

            case 'sound':
            case 'audio':
                asset = await new Promise((resolve, reject) => {
                    const audio = new Audio();
                    audio.crossOrigin = 'anonymous';
                    audio.preload = 'auto';

                    audio.onloadedmetadata = () => resolve(audio);
                    audio.onerror = () => reject(new Error("Failed to load audio"));
                    audio.src = blobURL;
                });
                break;

            default:
                // Return raw data for unknown types
                asset = await this.readFile(refObject);
                break;
        }

        this.assetCache.set(cacheKey, asset);
        resource._asset = asset;
        return asset;
    }

    /**
     * Loads resource data from saved project data
     * @param {Object} data Resource data object
     */
    async loadFrom(data = {}) {
        // Load resources
        if(data.resources) {
            for(const [key, resData] of Object.entries(data.resources)) {
                const resource = { ...resData };

                // Convert data back to Uint8Array if it was serialized
                if(resource.data && Array.isArray(resource.data)) {
                    resource.data = new Uint8Array(resource.data);
                }

                if(resource.hash) {
                    this.resources.set(resource.hash, resource);
                } else {
                    this.resources.set(this.normalizePath(key), resource);
                }
            }
        }

        // Load folder references and attempt to restore handles from IndexedDB
        if(data.folders && Array.isArray(data.folders)) {
            for(const folderName of data.folders) {
                // First set up the folder entry
                this.projectFolders.set(folderName, {
                    handle: null,
                    name: folderName,
                    needsReconnect: true
                });

                // Try to restore handle from IndexedDB
                if (!isNode) {
                    await this._restoreHandleFromIDB(folderName);
                }
            }
        }

        // Validate permissions after loading
        if(this.projectFolders.size > 0 && !isNode) {
            // Defer permission validation to allow UI to be ready
            setTimeout(() => this.validateFolderPermissions(), 100);
        }

        this.emit('resources-loaded');
    }

    /**
     * Exports resource data for saving
     * @returns {Object} Exported data
     */
    export() {
        const exportedResources = {};

        for(const [hash, resource] of this.resources) {
            const exported = {
                name: resource.name,
                type: resource.type,
                sourceType: resource.sourceType,
                mimeType: resource.mimeType,
                size: resource.size,
                hash: resource.hash
            };

            if(resource.sourceType === 'folder') {
                exported.folderName = resource.folderName;
            }

            exported.path = this.normalizePath(resource.path);
            exportedResources[hash] = exported;
        }

        return {
            resources: exportedResources,
            folders: Array.from(this.projectFolders.keys())
        };
    }

    getBundledResources() {
        const bundled = [];
        for(const [hash, resource] of this.resources) {
            if(resource.sourceType === 'project_folder') {
                bundled.push(resource);
            }
        }
        return bundled;
    }

    /**
     * Adds files from a folder to the resource manager
     * @param {string} folderName Folder name
     * @param {string} path Relative path within folder
     * @returns {Promise<Object>} Resource object
     */
    async addFileFromFolder(folderName, path) {
        const folderData = this.projectFolders.get(folderName);
        if(!folderData || !folderData.handle) {
            return Promise.reject(new Error(`Folder "${folderName}" not found`));
        }

        const permission = await this.checkFolderPermission(folderData.handle);
        if(permission !== 'granted') {
            return Promise.reject(new Error(`Permission not granted for folder "${folderName}"`));
        }

        try {
            const fileHandle = await this.getFileHandle(folderData.handle, path);
            const file = await fileHandle.getFile();
            const buffer = await file.arrayBuffer();
            const u8 = new Uint8Array(buffer);

            const hasherFactory = xxhash.h64;
            const hash = hasherFactory(u8).toString(16);

            if(this.resources.has(hash)) {
                return this.resources.get(hash);
            }

            const resource = {
                name: file.name,
                type: this.getTypeFromMimeType(file.type),
                sourceType: 'folder',
                folderName,
                path: this.normalizePath(path),
                mimeType: file.type,
                size: file.size,
                hash
            };

            this.resources.set(hash, resource);
            this.emit('resource-added', resource);
            return resource;
        } catch(e) {
            return Promise.reject(new Error(`Failed to add file: ${e.message}`));
        }
    }

    /**
     * Gets resource type from MIME type
     * @param {string} mimeType MIME type
     * @returns {string} Resource type
     */
    getTypeFromMimeType(mimeType) {
        if(!mimeType) return 'asset';
        const category = mimeType.split('/')[0];
        return { 'audio': 'sound', 'video': 'video', 'image': 'sprite' }[category] || 'asset';
    }

    /**
     * Add project resources (located directly in the project file) from dropped files
     * @param {File[]} files Array of File objects
     * @param {number} row Optional if adding to timeline
     * @param {number} offset Optional if adding to timeline
     */
    async addProjectResources(files, row, offset) {
        const addingToTimeline = (typeof row === "number" && typeof offset === "number" && this.project.timeline);
        let totalLength = 0;

        if(!Array.isArray(files) && !(files instanceof FileList)) {
            files = [files];
        }

        try {
            const hasherFactory = xxhash.h64;
            const addedResources = [];

            for (const file of files) {
                if(file instanceof File) {
                    if(file.size > MAX_RESOURCE_SIZE) {
                        LS.Modal.buildEphemeral({
                            title: "File Too Large",
                            content: `The file "${file.name}" exceeds the maximum allowed size of ${MAX_RESOURCE_SIZE / (1024 * 1024)} MB for embedded files and cannot be imported. Please keep project files for small files only (due to how browsers limit how we can load resources). You can add it as a folder resource instead.`,
                            buttons: [ { label: "OK" } ]
                        });
                        continue;
                    }

                    const buffer = await file.arrayBuffer();
                    const u8 = new Uint8Array(buffer);

                    const hash = hasherFactory(u8).toString(16);

                    // Skip if already exists
                    if(this.resources.has(hash)) {
                        addedResources.push(this.resources.get(hash));
                        continue;
                    }

                    const resource = {
                        name: file.name || "Untitled",
                        type: this.getTypeFromMimeType(file.type),
                        sourceType: 'project_folder',
                        path: file.name,
                        mimeType: file.type,
                        size: file.size,
                        data: u8,
                        hash
                    };

                    this.resources.set(hash, resource);
                    addedResources.push(resource);
                    this.emit('resource-added', resource);

                    if(addingToTimeline) {
                        // Get duration for media files
                        let duration = 5;

                        if(resource.type === 'video' || resource.type === 'sound') {
                            try {
                                const asset = await this.getAssetObject({ hash });
                                if(resource.type === 'video' && asset.video) {
                                    duration = asset.video.duration || 5;
                                } else if(resource.type === 'sound' && asset.duration) {
                                    duration = asset.duration || 5;
                                }
                            } catch(e) {
                                console.warn("Failed to get media duration:", e);
                            }
                        }

                        this.project.timeline.add({
                            label: file.name || "Untitled",
                            start: offset + totalLength,
                            duration,
                            row,
                            type: resource.type,
                            color: { "sound": "purple", "video": "blue", "sprite": "green" }[resource.type] || "gray",
                            data: {
                                resource: this.createReference(resource)
                            }
                        });

                        totalLength += duration;
                    }
                } else if (file.handle) {
                    // Probably opening a file from the browser, iduno

                    const timeline = this.project.timeline;
                    if (!timeline) continue;

                    const typeMap = {
                        'jpg': 'sprite', 'jpeg': 'sprite', 'png': 'sprite', 'gif': 'sprite',
                        'webp': 'sprite', 'svg': 'sprite', 'bmp': 'sprite',
                        'mp4': 'video', 'webm': 'video', 'mov': 'video', 'avi': 'video',
                        'mp3': 'sound', 'wav': 'sound', 'ogg': 'sound', 'flac': 'sound', 'aac': 'sound'
                    };

                    const ext = file.extension?.toLowerCase();
                    const type = typeMap[ext] || 'sprite';

                    console.log(file);

                    this.project.timeline.add({
                        type: type,
                        label: file.name.replace(/\.[^/.]+$/, ''),
                        color: { "sound": "purple", "video": "blue", "sprite": "green" }[type] || "gray",
                        start: this.project.timeline.seek || 0,
                        duration: 5,
                        row: 0,
                        data: {
                            resource: this.createReference(file)
                        }
                    });

                    LS.Toast.show(`Added ${file.name} to timeline`, { timeout: 2000 });
                }
            }

            return addedResources;
        } catch (e) {
            console.error("Failed to add project resources:", e);
            LS.Modal.buildEphemeral({
                title: "Error importing files",
                content: "An error occurred while importing the dropped files. Please try again.",
                buttons: [ { label: "OK" } ]
            });
            return [];
        }
    }

    /**
     * Removes a project resource
     * @param {Object|string} refObject Reference to the resource
     */
    removeProjectResource(refObject) {
        const resource = this.getResource(refObject);
        if(!resource) return;
        this.destroyResource(resource);
        this.resources.delete(resource.hash);
        this.emit('resource-removed', resource);
    }

    /**
     * Destroys a resource and cleans up all associated data
     * @param {Object} resource Resource object
     */
    destroyResource(resource) {
        if(!resource) return;

        // Revoke blob URL
        if(resource._blobURL) {
            URL.revokeObjectURL(resource._blobURL);
            delete resource._blobURL;
        }

        // Destroy cached asset
        const cacheKey = resource.hash;
        if(this.assetCache.has(cacheKey)) {
            const asset = this.assetCache.get(cacheKey);

            if(asset instanceof PIXI.Texture) {
                asset.destroy(true);
            } else if(asset && asset.texture instanceof PIXI.Texture) {
                // Video asset
                asset.texture.destroy(true);
                if(asset.video) {
                    asset.video.pause();
                    asset.video.src = '';
                    asset.video.load();
                }
            } else if(asset instanceof HTMLAudioElement) {
                asset.pause();
                asset.src = '';
                asset.load();
            }

            this.assetCache.delete(cacheKey);
        }

        delete resource._asset;

        // Clear embedded data
        if(resource.data) {
            resource.data = null;
        }
    }

    /**
     * Destroys the resource manager and all resources
     */
    destroy() {
        // Close permission modal if open
        if(this.permissionModal) {
            this.permissionModal.close();
            this.permissionModal = null;
        }

        // Destroy all resources
        for(const [hash, resource] of this.resources) {
            this.destroyResource(resource);
        }
        this.resources.clear();

        // Clear asset cache
        this.assetCache.clear();

        // Clear folders
        this.projectFolders.clear();

        // Close IndexedDB connection
        if (this._db) {
            this._db.close();
            this._db = null;
        }

        this.emit('destroy');
        this.events.clear();
        this.project = null;
    }
}

window.ResourceManager = ResourceManager;