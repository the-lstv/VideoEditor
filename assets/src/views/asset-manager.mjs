import * as EditorBaseClasses from "../core/base.mjs";

/**
 * Asset manager view class
 * Not proud of the state of this code
 */
class AssetManagerView extends LS.Multipane.View {
    static name = "assetManager";

    library = {
        objects: {
            name: "Object presets",
            icon: "bi-box",
            items: [
                { name: "Container", type: "container", item: { type: "container", label: "Container", color: "white" } },
                { name: "Dynamic text", type: "text", helpText: "A dynamic text object.\n\nIt uses a custom text rendering engine optimized for this platform. Text can be updated at any time and can be written anywhere on the screen quickly and at any scale. Also supports realtime effects and syntax highlighting.\n\nCons:\n- Fonts need to be converted to a special format limited to a set of characters, and text shaping is not currently supported.\n- Currently only works well with monospace fonts.\n- Larger overhead per instance; it's recommended to reuse it.\n- Slightly more complex to use.\n\nPros:\n- Crisp at any scale\n- Great for dynamic content and per-character effects\n- A more versatile API.\n\nSuitable when you change text or text styles often and need high performance text rendering with advanced per-character effects.", item: { type: "text", label: "Dynamic text", data: { text: "Some text" }, color: "aquamarine" } },
                { name: "Static text", type: "static_text", helpText: "A static text object that uses the browser's native text rendering, and then applies it as a texture to a sprite.\n\nCons:\n- Updates are expensive, meaning changing text or styles often may cause performance issues.\n- Handles less textthan dynamic text (performance and memory usage worsens with more text).\n- Less flexible scripting interface and styling is limited to one block (no individual character styling).\n- Does not handle scaling automatically, so changing text size requires re-rendering, otherwise the text will be distorted/pixelated.\n\nPros:\n- Simpler to use\n- More efficient for fixed text content\n- Handles font features (ligatures, kerning) better and works with any supported language.\n\nSuitable when you have short to medium fixed text content that doesn't need frequent updates and stays more-or-less the same size.", item: { type: "static_text", label: "Static text", data: { text: "Some text" }, color: "aquamarine" } },
                { name: "Simple shape", type: "sprite", icon: "bi-square", item: { type: "sprite", label: "Shape", data: { positionX: 100, positionY: 100, scaleX: 500, scaleY: 500, anchorX: 0, anchorY: 0 } } },
                { name: "Vector shape", type: "graphics", item: { type: "graphics", label: "Vector shape" } },
                { name: "Automation clip", type: "automation", item: { type: "automation", label: "Automation clip", data: { value: 1, points: [ { value: 0, type: "linear", time: 1 } ] } } },
                { name: "Video", type: "video", item: { type: "video", label: "Video", color: "blue" } },
                { name: "Image", type: "sprite", item: { type: "sprite", label: "Image" } },
                { name: "Sound", type: "sound", item: { type: "sound", label: "Sound", color: "purple" } },
                { name: "Pattern", type: "notes", item: { type: "notes", label: "Pattern", color: "yellow" } },
                { name: "3D Mesh", type: "mesh", item: { type: "mesh", label: "3D Mesh", color: "lapis" } },
                { name: "Camera", type: "camera", item: { type: "camera", label: "Camera", color: "orange" } },
                { name: "Light", type: "light", item: { type: "light", label: "Light", color: "yellow" } },
                { name: "Particle emitter", type: "particles", item: { type: "particles", label: "Particle emitter", color: "pink" } },
                { name: "Events", type: "events", item: { type: "events", label: "Events" } },
                { name: "Timeline script", type: "script", item: { type: "script", label: "Timeline script" } },
                { name: "Empty item", type: "empty", item: { type: "empty", label: "Empty item" } }
            ]
        },

        folders: {
            name: "Project Folders",
            icon: "bi-folder",
        },

        projectAssets: {
            name: "Project Assets",
            icon: "bi-file-earmark-binary-fill",
        },

        saved: {
            name: "Saved items",
            icon: "bi-star-fill",
        }
    }

