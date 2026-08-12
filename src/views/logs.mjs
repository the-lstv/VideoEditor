export default class LogsView extends LS.View {
    static name = "LogsView";

    constructor() {
        super({
            name: "LogsView",
            title: "Logs",
            container: LS.Create({
                class: "logs-panel",
                inner: [
                    { tag: "div", class: "log-console" },
                    { tag: "div", class: "metrics" }
                ]
            })
        });

        this.logOutput = this.container.querySelector(".log-console");
        this.metricsBox = this.container.querySelector(".metrics");

        this.addExternalEventListener(LS, "log", (level, message) => {
            this.pushLog(level, message);
        });
    }

    destroy() {
        super.destroy();
    }

    clearLogs() {
        this.logOutput.replaceChildren();
    }

    pushLog(level, message) {
        const row = document.createElement("div");
        row.className = `log-entry ${level}`;
        const label = document.createElement("i");
        label.className = `bi-${level === "error" ? "exclamation-circle" : level === "warn" ? "exclamation-triangle" : "info-circle"}`;
        const text = document.createElement("span");
        text.textContent = message;
        row.appendChild(label);
        row.appendChild(text);
        this.logOutput.appendChild(row);
    }
}