/**
 * ConfigStore class.
 * @copyright 2026 lstv.space
 * @license GPL-3.0
 */

/**
 * Rough polyfill implementation of ConfigStore class
 * TODO: Temporarily using localStorage; in the future, this should be swapped
 */
class ConfigStore {
    storage = localStorage;
    prefix  = "config-";

    constructor() {
        this.store = new Map();

        // Load existing config from localStorage
        for (const key in this.storage) {
            if (key.startsWith(this.prefix)) {
                const configKey = key.substring(this.prefix.length);
                try {
                    const value = JSON.parse(this.storage.getItem(key));
                    this.store.set(configKey, value);
                } catch (e) {
                    console.warn(`ConfigStore: Failed to parse config item ${configKey}`, e);
                }
            }
        }
    }

    // The storage class can implement whatever it needs to await when initalizing here
    async open() {}

    set(key, value = true) {
        this.store.set(key, value);
        this.storage.setItem(`${this.prefix}${key}`, JSON.stringify(value));
    }

    get(key, defaultValue = null) {
        return this.store.get(key) || defaultValue;
    }

    has(key) {
        return this.store.has(key);
    }

    delete(key) {
        this.store.delete(key);
        this.storage.removeItem(`${this.prefix}${key}`);
    }

    clear() {
        this.store.clear();
        // Remove all config items from localStorage
        for (const key in this.storage) {
            if (key.startsWith(this.prefix)) {
                this.storage.removeItem(key);
            }
        }
    }

    export(asString = false) {
        const exported = {};
        for (const [key, value] of this.store.entries()) {
            exported[key] = value;
        }

        if (asString) return JSON.stringify(exported); return exported;
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

export default ConfigStore;