    constructor() {
        super({
            name: 'AssetManagerView',
            title: 'Content library',
            container: LS.Create({
                class: 'editor-asset-manager',
                inner: []
            })
        });

        this.container.add([
            this.__sidebar = LS.Create({ class: 'asset-manager-sidebar' }),
            this.__contentContainer = LS.Create({ class: 'asset-manager-content' })
        ]);

        for(const [tabName, tabData] of Object.entries(this.library)) {
            const tabButton = LS.Create({ attributes: { role: "button", "data-tab": tabName }, inner: { tag: 'i', class: tabData.icon }, tooltip: tabData.name, onclick: () => { this.setTab(tabName) } });
            this.__sidebar.appendChild(tabButton);
        }

        this.previewElement = LS.Create({ class: 'asset-drop-preview' });

        let dragItemType = null;
        this.handle = new LS.Util.TouchHandle(this.__contentContainer, {
            cursor: 'grabbing',
            onStart: (event) => {
                const obj = event.domEvent.target.targetObject || event.domEvent.target._fileData;
                if(!obj) return event.cancel();

                dragItemType = event.domEvent.target.targetObject ? 'library-object' : 'project-asset';

                obj.icon = this.getIcon(obj);
                EditorBaseClasses.dragState.start(obj, event.x, event.y);
            },

            onMove: (event) => EditorBaseClasses.dragState.setPosition(event.x, event.y),

            onEnd: (event) => {
                const x = EditorBaseClasses.dragState.x;
                const y = EditorBaseClasses.dragState.y;
                EditorBaseClasses.dragState.stop();

                const elementsFromPoint = document.elementsFromPoint(x, y);
                const timeline = elementsFromPoint.find(el => el.classList.contains('ls-timeline'))?.__lsComponent || null;

                if(timeline) {
                    if(!(timeline instanceof LS.Timeline) || (dragItemType === 'library-object' && !EditorBaseClasses.dragState.target?.item)) {
                        LS.Toast.show("Sorry, something went wrong while adding the item.", { timeout: 3000, accent: "red" });
                        return;
                    }

                    const { time, row } = timeline.transformCoords(x, y);

                    if(dragItemType === 'library-object') {
                        const newItem = timeline.cloneItem(EditorBaseClasses.dragState.target.item);
                        newItem.start = time;
                        newItem.row = row;
                        newItem.duration = newItem.duration || 1;

                        timeline.add(newItem);
                    } else if(dragItemType === 'project-asset') {
                        this.parent.resources.addProjectResources([EditorBaseClasses.dragState.target], row, time);
                    }
                }
            }
        });

        this.__contentContainer.addEventListener("dragover", (e) => {
            if(this.currentTab !== 'projectAssets') return;

            e.preventDefault();
            this.__contentContainer.classList.add("drag-over");
        });

        this.__contentContainer.addEventListener("dragleave", (e) => {
            if(this.currentTab !== 'projectAssets') return;

            e.preventDefault();
            this.__contentContainer.classList.remove("drag-over");
        });

        this.__contentContainer.addEventListener("drop", (e) => {
            if(this.currentTab !== 'projectAssets') return;

            e.preventDefault();
            this.__contentContainer.classList.remove("drag-over");
            this.parent?.resources.addProjectResources(e.dataTransfer.files);
        });

        this._boundRefreshFolders = () => this.refreshTab('folders');
        this._boundRefreshProjectAssets = () => this.refreshTab('projectAssets');

        this.setTab('objects');
    }

    onAttached() {
        if (this.parent?.resources) {
            this.parent.resources.on('folder-added', this._boundRefreshFolders);
            this.parent.resources.on('folder-removed', this._boundRefreshFolders);
            this.parent.resources.on('resource-added', this._boundRefreshProjectAssets);
            this.parent.resources.on('resource-removed', this._boundRefreshProjectAssets);
            this.parent.resources.on('resources-loaded', () => {
                this.refreshTab('folders');
                this.refreshTab('projectAssets');
            });
        }
    }

