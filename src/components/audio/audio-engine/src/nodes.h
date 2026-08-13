#pragma once

#include "structures.h"
#include "helpers.h"
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

    plugin->processData.inputEvents = nullptr;
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

/**
 * @brief Simple oscillator audio node processor callback.
 * This function generates a waveform based on the frequency and shape morph.
 *
 * Uniforms:
 * 0: frequency (Hz)
 * 1: shape - lerp 0-4, sine, triangle, saw, square, pulse
 */
float gPhase = 0.0f; // temporary
AUDIO_PROCESSOR(Oscillator) {
    float frequency = instruction->uniforms[0];
    float shape     = instruction->uniforms[1];
    bool reverse = (instruction->flags & FlagInvertPhase) != 0;

    float* outBuffer = GET_BUFFER_FLOAT(instruction->indexes[FIRST_OUTPUT_INDEX]);
    float phaseIncrement = (reverse? -1.0f : 1.0f) * frequency / fSampleRate;

    // std::cout << "Oscillator: frequency=" << frequency << ", shape=" << shape << ", phase=" << gPhase << ", phaseIncrement=" << phaseIncrement << ", outputBuffer=" << static_cast<int>(instruction->outputs[0]) << std::endl;

    for (uint16_t i = 0; i < bufferSize; ++i) {
        float v = waveFromShape(gPhase, shape);
        // float v = std::sin(gPhase); // temporary

        outBuffer[i]              += v; // Write to the first channel
        outBuffer[i + bufferSize] += v; // Write to the second channel
        gPhase = wrapUnit(gPhase + phaseIncrement);
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