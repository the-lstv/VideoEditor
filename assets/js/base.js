/**
 * Project class
 */
class Project extends LS.EventHandler {
    constructor(data) {
        super();

        this.loadFrom(data);

        this.renderingCanvas = document.createElement('canvas');
        this.renderer = new Renderer({
            canvas: this.renderingCanvas,
            width: 1280,
            height: 720,
            backgroundColor: 0x000000,
            ...(this.config.rendererOptions || {})
        });

        this.initialized = false;
    }

    async init() {
        await this.renderer.init();
        this.initialized = true;

        window.__PIXI_DEVTOOLS__ = {
            renderer: this.renderer.renderer
        };

        this.completed('ready');
    }

    loadFrom(data = {}) {
        if (typeof data === "string") {
            data = JSON.parse(data);
        }

        this.config = data.config || {};
        if(!this.config.rendererOptions) {
            this.config.rendererOptions = {
                width: 1280,
                height: 720
            };
        }

        this.timelines = new Map(Object.entries(data.timelines || {}));

        if(Array.isArray(data.resources)) {
            for (const resource of data.resources) {
                const res = new Resource(resource);
            }

            this.resources = data.resources;
        }
    }

    destroy() {
        // TODO: Proper destruction
        this.renderer.destroy();
        this.events.clear();
        this.emit('destroy');
        this.__destroyed = true;
    }

    export(asString = false) {
        const data = {
            config: this.config,
            timelines: Object.fromEntries(this.timelines),
            resources: Object.fromEntries(this.resources)
        };
        return asString ? JSON.stringify(data) : data;
    }
}

/**
 * View class
 * Base class for all views
 */
class View extends LS.EventHandler {
    constructor({ container, name, defaultSlots, slots } = {}) {
        super();

        this.container = container;
        this.container.classList.add('editor-view');
        this.__name = name || null;

        this._defaultSlots = Array.isArray(defaultSlots) ? defaultSlots : (defaultSlots ? [defaultSlots] : []);
        this._slots = Array.isArray(slots) ? slots : (slots ? [slots] : []);
        this.currentSlot = null;
    }

    // Subclasses should subscribe the destroy event to free resources
    // (Don't override this method)
    destroy() {
        this.emit('destroy');
        this.container.remove();
        this.events.clear();
        this.__destroyed = true;
        if(this.currentSlot) {
            this.currentSlot.set(null);
        }
    }
}

/**
 * Slot class
 * Represents a slot in the layout where views can be placed
 */
class Slot {
    constructor(name, options = {}) {
        this.name = name.toLowerCase();
        this.options = options;
        
        this.__emptyMessage = LS.Create({ class: 'editor-view layout-slot-empty', inner: [{ tag: "i", class: "bi-info-circle" }, `This slot is empty.`] });

        this.container = LS.Create({
            tag: "layout-item",
            class: 'layout-slot layout-slot-' + name,
            inner: this.__emptyMessage
        });

        if(options.minSize) {
            this.container.style.minWidth = options.minSize.width + 'px';
            this.container.style.minHeight = options.minSize.height + 'px';
        }

        if(options.maxSize) {
            this.container.style.maxWidth = options.maxSize.width + 'px';
            this.container.style.maxHeight = options.maxSize.height + 'px';
        }

        if(options.width) {
            this.container.style.width = options.width + (typeof options.width === "number" ? 'px' : '');
        }

        if(options.height) {
            this.container.style.height = options.height + (typeof options.height === "number" ? 'px' : '');
        }
    }

    set(view) {
        for(const child of this.container.children) {
            child.remove();
        }

        if(!view || view.__destroyed) {
            this.container.appendChild(this.__emptyMessage);
            if(view && view.__destroyed) {
                console.warn(`Slot.set: cannot set destroyed view ${view.constructor.name} to slot ${this.name}`);
                view.currentSlot = null;
                return;
            }
            return;
        }

        view.currentSlot = this;
        this.container.appendChild(view.container);
    }
}