    onDetached() {
        if (this.parent?.resources) {
            this.parent.resources.off('folder-added', this._boundRefreshFolders);
            this.parent.resources.off('folder-removed', this._boundRefreshFolders);
            this.parent.resources.off('resource-added', this._boundRefreshProjectAssets);
            this.parent.resources.off('resource-removed', this._boundRefreshProjectAssets);
        }
    }

    refreshTab(tabName) {
        const library = this.library[tabName];
        if (library.__element) {
            library.__element.remove();
            library.__element = null;
        }

        if (this.currentTab === tabName) {
            this.__contentContainer.innerHTML = '';
            this.__contentContainer.appendChild(this.createTab(library));
        }
    }

    setTab(tabName) {
        const library = this.library[tabName];
        const tabs = this.__sidebar.children;

        for(const tab of tabs) {
            tab.classList.toggle('selected', tab.getAttribute('data-tab') === tabName);
        }

        this.currentTab = tabName;
        this.__contentContainer.innerHTML = '';
        this.__contentContainer.appendChild(this.createTab(library));
    }

    createTab(library) {
        const grid = library.__element = LS.Create({ class: 'asset-library-grid' });

        if (library.name === "Project Folders") {
            this._createFoldersTab(grid);
        } else if (library.name === "Saved items") {
            grid.appendChild(LS.Create("ls-box", {
                inner: "You can save presets you use often here for quick access. To save an item, right click on it and select 'Save to library'.",
            }));
        } else if (library.name === "Project Assets") {
            grid.appendChild(LS.Create("ls-box.margin-bottom-medium", {
                inner: "These assets are embedded in the project file and work anywhere. Note that this increases the project file size and memory usage, so use it for small files only! You can drag and drop files here or to the timeline directly.",
            }));

            this.refreshProjectAssets(grid);
        }

        if (library.items) for (const obj of library.items) {
            const itemElement = obj.__element || this.createAssetPreview(obj);
            grid.appendChild(itemElement);
        }

        return grid;
    }

    // FIXME: I know this isnt clean but im tired :(
    _createFoldersTab(grid) {
        grid.appendChild(LS.Create("ls-box.margin-bottom-medium", {
            inner: "Add folders from your computer to browse and access their content."
        }));

        grid.appendChild(LS.Create({
            tag: 'button',
            class: 'elevated',
            inner: [{ tag: 'i', class: 'bi-folder-plus' }, ' Add folder to project'],
            onclick: () => { this.parent.resources.addFolder() }
        }));

        grid.appendChild(LS.Create({
            tag: 'button',
            class: 'elevated',
            inner: [{ tag: 'i', class: 'bi-folder-plus' }, ' Add folder (global)'],
            onclick: () => { this.parent.resources.addFolder() }
        }));

        this.refreshFolders(grid);
    }

    /**
     * Expands or collapses a folder in the folders tab, showing or hiding its content.
     * @warning This is experimental and not clean at all yet. I don't have much time sadly. Life is hard.
     * 
     * @param {*} folderData 
     * @returns 
     */
    toggleExpandFolder(folderData) {
        if (!folderData) return;

        this.parent.resources.listDirectory(folderData.name, "/").then(files => {
            if (!folderData.__element) return;

            let fileList = folderData.__fileList;
            if (fileList) {
                fileList.remove();
                folderData.__fileList = null;
                return;
            }

            fileList = folderData.__fileList = LS.Create({ class: 'folder-file-list' });

            for (const file of files) {
                const fileElement = this.createAssetPreview({
                    name: file.name,
                    type: file.type,
                });

                fileList.appendChild(fileElement);
            }

            folderData.__element.appendChild(fileList);
        });
    }

