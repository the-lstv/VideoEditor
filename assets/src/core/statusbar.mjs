class StatusBar {
    constructor(container) {
        this.container = container;
        container.append(
            LS.Create(".statusbar-left", {
                inner: ""
            }),
            
            LS.Create(".statusbar-right", {
                inner: [
                    { emmet: ".nav-menu-item", inner: "" },
                ]
            })
        );

        LS.on("flavor-ready", (flavor) => {
            this.container.querySelector(".statusbar-left").textContent = "Version " + (flavor.constructor.version || "");
        });
    }
}

export default StatusBar;