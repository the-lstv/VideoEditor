function generateRandomNodes(count, dispersity) {
    if(!dispersity) dispersity = count / 100;

    const nodes = [];
    for(let i = 0; i < count; i++){
        nodes.push({
            label: `Node ${i}`,
            icon: "acorn",
            x: Math.random() * (800 * dispersity) - (400 * dispersity),
            y: Math.random() * (800 * dispersity) - (400 * dispersity),
            inputs: [{ id: "In 1" }, { id: "In 2" }],
            outputs: [{ id: "Out 1" }, { id: "Out 2" }],
            id: `node-${i}`
        });
    }
    return nodes;
}

function generateRandomConnections(nodes, connectionCount) {
    const connections = [];
    for(let i = 0; i < connectionCount; i++){
        const fromNode = nodes[Math.floor(Math.random() * nodes.length)];
        const toNode = nodes[Math.floor(Math.random() * nodes.length)];
        if(fromNode && toNode && fromNode !== toNode){
            connections.push({
                sourceNodeId: fromNode.id,
                sourcePortId: fromNode.outputs[Math.floor(Math.random() * fromNode.outputs.length)].id,
                targetNodeId: toNode.id,
                targetPortId: toNode.inputs[Math.floor(Math.random() * toNode.inputs.length)].id
            });
        }
    }
    return connections;
}

const nodeBank = [
    {
        kind: "Gain",
        label: "Gain",
        description: "Gain node.",
        icon: "sliders-horizontal",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        accent: "orange",
        category: "Core"
    },

    {
        kind: "Filter",
        label: "Filter",
        description: "Filter node.",
        icon: "funnel",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        accent: "aquamarine",
        category: "Core"
    },

    {
        kind: "Compressor",
        label: "Compressor",
        description: "Compressor node.",
        icon: "waveform",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        accent: "orange",
        category: "Core"
    },

    {
        kind: "Eq",
        label: "Equalizer",
        description: "Equalizer node.",
        icon: "chart-bar",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        accent: "lime",
        category: "Core"
    },

    {
        kind: "Delay",
        label: "Delay",
        description: "Delay node.",
        icon: "wave-sine",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        accent: "orange",
        category: "Fx-Space"
    },

    {
        kind: "Chorus",
        label: "Chorus",
        description: "Chorus node.",
        icon: "users-three",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        accent: "lapis",
        category: "Fx-Space"
    },

    {
        kind: "Reverb",
        label: "Reverb",
        description: "Reverb node.",
        icon: "cloud-rain",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        accent: "teal",
        category: "Fx-Space"
    },

    {
        kind: "Dattorro",
        label: "Dattorro Reverb",
        description: "Dattorro reverb node.",
        icon: "cloud-fog",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        accent: "teal",
        category: "Fx-Space"
    },

    {
        kind: "Tidal",
        label: "Tidal Modulator",
        description: "Tidal modulator node.",
        icon: "function",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        accent: "lapis",
        category: "Fx-Motion"
    },

    {
        kind: "Chroma",
        label: "Chroma Modulator",
        description: "Chroma modulator node.",
        icon: "palette",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        accent: "hotpink",
        category: "Fx-Motion"
    },

    {
        kind: "Bitcrush",
        label: "Bitcrusher",
        description: "Bitcrusher node.",
        icon: "wave-triangle",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        accent: "orange",
        category: "Fx-Texture"
    },

    {
        kind: "Massive",
        label: "Massive Synth",
        description: "Massive synth node.",
        icon: "lightning",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        accent: "hotpink",
        category: "Fx-Texture"
    },

    {
        kind: "Sequencer",
        label: "Sequencer",
        description: "Sequencer node.",
        icon: "steps",
        inputs: [{ id: "In", type: "midi" }],
        outputs: [{ id: "Out", type: "midi" }],
        category: "Sources"
    },

    {
        kind: "LFO",
        label: "LFO",
        description: "Low-frequency oscillator.",
        icon: "wave-sine",
        inputs: [],
        outputs: [{ id: "Out", type: "param" }],
        category: "Modulation"
    },

    {
        kind: "Envelope",
        label: "Envelope Generator",
        description: "Envelope generator node.",
        icon: "chart-line-up",
        inputs: [{ id: "In", type: "midi" }],
        outputs: [{ id: "Out", type: "param" }],
        category: "Modulation"
    },

    {
        kind: "Oscillator",
        label: "Oscillator",
        description: "Simple oscillator.",
        icon: "waveform",
        inputs: [{ id: "In", type: "midi" }],
        outputs: [{ id: "Out", type: "audio" }],
        category: "Generators"
    },

    {
        kind: "Sampler",
        label: "Sampler",
        description: "Built-in sampler.",
        icon: "waveform",
        inputs: [{ id: "In", type: "midi" }],
        outputs: [{ id: "Out", type: "audio" }],
        category: "Generators"
    },

    {
        kind: "wavetable",
        label: "Wavetable Oscillator",
        description: "Wavetable oscillator.",
        icon: "waveform",
        inputs: [{ id: "In", type: "midi" }],
        outputs: [{ id: "Out", type: "audio" }],
        category: "Generators"
    },

    {
        kind: "MixerTrack",
        label: "Mixer channel",
        description: "Mixer channel, visible in the mixer. Allows routing audio signals.",
        icon: "speaker-hifi",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        category: "Mixers"
    },

    {
        kind: "midi.pass",
        label: "MIDI Pass-through",
        description: "Passes MIDI data through without modification.",
        icon: "piano-keys",
        inputs: [{ id: "In", type: "midi" }],
        outputs: [{ id: "Out", type: "midi" }],
        category: "MIDI"
    },

    {
        kind: "effect.reverb",
        label: "Reverb Effect",
        description: "Applies a reverb effect to the audio signal.",
        icon: "cloud-rain",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [{ id: "Out", type: "audio" }],
        category: "Effects"
    },

    {
        kind: "input",
        label: "Audio Input Device",
        description: "Input from an audio device, such as a microphone or line-in.",
        icon: "microphone",
        inputs: [],
        outputs: [{ id: "Out", type: "audio" }],
        category: "Hardware"
    },

    {
        kind: "input",
        label: "Audio Input",
        description: "Audio input from the system, whatever was passed.",
        icon: "plugs-connected",
        inputs: [],
        outputs: [{ id: "Out", type: "audio" }],
        category: "Hardware"
    },

    {
        kind: "master",
        label: "Master Output",
        description: "Sends the signal into the audio device. Note that even if you add multiple master nodes, they will still act as the same output.",
        icon: "speaker-high",
        inputs: [{ id: "In", type: "audio" }],
        outputs: [],
        category: "Hardware"
    }
];

