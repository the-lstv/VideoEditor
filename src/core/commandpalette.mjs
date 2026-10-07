export default function initCommandPalette(app, paletteOverlay) {
    const paletteBar = paletteOverlay.querySelector(".ls-command-palette-wrapper");
    const paletteContainer = paletteOverlay.querySelector(".ls-command-palette");
    const terminalContainer = paletteOverlay.querySelector("#commandTerminal");
    const terminalOutput = terminalContainer && terminalContainer.querySelector(".terminal-output");

    const paletteLogger = {
        info : (...a) => LS.CommandPalette.writeLogTo(terminalOutput, 0, ...a),
        log  : (...a) => LS.CommandPalette.writeLogTo(terminalOutput, 1, ...a),
        warn : (...a) => LS.CommandPalette.writeLogTo(terminalOutput, 2, ...a),
        error: (...a) => LS.CommandPalette.writeLogTo(terminalOutput, 3, ...a),
        fatal: (...a) => LS.CommandPalette.writeLogTo(terminalOutput, 4, ...a),
        clear: () => terminalOutput.replaceChildren()
    }

    const palette = new LS.CommandPalette({
        container: paletteContainer,
        fontWidth: 9.6 * 1.2,
        onClose(){ LS.Animation.fadeOut(paletteOverlay, "down") },
        onOpen (){ LS.Animation.fadeIn(paletteOverlay,  "up")   },
        logger: paletteLogger,
    });

    let terminalHidden = true;
    const terminalObserver = new MutationObserver(() => {
        const hasContent = terminalOutput.children.length > 0;
        if (hasContent) {
            if (terminalHidden) {
                LS.Animation.fadeIn(terminalContainer, 200, "up");
                terminalHidden = false;
            }
        } else {
            if (!terminalHidden) {
                LS.Animation.fadeOut(terminalContainer, 200, "down");
                terminalHidden = true;
            }
        }
    });

    terminalObserver.observe(terminalOutput, { childList: true });

    paletteBar.querySelector(".ls-command-palette-buttons button").addEventListener("click", () => {
        palette.close();
    });

    palette.register([
        {
            name: "about",
            icon: "bi-info-circle",
            description: "Open the about modal",
            onCalled() {
                app.aboutDialog();
            }
        },

        {
            name: "set-accent",
            icon: "bi-palette2",
            description: "Set an accent color",

            onCalled(color) {
                LS.Color.setAccent(color);
            },

            inputs: [
                { name: "preset", type: "list", list: [ { name: "custom", icon: "bi-palette2", type: "color" }, ...["white","blue","pastel-indigo","lapis","pastel-teal","aquamarine","green","lime","neon","yellow","orange","deep-orange","red","rusty-red","pink","hotpink","purple"].map(accent => ({
                    name: accent,
                    icon: `bi-circle-fill`,
                    accentColor: accent,
                    value: accent
                }))] }
            ]
        },

        {
            name: "set-theme",
            icon: "bi-palette",
            description: "Set user theme",
            onCalled(theme) {
                if (theme === "system") {
                    localStorage.removeItem("ls-theme");
                    LS.Color.setAdaptiveTheme();
                    return;
                }

                LS.Color.setTheme(theme);
                localStorage.setItem("ls-theme", theme);
            },
            inputs: [
                {
                    name: "theme",
                    type: "list",
                    list: [
                        { name: "Light", value: "light", icon: "bi-brightness-high" },
                        { name: "Dark", value: "dark", icon: "bi-moon" },
                        { name: "System", value: "system", icon: "bi-laptop" }
                    ]
                }
            ]
        },

        {
            name: "set-language",
            icon: "bi-translate",
            description: "Set user language",
            onCalled(lang) {
                if(lang === "volunteer") {
                    app.openExternal(app.GITHUB_REPO + "/issues?q=state%3Aopen%20label%3Atranslation");
                    return;
                }

                LS.i18n.changeLocale(lang);
                app.config.set("language", lang);
            },
            inputs: [
                {
                    name: "language",
                    type: "list",
                    list: app.locales
                }
            ]
        },

        {
            name: "config",
            alias: ["settings"],
            icon: "bi-gear",
            description: "Quickly navigate settings"
        },

        {
            name: "logs",
            icon: "bi-file-earmark-text",
            description: "Show logs",
        },

        {
            name: "switch-flavor",
            icon: "bi-app",
            description: "Switch the application flavor",

            onCalled(flavor) {
                LS.Modal.confirm("Are you sure you want to switch the flavor? This will close the current one and may cause unsaved changes to be lost.<br><br>Warning: This is very experimental and may cause instability!").then(confirmed => {
                    if(!confirmed) return;
                    palette.close();
                    app.dynamicLoadFlavor(flavor, { delay: 250 }).catch(e => {
                        console.error("Failed to load flavor:", e);
                        LS.Modal.alert("Failed to load flavor: " + e.message);
                    });
                });
            },

            inputs: [
                { name: "flavor", type: "list", list: app.flavorList }
            ]
        },

        {
            name: "open-project-manager",
            icon: "bi-folder2-open",
            description: "Open the project manager",
            onCalled() {
                app.shortcutManager.triggerMapping("GLOBAL_PROJECT_MANAGER");
            }
        },

        {
            name: "open-preferences",
            icon: "bi-sliders",
            description: "Open the preferences modal",
            onCalled() {
                app.shortcutManager.triggerMapping("OPEN_PREFERENCES");
            }
        },

        {
            name: "new-project",
            icon: "bi-file-earmark-plus",
            description: "Create a new project",
            onCalled() {
                app.shortcutManager.triggerMapping("GLOBAL_NEW_PROJECT");
            }
        },

        {
            name: "open-project",
            icon: "bi-folder2-open",
            description: "Open an existing project",
            onCalled() {
                app.shortcutManager.triggerMapping("GLOBAL_OPEN");
            }
        },

        {
            name: "save-project",
            icon: "bi-save",
            description: "Save the current project",
            onCalled() {
                app.shortcutManager.triggerMapping("GLOBAL_SAVE");
            }
        },

        {
            name: "export-project",
            icon: "bi-box-arrow-up",
            description: "Export the current project",
            onCalled() {
                app.shortcutManager.triggerMapping("GLOBAL_EXPORT_MENU");
            }
        },

        {
            name: "new-window",
            icon: "bi-window-plus",
            description: "Open a new window",
            onCalled() {
                app.shortcutManager.triggerMapping("GLOBAL_NEW_WINDOW");
            }
        },

        {
            name: "restart",
            icon: "bi-arrow-clockwise",
            description: "Restart the program",
            onCalled() {
                app.shortcutManager.triggerMapping("GLOBAL_NEW_WINDOW");
                window.close();
            }
        },

        {
            name: "echo",
            alias: ["print"],
            icon: "bi-chat",
            description: "Echo input",
            onCalled(text) { paletteLogger.log(text) },
            inputs: [
                { name: "text", type: "string", description: "Text to echo" }
            ]
        },

        {
            name: "eval",
            alias: [">"],
            icon: "bi-terminal",
            description: "Evaluate JavaScript code",
            onCalled(code) {
                paletteLogger.log(`> ${code}`);
                try {
                    const result = eval(code);
                    paletteLogger.log(result);
                } catch(e) {
                    paletteLogger.error(e);
                }
            },
            inputs: [
                { name: "code", type: "string", description: "JavaScript code to evaluate" }
            ]
        },

        {
            name: "clear",
            icon: "bi-trash",
            alias: ["clear-terminal", "cls"],
            description: "Clear output",
            onCalled() { paletteLogger.clear() }
        },

        {
            name: "close",
            icon: "bi-x-lg",
            description: "Close the command palette",
            onCalled() { palette.close() }
        },

        isNode && {
            name: "exit",
            icon: "bi-x-circle",
            description: "Exit the application",
            onCalled() {
                window.close();
            }
        }
    ]);

    app.pallette = palette;
}