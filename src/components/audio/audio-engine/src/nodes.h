#pragma once

#include "structures.h"
#include "helpers.h"
#include <cstdint>
#include <deque>
#include <unordered_map>
using namespace Merge;
namespace Merge {

/**
 * Info about buffers:
 *   Buffers are indexed. They aren't fixed and can be reused or moved around at any point in the program.
 *   Nodes should do something like "GET_BUFFER_FLOAT(instruction->outputs[0])" to get the output buffer for the first output port and then write to it BY ADDITION.
 *
 * What are uniforms?
 *   Uniforms are a set of 15 indexed floats stored in the program instruction itself.
 *   They are meant to be used for simple extra parameters that don't require a full state.
 *   They can be set dynamically at runtime.
 */

/**
 * @brief VST3 audio node processor callback.
 * This function is used to process audio through all VST3 plugins.
 */
AUDIO_PROCESSOR(VST3Processor) {
    VST3PluginInstance* plugin = static_cast<VST3PluginInstance*>(instruction->state);

    if (!plugin->processor) {
        CLEAR_OUTPUT_BUFFERS;
        return;
    }

    plugin->processData.numSamples = static_cast<int32>(bufferSize);
    plugin->processData.numInputs = static_cast <int32>(instruction->aInputCount);
    plugin->processData.numOutputs = static_cast<int32>(instruction->aOutputCount);

    // Since our program buffer indexes can vary, we need to rebuild the input/output pointers.
    // Todo: Of course this should not be per process() call though there isn't a good way to do it without a lot of extra complexity
    // Later the iChannels and oChannels arrays should be stored somewhere and the poitners should magically set in

    // Also shouldn't be hardcoded to 2 channels and 16 buses

    for (uint32_t i = 0; i < instruction->aInputCount; ++i) {
        plugin->inputs[i].numChannels = outputChannels;
        plugin->inputs[i].silenceFlags = 0;
        plugin->inputs[i].channelBuffers32 = plugin->iChannels[i].data();
        plugin->inputs[i].channelBuffers32[0] = GET_BUFFER_FLOAT(instruction->indexes[i + FIRST_INPUT_INDEX]);
        plugin->inputs[i].channelBuffers32[1] = GET_BUFFER_FLOAT(instruction->indexes[i + FIRST_INPUT_INDEX]) + bufferSize;
    }

    for (uint32_t i = 0; i < instruction->aOutputCount; ++i) {
        plugin->outputs[i].numChannels = outputChannels;
        plugin->outputs[i].silenceFlags = 0;
        plugin->outputs[i].channelBuffers32 = plugin->oChannels[i].data();
        plugin->outputs[i].channelBuffers32[0] = GET_BUFFER_FLOAT(instruction->indexes[i + FIRST_OUTPUT_INDEX]);
        plugin->outputs[i].channelBuffers32[1] = GET_BUFFER_FLOAT(instruction->indexes[i + FIRST_OUTPUT_INDEX]) + bufferSize;
    }

    plugin->processData.inputs = plugin->inputs.data();
    plugin->processData.outputs = plugin->outputs.data();

    plugin->processData.inputParameterChanges = nullptr;
    plugin->processData.outputParameterChanges = nullptr;

    plugin->processData.inputEvents = &plugin->eventList;
    plugin->eventList.eventCount = events->eventCount;
    plugin->processData.outputEvents = nullptr;

    plugin->processData.processContext = nullptr;

    int result = plugin->processor->process(plugin->processData);
    if (result != kResultTrue) {
        std::cerr << "VST3Processor: Plugin processing failed with result: " << result << std::endl;

        // @check Fallback: fill the buffer with silence
        CLEAR_OUTPUT_BUFFERS;
        return;
    }
}

float midiToFrequency(float midiNote) {
    return 440.0 * std::pow(2.0, (midiNote - 69.0) / 12.0);
}

struct VoiceState {
    bool active : 1 = false;      // Is the voice actively producing new sound
    bool gate : 1 = false;        // Gate
    float phase = 0.0f;       // oscillator phase
    float pan = 0.0f;         // panning value (-1.0 to 1.0)
    int frequency = 0;        // frequency in Hz
    float velocity = 0.0f;

