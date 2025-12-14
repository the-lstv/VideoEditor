/**
 * Represents a layout slot/panel that can contain views
 */
class LayoutSlot {
    constructor(id, element, options = {}) {
        this.id = id;
        this.element = element;
        this.views = new Map();
        this.activeView = null;
        this.orientation = options.orientation || 'vertical';
        this.size = options.size || '1fr';
        this.minSize = options.minSize || 50;
        this.resizeHandles = null;
        
        this.setupElement();
    }

    setupElement() {
        this.element.dataset.slotId = this.id;
        this.element.classList.add('layout-slot');
        this.element.style.display = 'flex';
        this.element.style.flexDirection = this.orientation === 'horizontal' ? 'row' : 'column';
        this.element.style.overflow = 'hidden';
        this.element.style.position = 'relative';
    }

    addView(viewId, view) {
        this.views.set(viewId, view);
        view.dataset.viewId = viewId;
        view.classList.add('layout-view');
        view.style.display = 'none';
        this.element.appendChild(view);
        if (!this.activeView) {
            this.setActiveView(viewId);
        }
    }

    removeView(viewId) {
        const view = this.views.get(viewId);
        if (view) {
            view.remove();
            this.views.delete(viewId);
            if (this.activeView === viewId) {
                this.activeView = this.views.size > 0 ? this.views.keys().next().value : null;
                if (this.activeView) {
                    this.setActiveView(this.activeView);
                }
            }
        }
        return view || null;
    }

    setActiveView(viewId) {
        if (!this.views.has(viewId)) return false;
        if (this.activeView) {
            const prev = this.views.get(this.activeView);
            if (prev) prev.style.display = 'none';
        }
        const view = this.views.get(viewId);
        if (view) {
            view.style.display = 'flex';
            view.style.flex = '1';
            this.activeView = viewId;
        }
        return true;
    }

    getActiveView() {
        return this.activeView;
    }

    getElement() {
        return this.element;
    }

    getId() {
        return this.id;
    }

    getViews() {
        return new Map(this.views);
    }

    hasView(viewId) {
        return this.views.has(viewId);
    }

    setOrientation(orientation) {
        this.orientation = orientation;
        this.element.style.flexDirection = orientation === 'horizontal' ? 'row' : 'column';
    }

    getOrientation() {
        return this.orientation;
    }

    setSize(size) {
        this.size = size;
        if (typeof size === 'number') {
            this.element.style.flex = `0 0 ${size}px`;
        } else {
            this.element.style.flex = size;
        }
    }

    getSize() {
        return this.size;
    }

    setResizeHandles(handles) {
        this.resizeHandles = handles;
    }

    getResizeHandles() {
        return this.resizeHandles;
    }
}

/**
 * Main Layout Manager
 */
class LayoutManager {
    constructor(container, resizeManager, options = {}) {
        this.container = container;
        this.resizeManager = resizeManager;
        this.slots = new Map();
        this.currentConfig = null;
        this.viewLocationMap = new Map();
        this.storageKey = options.storageKey || 'layout-manager-state';
        this.storage = options.storage || localStorage;
        this.activeResizeHandles = new Map();
        
        this.setupContainer();
    }

    setupContainer() {
        this.container.classList.add('layout-manager');
        this.container.style.display = 'flex';
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.container.style.overflow = 'hidden';
    }

    /**
     * Apply a layout configuration
     */
    applyLayout(config) {
        this.clearLayout();
        this.currentConfig = config;
        this.buildLayoutTree(config.structure, this.container);
        this.restoreSizes(config.id);
        this.setupResizeHandles(config);
    }

