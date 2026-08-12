/**
 * @file addon.cpp
 * @brief Node.js addon wrapper for the audio engine
 *
 * Using V8 headers with Electron compatibility, compatible with at least V8 15.
 * Tested for Electron v43.2.0 & Node.js v26.0.0
 *
 * @note This code is currently in very early stages.
 * Prebuilt binaries should be available at: https://repo.lstv.space/
*/

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

// --- V8 Things
#include "src/v8-utils.h"

// I know it's not ideal to do like this but I wanted to split the file.
#include "src/engine.h"

void js_start(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());

    uint8_t startTime = 0;

    // Parse arguments
    if (args.Length() >= 1 && args[0]->IsUint32()) {
        startTime = args[0]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(startTime);
    }

    bool started = engine->start(startTime);
    args.GetReturnValue().Set(Boolean::New(args.GetIsolate(), started));
}

void js_stop(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());
    engine->stop();
}

void js_pause(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());
    engine->pause();
}

void js_loadVST3(const FunctionCallbackInfo<Value> &args) {
    if(missingArguments(1, args)) {
        return;
    }

    // Get the path argument
    v8::String::Utf8Value path(args.GetIsolate(), args[0]);

    std::string error;
    bool success = Merge::loadVST3(*path, error);

    if(!success) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::Error(String::NewFromUtf8(args.GetIsolate(), error.c_str(), NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    args.GetReturnValue().Set(Boolean::New(args.GetIsolate(), true));
}

void js_unloadVST3(const FunctionCallbackInfo<Value> &args) {
    if(missingArguments(1, args)) {
        return;
    }

    // Get the path argument
    v8::String::Utf8Value path(args.GetIsolate(), args[0]);

    std::string error;
    bool success = Merge::unloadVST3(*path, error);
    if(!success) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::Error(String::NewFromUtf8(args.GetIsolate(), error.c_str(), NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    args.GetReturnValue().Set(Boolean::New(args.GetIsolate(), true));
}

void js_setUniform(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());

    if(missingArguments(4, args)) {
        return;
    }

    if(!args[0]->IsUint32()) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "Argument timestamp must be an unsigned integer", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    Merge::Event event;
    event.type = Merge::EventType::SetUniform;
    event.timestamp = args[0]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    event.node = args[1]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    event.uniform.index = args[2]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    event.uniform.value = static_cast<float>(args[3]->NumberValue(args.GetIsolate()->GetCurrentContext()).FromMaybe(0.0));
    engine->queue.push(event);
}

void js_setMix(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());

    if(missingArguments(4, args)) {
        return;
    }

    if(!args[0]->IsUint32()) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "Argument timestamp must be an unsigned integer", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    Merge::Event event;
    event.type = Merge::EventType::SetMix;
    event.timestamp = args[0]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    event.node = args[1]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    event.mix.left = static_cast<float>(args[2]->NumberValue(args.GetIsolate()->GetCurrentContext()).FromMaybe(1.0));
    event.mix.right = static_cast<float>(args[3]->NumberValue(args.GetIsolate()->GetCurrentContext()).FromMaybe(1.0));
    engine->queue.push(event);
}

void js_setPan(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());

    if(missingArguments(5, args)) {
        return;
    }

    if(!args[0]->IsUint32()) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "Argument timestamp must be an unsigned integer", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    Merge::Event event;
    event.type = Merge::EventType::SetMix;
    event.timestamp = args[0]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    event.node = args[1]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);

    float pan = static_cast<float>(args[2]->NumberValue(args.GetIsolate()->GetCurrentContext()).FromMaybe(0.0));
    float gain = static_cast<float>(args[3]->NumberValue(args.GetIsolate()->GetCurrentContext()).FromMaybe(1.0));

    // Convert pan value to left and right channel values
    event.mix.left =  std::cos((pan + 1.0f) * (M_PI / 4.0f)) * gain;
    event.mix.right = std::sin((pan + 1.0f) * (M_PI / 4.0f)) * gain;
    engine->queue.push(event);
}

