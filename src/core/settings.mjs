/**
 * Work in progress!
 * TODO: Requires a lot of refactoration
 */

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
                    button.classList.add("level-1");
                } else {
                    button.classList.remove("active");
                    button.classList.remove("level-1");
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

        menu.appendChild(m_category("Projects"));
        menu.appendChild(m_button_group([
            m_button("ph ph-folder-simple ", "Manage projects", "project")
        ]));

        menu.appendChild(m_category("Interface"));
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

        const customHSL = [100, 100, 50, 0, 1];

        const setCustom = () => {
            LS.Color.update("custom", LS.Color.fromHSL(customHSL[0], customHSL[1], customHSL[2]), null, null, { hueShift: customHSL[3], saturationBoost: customHSL[4] });
            LS.Color.setAccent("custom");
        }

        this.tabs.add("appearance", LS.Create({
            inner: [
                { tag: "h2", inner: "Appearance" },
                { tag: "p", inner: "Make it feel like home!" },

                {
                    tag: "label", class: "ls-switch", inner: [
                        { tag: "input", type: "checkbox", checked: LS.Color.theme === "light", onchange: (e) => {
                            LS.Color.theme = e.target.checked ? "light" : "dark";
                        } },
                        { tag: "span" },
                        "Light theme"
                    ]
                },

                LS.Create("br"),
                LS.Create("br"),

                (() => {
                    const knob = new LS.Knob({
                        min: 0,
                        max: 360,
                        value: 100,
                        step: 1,
                        defaultValue: 100,

                        label: "Hue",
                        tooltip: "Hue of the accent color",

                        frameTimed: true,

                        mode: 2,
                        style: {
                            arcGap: [180, 540]
                        },

                        onInput: (value) => {
                            customHSL[0] = value;
                            setCustom();
                        }
                    }).element;

                    // Sets the knob accent to the hue without being affected by the actual theme
                    knob.style.setProperty("--accent-60", "hsl(calc(attr(aria-valuenow type(<number>))) 100% 60%)");
                    return knob;
                })(),

                new LS.Knob({
                    min: 0,
                    max: 100,
                    value: 100,
                    step: 1,
                    defaultValue: 100,

                    frameTimed: true,

                    label: "Saturation",
                    tooltip: "Intensity of the color",

                    onInput: (value) => {
                        customHSL[1] = value;
                        setCustom();
                    }
                }),

                new LS.Knob({
                    min: 0,
                    max: 8,
                    value: 1,
                    step: 0.1,
                    defaultValue: 1,

                    frameTimed: true,

                    label: "Blend",
                    tooltip: "How much the accent blends in with the surface",

                    onInput: (value) => {
                        customHSL[4] = value;
                        setCustom();
                    }
                }),

                new LS.Knob({
                    min: -0.5,
                    max: 0.5,
                    value: 0,
                    step: 0.1,
                    defaultValue: 0,

                    frameTimed: true,

                    label: "Hue Step",
                    tooltip: "Hue shift across color depth",

                    onInput: (value) => {
                        customHSL[3] = value * 2;
                        setCustom();
                    }
                }).element,

                LS.Create("br"),
                LS.Create("br"),

                new LS.Range({
                    min: 0,
                    max: 1.0,
                    value: 1,
                    step: 0.5,

                    label: "Rounded Corners",
                    tooltip: true,

                    onInput: (value) => {
                        document.body.style.setProperty('--border-radius-multiplier', value);
                    }
                }),

                LS.Create("br"),

                {
                    tag: "label", class: "ls-switch", inner: [
                        { tag: "input", type: "checkbox", checked: LS.Color.theme === "light", onchange: (e) => {
                            LS.Color.theme = e.target.checked ? "light" : "dark";
                        } },
                        { tag: "span" },
                        "Enable animations"
                    ]
                },

                new LS.Range({
                    min: 0,
                    max: 600,
                    value: LS.Animation.DEFAULT_DURATION,
                    step: 10,

                    label: "Animation Duration",
                    tooltip: true,

                    onInput: (value) => {
                        LS.Animation.DEFAULT_DURATION = value;
                    }
                }),

                // {
                //     tag: "label", class: "ls-switch", inner: [
                //         { tag: "input", type: "checkbox", checked: LS.Tooltips.animationEnabled, onchange: (e) => {
                //             LS.Tooltips.animationEnabled = e.target.checked;
                //         } },
                //         { tag: "span" },
                //         "Animate tooltips"
                //     ]
                // },

                {
                    html: `
    <h4 style="margin-bottom: 0">Color palette</h4>
    <ls-div style="display: flex">
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
    <ls-div style="display: flex">
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
    <ls-div style="display: flex;">
        <div class="pallete-chip" style="background: var(--accent-mix-10);"></div>
        <div class="pallete-chip" style="background: var(--accent-mix-20);"></div>
        <div class="pallete-chip" style="background: var(--accent-mix-40);"></div>
        <div class="pallete-chip" style="background: var(--accent-mix-60);"></div>
        <div class="pallete-chip" style="background: var(--accent-mix-80);"></div>
    </ls-div>

    <h4 style="margin-bottom: 0">Theme colors</h4>
    <ls-div style="display: flex;">
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
    </ls-div>`
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

function m_category(title) {
    const el = document.createElement("span");
    el.className = "menu-category-title";
    el.textContent = title;
    return el;
}

function m_button(icon, label, tabId) {
    const button = document.createElement("button");
    button.className = "elevated";
    button.innerHTML = `<i class="${icon}"></i><span>${label}</span>`;
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