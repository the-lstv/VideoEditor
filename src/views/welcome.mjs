/**
 * Welcome screen view.
 */
export default class WelcomeView extends LS.View {
    static name = "WelcomeView";

    constructor() {
        super({
            name: "WelcomeView",
            title: "Welcome",
            container: LS.Create({
                class: "welcome-screen",
                style: "display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;",
                inner: [
                    { tag: "h1", inner: "Welcome to LS Creative Centre!", style: "margin: 0" },
                    { tag: "p", inner: "This is the home to all of your projects.\nWhether you are working on videos, music, games, presentations, code, images or other digital content, you'll find everything you need here." }
                ]
            })
        });
    }
}