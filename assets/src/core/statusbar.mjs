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
    }
}

export default StatusBar;