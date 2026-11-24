/**
 * Work in progress!
 * TODO: Requires a lot of refactoration
 */

function createThemePreview(theme) {
    const colors      = theme.colors      || {};
    const ui          = theme.ui          || {};
    const backgrounds = theme.backgrounds || {};

    const scheme = colors?.scheme;
    const preview = LS.Create("div.themePreview.level-0>div.p-header+div.p-body>div.p-l{Text}>br+button^div.p-c+div.p-r^div.p-footer");

    preview.style.setProperty('--border-radius-multiplier', theme?.corners ?? 1);
    preview.setAttribute('data-ls-style', ui?.style || "flat");
    preview.setAttribute("data-ls-theme", scheme === "light"? "light": "dark");
    preview.setAttribute("data-theme-label", theme?.name || "Unnamed");
    preview.setAttribute("data-theme-description", theme?.description || "");

    LS.Color.setContrast(colors?.contrast, scheme === "light", preview);
    preview.style.cssText += LS.Color.generate(LS.Color.fromHSL(colors?.hue ?? 0, colors?.sat ?? 0, colors?.lightness ?? 50), null, null, { hueShift: colors?.step ?? 0, saturationBoost: colors?.blend ?? 1 });

    preview.onclick = () => {
        app.setTheme(LS.Util.clone(theme));
        LS.Misc.blink(preview);
    };

    return preview;
}

/**
 * Settings class represents the settings/config modal of the application.
 */
class Settings {
    /**
     * @type {LS.Tabs}
     */
    tabs = null;

    /**
     * @type {LS.InputGroup}
     */
    inputGroup = null;

    /**
     * @type {LS.Modal}
     */
    modal = null;

    initialized = false;

    /**
     * @param {LS.Modal} modal
     */
    constructor(options = {}) {
        this.modal = LS.Modal.build({
            content: options.content || LS.Create("#preferences-modal", {
                inner: [
                    { tag: "button", class: "menu-button clear square", hidden: true, inner: [{ tag: "i", class: "bi-layout-sidebar" }] },
                    { class: "menu sidebar-items level-n1" }
                ]
            })
        }, {
            width: '1065px'
        });

        // Initialize settings when the modal is opened
        this.modal.once('open', () => {
            this.init();
        });
    }

    /**
     * Initialize the settings.
     */
    init() {
        if(this.initialized) return;
        this.initialized = true;

        // todo
        const container = this.modal.container;
        container.classList.add('preferences-modal');

        const modalElement = LS.SelectOrCreate("#preferences-modal", container);
        modalElement.style.display = 'flex';
        modalElement.querySelector(".menu-button").addEventListener('click', () => {
            // Menu view toggle
            container.classList.toggle("sidebar-menu-visible");
        });

        const menu = container.querySelector(".menu");

        // Tabs for the content
        this.tabs = new LS.Tabs(LS.Create(".sidebar-content"), {
            list: false,
            parent: modalElement,
            slideAnimation: true
        });

        // // Tabs for the sidebar
        // this.sidebarTabs = new LS.Tabs(LS.Create(".menu"), {
        //     list: false,
        //     parent: menu,
        //     slideAnimation: true
        // });

        let changes = {};

        // Inputgroup is the central abstraction for collecting inputs & updating them.
        this.inputGroup = new LS.InputGroup(null, null, {
            async fetchData() {
                // todo: unified user data source (this will later be extended in multiple ways).
                return app.userFragment;
            },

            // This is called when the input needs to refresh its value
            updateCallback(input, data) {
                if(input.userData) {
                    const path = input.userData.split(".");
                    return path.reduce((obj, key) => obj?.[key], data);
                }
            },

            changeCallback(input, isFinal, value) {
                if(!isFinal) return;
                
                const path = input.userData.split(".");

                // Build the nested object structure based on the path
                let current = changes;
                for(let i = 0; i < path.length - 1; i++) {
                    current[path[i]] = {};
                    current = current[path[i]];
                }
                current[path[path.length - 1]] = value;

                input.inputElement.disabled = true;
                input.inputElement.setAttribute("data-ls-state", "loading");

                userUpdate(changes).then(() => {
                    input.inputElement.setAttribute("data-ls-state", "success");
                    changes = {};
                }).catch((err) => {
                    console.error(err);
                    input.inputElement.setAttribute("data-ls-state", "error");
                    LS.Toast.show("Error updating settings: " + (err.message || err), { accent: "red" });
                }).finally(() => {
                    input.inputElement.disabled = false;
                });
            }
        });

        this.#setupSidebar();
        this.#setupTabContent();

        // Request the initial data for the input group to populate the inputs with current values
        this.inputGroup.updateData();

        // Tab change listener
        this.tabs.on("change", async (tabId) => {
            const buttons = menu.querySelectorAll("button");

            buttons.forEach(button => {
                if(button.getAttribute("data-tab-id") === tabId) {
                    button.classList.add("active");
                    button.classList.add("level-0");
                } else {
                    button.classList.remove("active");
                    button.classList.remove("level-0");
                }
            });
        });

        // Set the initial tab
        this.tabs.set("main", true);
    }

