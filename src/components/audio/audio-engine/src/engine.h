#pragma once

/**
 * @brief Audio engine implementation, currently using miniaudio for audio output.
 * @note This code is currently in very early stages.
*/

#include <atomic>
#include <cstdint>
#include <vector>
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

// -- Includes
#include "structures.h"

// -- Processing nodes
#include "nodes.h"

// --- V8 headers (This should not be here though)
#include <v8.h>
using namespace v8;
#include "v8-utils.h"

// Global map of loaded VST3 plugins
std::unordered_map<std::string, VST3Plugin> gLoadedVST3;

/**
 * @brief Audio engine runtime class.
 * This one uses block-based/buffer processing so is not fully real-time.
 * This class manages the audio engine's lifecycle and thread management.
 *
 * Note: I will also be putting an unusually large amount of comments here since I am new to audio programming and still learning how things work.
 * So these comments help me keep track of what is going on
 */
namespace Merge {
    static const unsigned int stateSize = sizeof(SharedState);

    /**
     * @brief Load a VST3 plugin from the specified path. This is global and shared between all audio engine instances until the plugin is unloaded.
     * @param path The path to the VST3 plugin.
     * @param error Reference to a string to store any error messages.
     * @return True if the plugin was loaded successfully, false otherwise.
     */
    bool loadVST3(const std::string& path, std::string& error) {
        // Check if the plugin is already loaded
        if (gLoadedVST3.find(path) != gLoadedVST3.end()) {
            return true; // Already loaded
        }

        std::cout << "Loading VST3 plugin from path: " << path << std::endl;

        VST3::Hosting::Module::Ptr module = VST3::Hosting::Module::create(path, error);
        if (!module) {
            return false;
        }

        for (const auto& classInfo : module->getFactory().classInfos()) {
            std::cout << "Name: " << classInfo.name()
                      << " Category: " << classInfo.category()
                      << " ID: " << classInfo.ID().toString()
                      << '\n';
        }

        VST3::Hosting::ClassInfo selectedClass;
        bool foundAudioEffect = false;
        for (const auto& classInfo : module->getFactory().classInfos()) {
            if (classInfo.category() == kVstAudioEffectClass) {
                selectedClass = classInfo;
                foundAudioEffect = true;
                break;
            }
        }

        if (!foundAudioEffect) {
            error = "No VST audio effect class found in module";
            return false;
        }

        auto provider = owned(new PlugProvider(module->getFactory(), selectedClass, true));
        if (!provider || !provider->initialize()) {
            error = "Plugin provider initialization failed";
            return false;
        }

        VST3Plugin plugin;
        plugin.module = std::move(module);
        plugin.provider = std::move(provider);
        plugin.classInfo = selectedClass;
        gLoadedVST3[path] = std::move(plugin);
        return true;
    }

    bool unloadVST3(const std::string& path, std::string& error) {
        auto it = gLoadedVST3.find(path);
        if (it != gLoadedVST3.end()) {
            // TODO: Unload instances
            VST3Plugin& plugin = it->second;
            plugin.provider = nullptr;
            plugin.module.reset();
            gLoadedVST3.erase(it);
            return true;
        }

        error = "Plugin not loaded: " + path;
        return false;
    }

    // TODO: sort private/public members
    class EngineRuntime {
    private:
        uint32_t sampleRate;         // 44100 Hz & 48000 Hz are common
        uint16_t bufferSize;         // 512 samples is common but depends
        uint16_t scratchBufferCount; // Number of scratch buffers for processing
        uint8_t  outputChannels;     // Number of output channels
    public:
        // Number of scratch buffers for processing
        std::atomic<bool> running {false};
        std::atomic<bool> initialized {false};

        // Audio device
        ma_device_config deviceConfig {};
        ma_device device {};

        // Audio output ring buffer
        TPCircularBuffer outputRing;

        // Processing thread for audio engine
        std::jthread processingThread;

        // Scratch buffers storage for audio processing
        std::vector<float> audioScratchBuffers;

