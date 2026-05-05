/**
 * Flavor base class
 */

export default class Flavor extends LS.Context {
    name = "base";

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
        if(!this.project.config.flavorSpecific) {
            this.project.config.flavorSpecific = {};
        }

        if(!this.project.config.flavorSpecific[this.name]) {
            this.project.config.flavorSpecific[this.name] = {};
        }

        return this.project.config.flavorSpecific[this.name] || {};
    }
}