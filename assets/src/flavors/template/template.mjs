class TemplateFlavor extends FlavorBase {
    static name = "template";

    static iconSet = {
        icon: 'assets/src/flavors/template/images/icon.svg',
        small: 'assets/src/flavors/template/images/icon-flat.svg',
        favicon: 'assets/src/flavors/template/images/favicon.svg',
        desktopIcon: 'assets/src/flavors/template/images/favicon.png'
    };

    constructor(project) {
        super(project);

        // When the projects starts initializing
        this.project.once("initializing", async () => {
            await this.#init();
        });

        // When the project data has loaded
        this.project.on("project-data-loaded", (data) => { });

        // When a view connects to the project
        this.project.on("view-connected", (view) => { });

        // When a view disconnects from the project
        this.project.on("view-disconnected", (view) => { });

        // When the project data is being exported
        this.project.on("export", (data) => { });
    }

    async #init() { }

    /**
     * The default setup for this flavor.
     * Here you can setup views
     * @param {*} app 
     */
    static setupIn(app) {
        app.setIcon(this.iconSet);
        app.flavor = new this(app.currentProject || (app.currentProject = new Project()));
    }
}

export default TemplateFlavor;