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

// Sadly, this is mandatory for Electron >:(
#if defined(ELECTRON)
// These have to match the Electron build's build settings (of course they do not correctly expose them).
// Sandbox may or may not be required - with the official builds it is most likely enabled.
// In the future I will likely build my own Electron without sandbox so that we can have proper shared memory

// New idea, I was thinking I'd make my own renderer entirely and ditch Electron.. If I had the guarantee it won't just be a waste of time that nobody even sees I'd do it
// But who am I kidding, you are not reading this anyway. Wait...
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

// Some helpers to make the code a bit more readable & compact
#define CREATE_CLASS(tpl, constructor, name, fc) \
    Local<FunctionTemplate> tpl = FunctionTemplate::New(isolate, constructor, externalPerContextData); \
    tpl->SetClassName(String::NewFromUtf8(isolate, name, NewStringType::kNormal).ToLocalChecked()); \
    tpl->InstanceTemplate()->SetInternalFieldCount(fc);

#define EXPORT_CLASS(exports, tpl, name) \
    exports->Set(isolate->GetCurrentContext(), String::NewFromUtf8(isolate, name, NewStringType::kNormal).ToLocalChecked(), tpl->GetFunction(isolate->GetCurrentContext()).ToLocalChecked()).ToChecked();


#define __ADD_METHOD(tpl, name, callback) \
    tpl->PrototypeTemplate()->Set( \
        String::NewFromUtf8(isolate, name, NewStringType::kNormal).ToLocalChecked(), \
        FunctionTemplate::New(isolate, callback, externalPerContextData) \
    );

// Layout for the runtime shared state
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
            if(!sharedState) {
                return false;
            }

            bool expected = false;
            if (!running.compare_exchange_strong(expected, true)) {
                // Return if we are already running
                return true;
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
    AudioEngine::EngineRuntime *engine = (AudioEngine::EngineRuntime *)getInternalPointer(args.This());
    bool started = engine->start();
    args.GetReturnValue().Set(Boolean::New(args.GetIsolate(), started));
}

void js_stop(const FunctionCallbackInfo<Value> &args) {
    AudioEngine::EngineRuntime *engine = (AudioEngine::EngineRuntime *)getInternalPointer(args.This());
    engine->stop();
}

// Just a simple roundtrip test
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
}

void js_sendMidiEvent(const FunctionCallbackInfo<Value> &args) {
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
struct PerContextData {
    Isolate *isolate;
    Global<Function> engineConstructor;

    /* We hold all instances until free */
    std::vector<std::unique_ptr<AudioEngine::EngineRuntime>> engines;
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
}

void js_getSharedBufferSize(const v8::FunctionCallbackInfo<v8::Value>& args) {
    unsigned int size = AudioEngine::stateSize;
    args.GetReturnValue().Set(Number::New(args.GetIsolate(), size));
}

// Let's go! I finally managed to get this working correctly
// It's a small thing but the feeling when it doesn't instantly coredump is quite strange
void runtime_constructor(const FunctionCallbackInfo<Value> &args) {
    Isolate *isolate = args.GetIsolate();

    /* Create the engine instance that will be bound to this runtime */
    AudioEngine::EngineRuntime *engine = new AudioEngine::EngineRuntime();

    Local<Object> localApp = args.This();
    setInternalPointer(localApp, engine);

    /* Store for cleanup */
    #if (V8_MAJOR_VERSION >= 14)
        auto *perContextData = (PerContextData *) Local<External>::Cast(args.Data())->Value(0);
    #else
        auto *perContextData = (PerContextData *) Local<External>::Cast(args.Data())->Value();
    #endif
    perContextData->engines.emplace_back(engine);
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

    CREATE_CLASS(runtime, runtime_constructor, "EngineRuntime", 1);
    __ADD_METHOD(runtime, "start", js_start);
    __ADD_METHOD(runtime, "stop", js_stop);
    __ADD_METHOD(runtime, "roundTripTest", js_roundTripTest);
    __ADD_METHOD(runtime, "attachBuffer", js_attachBuffer);
    __ADD_METHOD(runtime, "getSharedBufferSize", js_getSharedBufferSize);
    __ADD_METHOD(runtime, "loadVST3", js_loadVST3);
    __ADD_METHOD(runtime, "setParameter", js_setParameter);
    __ADD_METHOD(runtime, "sendMidiEvent", js_sendMidiEvent);
    EXPORT_CLASS(exports, runtime, "EngineRuntime");
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

        // I also hope this does not create memory leaks but if it does blame Electron
    }, perContextData);
}
#endif