/**
 * @file audio-engine.cpp
 * @brief Audio engine implementation using miniaudio
 *
 * A Node addon (using V8 headers directly avoiding node-addon-api).
 *
 * @note This code is currently in very early stages.
*/

#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

// For the Node.js addon
#include <v8.h>
using namespace v8;

#include <cstdint>

#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/utility/optional.h"

#include "public.sdk/samples/vst-hosting/audiohost/source/audiohost.h"
#include "public.sdk/samples/vst-hosting/audiohost/source/platform/appinit.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/utility/stringconvert.h"
#include "base/source/fcommandline.h"
#include "pluginterfaces/base/funknown.h"
#include "pluginterfaces/base/fstrdefs.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/gui/iplugviewcontentscalesupport.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/vsttypes.h"

using namespace Steinberg;
using namespace Steinberg::Vst;

struct AudioNode {
    virtual ~AudioNode() = default;
};

struct MixerNode : public AudioNode {
    virtual void process(float* output, int numSamples) = 0;
};

const int SAMPLE_RATE = 48000;
const int BUFFER_SIZE = 512;
const int NUM_CHANNELS = 2;
const int NUM_BUFFERS = 4;
const int MAX_LATENCY_MS = 100;

const float PI = 3.14159265358979323846f;

float phase = 0;
float frequency = 440.0f;

template <typename T> int sign(T val) {
    return (T(0) < val) - (val < T(0));
}

void callback(
    ma_device* device,
    void* output,
    const void* input,
    ma_uint32 frameCount
) {
    float* out = (float*)output;

    for (uint32_t i = 0; i < frameCount; i++) {
        float sample = (phase / PI) - 1.0f;

        out[i * 2 + 0] = sample;
        out[i * 2 + 1] = sample;

        phase += 2.0f * PI * frequency / SAMPLE_RATE;
        if (phase >= 2.0f * PI)
            phase -= 2.0f * PI;
    }
}

int main() {
    ma_device_config config =
        ma_device_config_init(ma_device_type_playback);

    config.playback.format   = ma_format_f32;
    config.playback.channels = NUM_CHANNELS;
    config.sampleRate        = SAMPLE_RATE;
    config.dataCallback      = callback;

    ma_device device;

    ma_device_init(nullptr, &config, &device);
    ma_device_start(&device);

    while (true) { }
}

int test_loadVST() {
    std::string error;
    std::string path = "/home/lstv/Downloads/test/metadaw.vst3";

    VST3::Hosting::Module::Ptr module = 
        VST3::Hosting::Module::create(path, error);
    if (! module)
        return -1;

    IPtr<PlugProvider> plugProvider;
    VST3::Optional<VST3::UID> effectID = std::move(VST3::UID());
    for (auto& classInfo : module->
        getFactory().classInfos())
    {
        if (classInfo.category() == kVstAudioEffectClass)
        {
            if (effectID)
            {
                if (*effectID != classInfo.ID())
                    continue;
            }
                plugProvider = owned(new 
                    PlugProvider(module->getFactory(), 
                    classInfo, true));
                break;
        }
    }

    if (! plugProvider)
        return -1;
}


/* This is required when building as a Node.js addon */
#ifndef ADDON_IS_HOST
#include <node.h>
extern "C" NODE_MODULE_EXPORT void
NODE_MODULE_INITIALIZER(Local<Object> exports, Local<Value> module, Local<Context> context) {
    Isolate *isolate = Isolate::GetCurrent();
    
    exports->Set(context, String::NewFromUtf8(isolate, "startAudioEngine").ToLocalChecked(),
        FunctionTemplate::New(isolate, [](const FunctionCallbackInfo<Value>& args) {
            main();
        })->GetFunction(context).ToLocalChecked()).Check();
    
    exports->Set(context, String::NewFromUtf8(isolate, "test_loadVST").ToLocalChecked(),
        FunctionTemplate::New(isolate, [](const FunctionCallbackInfo<Value>& args) {
            test_loadVST();
        })->GetFunction(context).ToLocalChecked()).Check();

    // /* We cannot rely on process.exit or process.beforeExit when it comes to WorkerThreads */
    // node::AddEnvironmentCleanupHook(isolate, [](void *arg) {
    // }, perContextData);
}
#endif