const LAYOUT_SCHEMA_PRESETS = {
    /**
     * |   |   |
     * |-------|
     * |   |   |
     */
    'default': {
        direction: 'column',
        inner: [
            // Two horizontal rows
            { inner: [ { type: 'slot', name: 'top-left-row', resize: { width: 600 } }, { type: 'slot', name: 'top-right-row' } ], resize: { height: "65%" } },
            { inner: [ { type: 'slot', name: 'bottom-left-row', resize: { width: 300 } }, { type: 'slot', name: 'bottom-right-row' } ] },
        ]
    },

    /**
     * |   | | |
     * |   |---|
     * |   |   |
     */
    'vertical-split': {
        direction: 'row',
        inner: [
            { type: 'slot', name: 'left-panel' },
            { inner: {
                direction: 'column',
                inner: [ { direction: "row", inner: [ { type: 'slot', name: 'top-right-left-row' }, { type: 'slot', name: 'top-right-right-row' } ] }, { type: 'slot', name: 'right-bottom' } ]
            } }
        ]
    },

    /**
     * |   |   |
     * |-------|
     * |   |   |
     */
    'default-but-better': {
        direction: 'column',
        tilt: Math.floor(Math.random() * 17 + 28),
        inner: [
            // Two horizontal rows
            { inner: [ { type: 'slot', name: 'top-left-row', resize: { width: 600 } }, { type: 'slot', name: 'top-right-row' } ], resize: { height: "65%" } },
            { inner: [ { type: 'slot', name: 'bottom-left-row', resize: { width: 300 } }, { type: 'slot', name: 'bottom-right-row' } ] },
        ]
    },
};

/**
 * Main Layout Manager
 * 
 * HOW LAYOUTS WORK:
 * LayoutManager manages a schema and a set of slots.
 * Views can specify an array of slot names where they want to be placed, in order.
 * 
 * The schema defines the layout structure, which can be virtually any combination with an unlimited amount of slots.
 */
class LayoutManager {
    constructor(container, options = {}) {
        this.container = container || document.body;
        this.options = options;

        this.views = new Set();
        this.slots = new Map();

        this.__schemaLoaded = false;
        this.setSchema(options.layout || 'default');
    }

    static cloneSchema(schema) {
        function replacer(key, value) {
            if (value instanceof Slot) {
                return { type: 'slot', name: value.name, ...value.options? { options: value.options } : {}, ...value.resize ? { resize: value.resize } : {} };
            }
            return value;
        }

        return JSON.parse(JSON.stringify(schema, replacer));
    }

    add(...views) {
        for (const view of views) {
            if (!(view instanceof View)) {
                console.error("LayoutManager.add: view must be an instance of View");
                return;
            }

            this.views.add(view);
        }

        this.render();
    }