void js_setFlags(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());

    if(missingArguments(3, args)) {
        return;
    }

    if(!args[0]->IsUint32()) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "Argument timestamp must be an unsigned integer", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    Merge::Event event;
    event.type = Merge::EventType::SetFlags;
    event.timestamp = args[0]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    event.node = args[1]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    event.flags = static_cast<uint8_t>(args[2]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0));
    engine->queue.push(event);
}

void js_enqueueMidi(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());
    
    Merge::Event event;
    event.type =         Merge::EventType::MIDIEvent;
    event.timestamp =    args[0]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    event.node =         args[1]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    event.midi.type =    static_cast<uint8_t> (args[2]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0));
    event.midi.channel = static_cast<uint8_t> (args[3]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0));
    event.midi.note =    static_cast<uint16_t>(args[4]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0));
    event.midi.bend =    static_cast<uint8_t> (args[5]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0));
    engine->queue.push(event);
}

void js_setParam(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());
    // todo
}

void js_debugPrintProgram(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());
    for(size_t i = 0; i < engine->program.size(); ++i) {
        Merge::AudioInstruction& instruction = engine->program[i];

        std::cout << "Instruction " << i <<
            ": fn=" << instruction.process <<
            ", toMaster=" << (instruction.masterFlags & FlagOut0Master) << "," << (instruction.masterFlags & FlagOut1Master) << "," << (instruction.masterFlags & FlagOut2Master) << "," << (instruction.masterFlags & FlagOut3Master) << "," << (instruction.masterFlags & FlagOut4Master) << "," << (instruction.masterFlags & FlagOut5Master) << "," << (instruction.masterFlags & FlagOut6Master) << "," << (instruction.masterFlags & FlagOut7Master) <<
            ", mute=" << (instruction.flags & FlagMute) << ", bypass=" << (instruction.flags & FlagBypass) << ", left=" << instruction.left << ", right=" << instruction.right;

        for(uint8_t j = 0; j < instruction.inputCount; ++j) {
            std::cout << ", i[" << (int)j << "]=" << static_cast<int>(instruction.inputs[j]);
        }

        for(uint8_t j = 0; j < instruction.outputCount; ++j) {
            std::cout << ", o[" << (int)j << "]=" << static_cast<int>(instruction.outputs[j]);
        }

        for(uint8_t j = 0; j < 15; ++j) {
            std::cout << ", u" << (int)j << "=" << instruction.uniforms[j];
        }

        std::cout << std::endl;
    }
}

void js_uploadProgram(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());

    if(missingArguments(1, args)) {
        return;
    }

    if(!args[0]->IsArrayBuffer()) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "Argument must be an ArrayBuffer", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    auto buffer = args[0].As<v8::ArrayBuffer>();
    if(buffer->ByteLength() % sizeof(Merge::AudioInstruction) != 0) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "ArrayBuffer size must be a multiple of AudioInstruction size", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    // Process and update to the compiled program from JS
    size_t instructionCount = buffer->ByteLength() / sizeof(Merge::AudioInstruction);
    Merge::AudioInstruction* instructions = static_cast<Merge::AudioInstruction*>(buffer->GetBackingStore()->Data());

    // JS uploads instruction process functions as registry indexes, so we have an extra pass to resolve them to function pointers.
    for(size_t i = 0; i < instructionCount; ++i) {
        // Convert the registry index to a function pointer and assign it to the instruction's process function

        uint64_t id = reinterpret_cast<uint64_t>(instructions[i].process);
        if(id >= gProcessFunctionRegistry.size()) {
            args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "AudioInstruction processor index is out of bounds", NewStringType::kNormal).ToLocalChecked())));
            return;
        }

        instructions[i].process = gProcessFunctionRegistry[id];

        if (instructions[i].process == nullptr) {
            args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "AudioInstruction processor index must be valid", NewStringType::kNormal).ToLocalChecked())));
            return;
        }
    }

    // Copy the instructions into the engine's program
    engine->program.assign(instructions, instructions + instructionCount);

    // For debug, print the instructions
    js_debugPrintProgram(args);
}

