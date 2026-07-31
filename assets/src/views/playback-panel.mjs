export default class PlaybackPanel extends LS.View {
    static name = "PlaybackPanelView";

    constructor() {
        super({
            name: "PlaybackPanelView",
            title: "Playback Panel",
            container: LS.Create({
                class: "playback-panel"
            })
        });

        this.seeker = new LS.Range({
            max: 0,
            value: 0,
        });

        this.masterGainKnob = new LS.Knob({
            min: 0,
            max: 125,
            value: 100,
            step: 1,
            defaultValue: 100,

            label: "Master volume",

            onChange: (value) => {
                if (this.onMasterGainChange) this.onMasterGainChange(value);
            }
        });

        this.tempoKnob = new LS.Knob({
            min: 1,
            max: 9999, // tempo go brrr
            value: 140,
            defaultValue: 140,
            step: 1,

            preset: "numeric",

            label: "Tempo",

            onChange: (value) => {
                if (this.onTempoChange) this.onTempoChange(value);
            }
        });

        this.__playButton = null;

        LS.Util.resolveElements([
            [
                {
                    class: "playback-panel-header",
                    inner: [this.masterGainKnob.element, this.tempoKnob.element]
                },
            ],

            [
                { class: "preview-controls controls-bar", inner: [
                    [
                        (this.__playButton = LS.Create("button", {
                            class: "control-button square clear",
                            inner: { tag: "i", class: "bi-play-fill" },
                            tooltip: "Play/Pause <kbd>Space</kbd>",
                            onclick: () => this.togglePlay()
                        })),
    
                        {
                            tag: "button",
                            class: "control-button square clear",
                            inner: { tag: "i", class: "bi-stop-fill" },
                            tooltip: "Stop",
                            onclick: () => {
                                this.seek(0, true);
                                this.setPlaying(false);
                            }
                        }
                    ],
    
                    [
                        { tag: "span", class: "preview-time-current", inner: "0:00", style: { color: "var(--accent)" } },
                        { tag: "span", inner: "/" },
                        { tag: "span", class: "preview-time-total", inner: "0:00" }
                    ]
                ] },
                {
                    class: "preview-seeker",
                    inner: this.seeker.element
                },
            ],
        ], this.container);

        const previewTimeCurrent = this.container.querySelector(".preview-time-current");
        const previewTimeTotal = this.container.querySelector(".preview-time-total");

        this.details = {
            time: 0,
            totalTime: 0,
            playing: false
        };

        this.frameScheduler = new LS.Util.FrameScheduler((delta) => {
            previewTimeCurrent.textContent = this.#formatTime(this.details.time, true);
            previewTimeTotal.textContent = this.#formatTime(this.details.totalTime);
            this.seeker.value = this.details.time;
            this.seeker.max = this.details.totalTime;
            if(this.__playButton) this.__playButton.querySelector("i").className = this.details.playing? "bi-pause-fill": "bi-play-fill";
        });

        let originalPlaying = false;
        this.seeker.on("start", (value) => {
            originalPlaying = this.details.playing;
            this.setPlaying(false);
        });
        
        this.seeker.on("input", (value) => {
            this.seek(value);
        });

        // On end
        this.seeker.on("change", (value) => {
            this.seek(value);
            this.setPlaying(originalPlaying);
        });

        // We limit to 30 FPS to reduce CPU/GPU usage
        // Since this is not a high priority update
        this.frameScheduler.limitFPS(60);
    }
    
    onAttached(project) {
        const attachment = this.attachedTo || this.parent;
        if(!attachment) {
            console.error("PlaybackPanel: cannot attach to renderer without an attachment or parent project");
            return;
        }
    
        this.addExternalEventListener(attachment, 'seek', (time) => this.#updateSeek(time));
        this.addExternalEventListener(attachment, 'duration-changed', (duration) => this.#updateDuration(duration));
        this.addExternalEventListener(attachment, 'playing-changed', (playing) => this.#updatePlay(playing));
    }

    #formatTime(ms, decisecond = false) {
        if(isNaN(ms) || !isFinite(ms)) return "0:00";
        
        const totalSeconds = Math.floor(ms / 1000);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        let timeString = mins + ":" + (secs < 10 ? "0" : "") + secs;

        if(decisecond) {
            const ds = Math.floor((ms - totalSeconds * 1000) / 100);
            timeString += "." + ds;
        }

        return timeString;
    }

    seek(time, moveCamera = false) {
        if(time === -1) time = this.details.totalTime;
        const attachment = this.attachedTo || this.parent;
        attachment?.seek(time, moveCamera);
    }

    #updatePlay(playing) {
        if(playing === this.details.playing) return;
        this.details.playing = playing;
        this.frameScheduler.schedule();
    }

    #updateSeek(time) {
        if(time === this.details.time) return;
        this.details.time = time;
        this.frameScheduler.schedule();
    }

    #updateDuration(totalTime) {
        if(totalTime === this.details.totalTime) return;
        this.details.totalTime = totalTime;
        this.frameScheduler.schedule();
    }

    togglePlay() {
        const attachment = this.attachedTo || this.parent;
        if(attachment) {
            attachment.playing = !attachment.playing;
        }
    }

    setPlaying(playing) {
        const attachment = this.attachedTo || this.parent;
        if(attachment) {
            attachment.playing = playing;
        }
    }


    destroy() {
        this.frameScheduler.destroy();
        this.frameScheduler = null;
        this.seeker.destroy();
        this.seeker = null;

        super.destroy();
    }
}