    void reset() {
        active = false;
        gate = false;
        phase = 0.0f;
        pan = 0.0f;
        frequency = 0;
        velocity = 0.0f;
    }

    void increment(float phaseIncrement, float fSampleRate, bool reverse = false) {
        phase += (reverse? -1.0f : 1.0f) * frequency / fSampleRate;
        if (phase >= 1.0f) {
            phase -= 1.0f; // Wrap around to keep phase in [0, 1)
        }
    }

    void increment(float phaseIncrement, bool reverse = false) {
        phase += (reverse? -1.0f : 1.0f) * phaseIncrement;
        if (phase >= 1.0f) {
            phase -= 1.0f; // Wrap around to keep phase in [0, 1)
        }
    }
};

VoiceState voices[64];
uint8_t activeVoices = 0;
std::unordered_map<uint32_t, uint8_t> noteToVoice;

/**
 * @brief Simple oscillator audio node processor callback.
 * This function generates a waveform based on the frequency and shape morph.
 *
 * Uniforms:
 * 0: frequency (Hz)
 * 1: shape - lerp 0-4, sine, triangle, saw, square, pulse
 */
AUDIO_PROCESSOR(Oscillator) {
    float frequencyShift = instruction->uniforms[0];
    float shape     = instruction->uniforms[1];
    bool reverse = (instruction->flags & FlagInvertPhase) != 0;

    float* outBuffer = GET_BUFFER_FLOAT(instruction->indexes[FIRST_OUTPUT_INDEX]);

    for(uint16_t i = 0; i < events->eventCount; ++i) {
        const Merge::Event* event = events->events[i];
        if(event->type == Merge::EventType::NoteOn || event->type == Merge::EventType::NoteOff) {
            // Find an available voice
            int voiceIndex = -1;
            if(event->type == Merge::EventType::NoteOn && event->midi.velocity > 0) {
                // Check if the note is already assigned to a voice
                auto it = noteToVoice.find(event->midi.id);
                if (it != noteToVoice.end()) {
                    voiceIndex = it->second;
                } else {
                    // Use a free voice
                    voiceIndex = activeVoices;
                    if(voiceIndex >= 64) {
                        continue;
                    }
                }
            }

            VoiceState& voice = voices[voiceIndex];

            voice.frequency = midiToFrequency(event->midi.note) + frequencyShift;
            voice.velocity = static_cast<float>(event->midi.velocity) / 127.0f;
            voice.active = (event->type == Merge::EventType::NoteOn && event->midi.velocity > 0); // Note On with velocity > 0
            voice.gate = true;

            if(!voice.active) {
                // Note Off event
                voice.gate = false;
                noteToVoice.erase(event->midi.id);
                activeVoices--;
            } else {
                // Note On event
                noteToVoice[event->midi.id] = voiceIndex;
                activeVoices++;
            }

            std::cout << "Oscillator: MIDI Event - channel=" << static_cast<int>(event->midi.channel) << ", note=" << static_cast<int>(event->midi.note) << ", frequency=" << voice.frequency << ", velocity=" << voice.velocity << ", active=" << voice.active << std::endl;
        }
    }

    for(uint8_t voice = 0; voice < activeVoices; ++voice) {
        VoiceState& v = voices[voice];
        if(v.active && v.gate) {
            for (uint16_t i = 0; i < bufferSize; ++i) {
                float vSample = waveFromShape(v.phase, shape) * v.velocity;

                outBuffer[i]              += vSample; // Write to the first channel
                outBuffer[i + bufferSize] += vSample; // Write to the second channel

                v.increment(v.frequency, fSampleRate, reverse);
            }
        }
    }
}

// Vox
// const auto p = wrapUnit(phase);
// const float formA = std::sin(static_cast<float>(juce::MathConstants<double>::twoPi * p));
// const float formB = std::sin(static_cast<float>(juce::MathConstants<double>::twoPi * (p * (2.01 + position * 0.95f) + 0.18)));
// const float formC = std::sin(static_cast<float>(juce::MathConstants<double>::twoPi * (p * (3.02 + position * 1.45f) + 0.46)));
// sampleValue = formA * 0.72f + formB * 0.22f + formC * 0.18f;
// break;
// Glass
// const auto p = wrapUnit(phase);
// const float sine = std::sin(static_cast<float>(juce::MathConstants<double>::twoPi * p));
// const float shimmer = std::sin(static_cast<float>(juce::MathConstants<double>::twoPi * (p * (4.0 + position * 4.0f) + position * 0.35f)));
// const float edge = std::sin(static_cast<float>(juce::MathConstants<double>::twoPi * (p * (6.0 + position * 6.0f) + position * 0.18f)));
// sampleValue = sine * 0.62f + shimmer * 0.26f + edge * 0.12f;
// break;

AUDIO_PROCESSOR(MixerTrack) {
    int in = instruction->indexes[0];
    int out = instruction->indexes[instruction->aInputCount];
    if(in == out) {
        return;
    }

    // Copy the input buffer to the output buffer
    std::memcpy(GET_BUFFER_BYTE(out), GET_BUFFER_BYTE(in), blockByteSize);
}

AUDIO_PROCESSOR(Sampler) {
    // Implementation for sampler node
}

AUDIO_PROCESSOR(WaveTable) {
    // Implementation for wave table node
}

AUDIO_PROCESSOR(Delay) {
    // Implementation for delay node
}

AUDIO_PROCESSOR(Chorus) {
    // Implementation for chorus node
}

AUDIO_PROCESSOR(Reverb) {
    // Implementation for reverb node
}

AUDIO_PROCESSOR(Dattorro) {
    // Implementation for Dattorro reverb node
}

AUDIO_PROCESSOR(Bitcrusher) {
    // Implementation for bitcrusher node
}

AUDIO_PROCESSOR(Waveshaper) {
    // Implementation for waveshaper node
}


AUDIO_PROCESSOR(Massive) {
    // Implementation for massive node
}
AUDIO_PROCESSOR(Chroma) {
    // Implementation for chroma node
}

AUDIO_PROCESSOR(Tidal) {
    // Implementation for tidal node
}
AUDIO_PROCESSOR(Sequencer) {
    // Implementation for sequencer node
}


AUDIO_PROCESSOR(LFO) {
    // Implementation for LFO node
}
AUDIO_PROCESSOR(Envelope) {
    // Implementation for envelope node
}

AUDIO_PROCESSOR(AudioInput) {
    // Implementation for audio input node
}


AUDIO_PROCESSOR(Filter) {
    // Implementation for filter node
}
AUDIO_PROCESSOR(Limiter) {
    // Implementation for limiter node
}
AUDIO_PROCESSOR(Compressor) {
    // Implementation for compressor node
}
AUDIO_PROCESSOR(TransientProcessor) {
    // Implementation for transient processor node
}
AUDIO_PROCESSOR(Stereo) {
    // Implementation for stereo node
}
AUDIO_PROCESSOR(Widen) {
    // Implementation for widen node
}


// Reserved for whenever I decide to implement the following audio plugin formats
AUDIO_PROCESSOR(VST2Processor) {}
AUDIO_PROCESSOR(CLAPProcessor) {}
AUDIO_PROCESSOR(AAXProcessor) {}
AUDIO_PROCESSOR(CustomProcessor) {}

// Static mapping from an index to the processor function pointer (for JS clients):
// Order matters
const std::array<AUDIO_PROCESSOR_SIGN(), 256> gProcessFunctionRegistry = {
     &MixerTrack,
     &Oscillator,
     &VST3Processor,
     &Reverb,
     &Delay,
     &Chorus,
     &Dattorro,
     &Bitcrusher,
     &Waveshaper,
     &Massive,
    &Chroma,
    &Sampler,
    &WaveTable,
    &Sequencer,
    &Tidal,
    &LFO,
    &Envelope,
    &AudioInput,
    &Filter,
    &Limiter,
    &Compressor,
    &TransientProcessor,
    &Stereo,
    &Widen,
    &VST2Processor,
    &CLAPProcessor,
    &AAXProcessor,
    &CustomProcessor
};

} // namespace Merge