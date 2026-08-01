/**
 * @file audio-engine.cpp
 * @brief Audio engine implementation, currently using miniaudio for audio output, powering MetaDAW.
 *
 * A Node addon using V8 headers with Electron compatibility.
 * Tested for Electron v43.2.0
 *
 * @note This code is currently in very early stages.
 * Prebuilt binaries should be available at: https://repo.lstv.space/
*/

#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

// --- Standard headers
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstring>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

// --- Platform headers
#if defined(__linux__) || defined(__APPLE__)
#include <pthread.h>
#endif

// Sadly, this trash is mandatory for Electron >:(
#if defined(ELECTRON)
// These have to match the Electron build's build settings, but of course they do not correctly expose them.
// Sandbox may or may not be required - with the crappy official builds it is most likely enabled.
// In the future I will likely build my own Electron without sandbox so that we can have proper shared memory
#define V8_ENABLE_SANDBOX true
#define V8_COMPRESS_POINTERS
#endif

// --- V8 headers (we don't use node-addon-api here)
#include <v8.h>
using namespace v8;

// --- V8 Utilities
#include "src/Utils.h"

// --- VST3 SDK
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
using namespace Steinberg;
using namespace Steinberg::Vst;

struct alignas(64) SharedState {

};

namespace AudioEngine {

    // -- TEST ONLY
    float phase = 0.0f;
    const float frequency = 440.0f;
    // const float SAMPLE_RATE = 44100.0f;
    const float PI = 3.14159265358979323846f;

    static const unsigned int stateSize = sizeof(SharedState);

    class EngineRuntime {
        // TODO: sort private/public members
    public:
        uint32_t sampleRate; // 44100 Hz & 48000 Hz are common
        uint32_t bufferSize; // 512 samples is common but depends
        uint32_t outputChannels = 2; // Stereo output

        std::atomic<bool> running {false};

        // Shared buffer for the state
        v8::Global<v8::ArrayBuffer> sharedBuffer;
        std::shared_ptr<v8::BackingStore> sharedBackingStore;
        
        // Shared state shared between the audio engine and the main thread
        std::unique_ptr<SharedState> sharedState;

        EngineRuntime(uint32_t sampleRate = 44100, uint32_t bufferSize = 512) : sampleRate(sampleRate), bufferSize(bufferSize) {
            // Initialize the audio engine
        }

        /*
            Sets the external shared state pointer. This should be called before starting the engine.
            Returns true if the shared state was set successfully, false if the engine is already running.
            Thread-safe: true but be careful
        */
        bool setExternalSharedState(void* ptr) {
            if (running.load(std::memory_order_acquire)) {
                return false; // Cannot set shared state while running
            }

            SharedState* state = reinterpret_cast<SharedState*>(ptr);
            sharedState = std::unique_ptr<SharedState>(state);
            return true;
        }

        static void audioCallback(ma_device*, void* output, const void*, ma_uint32 frameCount) {
            float* out = static_cast<float*>(output);

            for (uint32_t i = 0; i < frameCount; i++) {
                float sample = (phase / PI) - 1.0f;

                out[i * 2 + 0] = sample;
                out[i * 2 + 1] = sample;

                phase += 2.0f * PI * frequency / 44100.0f;
                if (phase >= 2.0f * PI)
                    phase -= 2.0f * PI;
            }
        }

        /*
            Start the audio engine. Returns true if the engine was started successfully.
            Thread-safe: true, can be called from any thread.
        */
        bool start(){
            bool expected = false;
            if (!running.compare_exchange_strong(expected, true)) {
                // Return if we are already running
                return true;
            }

            if(!sharedState) {
                return false;
            }

            ma_device_config config = ma_device_config_init(ma_device_type_playback);
            config.playback.format = ma_format_f32;
            config.playback.channels = outputChannels;
            config.sampleRate = sampleRate;
            config.dataCallback = &EngineRuntime::audioCallback;
            config.pUserData = this;

            return true;
        }

        /*
            Stops the audio engine.
            Thread-safe: true, can be called from any thread.
        */
        void stop() {
            // Stop the audio engine
        }
    };

// int main() {
//     ma_device_config config =
//         ma_device_config_init(ma_device_type_playback);

//     config.playback.format   = ma_format_f32;
//     config.playback.channels = 2;
//     config.sampleRate        = SAMPLE_RATE;
//     config.dataCallback      = callback;

//     ma_device device;

//     ma_device_init(nullptr, &config, &device);
//     ma_device_start(&device);

//     while (true) { }
// }

}








// --- Node addon implementation

void js_start(const FunctionCallbackInfo<Value> &args) {
}

void js_stop(const FunctionCallbackInfo<Value> &args) {
}