        // Scratch buffers storage for audio processing
        std::vector<Merge::Event> eventScratchBuffers;

        // Current program of audio instructions to execute
        // This will contain the compiled node graph
        std::vector<AudioInstruction> program;

        SPSCQueue<Merge::Event> queue = SPSCQueue<Merge::Event>(8192);

        // Static event lists (eg. patterns)
        std::vector<std::vector<Merge::Event>> EventLists;

        // Shared data to let the main thread read into the state of the audio engine
        V8OwnedArrayBuffer<SharedState> sharedState;

        EngineRuntime(uint32_t sampleRate = 44100, uint16_t bufferSize = 512, uint16_t scratchBufferCount = 64, uint8_t outputChannels = 2) : sampleRate(sampleRate), bufferSize(bufferSize), scratchBufferCount(scratchBufferCount), outputChannels(outputChannels) {
            // Initialize the audio engine
            std::cout << "Initializing audio engine with sample rate: " << sampleRate << ", buffer size: " << bufferSize << ", scratch buffers: " << scratchBufferCount << std::endl;

            if(sampleRate < 8000 || sampleRate > 192000) {
                std::cerr << "Sample rate should be between 8000 and 192000 Hz, you provided: " << sampleRate << ". Defaulting to 44100." << std::endl;
                sampleRate = 44100;
            }

            if(bufferSize < 64 || bufferSize > 8192) {
                std::cerr << "Buffer size should be between 64 and 8192 samples, you provided: " << bufferSize << ". Defaulting to 512." << std::endl;
                bufferSize = 512;
            }

            if(scratchBufferCount == 0 || scratchBufferCount > 256) {
                std::cerr << "Scratch buffer count must be between 1 and 256, you provided: " << scratchBufferCount << ". Defaulting to 64." << std::endl;
                scratchBufferCount = 64;
            }

            if(outputChannels < 1 || outputChannels > 8) {
                std::cerr << "Output channels must be between 1 and 8, you provided: " << outputChannels << ". Defaulting to 2 (stereo)." << std::endl;
                outputChannels = 2;
            }

            // Allocate scratch buffers
            audioScratchBuffers.resize(scratchBufferCount * bufferSize * outputChannels, 0.0f);
            eventScratchBuffers.resize(scratchBufferCount * 2048, Merge::Event{});

            // Initialize the ring buffer with enough space
            int result = TPCircularBufferInit(&outputRing, bufferSize * outputChannels * sizeof(float) * 8);
            if (result == 0) {
                std::cerr << "Failed to initialize the output ring buffer." << std::endl;
                return;
            }
        }

        ~EngineRuntime() {
            //debug
            std::cout << "Destroying audio engine runtime." << std::endl;
            stop();

            audioScratchBuffers.clear();
            program.clear();
            EventLists.clear();
            eventScratchBuffers.clear();
        }

        /**
         * Sets the external shared state pointer. This should be called before starting the engine.
         * Returns true if the shared state was set successfully, false if the engine is already running.
         */
        bool setExternalSharedState(v8::Isolate* isolate, v8::Local<v8::ArrayBuffer> value) {
            if (running.load(std::memory_order_acquire)) {
                return false; // Cannot set shared state while running
            }

            sharedState.reset(isolate, value);
            return true;
        }

