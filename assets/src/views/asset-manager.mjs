import * as EditorBaseClasses from "../core/base.mjs";

/**
 * Asset manager view class (standalone)
 * Not proud of the state of this code
 */
class AssetManagerView extends LS.Multipane.View {
    static name = "assetManager";

    libraryTemplate = {
        objects: {
            name: "Basic objects",
            icon: "bi-box",
            items: [
                { icon: "bi-archive", label: "Container", type: "container", item: { type: "container", label: "Container", color: "white" } },
                { icon: "bi-textarea-t", label: "Dynamic text", type: "text", helpText: "A dynamic text object.\n\nIt uses a custom text rendering engine optimized for this platform. Text can be updated at any time and can be written anywhere on the screen quickly and at any scale. Also supports realtime effects and syntax highlighting.\n\nCons:\n- Fonts need to be converted to a special format limited to a set of characters, and text shaping is not currently supported.\n- Currently only works well with monospace fonts.\n- Larger overhead per instance; it's recommended to reuse it.\n- Slightly more complex to use.\n\nPros:\n- Crisp at any scale\n- Great for dynamic content and per-character effects\n- A more versatile API.\n\nSuitable when you change text or text styles often and need high performance text rendering with advanced per-character effects.", item: { type: "text", label: "Dynamic text", data: { text: "Some text" }, color: "aquamarine" } },
                { icon: "bi-fonts", label: "Static text", type: "static_text", helpText: "A static text object that uses the browser's native text rendering, and then applies it as a texture to a sprite.\n\nCons:\n- Updates are expensive, meaning changing text or styles often may cause performance issues.\n- Handles less textthan dynamic text (performance and memory usage worsens with more text).\n- Less flexible scripting interface and styling is limited to one block (no individual character styling).\n- Does not handle scaling automatically, so changing text size requires re-rendering, otherwise the text will be distorted/pixelated.\n\nPros:\n- Simpler to use\n- More efficient for fixed text content\n- Handles font features (ligatures, kerning) better and works with any supported language.\n\nSuitable when you have short to medium fixed text content that doesn't need frequent updates and stays more-or-less the same size.", item: { type: "static_text", label: "Static text", data: { text: "Some text" }, color: "aquamarine" } },
                { icon: "bi-square", label: "Simple shape", type: "sprite", item: { type: "sprite", label: "Shape", data: { positionX: 100, positionY: 100, scaleX: 500, scaleY: 500, anchorX: 0, anchorY: 0 } } },
                { icon: "bi-vector-pen", label: "Vector shape", type: "graphics", item: { type: "graphics", label: "Vector shape" } },
                { icon: "bi-bezier2", label: "Automation clip", type: "automation", item: { type: "automation", label: "Automation clip", data: { value: 1, points: [ { value: 0, type: "linear", time: 1 } ] } } },
                { icon: "bi-film", label: "Video", type: "video", item: { type: "video", label: "Video", color: "blue" } },
                { icon: "bi-image", label: "Image", type: "sprite", item: { type: "sprite", label: "Image" } },
                { icon: "bi-music-note-beamed", label: "Sound", type: "sound", item: { type: "sound", label: "Sound", color: "purple" } },
                { icon: "bi-music-note-list", label: "Pattern", type: "notes", item: { type: "notes", label: "Pattern", color: "yellow" } },
                { icon: "bi-box", label: "3D Mesh", type: "mesh", item: { type: "mesh", label: "3D Mesh", color: "lapis" } },
                { icon: "bi-camera-video", label: "Camera", type: "camera", item: { type: "camera", label: "Camera", color: "orange" } },
                { icon: "bi-lightbulb", label: "Light", type: "light", item: { type: "light", label: "Light", color: "yellow" } },
                { icon: "bi-stars", label: "Particle emitter", type: "particles", item: { type: "particles", label: "Particle emitter", color: "pink" } },
                { icon: "bi-toggles", label: "Events", type: "events", item: { type: "events", label: "Events" } },
                { icon: "bi-braces-asterisk", label: "Timeline script", type: "script", item: { type: "script", label: "Timeline script" } },
                { icon: "bi-file-earmark", label: "Empty item", type: "empty", item: { type: "empty", label: "Empty item" } },
            ]
        },

        folders: {
            name: "File browser",
            icon: "bi-folder",
        },

        projectAssets: {
            name: "Assets used in project",
            icon: "bi-file-earmark-fill",
        },

        saved: {
            name: "Saved items",
            icon: "bi-star-fill",
        }
    }