    /**
     * Sets up the sidebar.
     */
    #setupSidebar() {
        const menu = this.modal.container.querySelector(".menu");

        menu.addEventListener("click", (event) => {
            const button = event.target.closest("button");
            if(button) {
                const tabId = button.getAttribute("data-tab-id");
                if(tabId) {
                    this.tabs.set(tabId);
                }
            }
        });

        // ---- Sidebar buttons

        menu.appendChild(m_button_group([
            m_button("ph ph-house ", "Main", "main")
        ]));

        menu.appendChild(m_category("Projects", "settings.projects"));
        menu.appendChild(m_button_group([
            m_button("ph ph-folder-simple ", "Manage projects", "project")
        ]));

        menu.appendChild(m_category("Interface", "settings.interface"));
        menu.appendChild(m_button_group([
            m_button("ph ph-palette  ", "Appearance", "appearance"),
            m_button("ph ph-keyboard ", "Keyboard Shortcuts", "keyboard"),
            m_button("ph ph-layout   ", "Layout", "layout")
        ]));
    }

    /**
     * Sets up the content for each tab.
     */
    #setupTabContent() {
        this.tabs.add("main", LS.Create({
            inner: [
                { tag: "h2", inner: "Main Settings" },
                { tag: "p", inner: "Configure the main settings of the application." }
            ]
        }));

        const applyAll = () => { app.setTheme(app.theme) }

        app.globalEvents.on("theme-updated", () => {
            inputGroup.updateData();
        });

        const inputGroup = new LS.InputGroup(null, null, {
            fetchData() {
                return app.theme;
            },

            updateCallback(input, data) {
                if(input.userData) {
                    const path = input.userData.split(".");
                    return path.reduce((obj, key) => obj?.[key], data);
                }
            },

            changeCallback(input, isFinal, value) {
                if(!isFinal) return;
            }
        });

        const imageInput = LS.Create("input[type=file style=display:none accept=image/*]");

        imageInput.addEventListener('change', function() {
            let image = document.createElement("img");
            const url = URL.createObjectURL(this.files[0]);

            image.onload = function() {
                app.theme.colors.hue = LS.Color.fromImage(image).hsl[0];
                URL.revokeObjectURL(this.src);
                applyAll();
                // image = null;
            }

            image.src = url;
        });

        const themeList = LS.Create({
            inner: [
                createThemePreview({"version":1,"name":"Ocean","description":"Feel the breeze?","colors":{"scheme":"dark","hue":178,"sat":90,"blend":2.8,"step":0},"corners":1,"animationDuration":480,"roundedList":true,"ui":{"style":"flat","transparency":true,"compact":true}}),
                createThemePreview({"version":1,"name":"Heavy Workplace","colors":{"scheme":"dark","hue":55,"sat":100,"blend":0,"step":0,"increaseContrast":true,"contrast":1},"corners":1,"animationDuration":450,"roundedList":true,"ui":{"style":"flat"},"alwaysDetachTooltips":false}),
                createThemePreview({"version":1,name:"Vaporwave","colors":{"scheme":"dark","hue":167,"sat":80,"blend":7,"step":0.8,"increaseContrast":true,"contrast":1.5},"corners":1,"animationDuration":450,"roundedList":true,"ui":{"style":"flat","frost":false,"compact":true}}),
                createThemePreview({"version":1,"colors":{"scheme":"dark","hue":10,"sat":35,"blend":8,"step":0,"increaseContrast":false,"contrast":1.2},"corners":1,"animationDuration":450,"roundedList":true,"ui":{"style":"flat","frost":false,"compact":true},"name":"Easy on the eyes"}),
                createThemePreview({"version":1,"colors":{"scheme":"light","hue":322,"sat":20,"blend":4.5,"step":0,"increaseContrast":false,"contrast":1.5},"corners":1,"animationDuration":450,"roundedList":true,"ui":{"style":"flat","frost":false,"compact":true},"name":"Cozy Pink"}),
            ]
        });

        this.tabs.add("appearance", LS.Create({
            inner: [
                { tag: "h2", text: "Appearance", i18n: "settings.appearance.title" },
                { tag: "p", text: "Make it feel like home!", i18n: "settings.appearance.description" },

                LS.Create("br"),

                {
                    class: "appearance-settings",
                    inner: [
                        [
                            {
                                emmet: "button.compact",
                                inner: [{ emmet: "i.bi-floppy-fill", style: "font-size: small" }, { text: "Save", i18n: "settings.appearance.save" }],
                                onclick: async () => {
                                    const name = await LS.Modal.prompt("Enter the name for the theme you want to save:", app.theme.name);
                                    if(!name) {
                                        return LS.Toast.show("Theme was not saved.", { accent: "red" });
                                    }

                                    app.theme.name = name;

                                    const savedTheme = LS.Util.clone(app.theme);
                                    themeList.appendChild(createThemePreview(savedTheme));
                                }
                            },
                            " ",
                            {
                                emmet: "button.compact",
                                inner: [{ emmet: "i.bi-arrow-clockwise", style: "font-size: small" }, { text: "Reset", i18n: "settings.appearance.reset" }],
                                onclick: () => {
                                    app.setTheme(app.getDefaultTheme());
                                }
                            },
                            " ",
                            {
                                emmet: "button.elevated.compact",
                                inner: [{ emmet: "i.bi-share-fill", style: "font-size: small" }, { text: "Share", i18n: "settings.appearance.share" }],
                                onclick: async () => {
                                    LS.Util.copy(JSON.stringify(app.theme));
                                    return LS.Toast.show("Theme was copied to clipboard!");
                                }
                            },
                            " ",
                            {
                                emmet: "button.elevated.compact",
                                inner: [{ emmet: "i.bi-box-arrow-in-down", style: "font-size: small" }, { text: "Import", i18n: "settings.appearance.import" }],
                                onclick: async () => {
                                    let theme = null;

                                    try {
                                        theme = JSON.parse(await LS.Modal.prompt("Paste the theme JSON:"));
                                    } catch(e) {
                                        console.error(e);
                                    }

                                    if(typeof theme !== "object" || theme === null) return LS.Toast.show("Failed importing theme", { accent: "red" });

                                    // TODO: normalize theme to avoid garbage

                                    app.setTheme(theme);
                                    themeList.appendChild(createThemePreview(theme));
                                    return LS.Toast.show("Pasted theme was applied and saved!");
                                }
                            },
                            LS.Create("br"),
                            LS.Create("br"),

                            (() => {
                                const knob = inputGroup.create("knob", {
                                    min: 0,
                                    max: 360,
                                    value: app.theme.colors.hue,
                                    userData: "colors.hue",
                                    step: 1,
                                    defaultValue: 100,

                                    options: {
                                        label: "Hue",
                                        tooltip: "Hue of the accent color",
    
                                        frameTimed: true,
    
                                        mode: 2,
                                        style: {
                                            arcGap: [180, 540]
                                        },
    
                                        onInput: (value) => {
                                            app.theme.colors.hue = value;
                                            applyAll();
                                        }
                                    }
                                }).element;

                                // Sets the knob accent to the hue without being affected by the actual theme
                                knob.style.setProperty("--accent-60", "hsl(calc(attr(aria-valuenow type(<number>))) 100% 60%)");
                                knob.style.marginLeft = "0";
                                return knob;
                            })(),

                            inputGroup.create("knob", {
                                min: 0,
                                max: 100,
                                value: app.theme.colors.sat,
                                userData: "colors.sat",
                                step: 1,
                                defaultValue: 100,

                                options: {
                                    frameTimed: true,

                                    label: "Saturation",
                                    tooltip: "Intensity of the color",

                                    onInput: (value) => {
                                        app.theme.colors.sat = value;
                                        applyAll();
                                    }
                                }
                            }),

                            inputGroup.create("knob", {
                                min: 0,
                                max: 8,
                                value: app.theme.colors.blend,
                                userData: "colors.blend",
                                step: 0.1,
                                defaultValue: 1,

                                options: {
                                    frameTimed: true,

                                    label: "Blend",
                                    tooltip: "How much the accent blends in with the surface",

                                    onInput: (value) => {
                                        app.theme.colors.blend = value;
                                        applyAll();
                                    }
                                }
                            }),

                            inputGroup.create("knob", {
                                min: -0.5,
                                max: 0.5,
                                value: app.theme.colors.step,
                                userData: "colors.step",
                                step: 0.1,
                                defaultValue: 0,

                                options: {
                                    frameTimed: true,

                                    label: "Hue Step",
                                    tooltip: "Hue shift across color depth",

                                    onInput: (value) => {
                                        app.theme.colors.step = value * 2;
                                        applyAll();
                                    }
                                }
                            }).element,

                            inputGroup.create("knob", {
                                min: 1.0,
                                max: 1.6,
                                step: 0.1,
                                value: app.theme.colors.contrast || 1,
                                userData: "colors.contrast",
                                defaultValue: 1,

                                options: {
                                    frameTimed: true,

                                    label: "Contrast",
                                    tooltip: "Spreads lightness levels.<br><b>This is overriden by the \"Increase contrast\" option.</b><br>In most cases it is recommended to try that option<br>instead as it has better color distribution.",

                                    onInput: (value) => {
                                        app.theme.colors.contrast = value;
                                        if(!app.theme.colors.increaseContrast) {   
                                            LS.Color.contrast = value;
                                        }
                                    }
                                }
                            }).element,

                            LS.Create("br"),
                            LS.Create("br"),

                            {
                                emmet: "button.elevated.compact",
                                inner: [{ emmet: "i.bi-dice-5-fill", style: "font-size: small" }, "Random"],
                                onclick: () => {
                                    app.theme.colors.hue = Math.random() * 255;
                                    applyAll();
                                }
                            },

                            // " ",

                            // {
                            //     emmet: "button.elevated.compact",
                            //     inner: [{ emmet: "i.bi-eyedropper", style: "font-size: small" }, "Pick"],
                            //     onclick: () => {
                            //         app.theme.colors.hue = Math.random() * 255;
                            //         applyAll();
                            //     }
                            // },

                            " ",

                            imageInput,

                            {
                                emmet: "button.elevated.compact",
                                inner: [{ emmet: "i.bi-image", style: "font-size: small" }, "From image"],
                                onclick: () => { imageInput.click() }
                            },

                            LS.Create("br"),
                            LS.Create("br"),

                            {
                                tag: "label", class: "ls-switch", inner: [
                                    { tag: "input", type: "checkbox", checked: LS.Color.theme === "light", onchange: (e) => {
                                        app.theme.colors.scheme = LS.Color.theme = e.target.checked ? "light" : "dark";
                                    } },
                                    { tag: "span" },
                                    "Light theme"
                                ]
                            },

                            LS.Create("br"),
                            LS.Create("br"),

                            {
                                tooltip: "If you are having a hard time telling things apart,<br>this spreads lightness levels to improve visibility.<br>Overrides the contrast knob.<br><br>NOTE: This is in beta.",
                                tag: "label", class: "ls-switch", inner: [
                                    { tag: "input", type: "checkbox", checked: !!app.theme.colors.increaseContrast, onchange: (e) => {
                                        app.theme.colors.increaseContrast = e.target.checked;
                                        applyAll();
                                    } },
                                    { tag: "span" },
                                    "Increase contrast"
                                ]
                            },

                            // " ",

                            // {
                            //     emmet: "button.elevated.compact",
                            //     inner: [{ emmet: "i.bi-dice-5-fill", style: "font-size: small" }, "Random theme"],
                            //     onclick: () => {
                            //         app.theme.colors.hue = Math.random() * 255;
                            //         app.theme.colors.sat = Math.random() * 100;
                            //         app.theme.colors.blend = Math.random() * 8;
                            //         app.theme.colors.step = Math.random() * 1 - 0.5;
                            //         app.theme.corners = Math.random() * 1.5;
                            //         applyAll();
                            //     }
                            // },

                            LS.Create("br"),
                            LS.Create("br"),

                            new LS.Range({
                                min: 0,
                                max: 1.5,
                                value: app.theme.corners,
                                step: 0.5,

                                label: "Rounded Corners",
                                tooltip: true,

                                onInput: (value) => {
                                    document.body.style.setProperty('--border-radius-multiplier', value);
                                    app.theme.corners = value;
                                }
                            }),

                            LS.Create("br"),

                            // {
                            //     tag: "label", class: "ls-switch", inner: [
                            //         { tag: "input", type: "checkbox", checked: LS.Color.theme === "light", onchange: (e) => {
                            //             LS.Color.theme = e.target.checked ? "light" : "dark";
                            //         } },
                            //         { tag: "span" },
                            //         "Enable animations"
                            //     ]
                            // },

                            new LS.Range({
                                min: 0,
                                max: 600,
                                value: app.theme.animationDuration || LS.Animation.DEFAULT_DURATION,
                                step: 10,

                                label: "Animation Duration",
                                tooltip: true,

                                onInput: (value) => {
                                    app.theme.animationDuration = LS.Animation.DEFAULT_DURATION = value;
                                }
                            }),

                            LS.Create("br"),
                            LS.Create("h3{Experimental}"),
                            LS.Create("br"),

                            {
                                tag: "label", class: "ls-switch", tooltip: "Tooltips will follow the mouse position rather<br>than get attached to their target.", inner: [
                                    { tag: "input", type: "checkbox", checked: !!app.theme.alwaysDetachTooltips, onchange: (e) => {
                                        app.theme.alwaysDetachTooltips = e.target.checked;
                                        LS.Tooltips.alwaysDetached = e.target.checked;
                                    } },
                                    { tag: "span" },
                                    "Always detach tooltips"
                                ]
                            },

                            LS.Create("br"),
                            LS.Create("br"),

                            {
                                tag: "label", class: "ls-switch", tooltip: "Whether tooltips are animated. This is in beta.", inner: [
                                    { tag: "input", type: "checkbox", checked: !!app.theme.animatedTooltips, onchange: (e) => {
                                        app.theme.animatedTooltips = e.target.checked;
                                        LS.Tooltips.animationEnabled = e.target.checked;
                                    } },
                                    { tag: "span" },
                                    "Animate tooltips"
                                ]
                            },

                            LS.Create("br"),
                            LS.Create("br"),

                            {
                                tag: "label", class: "ls-switch", tooltip: "Some menus will use an transparency + blur effect.<br><b>This can affect performance.</b>", inner: [
                                    { tag: "input", type: "checkbox", checked: !!app.theme.ui.frost, onchange: (e) => {
                                        app.theme.ui.frost = e.target.checked;
                                        applyAll();
                                    } },
                                    { tag: "span" },
                                    "Frost effect"
                                ]
                            },

                            LS.Create("br"),
                            LS.Create("br"),

                            {
                                tag: "label", class: "ls-switch", tooltip: "Items in tree/lists will show with margin and round corners.", inner: [
                                    { tag: "input", type: "checkbox", checked: app.theme.ui.roundedList !== false, onchange: (e) => {
                                        app.theme.ui.roundedList = e.target.checked;
                                        applyAll();
                                    } },
                                    { tag: "span" },
                                    "Rounded list view"
                                ]
                            },

                            LS.Create("br"),
                            LS.Create("br"),

                            {
                                tooltip: "Change the style of LS UI elements (beta)",
                                tag: "label",
                                inner: [
                                    "UI Style",
                                    LS.Create("br"),
                                    LS.Create('ls-select.margin-top-small', {
                                        onchange: (e) => {
                                            app.theme.ui.style = e.target.value;
                                            console.log(e.target.value);
                                            applyAll();
                                        },

                                        options: [
                                            { label: "Flat", value: "flat" },
                                            { label: "Shiny (beta)", value: "shiny" },
                                        ]
                                    }),
                                ]
                            },

                            LS.Create("br"),
                            LS.Create("br"),
                            LS.Create("hr"),

                            {
                                html: `
                <h4 style="margin-bottom: 0">Color palette</h4>
                <ls-div class="pallete-chip-container">
                    <div class="pallete-chip" style="background: var(--accent-10);"></div>
                    <div class="pallete-chip" style="background: var(--accent-20);"></div>
                    <div class="pallete-chip" style="background: var(--accent-30);"></div>
                    <div class="pallete-chip" style="background: var(--accent-35);"></div>
                    <div class="pallete-chip" style="background: var(--accent-40);"></div>
                    <div class="pallete-chip" style="background: var(--accent-45);"></div>
                    <div class="pallete-chip" style="background: var(--accent-50);"></div>
                    <div class="pallete-chip" style="background: var(--accent-55);"></div>
                    <div class="pallete-chip" style="background: var(--accent-60);"></div>
                    <div class="pallete-chip" style="background: var(--accent-70);"></div>
                    <div class="pallete-chip" style="background: var(--accent-80);"></div>
                    <div class="pallete-chip" style="background: var(--accent-90);"></div>
                    <div class="pallete-chip" style="background: var(--accent-95);"></div>
                </ls-div>

                <h4 style="margin-bottom: 0">Surface colors</h4>
                <ls-div class="pallete-chip-container">
                    <div class="pallete-chip" style="background: var(--base-0);"></div>
                    <div class="pallete-chip" style="background: var(--base-6);"></div>
                    <div class="pallete-chip" style="background: var(--base-8);"></div>
                    <div class="pallete-chip" style="background: var(--base-10);"></div>
                    <div class="pallete-chip" style="background: var(--base-15);"></div>
                    <div class="pallete-chip" style="background: var(--base-20);"></div>
                    <div class="pallete-chip" style="background: var(--base-25);"></div>
                    <div class="pallete-chip" style="background: var(--base-30);"></div>
                    <div class="pallete-chip" style="background: var(--base-35);"></div>
                    <div class="pallete-chip" style="background: var(--base-40);"></div>
                    <div class="pallete-chip" style="background: var(--base-45);"></div>
                    <div class="pallete-chip" style="background: var(--base-50);"></div>
                    <div class="pallete-chip" style="background: var(--base-55);"></div>
                    <div class="pallete-chip" style="background: var(--base-60);"></div>
                    <div class="pallete-chip" style="background: var(--base-65);"></div>
                    <div class="pallete-chip" style="background: var(--base-70);"></div>
                    <div class="pallete-chip" style="background: var(--base-75);"></div>
                    <div class="pallete-chip" style="background: var(--base-80);"></div>
                    <div class="pallete-chip" style="background: var(--base-85);"></div>
                    <div class="pallete-chip" style="background: var(--base-90);"></div>
                    <div class="pallete-chip" style="background: var(--base-95);"></div>
                    <div class="pallete-chip" style="background: var(--base-98);"></div>
                    <div class="pallete-chip" style="background: var(--base-100);"></div>
                </ls-div>

                <h4 style="margin-bottom: 0">Tint colors</h4>
                <ls-div class="pallete-chip-container">
                    <div class="pallete-chip" style="background: var(--accent-mix-10);"></div>
                    <div class="pallete-chip" style="background: var(--accent-mix-20);"></div>
                    <div class="pallete-chip" style="background: var(--accent-mix-40);"></div>
                    <div class="pallete-chip" style="background: var(--accent-mix-60);"></div>
                    <div class="pallete-chip" style="background: var(--accent-mix-80);"></div>
                </ls-div>

                <h4 style="margin-bottom: 0">Theme colors</h4>
                <ls-div class="pallete-chip-container">
                    <div class="pallete-chip" style="background: var(--surface-n3);"></div>
                    <div class="pallete-chip" style="background: var(--surface-n2);"></div>
                    <div class="pallete-chip" style="background: var(--surface-n1);"></div>
                    <div class="pallete-chip" style="background: var(--surface-0);"></div>
                    <div class="pallete-chip" style="background: var(--surface-1);"></div>
                    <div class="pallete-chip" style="background: var(--surface-2);"></div>
                    <div class="pallete-chip" style="background: var(--surface-3);"></div>
                    <div class="pallete-chip" style="background: var(--surface-4);"></div>
                    <div class="pallete-chip" style="background: var(--surface-5);"></div>
                    <div class="pallete-chip" style="background: var(--surface-6);"></div>
                    <div class="pallete-chip" style="background: var(--surface-7);"></div>
                    <div class="pallete-chip" style="background: var(--surface-8);"></div>
                    <div class="pallete-chip" style="background: var(--surface-9);"></div>
                    <div class="pallete-chip" style="background: var(--surface-10);"></div>
                </ls-div><br><br><br>`
                            }
                        ],

                        themeList
                    ]
                }
            ]
        }));

        this.tabs.add("keyboard", LS.Create({
            inner: [
                // { tag: "h2", inner: "Keyboard Shortcuts" },
                // { tag: "p", inner: "Configure your keyboard shortcuts here." },
                { tag: "table", inner:
                    [
                        { tag: "thead", inner: [
                            { tag: "tr", inner: [
                                { tag: "th", inner: "Action" },
                                { tag: "th", inner: "Shortcut" }
                            ]}
                        ]},
                        { tag: "tbody", inner: [
                            ...app.shortcutManager.mappings.keys().map(mapping => {
                                let shortcuts = [...app.shortcutManager.shortcuts].filter(s => s[1].handler === mapping).map(s => s[0]);
                                if(!Array.isArray(shortcuts)) {
                                    shortcuts = [shortcuts];
                                }
                
                                // todo
                                return { tag: "tr", class: "shortcut-entry", inner: [
                                    { tag: "td", class: "shortcut-label", inner: mapping },
                                    { tag: "td", class: "shortcut-keys", inner: shortcuts.map(shortcut => {
                                        return { tag: "kbd", class: "shortcut-key", inner: shortcut };
                                    }) }
                                ]};
                            })]
                        }
                    ]
                },
                { tag: "br" },
                { tag: "br" }, // margin is not working for some reason
            ]
        }));

        this.tabs.add("layout", LS.Create({}));
    }
}

/*
 * ---- Helper functions
 */

function m_category(title, i18n) {
    const el = LS.Create("span.menu-category-title", {
        i18n,
        text: title
    });
    return el;
}

function m_button(icon, label, tabId) {
    const button = LS.Create("button.surface", {
        inner: [{ emmet: `i.${icon.trim().replaceAll(" ", ".")}` }, { tag: "span", text: label, i18n: "settings." + tabId + ".title" }]
    });

    button.setAttribute("data-tab-id", tabId);
    return button;
}

function m_button_group(buttons) {
    const group = document.createElement("div");
    group.className = "grouped-buttons";
    buttons.forEach(button => {
        group.appendChild(button);
    });
    return group;
}

/**
 * @type {Settings}
 */
let settings;

function openPage(tabId) {
    settings.init();
    settings.tabs.set(tabId);
    settings.modal.open();
}

function createModal(options) {
    if(settings) {
        return settings;
    }

    return (settings = new Settings(options));
}

export { openPage, createModal };