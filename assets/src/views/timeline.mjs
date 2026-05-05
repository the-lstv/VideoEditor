/**
 * Timeline view class
 * @see LS.Timeline for the timeline implementation itself
 */
class TimelineView extends LS.Multipane.View {
    static name = "timeline";

    constructor() {
        super({
            name: 'TimelineView',
            title: 'Timeline',
            container: LS.Create({
                class: 'editor-timeline',
                inner: [
                    {
                        class: 'timeline-header controls-bar',
                        inner: [
                            [
                                { tag: "button", class: "control-button square clear", inner: { tag: "i", class: "bi-plus-lg" }, tooltip: "Add track", onclick: () => {
                                    this.timeline.addTrack();
                                } },

                                { emmet: "hr.vertical" },

                                { tag: "button", class: "control-button tool-button tool-select square", inner: { tag: "i", class: "bi-cursor" }, tooltip: "Select tool <kbd>V</kbd>", onclick: () => {
                                    this.timeline.tool = "select";
                                } },

                                { tag: "button", class: "control-button tool-button tool-slice square clear", inner: { tag: "i", class: "bi-scissors" }, tooltip: "Slicing tool <kbd>C</kbd><br>Or <kbd>Alt</kbd> while dragging", onclick: () => {
                                    this.timeline.tool = "slice";
                                } },

                                { tag: "button", class: "control-button tool-button tool-preview square clear", inner: { tag: "i", class: "bi-eye-fill" }, tooltip: "Preview tool <kbd>P</kbd><br>Or <kbd>Alt</kbd> + right-click", onclick: () => {
                                    this.timeline.tool = "preview";
                                } },

                                { tag: "button", class: "control-button tool-button tool-group square clear", inner: { tag: "i", class: "bi-collection" }, tooltip: "Group tool <kbd>G</kbd><br>Or <kbd>Ctrl+G</kbd>", onclick: () => {
                                    this.timeline.tool = "group";
                                } },

                                { tag: "button", class: "control-button tool-button tool-erase square clear", inner: { tag: "i", class: "bi-eraser" }, tooltip: "Erase tool <kbd>E</kbd><br>Or <kbd>Right Mouse + Drag</kbd>", onclick: () => {
                                    this.timeline.tool = "erase";
                                } },

                                { emmet: "hr.vertical" },

                                { tag: "button", class: "control-button square clear", inner: { tag: "i", class: "bi-question" }, tooltip: "Help & Tips", onclick: () => {
                                    LS.Modal.buildEphemeral({
                                        title: "Timeline controls help",
                                        content: [
                                            // { tag: "p", style: "margin-top: 0", html: "You can customize these controls, either directly here or in the settings!" },
                                            { tag: "h3", inner: "Basics:" },
                                            { tag: "ul", style: "padding-left: 20px", inner: [
                                                { tag: "li", inner: ["To add items, drag them from the media library onto the timeline."] },
                                                { tag: "li", inner: ["To move items, drag them within the timeline or use Shift + Arrow keys."] },
                                                { tag: "li", inner: ["When moving items, they are by default snapped to a grid (which is customizable in the settings). You can hold ", { tag: "code", inner: "Alt" }, " to enable free movement, or ", { tag: "code", inner: "Shift" }, " to snap to one second."] },
                                                { tag: "li", inner: ["Click an item to select it."] },
                                                { tag: "li", inner: ["Hold Ctrl to select multiple items."] },
                                                { tag: "li", inner: ["To quickly copy items, you can hold ", { tag: "code", inner: "Shift" }, " while dragging."] },
                                                { tag: "li", inner: ["To repeat items, press ", { tag: "code", inner: "Ctrl + B" }, " on a selected item."] },
                                            ] },
                                            { tag: "h3", inner: "Navigation:" },
                                            { tag: "ul", style: "padding-left: 20px", inner: [
                                                { tag: "li", inner: ["Panning: ",  { tag: "code", inner: "Middle Mouse + Drag" } ] },
                                                { tag: "li", inner: ["Horizontal Scrolling: ",  { tag: "code", inner: "Shift + Mouse Wheel" } ] },
                                                { tag: "li", inner: ["Vertical Scrolling: ",  { tag: "code", inner: "Mouse Wheel" } ] },
                                                { tag: "li", inner: ["Horizontal zooming: ",  { tag: "code", inner: "Ctrl + Mouse Wheel" } ] },
                                                { tag: "li", inner: ["Vertical zooming: ",  { tag: "code", inner: "Alt + Mouse Wheel" }, "or", { tag: "code", inner: "Ctrl + Mouse Drag" } ] },
                                                { tag: "li", inner: ["Selecting clips: ",  { tag: "code", inner: "Ctrl + Click + Drag" } ] },
                                                { tag: "li", inner: ["Jump to start/end: ",  { tag: "code", inner: "Home / End" } ] },
                                                { tag: "li", inner: ["Next/previous frame: ",  { tag: "code", inner: "Shift + Arrows" } ] },
                                            ] },
                                            { tag: "h3", inner: "Tools:" },
                                            { tag: "ul", style: "padding-left: 20px", inner: [
                                                { tag: "li", inner: ["Select tool: ",  { tag: "code", inner: "V" } ] },
                                                { tag: "li", inner: ["Slice tool: ",  { tag: "code", inner: "C" }, ", or hold Alt" ] },
                                                { tag: "li", inner: ["The slice tool splits clips by default. If you want to cut something (remove the small piece), use right click." ] },
                                                { tag: "li", inner: ["Preview tool: ",  { tag: "code", inner: "P" }, ", or hold Alt+Right Click" ] },
                                                { tag: "li", inner: ["Group tool: ",  { tag: "code", inner: "G" }, ", or Ctrl+G on selected items" ] },
                                                { tag: "li", inner: ["Erase tool: ",  { tag: "code", inner: "E" }, ", or drag with right mouse button" ] },
                                            ] },
                                        ],
                                        buttons: [{ label: "Close" }]
                                    });
                                } },

                                // { tag: "ls-select", tooltip: "Select timeline", onchange: (e) => {
                                //     const selectedTrack = e.target.value;
                                //     this.timeline.selectTrack(selectedTrack);
                                // } }
                            ],

                            [
                                { tag: "button", class: "control-button square clear", inner: { tag: "i", class: "bi-zoom-in" }, tooltip: "Zoom in <kbd>+</kbd>", onclick: () => {
                                    this.timeline.zoomIn();
                                } },
                                { tag: "button", class: "control-button square clear", inner: { tag: "i", class: "bi-zoom-out" }, tooltip: "Zoom out <kbd>-</kbd>", onclick: () => {
                                    this.timeline.zoomOut();
                                } }
                            ]
                        ]
                    }
                ]
            })
        });

        this.timeline = new LS.Timeline({
            element: this.container,
            allowAutomationClips: true,
            autoCreateAutomationClips: true,
        });

        const seekEventRef = this.prepareEvent("seek");
        this.timeline.on('seek', time => {
            this.quickEmit(seekEventRef, time);
        });

        const buttons = this.container.querySelectorAll(".tool-button");
        this.timeline.on('tool-changed', tool => {
            buttons.forEach(btn => {
                if(btn.classList.contains(`tool-${tool}`)) {
                    btn.classList.remove("clear");
                } else {
                    btn.classList.add("clear");
                }
            });
        });
    }

    setData(data) {
        this.timeline.reset(true, data);
    }

    destroy() {
        this.timeline.destroy();
        this.timeline = null;
        super.destroy();
    }
}

export default TimelineView;