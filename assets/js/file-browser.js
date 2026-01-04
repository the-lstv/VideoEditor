/**
 * File browser
 * 
 * PLEASE FORGIVE ME for this lazy *terrible* AI code, but I honestly don't have the energy to make a proper browser at this time.
 * This project is already large enough and this is yet another rabbit hole of a feature that I don't have time or energy to do properly.
 * I will remake this as soon as I can
 * Until then, it works I guess (it doesn't), sorry
 */
class FileBrowser {
    static THUMBNAIL_CACHE = new Map();
    static THUMBNAIL_QUEUE = [];
    static THUMBNAIL_PROCESSING = false;

    constructor(options = {}) {
        this.options = {
            container: null,
            onFileSelect: null,
            onFileOpen: null,
            onNavigate: null,
            showHidden: false,
            ...options
        };

        this.currentPath = [];
        this.currentHandle = null;
        this.rootHandle = null;
        this.files = [];
        this.filteredFiles = [];
        this.selectedFiles = new Set();
        this.viewMode = 'grid'; // 'grid' or 'list'
        this.sortBy = 'name'; // 'name', 'date', 'type', 'size'
        this.sortDirection = 'asc';
        this.searchQuery = '';
        this.history = [];
        this.historyIndex = -1;

        // Loading state tracking to prevent stale content
        this._loadingId = 0;
        this._isLoading = false;

        this._init();
    }

    _init() {
        this.element = LS.Create({
            class: 'file-browser',
            inner: [
                // Toolbar
                this._toolbar = LS.Create({
                    class: 'file-browser-toolbar',
                    inner: [
                        [
                            // Search
                            {
                                class: 'file-browser-search',
                                inner: [
                                    { tag: 'i', class: 'bi-search' },
                                    this._searchInput = LS.Create({
                                        tag: 'input',
                                        type: 'text',
                                        placeholder: 'Search files...',
                                        oninput: () => this._onSearch()
                                    })
                                ]
                            },
                            {
                                class: 'file-browser-toolbar-controls',
                                inner: [
                                    // Navigation buttons
                                    {
                                        class: 'file-browser-nav',
                                        inner: [
                                            this._backBtn = LS.Create({
                                                tag: 'button',
                                                class: 'square clear',
                                                inner: { tag: 'i', class: 'bi-arrow-left' },
                                                tooltip: 'Back',
                                                disabled: true,
                                                onclick: () => this.goBack()
                                            }),
                                            this._forwardBtn = LS.Create({
                                                tag: 'button',
                                                class: 'square clear',
                                                inner: { tag: 'i', class: 'bi-arrow-right' },
                                                tooltip: 'Forward',
                                                disabled: true,
                                                onclick: () => this.goForward()
                                            }),
                                            this._upBtn = LS.Create({
                                                tag: 'button',
                                                class: 'square clear',
                                                inner: { tag: 'i', class: 'bi-arrow-up' },
                                                tooltip: 'Go up',
                                                disabled: true,
                                                onclick: () => this.goUp()
                                            }),
                                            this._refreshBtn = LS.Create({
                                                tag: 'button',
                                                class: 'square clear',
                                                inner: { tag: 'i', class: 'bi-arrow-clockwise' },
                                                tooltip: 'Refresh',
                                                onclick: () => this.refresh()
                                            })
                                        ]
                                    },
                                    // View controls
                                    {
                                        class: 'file-browser-view-controls',
                                        inner: [
                                            this._sortSelect = LS.Create({
                                                tag: 'ls-select',
                                                class: 'clear',
                                                style: 'display: inline-block; width: auto; min-width: 100px;',
                                                options: [
                                                    { value: 'name', text: 'Name' },
                                                    { value: 'date', text: 'Date' },
                                                    { value: 'type', text: 'Type' },
                                                    { value: 'size', text: 'Size' }
                                                ],
                                                onchange: () => this._onSortChange()
                                            }),
                                            this._sortDirBtn = LS.Create({
                                                tag: 'button',
                                                class: 'square clear',
                                                inner: { tag: 'i', class: 'bi-sort-alpha-down' },
                                                tooltip: 'Sort direction',
                                                onclick: () => this._toggleSortDirection()
                                            }),
                                            { tag: 'span', class: 'separator' },
                                            this._gridViewBtn = LS.Create({
                                                tag: 'button',
                                                class: 'square clear active',
                                                inner: { tag: 'i', class: 'bi-grid-3x3-gap' },
                                                tooltip: 'Grid view',
                                                onclick: () => this.setViewMode('grid')
                                            }),
                                            this._listViewBtn = LS.Create({
                                                tag: 'button',
                                                class: 'square clear',
                                                inner: { tag: 'i', class: 'bi-list' },
                                                tooltip: 'List view',
                                                onclick: () => this.setViewMode('list')
                                            })
                                        ]
                                    },
                                ]
                            },
                            // Breadcrumbs
                            this._breadcrumb = LS.Create({ class: 'file-browser-breadcrumb' }),
                        ],
                    ]
                }),

                // Content area
                this._contentWrapper = LS.Create({
                    class: 'file-browser-content-wrapper',
                    inner: [
                        this._content = LS.Create({
                            class: 'file-browser-content grid-view',
                            inner: [
                                this._itemContainer = LS.Create({ class: 'file-browser-items' })
                            ]
                        }),
                        this._emptyState = LS.Create({
                            class: 'file-browser-empty',
                            style: 'display: none',
                            inner: [
                                { tag: 'i', class: 'bi-folder2-open' },
                                { tag: 'p', inner: 'This folder is empty' }
                            ]
                        }),
                        this._loadingState = LS.Create({
                            class: 'file-browser-loading',
                            style: 'display: none',
                            inner: [
                                { tag: 'div', class: 'spinner' },
                                { tag: 'p', inner: 'Loading...' }
                            ]
                        })
                    ]
                }),

                // Status bar
                this._statusBar = LS.Create({
                    class: 'file-browser-status',
                    inner: [
                        this._statusText = LS.Create({ tag: 'span', inner: 'No folder selected' }),
                        this._selectionText = LS.Create({ tag: 'span', class: 'selection-info' })
                    ]
                })
            ]
        });

        // Context menu
        this._contextMenu = new LS.Menu({
            items: [
                { text: 'Open', icon: 'bi-folder2-open', action: () => this._openSelected() },
                { text: 'Add to timeline', icon: 'bi-plus-lg', action: () => this._addSelectedToTimeline() },
                { type: 'separator' },
                { text: 'Copy path', icon: 'bi-clipboard', action: () => this._copyPath() },
                { type: 'separator' },
                { text: 'Select all', icon: 'bi-check2-square', shortcut: 'Ctrl+A', action: () => this.selectAll() },
                { text: 'Deselect all', icon: 'bi-square', action: () => this.deselectAll() }
            ]
        });

        this._setupEventListeners();

        if (this.options.container) {
            this.options.container.appendChild(this.element);
        }
    }