    constructor(parent) {
        super({
            name: 'AssetManagerView',
            title: 'Content library',
            container: LS.Create({
                class: 'editor-asset-manager',
                inner: []
            })
        });

        if (parent) {
            // When used standalone by other views, otherwise parent is provided by the project multipane
            this.parent = parent;
            this.addExternalEventListener(parent, "destroy", () => this.destroy());
        }

        // Element shown when there is no content to show
        this.emptyStateElement = LS.Create({
            class: 'empty-state',
            inner: [
                { tag: 'i', class: 'bi-folder2-open', style: 'font-size: 3em; opacity: 0.3;' },
                { tag: 'p', inner: 'No content added yet' }
            ]
        });

        // Element shown when dragging an asset
        this.previewElement = LS.Create({ class: 'asset-drop-preview' });

        // Sidebar and content container
        this.container.add([
            this.__sidebar = LS.Create({ class: 'asset-manager-sidebar' }),
            this.__contentContainer = LS.Create({ class: 'asset-manager-content' })
        ]);

        const tree = this.tree = new LS.Tree({
            rowHeight: 32, // Tempoarary

            loadData: async (node) => {
                console.log(node, this.parent);

                if(node.id === 'project-folders') {
                    this.refreshFolders();
                }

                if (node.type === 'folder') {
                    return (await this.parent.resources.listDirectory(node.folderName, node.path)).map(item => ({
                        id: item.path,
                        label: item.name,
                        path: item.relativePath,
                        fullPath: item.path,
                        folderName: node.folderName, //! there needs to be a better way
                        type: item.isDirectory ? 'folder' : 'file',
                        lazy: item.isDirectory,
                        icon: item.isDirectory ? undefined : AssetManagerView.getIcon(item)
                    }));
                }
            },

            updateNode: (node, element) => {
                if(node.color) element.setAttribute("ls-accent", node.color); else element.removeAttribute("ls-accent");
                if(node.description) element.setAttribute("title", node.description); else element.removeAttribute("title");

                if(node.helpText) {
                    const badgeContainer = element.querySelector(".ls-tree-node-badge");
                    if(badgeContainer && !badgeContainer.querySelector(".bi-info-circle")) {
                        // TODO: Optimize to not create a new badge every time
                        const badge = LS.Create({ tag: 'i', class: 'bi-info-circle', tooltip: "Click for more info", onclick() {
                            LS.Modal.buildEphemeral({
                                title: node.label,
                                content: { style: "white-space: pre-wrap;", inner: node.helpText }
                            });
                        }, style: 'margin-left: auto; opacity: 0.5;' });

                        badgeContainer.appendChild(badge);
                    }
                } else {
                    const badge = element.querySelector(".ls-tree-node-badge .bi-info-circle");
                    if(badge) badge.remove();
                }
            }
        });


        // --- File browser UI
        this.fileBrowserContainer = LS.Create({ class: 'file-browser', inner: [
            {
                class: "file-browser-header",
                style: "display: flex; justify-content: space-between; gap: 8px",
                inner: [
                    [
                        {
                            tag: 'button',
                            class: 'clear square',
                            inner: [{ tag: 'i', class: 'bi-arrows-collapse' }],
                            tooltip: "Collapse all folders",
                            onclick: () => {
                                this.tree.collapseAll();
                            }
                        },

                        {
                            tag: 'button',
                            class: 'clear square',
                            inner: [{ tag: 'i', class: 'bi-arrow-clockwise' }],
                            tooltip: "Refresh",
                            onclick: () => {
                                this.refreshFolders();
                            }
                        },
                    ],

                    [
                        {
                            tag: 'button',
                            class: 'elevated',
                            inner: [{ tag: 'i', class: 'bi-folder-plus' }, ' Project'],
                            tooltip: "Add a project folder",
                            onclick: () => { this.parent.resources.addFolder() }
                        },

                        {
                            tag: 'button',
                            class: 'elevated',
                            inner: [{ tag: 'i', class: 'bi-folder-plus' }, ' Global'],
                            tooltip: "Add a global folder",
                            onclick: () => { this.parent.resources.addFolder() }
                        }
                    ]
                ]
            },

            { class: 'file-browser-content', inner: tree.container }
        ] });

        tree.on("click", (node) => {
            // ...
            console.log("Clicked node:", node);
            this.quickEmit("file-clicked", node);
        });

        // --- Sidebar library tabs
        for(const [tabName, tabData] of Object.entries(this.libraryTemplate)) {
            const tabButton = LS.Create({ attributes: { role: "button", "data-tab": tabName }, inner: { tag: 'i', class: tabData.icon }, tooltip: tabData.name, onclick: () => { this.setTab(tabName) } });
            this.__sidebar.appendChild(tabButton);
        }


        // --- Drag and drop handling for assets
        this.handle = new LS.Util.TouchHandle(this.__contentContainer, {
            cursor: 'grabbing',
            buttons: [0],

            onStart: (event) => {
                const treeNodeElement = event.domEvent.target.closest('.ls-tree-node');
                if(!treeNodeElement) return event.cancel();

                const nodeData = this.tree.getNodeDataByElement(treeNodeElement);
                if(nodeData?.type === 'folder' || nodeData.children || nodeData.lazy) return event.cancel();

                // Set the drag state to the resource being dragged
                EditorBaseClasses.dragState.start(nodeData, event.x, event.y);
            },

            // During dragging, we simply update the position
            onMove: (event) => EditorBaseClasses.dragState.setPosition(event.x, event.y),

            // Asset dropped
            onEnd: (event) => {
                const x = EditorBaseClasses.dragState.x;
                const y = EditorBaseClasses.dragState.y;
                EditorBaseClasses.dragState.stop();

                if(!EditorBaseClasses.dragState.target) {
                    LS.Toast.show("Sorry, something went wrong while adding the item.", { timeout: 3000, accent: "red" });
                    return;
                }

                return this.quickEmit("asset-dropped", {
                    data: EditorBaseClasses.dragState.target,
                    x, y
                });
            }
        });

        // this.__contentContainer.addEventListener("dragover", (e) => {
        //     if(this.currentTab !== 'projectAssets') return;

        //     e.preventDefault();
        //     this.__contentContainer.classList.add("drag-over");
        // });

        // this.__contentContainer.addEventListener("dragleave", (e) => {
        //     if(this.currentTab !== 'projectAssets') return;

        //     e.preventDefault();
        //     this.__contentContainer.classList.remove("drag-over");
        // });

        // this.__contentContainer.addEventListener("drop", (e) => {
        //     if(this.currentTab !== 'projectAssets') return;

        //     e.preventDefault();
        //     this.__contentContainer.classList.remove("drag-over");
        //     this.parent?.resources.addProjectResources(e.dataTransfer.files);
        // });

        this._boundRefreshFolders = () => this.refreshFolders();
        this._boundRefreshProjectAssets = () => this.refreshFolders(); // todo
    }

