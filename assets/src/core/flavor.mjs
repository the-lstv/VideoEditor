/**
 * Flavor base class.
 * @copyright 2026 lstv.space
 * @license GPL-3.0
 */

export default class Flavor extends LS.Context {
    static name = "default";

    constructor(project) {
        super();

        if(!project) {
            throw new Error("Flavor must be initialized with a project");
        }

        this.project = project;

        this.project.once("destroy", () => {
            this.destroy();
        });
    }

    get flavorConfig() {
        const name = this.constructor.name || this.name || "default";

        if(!this.project.config.flavorSpecific) {
            this.project.config.flavorSpecific = {};
        }

        if(!this.project.config.flavorSpecific[name]) {
            this.project.config.flavorSpecific[name] = {};
        }

        return this.project.config.flavorSpecific[name] || {};
    }
}