void js_dynamicReplaceNode(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());

    if(missingArguments(2, args)) {
        return;
    }

    if(!args[0]->IsArrayBuffer()) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "Argument must be an ArrayBuffer", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    if(!args[1]->IsUint32()) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "Argument must be an unsigned integer", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    uint32_t nodeIndex = args[1]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    if(nodeIndex >= engine->program.size()) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "Node index is out of bounds", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    auto buffer = args[0].As<v8::ArrayBuffer>();
    if(buffer->ByteLength() != sizeof(Merge::AudioInstruction)) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "ArrayBuffer size must match AudioInstruction size", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    Merge::AudioInstruction* instruction = static_cast<Merge::AudioInstruction*>(buffer->GetBackingStore()->Data());
    engine->program[nodeIndex] = *instruction;
}

void js_destroyRuntime(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());
    setInternalPointer(args.This(), nullptr);
    delete engine;
}

void js_createMidiList(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());
    engine->midiLists.emplace_back(); // Add a new MIDIList to the vector
    uint32_t index = static_cast<uint32_t>(engine->midiLists.size() - 1); // Get the index of the newly added MIDIList
    args.GetReturnValue().Set(Number::New(args.GetIsolate(), index)); // Return the index to JavaScript
}

/**
 * Electron doesn't allow shared memory from C++, so we have to do something extremely ugly and let V8 create the memory for us.
 */
void js_attachBuffer(const v8::FunctionCallbackInfo<v8::Value>& args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());
    if(missingArguments(1, args)) {
        return;
    }

    if(!args[0]->IsArrayBuffer()) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "Argument must be an ArrayBuffer", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    auto buffer = args[0].As<v8::ArrayBuffer>();
    if(buffer->ByteLength() != Merge::stateSize) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "ArrayBuffer is the wrong size for shared state (call getSharedBufferSize() to get the correct size)", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    engine->stop();
    v8::Isolate* isolate = args.GetIsolate();

    engine->sharedBuffer.Reset(isolate, buffer);
    engine->sharedBackingStore = buffer->GetBackingStore();

    if(!engine->setExternalSharedState(engine->sharedBackingStore->Data())) {
        std::cerr << "Failed to set external shared state." << std::endl;
        args.GetReturnValue().Set(Boolean::New(isolate, false));
        return;
    }
    args.GetReturnValue().Set(Boolean::New(isolate, true));
}

void js_running(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());
    args.GetReturnValue().Set(Boolean::New(args.GetIsolate(), engine->running.load(std::memory_order_acquire)));
}

void js_currentTime(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());
    // args.GetReturnValue().Set(Number::New(args.GetIsolate(), engine->currentTime.load(std::memory_order_acquire)));
    args.GetReturnValue().Set(Number::New(args.GetIsolate(), engine->currentTime.load(std::memory_order_relaxed)));
}

void js_setTime(const FunctionCallbackInfo<Value> &args) {
    Merge::EngineRuntime *engine = (Merge::EngineRuntime *)getInternalPointer(args.This());
    if(missingArguments(1, args)) {
        return;
    }

    if(!args[0]->IsUint32()) {
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::TypeError(String::NewFromUtf8(args.GetIsolate(), "Argument must be an unsigned integer", NewStringType::kNormal).ToLocalChecked())));
        return;
    }

    uint32_t newTime = args[0]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
    engine->currentTime.store(newTime, std::memory_order_relaxed);
    args.GetReturnValue().Set(Boolean::New(args.GetIsolate(), true));
}

void js_getSharedBufferSize(const v8::FunctionCallbackInfo<v8::Value>& args) {
    unsigned int size = Merge::stateSize;
    args.GetReturnValue().Set(Number::New(args.GetIsolate(), size));
}

struct PerContextData {
    Isolate *isolate;

    /* We hold all instances until free */
    std::vector<std::unique_ptr<Merge::EngineRuntime>> engines;
};