    render() {
        // TODO: Resolve conflicts
        for (const view of this.views) {
            const slots = [...(view._slots || []), ...(view._defaultSlots || [])];
            if (slots.length === 0) continue;

            let placed = false;
            for (const slotName of slots) {
                const slot = this.slots.get(slotName.toLowerCase());
                if (slot) {
                    slot.set(view);
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                console.warn(`LayoutManager.render: No slot found for view ${view.constructor.name}`, slots, view);
            }
        }
    }

    setSchema(schema) {
        if(typeof schema === "string") {
            schema = LAYOUT_SCHEMA_PRESETS[schema];
        }

        if(!schema || (typeof schema !== "object")) {
            if(this.__schemaLoaded) {
                console.error("LayoutManager.setSchema: valid schema is required");
                return false;
            }

            console.warn("LayoutManager.setSchema: invalid schema provided, using default");
            schema = LAYOUT_SCHEMA_PRESETS['default'];
        }

        // Make a deep copy of the schema and set it as the current working schema
        schema = LayoutManager.cloneSchema(schema);
        this.schema = schema;

        for(const child of this.container.children) {
            child.remove();
        }

        for(const slot of this.slots) {
            if(slot.container) {
                LS.Resize.remove(slot.container); // Removes any resize handlers
                slot.container.remove();
            }
        }

        this.slots.clear();
        this.container.appendChild(this._processSchema(this.schema));

        this.__schemaLoaded = true;
        this.render();
        return true;
    }

    _processSchema(schema) {
        if (schema instanceof Slot || (schema.type && schema.type === 'slot')) {
            if (!(schema instanceof Slot)) {
                schema = new Slot(schema.name, schema.options);
            }

            this.slots.set(schema.name, schema);
            return schema.container;
        }

        const direction = schema.direction || "row";
        const container = LS.Create({ tag: "layout-item", class: 'layout-' + direction, ...schema.tilt? { style: `transform:rotate(${schema.tilt}deg)` } : {} });

        if(Array.isArray(schema.inner)) {
            let i = 0;
            for (const item of schema.inner) {
                const child = this._processSchema(item);
                container.appendChild(child);

                if(i !== schema.inner.length - 1) {
                    LS.Resize.set(child, {
                        sides: direction === 'column'? ['bottom']: ['right'],

                        // Snapping
                        snapCollapse: true,
                        snapExpand: true,
                        snapVertical: direction === 'column',
                        snapHorizontal: direction === 'row',

                        // Storage
                        store: true,
                        storeStringify: false,
                        storage: {
                            getItem: (key) => {
                                return item.resize || null;
                            },
                            setItem: (key, value) => {
                                item.resize = value;
                            }
                        }
                    });

                    if(!item.resize) child.style[direction === 'column' ? 'height' : 'width'] = (100 / schema.inner.length) + '%';
                }

                i++;
            }
        } else if (schema.inner) {
            container.appendChild(this._processSchema(schema.inner));
        }

        return container;
    }

    exportLayout(asString = false) {
        const exported = {
            views: [],
            schema: LayoutManager.cloneSchema(this.schema)
        }

        for (const view of this.views) {
            exported.views.push({
                name: view.__name || view.constructor.name,
                ... view._slots && view._slots.length ? { slots: view._slots } : {}
            });
        }

        return asString? JSON.stringify(exported): exported;
    }

    importLayout(data) {
        if (typeof data === "string") {
            data = JSON.parse(data);
        }

        if (!data.schema || !data.views) {
            console.error("LayoutManager.importLayout: invalid layout data");
            return;
        }

        this.setSchema(data.schema);

        for (const viewData of data.views) {
            for (const view of this.views) {
                if (view.__name === viewData.name || view.constructor.name === viewData.name) {
                    view._slots = viewData.slots;
                    break;
                }
            }
        }

        this.render();
    }
}

/**
 * Resource class
 * Base class for all resources (images, videos, audio, etc.)
 * This is *not* a node in the project, just a reusable source container
 */
class Resource {
    static collection = new Map();
    static get(id) {
        return Resource.collection.get(id);
    }

    static computeHash(data) {
        xxhash
    }

    constructor(data) {
        Resource.collection.set(data.id || data.hash, this);
    }
}

/**
 * 
 */

/**
 * Renderer class
 * Extends LS.GL.Renderer, which is used for hardware accelerated video rendering.
 * It is an abstract utility class wrapping PIXI.js with automatic renderer detection (WebGPU / WebGL) and scene management.
 */
class Renderer extends LS.GL.Renderer {
    constructor(options) {
        super(options);
    }
}

/**
 * ConfigStore class
 * Temporarily using localStorage
 */
class ConfigStore {
    constructor() {
        this.store = new Map();

        // Load existing config from localStorage
        for (const key in localStorage) {
            if (key.startsWith('config-')) {
                const configKey = key.substring(7);
                try {
                    const value = JSON.parse(localStorage.getItem(key));
                    this.store.set(configKey, value);
                } catch (e) {
                    console.warn(`ConfigStore: Failed to parse config item ${configKey}`, e);
                }
            }
        }
    }

    set(key, value) {
        this.store.set(key, value);
        localStorage.setItem(`config-${key}`, JSON.stringify(value));
    }

    get(key, defaultValue = null) {
        return this.store.get(key) || defaultValue;
    }

    has(key) {
        return this.store.has(key);
    }

    delete(key) {
        this.store.delete(key);
        localStorage.removeItem(`config-${key}`);
    }

    clear() {
        this.store.clear();
        // Remove all config items from localStorage
        for (const key in localStorage) {
            if (key.startsWith('config-')) {
                localStorage.removeItem(key);
            }
        }
    }

    export(asString = false) {
        const exported = {};
        for (const [key, value] of this.store.entries()) {
            exported[key] = value;
        }
        if (asString) {
            return JSON.stringify(exported);
        }
        return exported;
    }

    import(data) {
        if (typeof data === "string") {
            data = JSON.parse(data);
        }

        for (const key in data) {
            this.set(key, data[key]);
        }
    }
}

// Export classes
window.EditorBaseClasses = {
    View,
    LayoutManager,
    Resource,
    Renderer,
    Project,
    ConfigStore
};