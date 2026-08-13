#pragma once

// TODO: AVX2/AVX512 optimizations
#include <immintrin.h>

// --- Standard headers
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstring>
#include <iostream>
#include <memory>
#include <thread>
#include <vector>
#include <array>
#include <cstdint>
#include <cmath>
#include <unordered_map>

// --- Platform headers
#if defined(__linux__) || defined(__APPLE__)
#include <pthread.h>
#endif

#define AUDIO_PROCESSOR_SIGN(name) void (*name)(const AudioInstruction*, float*, uint16_t, uint16_t, float, uint8_t, uint64_t, Merge::Event**)
#define AUDIO_PROCESSOR(name) void name(const AudioInstruction* instruction, float* buffer, uint16_t blockByteSize, uint16_t bufferSize, float fSampleRate, uint8_t outputChannels, uint64_t currentTime, Merge::Event** events)

#define GET_BUFFER_FLOAT(index) (buffer + (bufferSize * outputChannels * index))
#define GET_BUFFER_BYTE(index) (reinterpret_cast<std::byte*>GET_BUFFER_FLOAT(index))

#define FIRST_INPUT_INDEX 0
#define FIRST_OUTPUT_INDEX instruction->aInputCount
#define FIRST_OUTPUT_INDEX_R instruction.aInputCount
#define FIRST_EVENT_INPUT_INDEX instruction->aInputCount + instruction->aOutputCount
#define FIRST_EVENT_INPUT_INDEX_R instruction.aInputCount + instruction.aOutputCount
#define FIRST_EVENT_OUTPUT_INDEX instruction->aInputCount + instruction->aOutputCount + instruction->eInputCount
#define FIRST_DATA_INPUT_INDEX instruction->aInputCount + instruction->aOutputCount + instruction->eInputCount + instruction->eOutputCount
#define FIRST_DATA_OUTPUT_INDEX instruction->aInputCount + instruction->aOutputCount + instruction->eInputCount + instruction->eOutputCount + instruction->dInputCount

#define CLEAR_BUFFER(index) std::memset(GET_BUFFER_BYTE(index), 0, blockByteSize)
#define CLEAR_INPUT_BUFFERS for (uint8_t i = 0; i < instruction->aInputCount; ++i) { CLEAR_BUFFER(instruction->indexes[i]); }
#define CLEAR_OUTPUT_BUFFERS for (uint8_t i = 0; i < instruction->aOutputCount; ++i) { CLEAR_BUFFER(instruction->indexes[i + FIRST_OUTPUT_INDEX]); }

#define CLEAR_ALL_BUFFERS CLEAR_INPUT_BUFFERS; CLEAR_OUTPUT_BUFFERS;

// --- VST3 SDK
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstevents.h"

using namespace Steinberg;
using namespace Steinberg::Vst;

// --- Ring buffer
#include "../include/ring-buffer/TPCircularBuffer.h"

// --- SPSC queue
#include "../include/rigtorp/SPSCQueue.h"
using namespace rigtorp;

// --- Constants
constexpr float PI = 3.14159265358979323846f;

// Layout for the runtime shared state
struct alignas(64) SharedState {
    float sampleHistory[1024];
    uint32_t usage = 0; // Thread usage
};

namespace Merge {

enum class EventType : uint8_t {
    MIDIEvent,
    SetParameter,
    SetUniform,
    SetMix,
    SetFlags
};

/**
 * @brief Event structure for audio engine communication.
 * Used to send events from the main thread to the audio engine thread.
 */
struct Event {
    EventType type = EventType::MIDIEvent;

    uint8_t flags;        // Flags
    uint8_t velocity = 0; // Velocity for MIDI events (here since padding's taking space anyway)

    // Events either have a timestamp (for scheduling) or a node index
    union {
        uint32_t timestamp = 0; // Timestamp in samples
        uint32_t node;          // Node index
    };

    union {
        struct {
            uint8_t data[12]; // Data for the event (e.g., MIDI message or parameter value)
        } u8data;

        struct {
            uint16_t index; // Index for the uniform
            float value;    // Value for the uniform
        } uniform;

        struct {
            uint32_t id;       // Parameter ID
            float targetValue; // Target value
        } parameter;

        struct {
            uint8_t type;    // MIDI event type
            uint8_t channel; // MIDI channel
            uint8_t bend;    // MIDI bend value
            uint16_t note;   // MIDI note
        } midi;

        struct {
            float left; // Left channel pan value
            float right; // Right channel pan value
        } mix;
    };
};

enum BitFlags : uint32_t {
    FlagInvert      = 1 << 0,
    FlagSwap        = 1 << 1,
    FlagBypass      = 1 << 2,
    FlagMute        = 1 << 3,
    FlagReserved    = 1 << 4,
    FlagClear       = 1 << 5,
    FlagInvertPhase = 1 << 6,

    FlagOut0Master  = 1 << 0,
    FlagOut1Master  = 1 << 1,
    FlagOut2Master  = 1 << 2,
    FlagOut3Master  = 1 << 3,
    FlagOut4Master  = 1 << 4,
    FlagOut5Master  = 1 << 5,
    FlagOut6Master  = 1 << 6,
    FlagOut7Master  = 1 << 7,
};

// Compiled instruction that the audio engine will execute.
struct AudioInstruction {
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
};

/**
 * @brief VST3 plugin base (global) structure
 */
struct VST3Plugin {
    VST3::Hosting::Module::Ptr module;
    VST3::Hosting::ClassInfo classInfo;
    IPtr<PlugProvider> provider;
};

/**
 * @brief VST3 plugin per-instance state structure
 */
struct VST3PluginInstance {
    bool configured = false;

    IPtr<IComponent> component;
    IPtr<IAudioProcessor> processor;
    IPtr<IEditController> controller;

    ProcessData processData {};

    // Inputs
    std::array<Steinberg::Vst::AudioBusBuffers, 16> inputs;
    std::array<std::array<float*, 2>, 16> iChannels;

    // Outputs
    std::array<Steinberg::Vst::AudioBusBuffers, 16> outputs;
    std::array<std::array<float*, 2>, 16> oChannels;
};

} // namespace Merge