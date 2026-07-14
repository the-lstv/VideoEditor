/**
 * Welcome screen view.
 */
export default class WelcomeView extends LS.Multipane.View {
    static name = "WelcomeView";

    constructor() {
        super({
            name: "WelcomeView",
            title: "Welcome",
            container: LS.Create({
                class: "welcome-screen",
                style: "display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;",
                inner: [
                    { tag: "h1", inner: "Welcome to LS Creative Centre!" },
                    { tag: "p", inner: "Open a project or a flavor to get started." }
                ]
            })
        });
    }
}