    /**
     * Refreshes the folder list in the asset library.
     * @param {*} grid The grid element to refresh the folder list in
     */
    refreshFolders(grid) {
        const folders = this.parent?.resources?.projectFolders;

        if (!folders || folders.size === 0) {
            grid.appendChild(LS.Create({
                class: 'empty-state',
                inner: [
                    { tag: 'i', class: 'bi-folder2-open', style: 'font-size: 3em; opacity: 0.3;' },
                    { tag: 'p', inner: 'No folders added yet' }
                ]
            }));
            return;
        }

        const folderGrid = LS.Create({ class: 'folder-list-grid' });

        for (const [name, folderData] of folders) {
            const folderElement = folderData.__element || (folderData.__element = LS.Create({
                class: 'folder-list-item treeview-item',
                inner: [
                    [{ tag: 'i', class: 'bi-folder-fill' }, " " + (folderData.name || folderData.path || "Unnamed folder")],

                    { class: 'folder-actions', inner: [
                        LS.Create({
                            tag: 'button',
                            class: 'square clear small',
                            inner: { tag: 'i', class: 'bi-trash' },
                            tooltip: 'Remove folder',

                            onclick: (e) => {
                                e.stopPropagation();
                                this.parent?.resources.removeFolder(name);
                            }
                        })
                    ]}
                ],

                onclick: () => this.toggleExpandFolder(folderData)
            }));

            folderGrid.appendChild(folderElement);
        }

        grid.appendChild(folderGrid);
    }

    /**
     * Refreshes the project assets in the asset library.
     * @param {*} grid The grid element to refresh the project assets in
     */
    refreshProjectAssets(grid) {
        const resources = this.parent?.resources?.resources;
        if (!resources || resources.size === 0) return;

        for (const [hash, fileData] of resources) {
            const obj = {
                name: fileData.name,
                type: fileData.type,
                hash: fileData.hash,
                path: fileData.path,
                mimeType: fileData.mimeType,
                size: fileData.size,
                sourceType: fileData.sourceType,
                item: this.createItemFromFileData(fileData)
            };

            const itemElement = this.createAssetPreview(obj);
            grid.appendChild(itemElement);
        }
    }

    createItemFromFileData(fileData) {
        const baseItem = {
            label: fileData.name,
            resourceHash: fileData.hash
        };

        switch (fileData.type) {
            case 'sprite':
                return { type: 'sprite', ...baseItem };
            case 'video':
                return { type: 'video', ...baseItem, color: 'blue' };
            case 'sound':
                return { type: 'sound', ...baseItem, color: 'purple' };
            default:
                return { type: fileData.type || 'sprite', ...baseItem };
        }
    }

    createAssetPreview(obj) {
        if(!obj.__element) {
            obj.__element = LS.Create({
                class: 'asset-library-item',
                inner: [
                    { tag: 'i', class: this.getIcon(obj) },
                    { tag: 'span', inner: obj.name },
                    obj.helpText ? { tag: 'i', class: 'bi-info-circle', onclick() {
                        LS.Modal.buildEphemeral({
                            title: obj.name,
                            content: { style: "white-space: pre-wrap;", inner: obj.helpText }
                        });
                    }, style: 'margin-left: auto; opacity: 0.5;' } : null
                ]
            });

            obj.__element.targetObject = obj;
        }

        return obj.__element;
    }

    getIcon(obj) {
        if(obj.mimeType) {
            if (obj.mimeType.startsWith("image/")) return "bi-image";
            if (obj.mimeType.startsWith("video/")) return "bi-film";
            if (obj.mimeType.startsWith("audio/")) return "bi-music-note-beamed";
        }

        return obj.icon || ({
            "container": "bi-archive",
            "sprite": "bi-image",
            "graphics": "bi-vector-pen",
            "text": "bi-textarea-t",
            "static_text": "bi-fonts",
            "video": "bi-film",
            "sound": "bi-music-note-beamed",
            "automation": "bi-bezier2",
            "notes": "bi-music-note-list",
            "camera": "bi-camera-video",
            "empty": "bi-file-earmark",
            "mesh": "bi-box",
            "light": "bi-lightbulb",
            "events": "bi-toggles",
            "particles": "bi-stars",
            "script": "bi-braces-asterisk"
        }[obj.type] || "bi-file")
    }

    destroy() {
        this.onDetached();
        this.handle.destroy();
        this.handle = null;
        this.previewElement.remove();
        this.previewElement = null;
        this.library = null;
        super.destroy();
    }
}

export default AssetManagerView;