    /**
     * Build layout tree recursively
     */
    buildLayoutTree(node, parent) {
        if (node.type === 'slot' && node.slotId) {
            const slotConfig = this.currentConfig?.slots.get(node.slotId);
            const slotElement = document.createElement('div');
            slotElement.className = 'layout-slot-container';
            slotElement.style.flex = typeof node.size === 'number' ? `0 0 ${node.size}px` : (node.size || '1fr');
            slotElement.style.overflow = 'hidden';

            const slot = new LayoutSlot(node.slotId, slotElement, {
                orientation: slotConfig?.orientation || node.orientation || 'vertical',
                size: slotConfig?.size || node.size,
                minSize: 50
            });

            parent.appendChild(slotElement);
            this.slots.set(node.slotId, slot);
        } else if (node.type === 'container' && node.children) {
            const containerElement = document.createElement('div');
            containerElement.className = 'layout-container';
            containerElement.style.display = 'flex';
            containerElement.style.flex = typeof node.size === 'number' ? `0 0 ${node.size}px` : (node.size || '1fr');
            containerElement.style.flexDirection = (node.orientation || 'vertical') === 'horizontal' ? 'row' : 'column';
            containerElement.style.overflow = 'hidden';

            parent.appendChild(containerElement);

            for (const child of node.children) {
                this.buildLayoutTree(child, containerElement);
            }
        }
    }

    /**
     * Setup resize handles for slots
     */
    setupResizeHandles(config) {
        for (const [slotId, slotConfig] of config.slots) {
            const slot = this.slots.get(slotId);
            if (!slot || !slotConfig.resizeSides || slotConfig.resizeSides.length === 0) continue;

            const element = slot.getElement();
            const handles = this.resizeManager.add(element, {
                sides: slotConfig.resizeSides,
                styled: true,
                minWidth: 50,
                minHeight: 50,
                store: `${this.storageKey}-${config.id}-${slotId}`,
                storage: this.storage
            });

            this.activeResizeHandles.set(slotId, handles);
            slot.setResizeHandles(handles);
        }
    }

    /**
     * Clear all resize handles
     */
    clearResizeHandles() {
        for (const [slotId] of this.activeResizeHandles) {
            const slot = this.slots.get(slotId);
            if (slot) {
                this.resizeManager.remove(slot.getElement());
            }
        }
        this.activeResizeHandles.clear();
    }

    /**
     * Clear the current layout
     */
    clearLayout() {
        this.clearResizeHandles();
        this.container.innerHTML = '';
        this.slots.clear();
    }

    /**
     * Add a view to a slot
     */
    addViewToSlot(viewId, view, slotId) {
        const slot = this.slots.get(slotId);
        if (!slot) return false;

        const prevSlotId = this.viewLocationMap.get(viewId);
        if (prevSlotId && prevSlotId !== slotId) {
            const prevSlot = this.slots.get(prevSlotId);
            if (prevSlot) {
                prevSlot.removeView(viewId);
            }
        }

        slot.addView(viewId, view);
        this.viewLocationMap.set(viewId, slotId);
        return true;
    }

    /**
     * Move view between slots
     */
    moveViewToSlot(viewId, toSlotId) {
        const fromSlotId = this.viewLocationMap.get(viewId);
        if (!fromSlotId) return false;

        const fromSlot = this.slots.get(fromSlotId);
        const toSlot = this.slots.get(toSlotId);
        if (!fromSlot || !toSlot) return false;

        const view = fromSlot.removeView(viewId);
        if (!view) return false;

        toSlot.addView(viewId, view);
        this.viewLocationMap.set(viewId, toSlotId);
        return true;
    }

    /**
     * Remove view from layout
     */
    removeView(viewId) {
        const slotId = this.viewLocationMap.get(viewId);
        if (!slotId) return false;

        const slot = this.slots.get(slotId);
        if (!slot) return false;

        slot.removeView(viewId);
        this.viewLocationMap.delete(viewId);
        return true;
    }

    /**
     * Set active view in a slot
     */
    setActiveView(slotId, viewId) {
        const slot = this.slots.get(slotId);
        if (!slot) return false;
        return slot.setActiveView(viewId);
    }

    /**
     * Get slot by ID
     */
    getSlot(slotId) {
        return this.slots.get(slotId) || null;
    }

    /**
     * Get all slots
     */
    getSlots() {
        return new Map(this.slots);
    }

    /**
     * Get view's slot
     */
    getViewSlot(viewId) {
        return this.viewLocationMap.get(viewId) || null;
    }

