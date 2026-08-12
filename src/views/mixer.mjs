/**
 * Channel mixer view.
 * It attaches to a patcher, and displays a mixer interface for found channel nodes.
 */
class MixerView extends LS.View {
    constructor() {
        super({
            name: "MixerView",
            title: "Mixer"
        });

        this.container.classList.add("mixer-view");

        this.container.appendChild(MixerView.buildChannel({
            label: "Master",
            id: "output.master"
        }, "M"));
    }

    static buildChannel(data, index) {
        return LS.Create({
            class: "mixer-channel",
            attributes: {
                "data-channel-index": index
            },
            inner: [
                { class: "channel-header", inner: [
                    { class: "channel-label", text: data.label || data.id || `Channel ${index + 1}` },
                    { class: "channel-mute-button", title: "Mute channel" },
                    { class: "channel-solo-button", title: "Solo channel" }
                ]},
                new LS.Range({
                    min: 0,
                    max: 125,
                    value: 100,
                    step: 1,
                    defaultValue: 100,

                    vertical: true,
                    tooltip: true
                })
            ]
        });
    }

    connect(patcher) {
        
    }
}

export default MixerView;