        /**
         * Start the audio engine. Returns true if the engine was started successfully.
         * Thread-safe: true, can be called from any thread.
         */
        bool start(){
            // if(!sharedState) {
            //     return false;
            // }

            // If running, we don't need to start again
            if (running.load(std::memory_order_acquire)) {
                return true;
            }

            bool eInitialized = initialized.load(std::memory_order_acquire);
            if(!eInitialized) {
                deviceConfig = ma_device_config_init(ma_device_type_playback);
                deviceConfig.playback.format = ma_format_f32;
                deviceConfig.playback.channels = outputChannels;
                deviceConfig.sampleRate = sampleRate;
                deviceConfig.dataCallback = &EngineRuntime::audioCallback;
                deviceConfig.pUserData = this;
    
                ma_result result = ma_device_init(nullptr, &deviceConfig, &device);
                if (result != MA_SUCCESS) {
                    return false;
                }

                initialized.store(true, std::memory_order_release);
            }
    
            ma_result startResult = ma_device_start(&device);
            if (startResult != MA_SUCCESS) {
                std::cerr << "Failed to start audio device: " << startResult << std::endl;
                stop();
                return false;
            }

            running.store(true, std::memory_order_release);

            if(!eInitialized) {
                processingThread = std::jthread(&EngineRuntime::processingLoop, this);
                if (!processingThread.joinable()) {
                    running.store(false, std::memory_order_release);
                    return false;
                }
    
                // Raise the thread priority for real-time audio processing
                #if defined(__linux__) || defined(__APPLE__)
                    pthread_t native = processingThread.native_handle();
                    sched_param params {};
                    params.sched_priority = sched_get_priority_max(SCHED_FIFO);
                    pthread_setschedparam(native, SCHED_FIFO, &params);
                #else
                    (void)processingThread;
                #endif
            }

            return true;
        }

        /**
         * Pauses the audio engine. This will stop audio processing but keep the engine initialized.
         * Thread-safe: true, can be called from any thread.
         */
        void pause() {
            ma_device_stop(&device);
            running.store(false, std::memory_order_release);
            TPCircularBufferClear(&outputRing);
        }

        /**
         * Stops the audio engine.
         * Thread-safe: true, can be called from any thread.
         */
        void stop() {
            if(!initialized.load(std::memory_order_acquire)) {
                return;
            }

            running.store(false, std::memory_order_release);
            initialized.store(false, std::memory_order_release);
            ma_device_uninit(&device);
            TPCircularBufferClear(&outputRing);
        }

        // Current time
        std::atomic<uint64_t> currentTime {0};

