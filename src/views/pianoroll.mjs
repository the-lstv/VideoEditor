import PianoRoll from "../components/audio/pianoroll.js";

/**
 * Piano roll view class (as a standalone view)
 * Normally it can be integrated into a timeline view to save resources
 * @experimental
 */
export default class PianoRollView extends LS.View {
    static name = "PianoRollView";

    constructor(options = {}) {
        super({
            name: "PianoRollView",
            title: "Piano Roll",
            container: LS.Create()
        });

        this.pianoRoll = new PianoRoll({
            container: this.container,
            ...options
        });
    }

    setNotes(notes) {
        this.pianoRoll.setNotes(notes);
    }

    destroy() {
        if (this.destroyed) return;
        this.pianoRoll.destroy();
        this.pianoRoll = null;
        super.destroy();
    }
}