// Just a simple roundtrip test, returns the frequency of a note given its semitone offset from A4 (440 Hz)
// A healthy engine configuration should be able to handle this, if this fails, there is a problem.
void js_roundTripTest(const FunctionCallbackInfo<Value> &args) {
    if(missingArguments(1, args)) {
        return;
    }

    if(!args[0]->IsInt32()) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "Argument must be an integer", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    float frequency = 440.0f * std::pow(2.0f, static_cast<float>(args[0]->Int32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0)) / 12.0f);
    args.GetReturnValue().Set(Number::New(args.GetIsolate(), frequency));
}

void js_loadVST3(const FunctionCallbackInfo<Value> &args) {
}

void js_setParameter(const FunctionCallbackInfo<Value> &args) {
    // uint32_t id = args[0]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    // float value = static_cast<float>(args[1]->NumberValue(args.GetIsolate()->GetCurrentContext()).FromMaybe(0.0));
    // float targetValue = static_cast<float>(args[2]->NumberValue(args.GetIsolate()->GetCurrentContext()).FromMaybe(0.0));
    // uint32_t flags = args[3]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    // EngineRuntime::instance().enqueueParameter(id, value, targetValue, flags);
    // args.GetReturnValue().Set(Boolean::New(args.GetIsolate(), true));
}

void js_sendMidiEvent(const FunctionCallbackInfo<Value> &args) {
    // uint32_t frameOffset = args[0]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    // v8::Local<v8::Uint8Array> dataArray = args[1].As<v8::Uint8Array>();
    // uint32_t size = dataArray->Length();
    // uint32_t channel = args[2]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);

    // std::vector<uint8_t> midiData(size);
    // dataArray->CopyContents(midiData.data(), size);

    // EngineRuntime::instance().enqueueMidi(frameOffset, midiData.data(), size, channel);
    // args.GetReturnValue().Set(Boolean::New(args.GetIsolate(), true));
}

/**
 * Fuckass Electron doesn't allow shared memory from C++, so we have to do something extremely ugly and let V8 create the memory for us.
 * I don't trust that Electron will ever do anything about it since they will rather say your addon is incompatible rather than doing something reasonable.
 * This is obviously an absolutely horrendous design and can lead to countless issues, but it's the only way to get shared memory working in Electron.
 * I guess a pointless feel of "security" (while having exec?) at the cost of memory corruption is a good tradeoff, right?
 */
struct BufferWeakData {
    // anything you need to identify the buffer
};

auto* weak_data = new BufferWeakData();

void js_attachBuffer(const v8::FunctionCallbackInfo<v8::Value>& args) {
    AudioEngine::EngineRuntime *engine = (AudioEngine::EngineRuntime *)getInternalPointer(args.This());
    v8::Isolate* isolate = args.GetIsolate();

    if(missingArguments(1, args)) {
        return;
    }

    if(!args[0]->IsArrayBuffer()) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "Argument must be an ArrayBuffer", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    auto buffer = args[0].As<v8::ArrayBuffer>();
    if(buffer->ByteLength() != AudioEngine::stateSize) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "ArrayBuffer is the wrong size for shared state (call getSharedBufferSize() to get the correct size)", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    engine->stop();
    engine->sharedBuffer.Reset(isolate, buffer);
    engine->sharedBackingStore = buffer->GetBackingStore();
    engine->setExternalSharedState(engine->sharedBackingStore->Data());

    // Hello world test
    uint8_t* data = static_cast<uint8_t*>(engine->sharedBackingStore->Data());
    data[0] = 123;

    // // Watch for garbage collection of the ArrayBuffer and reset the reference when it happens
    // buffer_ref.SetWeak(weak_data, [](const v8::WeakCallbackInfo<BufferWeakData>& info) {
    //     std::cout << "ArrayBuffer was garbage collected!" << std::endl;
    //     buffer_ref.Reset();
    //     data = nullptr;
    //     backing.reset();
    // }, v8::WeakCallbackType::kParameter);
}

void js_getSharedBufferSize(const v8::FunctionCallbackInfo<v8::Value>& args) {
    unsigned int size = AudioEngine::stateSize;
    args.GetReturnValue().Set(Number::New(args.GetIsolate(), size));
}

struct PerContextData {
    Isolate *isolate;
    Global<Function> engineConstructor;

    /* We hold all instances until free */
    std::vector<std::unique_ptr<AudioEngine::EngineRuntime>> engines;
};