        /**
         * The main block processing loop.
         * This one runs in batches of audio frames (not in real-time).
         *
         * This loop is relatively dumb and simply executes whatever instructions are in the queue, orchestration is the compiler's job.
         *
         * Inside the loop, we should avoid allocations and be as fast as possible.
         *
         * TODO: There's a LOT of optimization work to be done here, but I'm currently in a big rush, so I'll get it working first 🙏
         */
        void processingLoop() {
            uint32_t blockByteSize = bufferSize * outputChannels * sizeof(float);

            auto nextDeadline = std::chrono::steady_clock::now();
            const auto bufferDuration =
                std::chrono::duration_cast<std::chrono::steady_clock::duration>(
                    std::chrono::duration<double>(
                        static_cast<double>(bufferSize) / sampleRate
                    ));

            // Get a pointer to the scratch buffers for processing
            // Must not move while processing
            std::fill(audioScratchBuffers.begin(), audioScratchBuffers.end(), 0.0f);
            float* buffer = audioScratchBuffers.data();

            float fSampleRate = static_cast<float>(sampleRate);
            uint32_t availableBytes;

            while (initialized.load(std::memory_order_acquire)) {
                if (!running.load(std::memory_order_relaxed)) {
                    nextDeadline += bufferDuration;
                    std::this_thread::sleep_until(nextDeadline);
                    continue;
                }

                // Get the pointer to the output buffer & how many bytes are available
                float* output = static_cast<float*>(TPCircularBufferHead(&outputRing, &availableBytes));

                if(!output || availableBytes < blockByteSize) {
                    // We shouldn't write to cerr here blah blah
                    std::cerr << "AudioRuntime Error: out of space or failed to access the ring buffer, needs " << blockByteSize << " bytes, has " << availableBytes << " bytes, total buffer size is " << outputRing.length << " bytes, fillCount is " << outputRing.fillCount << std::endl;
                    nextDeadline += bufferDuration;
                    std::this_thread::sleep_until(nextDeadline);
                    continue;
                }

                // Clear the master output buffer to avoid garbage data
                std::memset(output, 0, blockByteSize);

                // TODO!!! You know what to do here
                // Clear the scratch buffer to avoid garbage data
                std::memset(buffer, 0, blockByteSize * scratchBufferCount);

                // Fetch events from the queue and process them
                // Should this be done here?
                while (queue.front()) {
                    Merge::Event* command = queue.front();
                    if(command) {
                        if(command->timestamp > currentTime.load(std::memory_order_relaxed)) {
                            break; // Stop processing if the event is scheduled for the future
                        }

                        // This currently processses past events too
                        // std::cout << "Processing event of type: " << static_cast<int>(command->type) << std::endl;

                        switch (command->type) {
                            case Merge::EventType::MIDIEvent: {
                                // Process MIDI event
                                break;
                            }

                            case Merge::EventType::SetParameter: {
                                // Process parameter change event
                                std::cout << "Processing Parameter Change event with timestamp: " << command->timestamp << std::endl;
                                break;
                            }

                            // todo: cerr must be moved out of the audio thread
                            case Merge::EventType::SetUniform: {
                                if(command->node >= program.size()) {
                                    std::cerr << "Error: Node index " << command->node << " is out of bounds for program size " << program.size() << std::endl;
                                    break;
                                }

                                if(command->uniform.index >= 15) {
                                    std::cerr << "Error: Uniform index " << command->uniform.index << " is out of bounds for uniform storage size 15" << std::endl;
                                    break;
                                }

                                program[command->node].uniforms[command->uniform.index] = command->uniform.value;
                                break;
                            }

                            case Merge::EventType::SetMix: {
                                if(command->node >= program.size()) {
                                    std::cerr << "Error: Node index " << command->node << " is out of bounds for program size " << program.size() << std::endl;
                                    break;
                                }

                                program[command->node].left = command->mix.left;
                                program[command->node].right = command->mix.right;
                                break;
                            }

                            case Merge::EventType::SetFlags: {
                                if(command->node >= program.size()) {
                                    std::cerr << "Error: Node index " << command->node << " is out of bounds for program size " << program.size() << std::endl;
                                    break;
                                }

                                program[command->node].flags = command->flags;
                                break;
                            }
                            break;
                        }

                        queue.pop();
                    }
                }

                // Execute the compiled program of audio instructions
                for (const auto& instruction : program) {
                    if (instruction.flags & FlagBypass) {
                        continue; // Skip bypassed
                    }

                    if(instruction.flags & FlagMute) {
                        // TODO: mute should output silence
                        continue;
                    }

                    // todo: this is bad
                    for(uint32_t i = 0; i < instruction.eInputCount; ++i) {
                        // Process event inputs
                        uint32_t eventListIndex = instruction.indexes[i + FIRST_EVENT_INPUT_INDEX_R];
                        if(eventListIndex >= EventLists.size()) {
                            std::cerr << "Error: Event list index " << eventListIndex << " is out of bounds for EventLists size " << EventLists.size() << std::endl;
                            continue;
                        }

                        // TODO: we should advance through lists efficiently (seek via binary search and advance for playback)
                        auto& eventList = EventLists[eventListIndex];
                        for(const auto& event : eventList) {
                            if(event.timestamp > currentTime.load(std::memory_order_relaxed)) {
                                break; // Stop processing if the event is scheduled for the future
                            }

                            // Process the event
                        }
                    }

                    if (instruction.process) {
                        instruction.process(&instruction, buffer, blockByteSize, bufferSize, fSampleRate, outputChannels, currentTime, nullptr);
                    }

                    // Mix in the processed audio to the output buffer if master (output) route is enabled.
                    // This could use SIMD optimizations in the future.
                    // This is also annoyingly currently converting to an interleaved format, though that is necessary for playback so we'd have to do it sooner or later, and this removes the need for a separate buffer per channel.
                    // But it's something to consider in the future.
                    if (instruction.masterFlags != 0) {
                        for(uint32_t i = 0; i < instruction.aOutputCount; ++i) {
                            if(instruction.masterFlags & (1 << i)) {
                                const float* dataBuffer = GET_BUFFER_FLOAT(instruction.indexes[i + FIRST_OUTPUT_INDEX_R]);

                                float left = instruction.left;
                                float right = instruction.right;

                                if (instruction.flags & FlagInvert) {
                                    // Invert the polarity of the audio signal
                                    left = -left;
                                    right = -right;
                                }

                                // todo: idk this forces all nodes to have a scratch even if they just route

                                // Mix the processed audio into the output buffer
                                // Swaps channels if set
                                if(instruction.flags & FlagSwap) {
                                    for (uint32_t i = 0; i < bufferSize; ++i) {
                                        output[0] += dataBuffer[i + bufferSize] * left;
                                        output[1] += dataBuffer[i] * right;
                                        output += 2;
                                    }
                                } else {
                                    for (uint32_t i = 0; i < bufferSize; ++i) {
                                        output[0] += dataBuffer[i] * left;
                                        output[1] += dataBuffer[i + bufferSize] * right;
                                        output += 2;
                                    }
                                }

                                // debug msg
                                std::cout << "Mixing output from node " << &instruction << " output: " << instruction.indexes[i + instruction.aInputCount] << " to master output, left gain: " << left << ", right gain: " << right << ", preview: " << dataBuffer[0] << "," << dataBuffer[1] << std::endl;
                            }
                        }
                    }
                }

                // Usage statistics for performance monitoring
                auto now = std::chrono::steady_clock::now();
                uint16_t usage = std::chrono::duration_cast<std::chrono::duration<uint16_t, std::milli>>(now - nextDeadline).count() / std::chrono::duration_cast<std::chrono::duration<uint16_t, std::milli>>(bufferDuration).count();

                if(sharedState.ptr) {
                    // Another necessary copy >:(
                    // Why do we have zerocopy processing when we still need to copy everything
                    // (this is Electron's fault btw)
                    memcpy(sharedState.data()->sampleHistory, output, blockByteSize);
                    sharedState.data()->usage = usage;
                }

                // Mark the produced bytes as available for reading by the audio callback
                TPCircularBufferProduce(&outputRing, blockByteSize);

                currentTime.fetch_add(bufferSize, std::memory_order_relaxed);
                nextDeadline += bufferDuration; // Time in nanoseconds

                if (now >= nextDeadline) {
                    std::cerr << "Warning: Audio processing is taking too long and is exceeding the buffer deadline, audio data may be dropped" << std::endl;
                }

                // Sleep the remainder of the buffer duration if we finished processing early (well we better do..)
                std::this_thread::sleep_until(nextDeadline);
            }

            // stop();
        }

