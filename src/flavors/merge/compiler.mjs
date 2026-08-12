import * as AudioEngine from "../../components/audio/index.mjs";

// The struct layouts are still drafts and subject to change

/*struct AudioInstruction {
    // Pointer to the audio processor function (e.g., a VST plugin)
    AUDIO_PROCESSOR_SIGN(process) = nullptr;

    // Pointer to the state of the audio processor (e.g., a VST plugin instance)
    void* state = nullptr;

    // Apparently C++ doesn't guarantee that the values are actually in the order you declare them?
    // So we are forced to use integer types instead of bitfields
    uint8_t flags = 0;

    uint8_t inputCount = 0; // Number of input buffers
    uint8_t inputs[16]; // Input buffer indexes (up to 16)

    uint8_t outputCount = 0; // Number of output buffers
    uint8_t outputs[16]; // Output buffer indexes (up to 16)

    uint8_t masterFlags = 0;

    // Mixing factor of the left and right channels.
    // Panning & gain is precomputed into the left and right channel mixing factors, so it has to be handled somewhere else to avoid computations in the loop :(
    float left = 1.0f;
    float right = 1.0f;

    // Uniforms (e.g., extra special parameters) for the audio processor without requiring a state
    float uniforms[15] = {0.0f}; // Uniform storage
};*/

/*struct Event {
    EventType type = EventType::MIDIEvent;

    uint8_t flags;        // Flags
    uint8_t velocity = 0; // Velocity for MIDI events (here since padding's taking space anyway)

    uint32_t timestamp = 0; // Timestamp in samples
    uint32_t node;          // Node index

    union {
        struct {
            uint8_t data[12]; // Data for the event (e.g., MIDI message or parameter value)
        } u8data;

        struct {
            uint16_t index; // Index for the uniform
            float value; // Value for the uniform
        } uniform;

        struct {
            uint32_t id; // Parameter ID
            float targetValue; // Target value
        } parameter;

        struct {
            uint8_t channel; // MIDI channel
            uint8_t size; // Size of the MIDI message
        } midi;

        struct {
            float left; // Left channel pan value
            float right; // Right channel pan value
        } mix;
    };
};*/


// This MUST remain in sync with the engine's program interpreter
const STRUCT_SIZE = 120; // sizeof(AudioInstruction)

