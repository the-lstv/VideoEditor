import * as EditorBaseClasses from "../core/base.mjs";
import { Resource } from "../core/resources.mjs";

/**
 * Asset manager view class (standalone)
 * Not proud of the state of this code
 */
class AssetManagerView extends LS.View {
    static name = "assetManager";

    libraryTemplate = {
        objects: {
            name: "Base objects",
            icon: "bi-box"
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

    constructor(parent, options = {}) {
        super({
            name: 'AssetManagerView',
            title: 'Content library',
            container: LS.Create({
                class: 'editor-asset-manager',
                inner: []
            })
        });

        this.options = options;

        if (parent) {
            // When used standalone by other views, otherwise parent is provided by the project multipane
            this.parent = parent;
            // this.addExternalEventListener(this.parent, "destroy", () => this.destroy());
            this.parent.on("destroy", this.__parentDestroyHandler = () => this.destroy());
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
        // if(this.destroyed) throw new Error("AssetManagerView is already destroyed");
        console.log("AssetManagerView detached from DOM", this);

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
                console.log("Loading library items for tab:", this.currentTab, library.items || this.options?.library?.[this.currentTab], this.options);
                this.tree.loadData(library.items || this.options?.library?.[this.currentTab] || []);
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

        this.__sidebar.remove();
        this.__sidebar = null;
        this.__contentContainer.remove();
        this.__contentContainer = null;

        this.parent?.off("destroy", this.__parentDestroyHandler);
        this.__parentDestroyHandler = null;

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