export default class PatcherView extends LS.View {
    constructor() {
        super({
            name: "PatcherView",
            title: "Patcher"
        });

        const pregeneratedMixerChannels = 4;

        const nodes = [
            {
                x: 380,
                y: -30,

                inputs: [{ id: "In", type: "audio" }],
                outputs: [],

                icon: "speaker-high",
                id: "output.master",
                label: "Master Output",
                kind: "master"
            },

            ...Array.from({ length: pregeneratedMixerChannels }, (_, i) => ({
                x: 160,
                y: -((pregeneratedMixerChannels / 2) * 90) + (i * 90),

                inputs: [{ id: "In", type: "audio" }],
                outputs: [{ id: "Out", type: "audio" }],

                icon: "speaker-hifi",
                id: `channel.${i + 1}`,
                label: `Channel ${i + 1}`,
                kind: "MixerTrack"
            })),

            {
                x: -230,
                y: -30,

                inputs: [],
                outputs: [{ id: "Out", type: "audio" }],

                icon: "plugs-connected",
                id: "input.master"
            },

            {
                x: -230,
                y: 80,

                inputs: [],
                outputs: [{ id: "Out", type: "midi" }],

                icon: "piano-keys",
                id: "input.midi",
                label: "MIDI Input"
            },

            {
                x: -130,
                y: 80,

                inputs: [],
                outputs: [{ id: "Out", type: "audio" }],

                kind: "Oscillator",
                icon: "waveform",
                id: "oscillator.1",
                label: "Oscillator",

                uniforms: [440, 0] // Sine wave at 440Hz
            }
        ]

        // const nodes = generateRandomNodes(100, 10);

        this.patcher = new LS.Patcher({
            parent: this.container,
            nodes,
            bank: nodeBank,
            fab: true,
            connections: [
                // All channels are routed to master by default
                ...Array.from({ length: pregeneratedMixerChannels }, (_, i) => ({
                    sourceNodeId: `channel.${i + 1}`,
                    sourcePortId: "Out",
                    targetNodeId: "output.master",
                    targetPortId: "In"
                })),

                // Oscillator is routed to channel 1 by default
                {
                    sourceNodeId: "oscillator.1",
                    sourcePortId: "Out",
                    targetNodeId: "channel.1",
                    targetPortId: "In"
                }
            ]
        });

        // this.patcher.loadPromise.then(() => {
            // const m = Array.from(this.patcher.iconEngine.font.nameMap.values());
            // for(const node of this.patcher.nodes) {
            //     node.icon = m[Math.floor(this.patcher.iconEngine.font.nameMap.size*Math.random())];
            // }
        // });

        window.p = this.patcher;

        this.loadPromise = this.patcher.loadPromise;
    }
}