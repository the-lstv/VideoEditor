export default class WebView extends LS.View {
    static name = "WebView";

    constructor() {
        super({
            name: "WebView",
            title: "Web",
            // <webview id="foo" src="https://www.github.com/" style="display:inline-flex; width:640px; height:480px"></webview>
            container: LS.Create({
                class: "web-browser-panel",
                inner: [
                    // { tag: "webview", src: "https://google.com" }
                    { tag: "iframe", src: "https://google.com" }
                ]
            })
        });

        this.addExternalEventListener(LS, "open-link", (url, options) => { });
    }

    destroy() {
        
    }
}