    /**
     * Save layout state
     */
    saveState(configId) {
        const state = {
            configId,
            timestamp: Date.now(),
            views: Array.from(this.viewLocationMap.entries())
        };
        this.storage.setItem(this.storageKey, JSON.stringify(state));
    }

    /**
     * Restore layout state
     */
    restoreState() {
        const data = this.storage.getItem(this.storageKey);
        if (!data) return null;
        try {
            const state = JSON.parse(data);
            return { configId: state.configId, views: state.views };
        } catch (e) {
            return null;
        }
    }

    /**
     * Restore saved sizes for slots
     */
    restoreSizes(configId) {
        for (const [slotId] of this.slots) {
            const key = `${this.storageKey}-${configId}-${slotId}`;
            try {
                const data = this.storage.getItem(key);
                if (data) {
                    // Sizes are restored automatically by LS.Resize when store key is set
                }
            } catch (e) {
                // Silently fail if storage is unavailable
            }
        }
    }

    /**
     * Get current configuration
     */
    getCurrentConfig() {
        return this.currentConfig;
    }
}

/**
 * Predefined layout configurations
 */
const PRESET_LAYOUTS = {
    HORIZONTAL_SPLIT: (slots = {}) => ({
        id: 'horizontal-split',
        name: 'Horizontal Split',
        structure: {
            type: 'container',
            orientation: 'vertical',
            children: [
                { type: 'slot', slotId: slots.top || 'top', size: '1fr' },
                { type: 'slot', slotId: slots.bottom || 'bottom', size: '1fr' }
            ]
        },
        slots: new Map([
            [slots.top || 'top', { orientation: 'horizontal', resizeSides: ['bottom'] }],
            [slots.bottom || 'bottom', { orientation: 'horizontal', resizeSides: ['top'] }]
        ])
    }),

    VERTICAL_SPLIT: (slots = {}) => ({
        id: 'vertical-split',
        name: 'Vertical Split',
        structure: {
            type: 'container',
            orientation: 'horizontal',
            children: [
                { type: 'slot', slotId: slots.left || 'left', size: '1fr' },
                { type: 'slot', slotId: slots.right || 'right', size: '1fr' }
            ]
        },
        slots: new Map([
            [slots.left || 'left', { orientation: 'vertical', resizeSides: ['right'] }],
            [slots.right || 'right', { orientation: 'vertical', resizeSides: ['left'] }]
        ])
    }),

    LEFT_TOP_BOTTOM: (slots = {}) => ({
        id: 'left-top-bottom',
        name: 'Left + Top/Bottom',
        structure: {
            type: 'container',
            orientation: 'horizontal',
            children: [
                { type: 'slot', slotId: slots.left || 'left', size: '300px' },
                {
                    type: 'container',
                    orientation: 'vertical',
                    size: '1fr',
                    children: [
                        { type: 'slot', slotId: slots.top || 'top', size: '1fr' },
                        { type: 'slot', slotId: slots.bottom || 'bottom', size: '1fr' }
                    ]
                }
            ]
        },
        slots: new Map([
            [slots.left || 'left', { orientation: 'vertical', resizeSides: ['right'] }],
            [slots.top || 'top', { orientation: 'horizontal', resizeSides: ['bottom'] }],
            [slots.bottom || 'bottom', { orientation: 'horizontal', resizeSides: ['top'] }]
        ])
    }),

    THREE_COLUMN: (slots = {}) => ({
        id: 'three-column',
        name: 'Three Column',
        structure: {
            type: 'container',
            orientation: 'horizontal',
            children: [
                { type: 'slot', slotId: slots.left || 'left', size: '250px' },
                { type: 'slot', slotId: slots.center || 'center', size: '1fr' },
                { type: 'slot', slotId: slots.right || 'right', size: '250px' }
            ]
        },
        slots: new Map([
            [slots.left || 'left', { orientation: 'vertical', resizeSides: ['right'] }],
            [slots.center || 'center', { orientation: 'vertical', resizeSides: ['left', 'right'] }],
            [slots.right || 'right', { orientation: 'vertical', resizeSides: ['left'] }]
        ])
    })
};
