class TemplateFlavor extends FlavorBase {
    static name = "template";

    static iconSet = {
        icon: 'src/flavors/template/images/icon.svg',
        small: 'src/flavors/template/images/icon-flat.svg',
        favicon: 'src/flavors/template/images/favicon.svg',
        desktopIcon: 'src/flavors/template/images/favicon.png'
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
     * This gets called when the "About" option is selected in the app menu.
     */
    onAboutDialog() {
        LS.Modal.buildEphemeral({
            content: [
                { tag: 'img', src: this.constructor.iconSet.icon, style: 'height: 5em; width: 100%; margin: auto' },
                { tag: 'h2', inner: 'Example Flavor', style: 'text-align: center' },
                { tag: 'p', inner: `Editor version ${app.VERSION}, running LS ${LS.version}` },
            ],
            buttons: [ { label: "Close" } ]
        });
    }

    static layoutPresets = {
        default: {
            title: "Classic",
            direction: 'column',
            inner: []
        }
    };

    static {
        LS.Multipane.registerPresets(this.name, this.layoutPresets);
    }
}

export default TemplateFlavor;