        /**
         * Audio callback function for playback that consumes audio data from the ring buffer.
         * This is called by the audio device when it needs more audio data.
         *
         * Should avoid any allocations and be as fast as possible.
         */
        static void audioCallback(ma_device* device, void* output, const void*, ma_uint32 frameCount) {
            EngineRuntime* engine = static_cast<EngineRuntime*>(device->pUserData);

            // Get a pointer to the available data in the ring buffer
            uint32_t availableBytes;
            void* ringBufferData = TPCircularBufferTail(&engine->outputRing, &availableBytes);

            // Calculate how many bytes we can read from the ring buffer
            uint32_t bytesToWrite = frameCount * engine->outputChannels * sizeof(float);
            uint32_t bytesToRead = std::min<ma_uint32>(bytesToWrite, availableBytes);

            // Copy the data from the ring buffer to the output buffer
            if (ringBufferData && bytesToRead > 0) {
                std::memcpy(output, ringBufferData, bytesToRead);
                TPCircularBufferConsume(&engine->outputRing, bytesToRead);
                return;
            }

            // If there's not enough data, we fill the rest with silence.
            std::memset(output, 0, bytesToWrite);
        }

        // Eventually we will have a callback for exporting audio to a file or a stream
        static void exportCallback(){}

        /**
         * Creates a VST3 plugin instance.
         * Note: this function is slow as shit, thanks to VST3's amazing architecture design.
         * So VST3 plugin instances should be used sparingly.
         *
         * @param plugin The VST3 plugin to instantiate.
         * @param instance The instance to create.
         * @return True if the plugin was instantiated successfully, false otherwise.
         */
        bool instantiateVST3Plugin(VST3Plugin& plugin, VST3PluginInstance& instance, std::string& error) {
            IPtr<IComponent> component = plugin.provider->getComponentPtr();
            if (!component) {
                error = "Plugin component could not be created";
                return false;
            }

            IAudioProcessor* processorRaw = nullptr;
            if (component->queryInterface(IAudioProcessor::iid, reinterpret_cast<void**>(&processorRaw)) != kResultTrue || !processorRaw) {
                error = "Plugin does not expose IAudioProcessor";
                return false;
            }

            IPtr<IAudioProcessor> processor = owned(processorRaw);

            IEditController* controllerRaw = plugin.provider->getController();
            IPtr<IEditController> controller = controllerRaw ? owned(controllerRaw) : nullptr;

            if (processor->canProcessSampleSize(kSample32) != kResultTrue) {
                error = "Plugin does not support 32-bit sample processing";
                return false;
            }

            const int32 inputBusCount  = component->getBusCount(kAudio, kInput);
            const int32 outputBusCount = component->getBusCount(kAudio, kOutput);

            const SpeakerArrangement stereoArrangement = SpeakerArr::kStereo;
            const SpeakerArrangement monoArrangement =   SpeakerArr::kMono;

            std::vector<SpeakerArrangement> inputArrangements(std::max<int32>(0, inputBusCount));
            std::vector<SpeakerArrangement> outputArrangements(std::max<int32>(0, outputBusCount));

            for (int32 index = 0; index < inputBusCount; ++index) {
                BusInfo info {};
                if (component->getBusInfo(kAudio, kInput, index, info) == kResultTrue) {
                    inputArrangements[static_cast<size_t>(index)] = info.channelCount <= 1 ? monoArrangement : stereoArrangement;
                }
            }

            for (int32 index = 0; index < outputBusCount; ++index) {
                BusInfo info {};
                if (component->getBusInfo(kAudio, kOutput, index, info) == kResultTrue) {
                    outputArrangements[static_cast<size_t>(index)] = info.channelCount <= 1 ? monoArrangement : stereoArrangement;
                }
            }

            if (!inputArrangements.empty() || !outputArrangements.empty()) {
                processor->setBusArrangements(
                    inputArrangements.empty() ? nullptr : inputArrangements.data(),
                    static_cast<int32>(inputArrangements.size()),
                    outputArrangements.empty() ? nullptr : outputArrangements.data(),
                    static_cast<int32>(outputArrangements.size()));
            }

            for (int32 index = 0; index < inputBusCount; ++index) {
                component->activateBus(kAudio, kInput, index, true);
            }
            for (int32 index = 0; index < outputBusCount; ++index) {
                component->activateBus(kAudio, kOutput, index, true);
            }

            if (component->setActive(true) != kResultTrue) {
                error = "Plugin setActive(true) failed";
                return false;
            }

            ProcessSetup processSetup {};
            processSetup.processMode = kRealtime;
            processSetup.symbolicSampleSize = kSample32;
            processSetup.maxSamplesPerBlock = static_cast<int32>(bufferSize);
            processSetup.sampleRate    = static_cast<SampleRate>(sampleRate);

            if (processor->setupProcessing(processSetup) != kResultTrue) {
                error = "Plugin setupProcessing failed";
                return false;
            }

            if (processor->setProcessing(true) != kResultTrue) {
                error = "Plugin setProcessing(true) failed";
                return false;
            }

            instance.component = component;
            instance.processor = processor;
            instance.controller = controller;
            // if (!instance.configured) {
            //     error = "Failed to allocate plugin processing buffers";
            //     return false;
            // }

            return true;
        }
    };
}