    _setupEventListeners() {
        // Keyboard navigation
        this.element.addEventListener('keydown', (e) => this._onKeyDown(e));

        // Context menu
        this._content.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._contextMenu.open(e.clientX, e.clientY);
        });

        // Click to deselect
        this._content.addEventListener('click', (e) => {
            if (e.target === this._content || e.target === this._itemContainer) {
                if (!e.ctrlKey && !e.shiftKey) {
                    this.deselectAll();
                }
            }
        });
    }

    _onKeyDown(e) {
        switch (e.key) {
            case 'a':
                if (e.ctrlKey) {
                    e.preventDefault();
                    this.selectAll();
                }
                break;
            case 'Escape':
                this.deselectAll();
                break;
            case 'Enter':
                this._openSelected();
                break;
            case 'Backspace':
                this.goUp();
                break;
            case 'F5':
                e.preventDefault();
                this.refresh();
                break;
        }
    }

    _onSearch() {
        this.searchQuery = this._searchInput.value.toLowerCase().trim();
        this._applyFilters();
    }

    _onSortChange() {
        this.sortBy = this._sortSelect.value;
        this._applyFilters();
    }

    _toggleSortDirection() {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        this._sortDirBtn.querySelector('i').className = 
            this.sortDirection === 'asc' ? 'bi-sort-alpha-down' : 'bi-sort-alpha-up';
        this._applyFilters();
    }

    _applyFilters() {
        let result = [...this.files];

        // Filter by search query
        if (this.searchQuery) {
            result = result.filter(f => f.name.toLowerCase().includes(this.searchQuery));
        }

        // Filter hidden files
        if (!this.options.showHidden) {
            result = result.filter(f => !f.name.startsWith('.'));
        }

        // Sort
        result.sort((a, b) => {
            // Directories first
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }

            let cmp = 0;
            switch (this.sortBy) {
                case 'name':
                    cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
                    break;
                case 'date':
                    cmp = (a.lastModified || 0) - (b.lastModified || 0);
                    break;
                case 'type':
                    cmp = (a.extension || '').localeCompare(b.extension || '');
                    break;
                case 'size':
                    cmp = (a.size || 0) - (b.size || 0);
                    break;
            }
            return this.sortDirection === 'asc' ? cmp : -cmp;
        });

        this.filteredFiles = result;
        this._renderItems();
        this._updateStatus();
    }

    _clearItems() {
        this._itemContainer.innerHTML = '';
    }

    _renderItems() {
        this._clearItems();

        // Show/hide empty state
        const isEmpty = this.filteredFiles.length === 0;
        this._emptyState.style.display = isEmpty ? 'flex' : 'none';
        this._itemContainer.style.display = isEmpty ? 'none' : '';

        if (isEmpty) return;

        // Create document fragment for better performance
        const fragment = document.createDocumentFragment();

        this.filteredFiles.forEach((file, index) => {
            const item = this._createItemElement(file, index);
            fragment.appendChild(item);
        });

        this._itemContainer.appendChild(fragment);
    }

    _createItemElement(file, index) {
        const item = LS.Create({
            class: 'file-browser-item asset-library-item' + (this.selectedFiles.has(file) ? ' selected' : ''),
            inner: [
                { class: 'file-item-icon', inner: { tag: 'i', class: this._getFileIcon(file) } },
                { class: 'file-item-thumbnail' },
                { class: 'file-item-name', inner: file.name, title: file.name },
                { class: 'file-item-details' }
            ]
        });

        item._fileData = file;
        item._index = index;

        item.addEventListener('click', (e) => this._onItemClick(e, item));
        item.addEventListener('dblclick', () => this._onItemDoubleClick(item));

        // Thumbnail handling
        if (this._canHaveThumbnail(file) && this.viewMode === 'grid') {
            const thumbnail = item.querySelector('.file-item-thumbnail');
            this._loadThumbnail(file, thumbnail, item);
        }

        // Details (for list view)
        if (this.viewMode === 'list') {
            const details = item.querySelector('.file-item-details');
            const size = file.isDirectory ? '--' : this._formatSize(file.size);
            const date = file.lastModified ? new Date(file.lastModified).toLocaleDateString() : '--';
            details.innerHTML = `<span class="file-size">${size}</span><span class="file-date">${date}</span>`;
        }

        return item;
    }

    _onItemClick(e, item) {
        const file = item._fileData;
        if (!file) return;

        if (e.ctrlKey) {
            // Toggle selection
            if (this.selectedFiles.has(file)) {
                this.selectedFiles.delete(file);
            } else {
                this.selectedFiles.add(file);
            }
        } else if (e.shiftKey && this._lastSelectedIndex !== undefined) {
            // Range selection
            const start = Math.min(this._lastSelectedIndex, item._index);
            const end = Math.max(this._lastSelectedIndex, item._index);
            for (let i = start; i <= end; i++) {
                const f = this.filteredFiles[i];
                if (f) this.selectedFiles.add(f);
            }
        } else {
            // Single selection
            this.selectedFiles.clear();
            this.selectedFiles.add(file);
        }

        this._lastSelectedIndex = item._index;
        this._updateSelectionVisuals();

        if (this.options.onFileSelect) {
            this.options.onFileSelect(Array.from(this.selectedFiles));
        }
    }

    _onItemDoubleClick(item) {
        const file = item._fileData;
        if (!file) return;

        if (file.isDirectory) {
            this.navigate(file.handle);
        } else if (this.options.onFileOpen) {
            this.options.onFileOpen(file);
        }
    }

    _updateSelectionVisuals() {
        const items = this._itemContainer.querySelectorAll('.file-browser-item');
        items.forEach(item => {
            item.classList.toggle('selected', this.selectedFiles.has(item._fileData));
        });
        this._updateStatus();
    }

    _updateStatus() {
        const total = this.filteredFiles.length;
        const folders = this.filteredFiles.filter(f => f.isDirectory).length;
        const files = total - folders;

        this._statusText.textContent = `${folders} folder${folders !== 1 ? 's' : ''}, ${files} file${files !== 1 ? 's' : ''}`;

        if (this.selectedFiles.size > 0) {
            const selectedSize = Array.from(this.selectedFiles)
                .filter(f => !f.isDirectory)
                .reduce((sum, f) => sum + (f.size || 0), 0);
            this._selectionText.textContent = `${this.selectedFiles.size} selected (${this._formatSize(selectedSize)})`;
        } else {
            this._selectionText.textContent = '';
        }
    }

    _updateBreadcrumb() {
        this._breadcrumb.innerHTML = '';

        // Root
        const rootItem = LS.Create({
            tag: 'button',
            class: 'breadcrumb-item clear',
            inner: [{ tag: 'i', class: 'bi-house' }],
            onclick: () => this.navigateToRoot()
        });
        this._breadcrumb.appendChild(rootItem);

        // Path segments
        for (let i = 0; i < this.currentPath.length; i++) {
            const segment = this.currentPath[i];
            const isLast = i === this.currentPath.length - 1;

            const separator = LS.Create({ tag: 'span', class: 'breadcrumb-separator', inner: '/' });
            this._breadcrumb.appendChild(separator);

            const item = LS.Create({
                tag: 'button',
                class: 'breadcrumb-item clear' + (isLast ? ' active' : ''),
                inner: segment.name,
                onclick: () => {
                    if (!isLast) {
                        this.navigateToIndex(i);
                    }
                }
            });
            this._breadcrumb.appendChild(item);
        }
    }

    _updateNavigationButtons() {
        this._backBtn.disabled = this.historyIndex <= 0;
        this._forwardBtn.disabled = this.historyIndex >= this.history.length - 1;
        this._upBtn.disabled = this.currentPath.length === 0;
    }

    _getFileIcon(file) {
        if (file.isDirectory) return 'bi-folder-fill';

        const ext = file.extension?.toLowerCase();
        const iconMap = {
            // Images
            'jpg': 'bi-file-image', 'jpeg': 'bi-file-image', 'png': 'bi-file-image',
            'gif': 'bi-file-image', 'webp': 'bi-file-image', 'svg': 'bi-file-image',
            'bmp': 'bi-file-image', 'ico': 'bi-file-image',
            // Video
            'mp4': 'bi-file-play', 'webm': 'bi-file-play', 'mov': 'bi-file-play',
            'avi': 'bi-file-play', 'mkv': 'bi-file-play', 'wmv': 'bi-file-play',
            // Audio
            'mp3': 'bi-file-music', 'wav': 'bi-file-music', 'ogg': 'bi-file-music',
            'flac': 'bi-file-music', 'aac': 'bi-file-music', 'm4a': 'bi-file-music',
            // Documents
            'pdf': 'bi-file-pdf', 'doc': 'bi-file-word', 'docx': 'bi-file-word',
            'xls': 'bi-file-excel', 'xlsx': 'bi-file-excel',
            'ppt': 'bi-file-ppt', 'pptx': 'bi-file-ppt',
            'txt': 'bi-file-text', 'md': 'bi-file-text',
            // Code
            'js': 'bi-file-code', 'ts': 'bi-file-code', 'json': 'bi-file-code',
            'html': 'bi-file-code', 'css': 'bi-file-code', 'py': 'bi-file-code',
            // Archives
            'zip': 'bi-file-zip', 'rar': 'bi-file-zip', '7z': 'bi-file-zip',
            'tar': 'bi-file-zip', 'gz': 'bi-file-zip',
        };

        return iconMap[ext] || 'bi-file-earmark';
    }

    _canHaveThumbnail(file) {
        if (file.isDirectory) return false;
        const ext = file.extension?.toLowerCase();
        return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
    }

    async _loadThumbnail(file, element, itemElement) {
        const cacheKey = file.handle ? await this._getHandlePath(file.handle) : file.path;
        
        if (FileBrowser.THUMBNAIL_CACHE.has(cacheKey)) {
            const cached = FileBrowser.THUMBNAIL_CACHE.get(cacheKey);
            element.style.backgroundImage = `url(${cached})`;
            element.style.display = '';
            itemElement.querySelector('.file-item-icon').style.display = 'none';
            return;
        }

        // Queue thumbnail generation
        FileBrowser.THUMBNAIL_QUEUE.push({ file, element, cacheKey, itemElement });
        this._processThumbnailQueue();
    }

    async _processThumbnailQueue() {
        if (FileBrowser.THUMBNAIL_PROCESSING || FileBrowser.THUMBNAIL_QUEUE.length === 0) return;
        FileBrowser.THUMBNAIL_PROCESSING = true;

        // Reuse a single canvas for all thumbnails
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const maxSize = 80;

        while (FileBrowser.THUMBNAIL_QUEUE.length > 0) {
            const { file, element, cacheKey, itemElement } = FileBrowser.THUMBNAIL_QUEUE.shift();

            // Skip if element is no longer visible
            if (!element.isConnected) continue;

            try {
                const blob = await file.handle.getFile();
                const url = URL.createObjectURL(blob);

                // Create thumbnail
                const img = new Image();
                img.src = url;
                await img.decode();

                let w = img.width, h = img.height;
                if (w > h) {
                    if (w > maxSize) { h = h * maxSize / w; w = maxSize; }
                } else {
                    if (h > maxSize) { w = w * maxSize / h; h = maxSize; }
                }

                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);

                const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.7);
                FileBrowser.THUMBNAIL_CACHE.set(cacheKey, thumbnailUrl);

                URL.revokeObjectURL(url);

                if (element.isConnected) {
                    element.style.backgroundImage = `url(${thumbnailUrl})`;
                    element.style.display = '';
                    const icon = itemElement.querySelector('.file-item-icon');
                    if (icon) icon.style.display = 'none';
                }
            } catch (e) {
                // Silently fail for thumbnails
            }

            // Yield to prevent blocking
            await new Promise(r => setTimeout(r, 10));
        }

        FileBrowser.THUMBNAIL_PROCESSING = false;
    }

    async _getHandlePath(handle) {
        try {
            const path = await this.rootHandle.resolve(handle);
            return path ? path.join('/') : handle.name;
        } catch {
            return handle.name;
        }
    }

    _formatSize(bytes) {
        if (bytes === 0 || bytes === undefined) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    _openSelected() {
        if (this.selectedFiles.size === 0) return;
        
        const file = Array.from(this.selectedFiles)[0];
        if (file.isDirectory) {
            this.navigate(file.handle);
        } else if (this.options.onFileOpen) {
            this.options.onFileOpen(file);
        }
    }

    _addSelectedToTimeline() {
        // Implementation depends on timeline integration
        for (const file of this.selectedFiles) {
            if (!file.isDirectory) {
                const dragObj = this._createDragObject(file);
                // Trigger add to timeline logic
            }
        }
    }

    _copyPath() {
        const paths = Array.from(this.selectedFiles).map(f => f.name);
        navigator.clipboard.writeText(paths.join('\n'));
        LS.Toast.show('Path copied to clipboard', { timeout: 2000 });
    }

    // Public API

    async setRootFolder(handle) {
        this.rootHandle = handle;
        this.currentHandle = handle;
        this.currentPath = [];
        this.history = [{ handle, path: [] }];
        this.historyIndex = 0;

        await this._loadDirectory();
        this._updateBreadcrumb();
        this._updateNavigationButtons();
    }

    async navigate(handle) {
        if (!handle || this._isLoading) return;

        // Add to path
        const entry = { name: handle.name, handle };
        this.currentPath.push(entry);
        this.currentHandle = handle;

        // Update history
        this.historyIndex++;
        this.history = this.history.slice(0, this.historyIndex);
        this.history.push({ handle, path: [...this.currentPath] });

        await this._loadDirectory();
        this._updateBreadcrumb();
        this._updateNavigationButtons();

        if (this.options.onNavigate) {
            this.options.onNavigate(this.currentPath);
        }
    }

    async navigateToRoot() {
        if (!this.rootHandle || this._isLoading) return;
        
        this.currentPath = [];
        this.currentHandle = this.rootHandle;
        
        this.historyIndex++;
        this.history = this.history.slice(0, this.historyIndex);
        this.history.push({ handle: this.rootHandle, path: [] });

        await this._loadDirectory();
        this._updateBreadcrumb();
        this._updateNavigationButtons();
    }

    async navigateToIndex(index) {
        if (index < 0 || index >= this.currentPath.length - 1 || this._isLoading) return;

        this.currentPath = this.currentPath.slice(0, index + 1);
        this.currentHandle = this.currentPath[index].handle;

        this.historyIndex++;
        this.history = this.history.slice(0, this.historyIndex);
        this.history.push({ handle: this.currentHandle, path: [...this.currentPath] });

        await this._loadDirectory();
        this._updateBreadcrumb();
        this._updateNavigationButtons();
    }

    async goUp() {
        if (this.currentPath.length === 0 || this._isLoading) return;

        this.currentPath.pop();
        this.currentHandle = this.currentPath.length > 0 
            ? this.currentPath[this.currentPath.length - 1].handle 
            : this.rootHandle;

        this.historyIndex++;
        this.history = this.history.slice(0, this.historyIndex);
        this.history.push({ handle: this.currentHandle, path: [...this.currentPath] });

        await this._loadDirectory();
        this._updateBreadcrumb();
        this._updateNavigationButtons();
    }

    async goBack() {
        if (this.historyIndex <= 0 || this._isLoading) return;

        this.historyIndex--;
        const entry = this.history[this.historyIndex];
        this.currentHandle = entry.handle;
        this.currentPath = [...entry.path];

        await this._loadDirectory();
        this._updateBreadcrumb();
        this._updateNavigationButtons();
    }

    async goForward() {
        if (this.historyIndex >= this.history.length - 1 || this._isLoading) return;

        this.historyIndex++;
        const entry = this.history[this.historyIndex];
        this.currentHandle = entry.handle;
        this.currentPath = [...entry.path];

        await this._loadDirectory();
        this._updateBreadcrumb();
        this._updateNavigationButtons();
    }

    async refresh() {
        if (this._isLoading) return;
        await this._loadDirectory();
    }

    async _loadDirectory() {
        if (!this.currentHandle) return;

        // Increment loading ID to track this specific load operation
        const currentLoadId = ++this._loadingId;
        this._isLoading = true;

        this._loadingState.style.display = 'flex';
        this._itemContainer.style.display = 'none';
        this._emptyState.style.display = 'none';
        
        // Clear immediately to prevent showing stale content
        this._clearItems();
        this.files = [];
        this.filteredFiles = [];
        this.selectedFiles.clear();
        this._lastSelectedIndex = undefined;

        try {
            const entries = [];
            // Build current path string from path segments
            const currentPathString = this.currentPath.map(p => p.name).join('/');
            
            for await (const entry of this.currentHandle.values()) {
                // Check if this load is still current
                if (currentLoadId !== this._loadingId) {
                    return; // Abort - a newer load has started
                }

                // Build full path for this entry
                const fullPath = currentPathString 
                    ? `${currentPathString}/${entry.name}` 
                    : entry.name;

                const fileData = {
                    name: entry.name,
                    path: fullPath,
                    handle: entry,
                    isDirectory: entry.kind === 'directory',
                    extension: entry.kind === 'file' ? entry.name.split('.').pop() : null
                };

                if (entry.kind === 'file') {
                    try {
                        const file = await entry.getFile();
                        fileData.size = file.size;
                        fileData.lastModified = file.lastModified;
                        fileData.mimeType = file.type;
                    } catch (e) {
                        // Permission denied or file inaccessible
                        fileData.size = 0;
                    }
                }

                entries.push(fileData);
            }

            // Final check before applying results
            if (currentLoadId !== this._loadingId) {
                return; // Abort - a newer load has started
            }

            this.files = entries;
        } catch (e) {
            console.error('Failed to load directory:', e);
            if (currentLoadId === this._loadingId) {
                LS.Toast.show('Failed to load directory', { accent: 'red', timeout: 3000 });
            }
        }

        // Only update UI if this is still the current load
        if (currentLoadId === this._loadingId) {
            this._isLoading = false;
            this._loadingState.style.display = 'none';
            this._itemContainer.style.display = '';
            this._applyFilters();
        }
    }

    setViewMode(mode) {
        this.viewMode = mode;
        this._content.classList.toggle('grid-view', mode === 'grid');
        this._content.classList.toggle('list-view', mode === 'list');
        this._gridViewBtn.classList.toggle('active', mode === 'grid');
        this._listViewBtn.classList.toggle('active', mode === 'list');

        this._renderItems();
    }

    selectAll() {
        this.filteredFiles.forEach(f => this.selectedFiles.add(f));
        this._updateSelectionVisuals();
    }

    deselectAll() {
        this.selectedFiles.clear();
        this._updateSelectionVisuals();
    }

    destroy() {
        if (this._contextMenu) this._contextMenu.destroy();

        this.element.remove();
        this.files = [];
        this.filteredFiles = [];
        this.selectedFiles.clear();
    }
}

// Export
window.FileBrowser = FileBrowser;