void runtime_constructor(const FunctionCallbackInfo<Value> &args) {
    // NOTE:
    // Before you ask me why are we creating a new class and setting prototypes every time we make an instance:
    // No idea, I took this from uWebSockets.js, when I tried to make a proper constructor, it didn't work (args.This() was different in the constructor than the instance).
    // This obviously seems like a huge performance issue (v8 optimization is thrown out the window), but I don't know how to fix it, and I don't have time to figure it out right now.

    Isolate *isolate = args.GetIsolate();

#if (V8_MAJOR_VERSION >= 14)
    auto *perContextData = (PerContextData *) Local<External>::Cast(args.Data())->Value(0);
#else
    auto *perContextData = (PerContextData *) Local<External>::Cast(args.Data())->Value();
#endif

#define ADD_METHOD(tpl, name, callback) \
    tpl->PrototypeTemplate()->Set( \
        String::NewFromUtf8(isolate, name, NewStringType::kNormal).ToLocalChecked(), \
        FunctionTemplate::New(isolate, callback, args.Data()) \
    );

    Local<FunctionTemplate> tpl = FunctionTemplate::New(isolate);
    tpl->SetClassName(String::NewFromUtf8(isolate, "EngineRuntime", NewStringType::kNormal).ToLocalChecked());
    tpl->InstanceTemplate()->SetInternalFieldCount(1);

    ADD_METHOD(tpl, "start", js_start);
    ADD_METHOD(tpl, "stop", js_stop);
    ADD_METHOD(tpl, "roundTripTest", js_roundTripTest);
    ADD_METHOD(tpl, "attachBuffer", js_attachBuffer);
    ADD_METHOD(tpl, "getSharedBufferSize", js_getSharedBufferSize);
    ADD_METHOD(tpl, "loadVST3", js_loadVST3);
    ADD_METHOD(tpl, "setParameter", js_setParameter);
    ADD_METHOD(tpl, "sendMidiEvent", js_sendMidiEvent);

    Local<Object> localApp = tpl->GetFunction(isolate->GetCurrentContext()).ToLocalChecked()->NewInstance(isolate->GetCurrentContext()).ToLocalChecked();

    /* Create the engine instance */
    AudioEngine::EngineRuntime *engine = new AudioEngine::EngineRuntime();
    // setInternalPointer(localApp, engine);

    localApp->SetAlignedPointerInInternalField(0, engine, 0);

    printf("stored\n");

    if (localApp->InternalFieldCount() > 0) {
        void* ptr = localApp->GetAlignedPointerFromInternalField(0, 0);
    } else {
        // Throw a regular JavaScript error instead of letting V8 abort the process
        isolate->ThrowException(v8::Exception::TypeError(
            v8::String::NewFromUtf8(isolate, "Invalid invocation context").ToLocalChecked()));
        return;
    }

    printf("C %p\n", localApp);
    printf("D %p\n", perContextData);
    printf("E %p\n", engine);

    /* Store for cleanup */
    perContextData->engines.emplace_back(engine);

    args.GetReturnValue().Set(localApp);
}


PerContextData* Main(Isolate *isolate, Local<Object> exports) {
    PerContextData *perContextData = new PerContextData();
    perContextData->isolate = isolate;

    /* Refer to per context data via External */
#if (V8_MAJOR_VERSION >= 14)
    Local<External> externalPerContextData = External::New(isolate, perContextData, 0);
#else
    Local<External> externalPerContextData = External::New(isolate, perContextData);
#endif

    exports->Set(isolate->GetCurrentContext(), String::NewFromUtf8(isolate, "EngineRuntime", NewStringType::kNormal).ToLocalChecked(), FunctionTemplate::New(isolate, runtime_constructor, externalPerContextData)->GetFunction(isolate->GetCurrentContext()).ToLocalChecked()).ToChecked();

    return perContextData;
}

static int loads = 0;

/* This is required when building as a Node.js addon */
#ifndef ADDON_IS_HOST
#include <node.h>
extern "C" NODE_MODULE_EXPORT void
NODE_MODULE_INITIALIZER(Local<Object> exports, Local<Value> module, Local<Context> context) {
    printf("addon init %d\n", ++loads);

    Isolate *isolate = Isolate::GetCurrent();
    PerContextData *perContextData = Main(isolate, exports);

    // /* We cannot rely on process.exit or process.beforeExit when it comes to WorkerThreads */
    node::AddEnvironmentCleanupHook(isolate, [](void *arg) {
        PerContextData *perContextData = (PerContextData *) arg;

        // Cleanup all engine instances
        for (auto &engine : perContextData->engines) {
            std::cout << "Cleaning up engine instance: " << engine.get() << std::endl;

            // Stop the engine if it's running and release shared memory
            if (engine->running.load(std::memory_order_acquire)) {
                engine->stop();
            }

            engine->sharedBuffer.Reset();
            engine->sharedBackingStore.reset();
            engine->sharedState.reset();
            delete engine.release();
        }

        // Cleanup the constructor reference and the per-context data
        // We may meet again
        perContextData->engineConstructor.Reset();
        perContextData->engines.clear();
        delete perContextData;

        // Beware that the program possibly still runs after this.
        // This hook simply calls whenever we reload, so we need to reliably destruct, then be prepared to start again.
    }, perContextData);
}
#endif