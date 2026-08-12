/**
 * Work in progress, settings for the editor.
 */

let tabs, modal;

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

function createModal(settingsContent) {
    modal = LS.Modal.build({
        content: settingsContent
    }, {
        width: '960px'
    });

    modal.once('open', () => {
        setup();
    });

    return modal;
}

function openPage(tabId) {
    modal.open();
    tabs.set(tabId);
}

function setup() {
    const container = modal.container;
    const modalElement = container.querySelector("#preferences-modal");
    const menu = container.querySelector(".menu");

    const content = document.createElement("div");
    content.className = "sidebar-content";

    tabs = new LS.Tabs(content, {
        list: false,
        parent: modalElement,
        slideAnimation: true
    });

    tabs.add("main", LS.Create({
        inner: [
            { tag: "h2", inner: "General" },
            { tag: "p", inner: "Adjust the general settings for the application." },
        ]
    }));

    tabs.add("keyboard", LS.Create({
        inner: [
            { tag: "h2", inner: "Keyboard Shortcuts" },
            { tag: "p", inner: "Configure your keyboard shortcuts here." },
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
            
                            return { tag: "tr", class: "shortcut-entry", inner: [
                                { tag: "td", class: "shortcut-label", inner: mapping },
                                { tag: "td", class: "shortcut-keys", inner: shortcuts.map(shortcut => {
                                    return { tag: "kbd", class: "shortcut-key", inner: shortcut };
                                }) }
                            ]};
                        })]
                    }
                ]
            }

        ]
    }));

    const customHSL = [100, 100, 50, 0, 1];

    const setCustom = () => {
        LS.Color.update("custom", LS.Color.fromHSL(customHSL[0], customHSL[1], customHSL[2]), null, null, { hueShift: customHSL[3], saturationBoost: customHSL[4] });
        LS.Color.setAccent("custom");
    }

    tabs.add("appearance", LS.Create({
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

    tabs.add("layout", LS.Create({
        inner: [
            { tag: "h2", inner: "Layout" },
            { tag: "p", inner: "Adjust the layout settings." },
        ]
    }));

    tabs.add("about", LS.Create({
        inner: [
            { tag: "h2", inner: "About" },
            { tag: "p", inner: "Information about the application." }
        ]
    }));

    modalElement.querySelector(".menu-button").addEventListener('click', () => {
        container.classList.toggle("sidebar-menu-visible");
    });

    modalElement.style.display = 'flex';
    container.classList.add('preferences-modal');

    menu.appendChild(m_button_group([
        m_button("bi-house-fill", "Main", "main")
    ]));

    menu.appendChild(m_category("Interface"));
    menu.appendChild(m_button_group([
        m_button("bi-palette-fill", "Appearance", "appearance"),
        m_button("bi-keyboard-fill", "Keyboard Shortcuts", "keyboard"),
        m_button("bi-layout-text-sidebar-reverse", "Layout", "layout")
    ]));

    menu.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if(button) {
            const tabId = button.getAttribute("data-tab-id");
            if(tabId) {
                tabs.set(tabId);
            }
        }
    });

    tabs.on("change", (tabId) => {
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

    tabs.set("main", true);
}

export { openPage, createModal };