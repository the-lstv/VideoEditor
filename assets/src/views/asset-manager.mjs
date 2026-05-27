import * as EditorBaseClasses from "../core/base.mjs";
import { Resource } from "../core/resources.mjs";

/**
 * Asset manager view class (standalone)
 * Not proud of the state of this code
 */
class AssetManagerView extends LS.Multipane.View {
    static name = "assetManager";

    libraryTemplate = {
        objects: {
            name: "Base objects",
            icon: "bi-box",
            items: [
                // { i18n: "assets.base.container", icon: "bi-archive", label: "Container", type: "container", item: { type: "container", label: "Container", tileColor: "white" } },
                { i18n: "assets.base.shape", icon: "bi-square", label: "Simple plane", type: "sprite", item: { type: "sprite", label: "Plane", data: { positionX: 100, positionY: 100, scaleX: 500, scaleY: 500, anchorX: 0, anchorY: 0 } } },
                { i18n: "assets.base.vector_shape", icon: "bi-vector-pen", label: "Vector shape", type: "graphics", item: { type: "graphics", label: "Vector shape" } },
                { i18n: "assets.base.automation_clip", icon: "bi-bezier2", label: "Automation clip", type: "automation", item: { type: "automation", label: "Automation clip" } },
                // { i18n: "assets.base.video", icon: "bi-film", label: "Video", type: "sprite", item: { type: "sprite", label: "Video", tileColor: "blue" } },
                // { i18n: "assets.base.image", icon: "bi-image", label: "Image", type: "sprite", item: { type: "sprite", label: "Image", tileColor: "lightgray" } },
                { i18n: "assets.base.sound", icon: "bi-music-note-beamed", label: "Sound", type: "audio", item: { type: "audio", label: "Sound", tileColor: "purple" } },
                { i18n: "assets.base.dynamic_text", icon: "bi-textarea-t", label: "Dynamic text", type: "text", helpText: "A dynamic text object.\n\nIt uses a custom text rendering engine. Text can be updated at any time, can be written anywhere, can be scripted, and shown at any scale. Also supports realtime effects and syntax highlighting.\n\nCons/limitations:\n- Fonts need to be converted to a special format, and limited to a set of characters\n- Text shaping and certain styling is not currently supported.\n- At the moment only works well with monospace fonts.\n- Bigger overhead per instance and while rendering then static text; it's recommended to reuse it.\n- Slightly more complex to use.\n\nPros:\n- Text remains crisp at any scale\n- Dynamic content and per-character effects\n- More versatile draw API.\n\nSuitable when you change text or text styles often and need high performance text rendering with advanced per-character effects.", item: { type: "text", label: "Dynamic text", data: { text: "Some text" }, tileColor: "aquamarine" } },
                { i18n: "assets.base.static_text", icon: "bi-fonts", label: "Static text", type: "static_text", helpText: "A static text object that uses the browser's native text rendering, and then applies it as a texture to a sprite.\n\nCons:\n- Updates are expensive, meaning changing text or styles often may cause performance issues.\n- Handles less textthan dynamic text (performance and memory usage worsens with more text).\n- Less flexible scripting interface and styling is limited to one block (no individual character styling).\n- Does not handle scaling automatically, so changing text size requires re-rendering, otherwise the text will be distorted/pixelated.\n\nPros:\n- Simpler to use\n- More efficient for fixed text content\n- Handles font features (ligatures, kerning) better and works with any supported language.\n\nSuitable when you have short to medium fixed text content that doesn't need frequent updates and stays more-or-less the same size.", item: { type: "static_text", label: "Static text", data: { text: "Some text" }, tileColor: "aquamarine" } },
                { i18n: "assets.base.timeline_script", icon: "bi-braces-asterisk", label: "Timeline script", type: "script", item: { type: "script", label: "Timeline script", tileColor: "pastel-indigo" } },
                { i18n: "assets.base.anotherTimeline", icon: "bi-bar-chart-steps", label: "Another timeline (composite)", type: "timeline", item: { type: "timeline", label: "Timeline" } },
                { i18n: "assets.base.pattern", icon: "bi-music-note-list", label: "Pattern", type: "notes", item: { type: "notes", label: "Pattern", tileColor: "yellow" } },
                { i18n: "assets.base.3d_mesh", icon: "bi-box", label: "3D Object", type: "mesh", item: { type: "mesh", label: "3D Object", tileColor: "lapis" } },
                { i18n: "assets.base.perspectiveCamera", icon: "bi-camera-video", label: "Perspective Camera", type: "camera", item: { type: "camera", label: "Perspective Camera", tileColor: "orange", data: { cameraType: "perspective", positionZ: 500 } } },
                { i18n: "assets.base.orthographicCamera", icon: "bi-camera-video", label: "Orthographic Camera", type: "camera", item: { type: "camera", label: "Orthographic Camera", tileColor: "orange", data: { cameraType: "orthographic", positionZ: 500 } } },
                { i18n: "assets.base.light", icon: "bi-lightbulb", label: "Light", type: "light", item: { type: "light", label: "Light", tileColor: "yellow" } },
                { i18n: "assets.base.particle_emitter", icon: "bi-stars", label: "Particles", type: "particles", item: { type: "particles", label: "Particles", tileColor: "pink" } },
                // { i18n: "assets.base.events", icon: "bi-toggles", label: "Events", type: "events", item: { type: "events", label: "Events" } },
                { i18n: "assets.base.empty_item", icon: "bi-file-earmark", label: "Empty item", type: "empty", item: { type: "empty", label: "Empty item" } },
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
                { tag: 'p', i18n: "assets.empty_state", text: "No items to display" }
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
                    this.updateTab();
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
                if(node.tileColor) element.setAttribute("ls-accent", node.tileColor); else element.removeAttribute("ls-accent");
                if(node.description) element.setAttribute("title", node.description); else element.removeAttribute("title");

                const badgeContainer = element.querySelector(".ls-tree-node-badge");
                if (badgeContainer && !badgeContainer.querySelector("i")) {
                    LS.Create({
                        tag: 'i', parent: badgeContainer, i18n: { tooltip: "assets.click_for_more_info" }, onclick: () => {
                            const node = tree.getNodeDataByElement(button.closest(".ls-tree-node"));
                            if (!node) return;

                            if (node.helpText) {
                                LS.Modal.buildEphemeral({
                                    title: node.label,
                                    content: { style: "white-space: pre-wrap;", inner: node.helpText }
                                });
                            } else {
                                console.log(this.parent)
                            }
                        }, style: 'margin-left: auto; opacity: 0.5;'
                    });
                }

                const button = element.querySelector("i");
                if(node.helpText) {
                    button.className = "bi-info-circle";
                    button.setAttribute("ls-tooltip", "Click for more info");
                    button.style.display = "block";
                } else if(node.type === 'file') {
                    if(!node.favorited) {
                        button.className = "bi-star";
                        button.setAttribute("ls-tooltip", "Favorite");
                    } else {
                        button.className = "bi-star-fill";
                        button.setAttribute("ls-tooltip", "Remove from favorites");
                    }
                    button.style.display = "block";
                } else if(node instanceof Resource) {
                    button.className = "bi-x-lg";
                    button.setAttribute("ls-tooltip", "Remove asset");
                    button.style.display = "block";
                } else {
                    button.style.display = "none";
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
                            i18n: { tooltip: "assets.collapse_folders" },
                            tooltip: "Collapse all folders",
                            onclick: () => {
                                this.tree.collapseAll();
                            }
                        },

                        {
                            tag: 'button',
                            class: 'clear square',
                            inner: [{ tag: 'i', class: 'bi-arrow-clockwise' }],
                            i18n: { tooltip: "assets.refresh" },
                            tooltip: "Refresh",
                            onclick: () => {
                                this.updateTab();
                            }
                        },
                    ],

                    [
                        {
                            tag: 'button',
                            class: 'elevated',
                            inner: [{ tag: 'i', class: 'bi-folder-plus' }, { i18n: "assets.project_folder", text: " Project" }],
                            i18n: { tooltip: "assets.add_project_folder" },
                            tooltip: "Add a project folder",
                            onclick: () => { this.parent.resources.addFolder() }
                        },

                        {
                            tag: 'button',
                            class: 'elevated',
                            inner: [{ tag: 'i', class: 'bi-folder-plus' }, { i18n: "assets.global_folder", text: " Global" }],
                            i18n: { tooltip: "assets.add_global_folder" },
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
            const tabButton = LS.Create({ attributes: { role: "button", "data-tab": tabName }, inner: { tag: 'i', class: tabData.icon }, i18n: { tooltip: "assets.tabname." + tabName }, tooltip: tabData.name, onclick: () => { this.setTab(tabName) } });
            this.__sidebar.appendChild(tabButton);
        }


        // --- Drag and drop handling for assets
        this.handle = new LS.Util.TouchHandle(this.__contentContainer, {
            cursor: 'grabbing',
            buttons: [0],

            onStart: (event) => {
                if(event.domEvent.target.tagName === 'I') return event.cancel();
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

            const items = Array.from(e.dataTransfer?.items || []);
            const files = items
                .map(item => item?.kind === "file" ? item.getAsFile() : null)
                .filter(Boolean);

            const fallbackFiles = Array.from(e.dataTransfer?.files || []).filter(Boolean);
            const droppedFiles = files.length > 0 ? files : fallbackFiles;

            app.flavorInstance?.fileDrop({ data: { files: droppedFiles } }, false);
        });

        this._boundRefreshFolders = () => this.updateTab();
        this._boundRefreshProjectAssets = () => this.updateTab(); // todo
    }

    onAttached() {
        if (this.parent?.resources) {
            this.parent.resources.on('folder-added', this._boundRefreshFolders);
            this.parent.resources.on('folder-removed', this._boundRefreshFolders);

            this.parent.resources.on('resource-added', this._boundRefreshProjectAssets);
            this.parent.resources.on('resource-removed', this._boundRefreshProjectAssets);
            this.parent.resources.on('resources-loaded', this._boundRefreshProjectAssets);
        }

        this.setTab(this.currentTab || 'objects');
    }

    onDetached() {
        if (this.parent?.resources) {
            this.parent.resources.off('folder-added', this._boundRefreshFolders);
            this.parent.resources.off('folder-removed', this._boundRefreshFolders);

            this.parent.resources.off('resource-added', this._boundRefreshProjectAssets);
            this.parent.resources.off('resource-removed', this._boundRefreshProjectAssets);
            this.parent.resources.off('resources-loaded', this._boundRefreshProjectAssets);
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

        const tabButtons = this.__sidebar.children;
        for(const tab of tabButtons) {
            tab.classList.toggle('selected', tab.getAttribute('data-tab') === tabName);
        }
        
        this.currentTab = tabName;
        this.updateTab(true);

        if(this.tree.nodes.length === 0) {
            this.__contentContainer.replaceChildren(this.emptyStateElement);
            return;
        }

        this.__contentContainer.replaceChildren(this.fileBrowserContainer);
    }

    updateTab(load = false) {
        const library = this.libraryTemplate[this.currentTab];

        switch(this.currentTab) {
            case 'folders':
                if(!library.items) library.items = [
                    {
                        id: 'project-data',
                        label: 'Project Folder',
                        i18n: "assets.project_data",
                        description: 'The project folder itself. Data stored here are tied to the project itself.',
                        type: 'folder',
                        tileColor: 'blue',
                        lazy: true
                    },

                    {
                        id: 'project-folders',
                        label: 'Linked Project Folders',
                        i18n: "assets.linked_project_folders",
                        description: 'Custom folders linked to the project.',
                        type: 'folder',
                        tileColor: 'green',
                        lazy: true
                    },

                    {
                        id: 'global-folders',
                        label: 'Global Linked Folders',
                        i18n: "assets.global_linked_folders",
                        description: 'Global linked folders available across projects.',
                        type: 'folder',
                        tileColor: 'green',
                        lazy: true
                    }
                ];

                if(load) {
                    this.tree.loadData(library.items);
                }

                const projectFoldersNode = this.tree.getNodeById('project-folders');
                if(!projectFoldersNode) return;

                projectFoldersNode.children ??= [];

                for(const node of projectFoldersNode.children) {
                    if(!this.parent.resources.projectFolders.has(node.id)) {
                        this.tree.removeNode(node.id);
                    }
                }

                for (const [id, folder] of this.parent.resources.projectFolders) {
                    if(!this.tree.has(id)) this.tree.addNode({
                        id,
                        folderName: folder.name,
                        label: folder.name || "Untitled folder",
                        type: 'folder',
                        lazy: true
                    }, 'project-folders');
                }

                // todo
                // for (const [id, folder] of this.parent.resources.globalFolders) {
                //     if(!this.tree.has(id)) this.tree.addNode({
                //         id,
                //         folderName: folder.name,
                //         label: folder.name || "Untitled folder",
                //         type: 'folder',
                //         lazy: true
                //     }, 'global-folders');
                // }
                break;

            case 'projectAssets':
                this.tree.willUpdate();
                if(!library.items) library.items = [];

                if(load) {
                    this.tree.loadData(library.items);
                }

                for (const resource of this.parent.resources.resources.values()) {
                    resource.icon = AssetManagerView.getIcon(resource);
                    if(!this.tree.has(resource.id)) this.tree.addNode(resource);
                }
                break;

            case 'saved':
                const savedItems = app.config.get("savedPresets");
                if(savedItems) this.tree.loadData(savedItems);
                break;

            default:
                this.tree.loadData(library.items);
        }

        this.tree.render();
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