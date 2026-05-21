/**
 * ConfigStore class.
 * @copyright 2026 lstv.space
 * @license GPL-3.0
 */

/**
 * Rough polyfill implementation of ConfigStore class
 * Temporarily using localStorage; in the future, this could be swapped
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

export default ConfigStore;