export default {
    /**
     * Compiles the patcher into a runnable program for the audio engine.
     */
    compileProgram(patcher) {
        if(!patcher || patcher.nodes.length === 0) return;

        const { sorted, sortedNodeIds, consumers, deps } = patcher.sortNodesTopologically();
        const connections = patcher.connections;

        const intermediateProgram = [];

        let bufferMap = new Map(); // Maps port IDs to buffer indexes
        let bufferIndex = -1; // Current buffer index

        // todo: optimize

        const masterNode = patcher.nodes.find(node => node.kind === "master");

        for(const node of sorted) {
            if(node.kind === "master") continue;                // Master node is handled separately

            const nodeDeps = deps.get(node.id) || [];           // Connections where this node is the target
            const nodeConsumers = consumers.get(node.id) || []; // Connections where this node is the source

            // No connections
            if(nodeDeps.length === 0 && nodeConsumers.length === 0) continue;

            // MixerTrack nodes with no inputs are not processed...
            // I guess note that some fx plugins could still want to generate sound so idk...
            if(node.kind === "MixerTrack" && nodeDeps.length === 0) continue;

            const handle = AudioEngine.processors.indexOf(node.kind);
            if(handle === -1) {
                LS.quickEmit("log", "warn", `No processor found for node kind: ${node.kind || "(unknown)"}`);
                continue;
            }

            // Opening node
            let audioOutputs = [], audioInputs = [], masterFlags = 0, mix = 1.0;

            let j = 0;
            for(const output of node.outputs) {
                if(output.type !== "audio") continue;

                const outputConnections = nodeConsumers.filter(c => c.sourcePortId === output.id);

                // todo: temp; later have a better algorithm to set buffer indexes and reuse them when possible
                bufferIndex++;

                let routed = false;
                for(const connection of outputConnections) {
                    if(connection.targetNodeId === masterNode.id) {
                        // Master node has special handling
                        masterFlags |= 1 << j;
                        // mix = typeof connection.strength === "number"? connection.strength: 1.0;
                    }

                    bufferMap.set(`${connection.id}:${node.id}`, bufferIndex);
                    routed = true;
                }

                if(routed) {
                    audioOutputs.push(bufferIndex);
                } else {
                    bufferIndex--;
                }
            }

            for(const input of node.inputs) {
                const inputConnections = nodeDeps.filter(c => c.targetPortId === input.id);

                for(const connection of inputConnections) {
                    if(connection.sourceNodeId === masterNode.id) {
                        // This will not happen (at least not yet until we have after-master routing) but just in case
                        continue;
                    }

                    if(input.type === "audio") {
                        const sourcePort = patcher.nodeMap.get(connection.sourceNodeId)?.outputs.find(p => p.id === connection.sourcePortId);
                        const bufferIdx = bufferMap.get(`${connection.id}:${connection.sourceNodeId}`);

                        if(bufferIdx !== undefined) {
                            audioInputs.push(bufferIdx);
                        } else {
                            LS.quickEmit("log", "warn", `No buffer index found for source port ${sourcePort?.id} of node ${connection.sourceNodeId}`);
                        }
                    }
                }
            }

            intermediateProgram.push([node, audioInputs, audioOutputs, masterFlags, mix, handle]);
        }

        const program = new ArrayBuffer(intermediateProgram.length * STRUCT_SIZE);
        const programView = new DataView(program);

        const LE = true;

        for (let i = 0; i < intermediateProgram.length; i++) {
            const [node, inputs, outputs, masterFlags, mix, handle] = intermediateProgram[i];

            let offset = i * STRUCT_SIZE;

            // Store offset in program for later use (e.g., for dynamically setting uniforms, pan, or flags)
            // This is NOT stable, only use while program is current and not recompiled
            // Example use: engine.setUniform(node.__programOffset, time, uniformIndex, value);
            node.__programOffset = i;

            // Processor function ID (will be resolved in the engine)
            programView.setBigUint64(offset, BigInt(handle), LE);
            offset += 8;

            // Processor state pointer (will be resolved later)
            programView.setBigUint64(offset, 0n, LE);
            offset += 8;

            // Flags
            let flags = 0;
            flags |= node.invert ? 1 << 0: 0;
            flags |= node.swap   ? 1 << 1: 0;
            flags |= node.bypass ? 1 << 2: 0;
            flags |= node.mute   ? 1 << 3: 0;
            programView.setUint8(offset, flags);
            offset += 1;

            // Input count
            programView.setUint8(offset, inputs.length);
            offset += 1;

            // Input buffer indexes
            for (let j = 0; j < 16; j++) {
                programView.setUint8(offset, inputs[j] || 0);
                offset += 1;
            }

            // Output count
            programView.setUint8(offset, outputs.length);
            offset += 1;

            // Output buffer indexes
            for (let j = 0; j < 16; j++) {
                programView.setUint8(offset, outputs[j] || 0);
                offset += 1;
            }

            // Output routing to master
            programView.setUint8(offset, masterFlags || 0);
            offset += 1;

            // Initial pan value
            // No idea how to compute it later... Ill deal with that later
            const pan = node.pan || 0.0;
            const left =  pan === 0? 1.0: Math.cos((pan + 1) * (Math.PI * 0.25)); // Convert pan (-1 to 1) to left channel mix factor
            const right = pan === 0? 1.0: Math.sin((pan + 1) * (Math.PI * 0.25)); // Convert pan (-1 to 1) to right channel mix factor

            // Left channel mix value (default to 1.0)
            programView.setFloat32(offset, (left || 1.0) * mix, LE);
            offset += 4;

            // Right channel mix value (default to 1.0)
            programView.setFloat32(offset, (right || 1.0) * mix, LE);
            offset += 4;

            // Uniforms
            for (let j = 0; j < 15; j++) {
                programView.setFloat32(offset + (j * 4), node.uniforms?.[j] || 0.0, LE);
            }
        }

        LS.quickEmit("log", "info", `Compiled program with ${intermediateProgram.length} instructions.`);

        window.last = {
            intermediateProgram,
            program
        };
        return program;
    },


    note2midi(note) {
        return [
            0,
            0,
            note.velocity || 127,
        ]
    },

    compileTimeline(timeline) {
        for(const item of timeline.items) {
            if(item.type === "pattern" && item.data.notes && item.data.notes.length > 0) {
                // Notes should be sorted, but we make sure
                item.data.notes.sort((a, b) => a.start - b.start);

                // Convert notes to MIDI events
                for(const note of item.data.notes) {

                }
            }
        }
    }
}