    onAttached() {
        if (this.parent?.resources) {
            this.parent.resources.on('folder-added', this._boundRefreshFolders);
            this.parent.resources.on('folder-removed', this._boundRefreshFolders);
            this.parent.resources.on('resource-added', this._boundRefreshProjectAssets);
            this.parent.resources.on('resource-removed', this._boundRefreshProjectAssets);
            this.parent.resources.on('resources-loaded', () => {
                this.refreshFolders();
            });
        }

        this.setTab(this.currentTab || 'objects');
    }

    onDetached() {
        if (this.parent?.resources) {
            this.parent.resources.off('folder-added', this._boundRefreshFolders);
            this.parent.resources.off('folder-removed', this._boundRefreshFolders);
            this.parent.resources.off('resource-added', this._boundRefreshProjectAssets);
            this.parent.resources.off('resource-removed', this._boundRefreshProjectAssets);
        }

        // Clear the tree
        this.tree.reset();
        this.setTab(null);
    }

    setTab(tabName) {
        if(tabName === null || !this.parent) {
            this.currentTab = null;
            this.__contentContainer.replaceChildren(this.emptyStateElement);
            return;
        }

        const library = this.libraryTemplate[tabName];
        const tabButtons = this.__sidebar.children;

        for(const tab of tabButtons) {
            tab.classList.toggle('selected', tab.getAttribute('data-tab') === tabName);
        }

        this.currentTab = tabName;

        let items = library.items || null;

        console.log(`Setting tab to ${tabName}`, items);

        switch(tabName) {
            case "folders":
                if(!items) items = [
                    {
                        id: 'project-data',
                        label: 'Project Data',
                        description: 'The project folder itself. Data stored here are tied to the project itself.',
                        type: 'folder',
                        color: 'blue',
                        lazy: true
                    },

                    {
                        id: 'project-folders',
                        label: 'Linked Project Folders',
                        description: 'Custom folders linked to the project.',
                        type: 'folder',
                        color: 'green',
                        lazy: true
                    },

                    {
                        id: 'global-folders',
                        label: 'Global Linked Folders',
                        description: 'Global linked folders available across projects.',
                        type: 'folder',
                        color: 'green',
                        lazy: true
                    }
                ];
                break;
        }

        if(!items || items.length === 0) {
            this.__contentContainer.replaceChildren(this.emptyStateElement);
            return;
        }

        this.tree.loadData(items);
        this.__contentContainer.replaceChildren(this.fileBrowserContainer);
    }

    refreshFolders() {
        if(this.currentTab === 'folders') {
            const projectFoldersList = [];
            for (const [id, folder] of this.parent.resources.projectFolders) {
                projectFoldersList.push({
                    id,
                    folderName: folder.name,
                    label: folder.name || "Untitled folder",
                    type: 'folder',
                    lazy: true
                });
            }

            this.tree.replaceChildren('project-folders', projectFoldersList);
        }
    }

    destroy() {
        if(this.destroyed) return;
        this.onDetached();
        this.handle.destroy();
        this.handle = null;
        this.previewElement.remove();
        this.previewElement = null;
        this.libraryTemplate = null;
        this.emptyStateElement = null;

        if(this.tree) {
            this.tree.destroy();
            this.tree = null;
        }

        if(this.fileBrowserContainer) {
            this.fileBrowserContainer.remove();
            this.fileBrowserContainer = null;
        }

        this.parent = null;
        super.destroy();
    }

    static getIcon(obj) {
        if(obj.mimeType) {
            if (obj.mimeType.startsWith("image/")) return "bi-image";
            if (obj.mimeType.startsWith("video/")) return "bi-film";
            if (obj.mimeType.startsWith("audio/")) return "bi-music-note-beamed";
        }

        return obj.icon || "bi-file";
    }
}

export { AssetManagerView };