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
                class: 'slides-list'
            })
        });
    }
}

export default SlidesView;