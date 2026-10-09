/**
 * Slides list
 */
class SlidesView extends LS.View {
    static name = "slidesList";

    constructor() {
        super({
            name: 'SlidesView',
            title: 'Slides',
            container: LS.Create({
                class: 'slides',
                inner: [
                    {
                        class: "slides-header controls-bar",
                        inner: [
                            { tag: "button", class: "control-button square clear", inner: { tag: "i", class: "bi-plus" }, onclick: () => {
                                if(!this.target) return;
                                this.addTab();
                            } },
                        ]
                    },
                    { class: 'slides-list' },
                ]
            })
        });

        this.target = null;
        this.tabsList = this.container.querySelector('.slides-list');

        this.tabChangeHandler = this.#tabChangeHandler.bind(this);
    }

    setTarget(presentation) {
        if(this.target) {
            this.target.tabs.off("change", this.tabChangeHandler);
        }

        this.target = presentation;
        this.render();

        if(this.target) {
            this.target.tabs.on("change", this.tabChangeHandler);
        }
    }

    #tabChangeHandler(newId, oldId) {
        this.container.querySelectorAll("[data-id]").forEach(el => {
            if(el.dataset.id === newId) {
                el.classList.add("active");
            } else {
                el.classList.remove("active");
            }
        });
    }

    addTab() {
        if(!this.target) return;

        const newSlide = this.target.tabs.add({ title: "New Slide" });

        if(!newSlide) return LS.Toast.show("Failed adding a new slide");

        this.render();
        this.target.tabs.set(newSlide);

        // Scroll to the new slide
        const newSlideEl = this.tabsList.querySelector(`[data-id="${newSlide}"]`);
        if(newSlideEl) {
            newSlideEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
        }
    }
    
    render() {
        this.tabsList.replaceChildren();
        if(!this.target) return;

        for(const id of this.target.tabs.order) {
            const slide = this.target.tabs.tabs.get(id);

            LS.Create({
                tag: 'div',
                class: 'slide-item' + (this.target.tabs.activeTab === id ? " active" : ""),
                parent: this.tabsList,
                inner: slide.title,

                attributes: { "data-id": id },

                onclick: () => {
                    this.target.tabs.set(id);
                }
            });
        }
    }

    destroy() {
        this.setTarget(null);
    }
}

export default SlidesView;