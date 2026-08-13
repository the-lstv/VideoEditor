import * as AudioEngine from "../../components/audio/index.mjs";

// The struct layouts are still drafts and subject to change

// This MUST remain in sync with the engine's program interpreter
const STRUCT_SIZE = 128; // sizeof(AudioInstruction)
const EVENT_STRUCT_SIZE = 20; // sizeof(Event)
const MAX_IO_COUNT = 36; // Maximum number of inputs/outputs per node (audio + event + data)
const LE = true; // Little-endian

/*struct AudioInstruction {
    // Pointer to the audio processor function (e.g., a VST plugin)
    AUDIO_PROCESSOR_SIGN(process) = nullptr;

    // Pointer to the state of the audio processor (e.g., a VST plugin instance)
    void* state = nullptr;

    // Apparently C++ doesn't guarantee that the values are actually in the order you declare them?
    // So we are forced to use integer types instead of bitfields
    uint8_t flags = 0;

    uint8_t aInputCount  = 0; // Number of input buffers
    uint8_t aOutputCount = 0; // Number of output buffers
    uint8_t eInputCount  = 0; // Number of event input buffers
    uint8_t eOutputCount = 0; // Number of event output buffers
    uint8_t dInputCount  = 0; // Number of data input buffers
    uint8_t dOutputCount = 0; // Number of data output buffers

    // The indexes of the individual input and output buffers.
    // Currently this means that each node can have up to 36 inputs/outputs total.
    uint8_t indexes[36];

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

        // Current buffer indexes
        // It's an array since JS does not have pass-by-reference for primitive types :(
        const bufferIndexes = [0, 0]; // audioBufferIndex, eventBufferIndex

        // todo: optimize

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

            let audioOutputs = [], audioInputs = [], eventInputs = [], eventOutputs = [], dataInputs = [], dataOutputs = [], masterFlags = 0, mix = 1.0;

            let j = 0;
            for(const output of node.outputs) {
                const type = output.type;
                const typeIndex = type === "audio"? 0: type === "midi" || type === "event"? 1: -1;
                const targetCollection = type === "audio"? audioOutputs: type === "midi" || type === "event"? eventOutputs: null;

                if(typeIndex === -1 || !targetCollection) {
                    LS.quickEmit("log", "warn", `Unknown output type: ${type}`);
                    continue;
                }

                const outputConnections = nodeConsumers.filter(c => c.sourcePortId === output.id);

                // todo: temp; later have a better algorithm to set buffer indexes and reuse them when possible
                bufferIndexes[typeIndex]++;

                let routed = false;
                for(const connection of outputConnections) {
                    if(!connection.targetNodeId) continue;

                    if(patcher.nodeMap.get(connection.targetNodeId)?.kind === "master") {
                        // Master node has special handling
                        masterFlags |= 1 << j;
                        // mix = typeof connection.strength === "number"? connection.strength: 1.0;
                    }

                    bufferMap.set(`${connection.id}:${node.id}`, bufferIndexes[typeIndex]);
                    routed = true;
                }

                if(routed) {
                    targetCollection.push(bufferIndexes[typeIndex]);
                } else {
                    bufferIndexes[typeIndex]--;
                }
            }

            for(const input of node.inputs) {
                const type = input.type;
                // const typeIndex = type === "audio"? 0: type === "midi" || type === "event"? 1: -1;
                const targetCollection = type === "audio"? audioInputs: type === "midi" || type === "event"? eventInputs: null;

                if(!targetCollection) {
                    LS.quickEmit("log", "warn", `Unknown input type: ${type}`);
                    continue;
                }

                const inputConnections = nodeDeps.filter(c => c.targetPortId === input.id);

                for(const connection of inputConnections) {
                    if(patcher.nodeMap.get(connection.sourceNodeId)?.kind === "master") {
                        // This will not happen (at least not yet until we have after-master routing) but just in case
                        continue;
                    }

                    if(input.type === "audio") {
                        const sourcePort = patcher.nodeMap.get(connection.sourceNodeId)?.outputs.find(p => p.id === connection.sourcePortId);
                        const bufferIdx = bufferMap.get(`${connection.id}:${connection.sourceNodeId}`);

                        if(bufferIdx !== undefined) {
                            targetCollection.push(bufferIdx);
                        } else {
                            LS.quickEmit("log", "warn", `No buffer index found for source port ${sourcePort?.id} of node ${connection.sourceNodeId}`);
                        }
                    }
                }
            }

            intermediateProgram.push([node, audioInputs, audioOutputs, eventInputs, eventOutputs, dataInputs, dataOutputs, masterFlags, mix, handle]);
        }

        const program = new ArrayBuffer(intermediateProgram.length * STRUCT_SIZE);
        const programView = new DataView(program);

        for (let i = 0; i < intermediateProgram.length; i++) {
            const [node, inputs, outputs, eventInputs, eventOutputs, dataInputs, dataOutputs, masterFlags, mix, handle] = intermediateProgram[i];

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

            // Output count
            programView.setUint8(offset, outputs.length);
            offset += 1;

            // Event input count
            programView.setUint8(offset, eventInputs.length);
            offset += 1;

            // Event output count
            programView.setUint8(offset, eventOutputs.length);
            offset += 1;

            // Data input count (not used yet)
            programView.setUint8(offset, 0);
            offset += 1;

            // Data output count (not used yet)
            programView.setUint8(offset, 0);
            offset += 1;

            let totalIOSize = inputs.length + outputs.length + eventInputs.length + eventOutputs.length + dataInputs.length + dataOutputs.length;
            if(totalIOSize > MAX_IO_COUNT) {
                LS.quickEmit("log", "warn", `Node ${node.id} has too many inputs/outputs (${totalIOSize}), maximum is ${MAX_IO_COUNT}. Some connections will be ignored.`);
                totalIOSize = MAX_IO_COUNT;

                // ! TODO: clamp
                // It shoulsn't be possible but just in case
            }

            // Input buffer indexes
            for (let j = 0; j < inputs.length; j++) {
                programView.setUint8(offset, inputs[j]);
                offset += 1;
            }

            // Output buffer indexes
            for (let j = 0; j < outputs.length; j++) {
                programView.setUint8(offset, outputs[j]);
                offset += 1;
            }

            // Event input buffer indexes
            for (let j = 0; j < eventInputs.length; j++) {
                programView.setUint8(offset, eventInputs[j]);
                offset += 1;
            }

            // Event output buffer indexes
            for (let j = 0; j < eventOutputs.length; j++) {
                programView.setUint8(offset, eventOutputs[j]);
                offset += 1;
            }

            // Fill remaining buffer indexes with 0
            for (let j = totalIOSize; j < MAX_IO_COUNT; j++) {
                programView.setUint8(offset, 0);
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


    note2midi(note, type, out = []) {
        const noteData = note.data || {};
        out[0] = 0;                       // MIDI event enum
        out[1] = noteData?.flags || 0;    // Flags
        out[2] = noteData?.velocity || 0; // Velocity
        out[3] = note.start;              // Timestamp OR node index for immediate events
        out[4] = type;                    // MIDI event type
        out[5] = noteData?.channel || 0;  // MIDI channel
        out[6] = noteData?.bend || 0;     // MIDI bend
        out[7] = noteData?.note || 0;     // MIDI note
        return out;
    },

    writeEvent(event, view, offset) {
        view.setUint8(offset, event[0]); // Event type
        offset += 1;

        view.setUint8(offset, event[1]); // Flags
        offset += 1;

        view.setUint8(offset, event[2]); // Velocity
        offset += 1;

        view.setUint32(offset, event[3], LE); // Timestamp OR node index
        offset += 4;

        view.setUint8(offset, event[4]); // MIDI event type
        offset += 1;

        view.setUint8(offset, event[5]); // MIDI channel
        offset += 1;

        view.setUint8(offset, event[6]); // MIDI bend
        offset += 1;

        view.setUint16(offset, event[7], LE); // MIDI note
    },

    compilePattern(pattern) {
        let eventCount = 0;
        const immediateEventArray = [];

        if(!pattern || !pattern.items || pattern.items.length === 0) return;

        // Notes should be sorted, but we make sure
        pattern.items.sort((a, b) => a.start - b.start);

        // Convert notes to MIDI events
        for(const note of pattern.items) {
            immediateEventArray.push(this.note2midi(note, 0));
            eventCount++;
        }

        // Convert to a typed array
        const eventArray = new ArrayBuffer(eventCount * EVENT_STRUCT_SIZE);
        const eventView = new DataView(eventArray);

        for(let i = 0; i < immediateEventArray.length; i++) {
            const event = immediateEventArray[i];
            let offset = i * EVENT_STRUCT_SIZE;
            this.writeEvent(event, eventView, offset);
        }

        LS.quickEmit("log", "info", `Compiled pattern with ${eventCount} events.`);
        return eventArray;
    }
}