// --- Constructor for the runtime class
void runtime_constructor(const FunctionCallbackInfo<Value> &args) {
    Isolate *isolate = args.GetIsolate();

    uint32_t sampleRate         = 44100;
    uint16_t bufferSize         = 512;
    uint16_t scratchBufferCount = 64;
    uint8_t  outputChannels     = 2;

    // Parse arguments
    if (args.Length() >= 1 && args[0]->IsUint32()) {
        sampleRate = args[0]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(sampleRate);
    }

    if (args.Length() >= 2 && args[1]->IsUint32()) {
        bufferSize = args[1]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(bufferSize);
    }

    if (args.Length() >= 3 && args[2]->IsUint32()) {
        scratchBufferCount = args[2]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(scratchBufferCount);
    }

    if (args.Length() >= 4 && args[3]->IsUint32()) {
        outputChannels = args[3]->Uint32Value(args.GetIsolate()->GetCurrentContext()).FromMaybe(outputChannels);
    }

    /* Create the engine instance that will be bound to this runtime */
    Merge::EngineRuntime *engine = new Merge::EngineRuntime(sampleRate, bufferSize, scratchBufferCount, outputChannels);

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

// --- Node addon API wrapper ---
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
    __ADD_METHOD(runtime, "attachBuffer", js_attachBuffer);
    __ADD_METHOD(runtime, "getSharedBufferSize", js_getSharedBufferSize);
    __ADD_METHOD(runtime, "setUniform", js_setUniform);
    __ADD_METHOD(runtime, "setMix", js_setMix);
    __ADD_METHOD(runtime, "setPan", js_setPan);
    __ADD_METHOD(runtime, "setFlags", js_setFlags);
    __ADD_METHOD(runtime, "enqueueMidi", js_enqueueMidi);
    __ADD_METHOD(runtime, "setParam", js_setParam);
    __ADD_METHOD(runtime, "createVSTInstance", js_loadVST3);
    __ADD_METHOD(runtime, "uploadProgram", js_uploadProgram);
    __ADD_METHOD(runtime, "dynamicReplaceNode", js_dynamicReplaceNode);
    __ADD_METHOD(runtime, "debugPrintProgram", js_debugPrintProgram);
    __ADD_METHOD(runtime, "start", js_start);
    __ADD_METHOD(runtime, "pause", js_pause);
    __ADD_METHOD(runtime, "stop", js_stop);
    __ADD_METHOD(runtime, "isRunning", js_running);
    __ADD_METHOD(runtime, "currentTime", js_currentTime);
    __ADD_METHOD(runtime, "destroy", js_destroyRuntime);
    __ADD_METHOD(runtime, "createMidiList", js_createMidiList);
    EXPORT_CLASS(exports, runtime, "EngineRuntime");

    // Set version
    exports->Set(isolate->GetCurrentContext(), String::NewFromUtf8(isolate, "version", NewStringType::kNormal).ToLocalChecked(), String::NewFromUtf8(isolate, "0.1.0", NewStringType::kNormal).ToLocalChecked()).ToChecked();

    // Add a loadVST3 function to the exports
    exports->Set(isolate->GetCurrentContext(), String::NewFromUtf8(isolate, "loadVST3", NewStringType::kNormal).ToLocalChecked(), Function::New(isolate->GetCurrentContext(), js_loadVST3).ToLocalChecked()).ToChecked();
    exports->Set(isolate->GetCurrentContext(), String::NewFromUtf8(isolate, "unloadVST3", NewStringType::kNormal).ToLocalChecked(), Function::New(isolate->GetCurrentContext(), js_unloadVST3).ToLocalChecked()).ToChecked();

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

    /* We cannot rely on process.exit or process.beforeExit when it comes to WorkerThreads */
    node::AddEnvironmentCleanupHook(isolate, [](void *arg) {
        std::cout << "Merge: Cleaning up." << std::endl;

        PerContextData *perContextData = (PerContextData *) arg;

        // Cleanup all engine instances
        for (auto &engine : perContextData->engines) {
            std::cout << "Cleaning up engine instance: " << engine.get() << std::endl;
            delete engine.release();
        }

        perContextData->isolate = nullptr;
        perContextData->engines.clear();
        delete perContextData;

        // I also hope this does not create memory leaks but if it does blame Electron
    }, perContextData);
}
#endif