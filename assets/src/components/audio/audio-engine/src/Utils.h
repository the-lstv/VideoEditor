#pragma once

#include <v8.h>
using namespace v8;

/* Getting internal pointer is different in recent V8 versions */
#if (V8_MAJOR_VERSION >= 14)
    inline void *getInternalPointer(const Local<Object> &holder, int index = 0) {
        return holder->GetAlignedPointerFromInternalField(index, 0); // What is the order or change here exactly?
    }

    inline void setInternalPointer(const Local<Object> &holder, void *value, int index = 0) {
        holder->SetAlignedPointerInInternalField(index, value, 0);
    }
#else
    inline void *getInternalPointer(const Local<Object> &holder, int index = 0) {
        return holder->GetAlignedPointerFromInternalField(index);
    }

    inline void setInternalPointer(const Local<Object> &holder, void *value, int index = 0) {
        holder->SetAlignedPointerInInternalField(index, value);
    }
#endif

static inline bool missingArguments(int length, const FunctionCallbackInfo<Value> &args) {
    if (args.Length() < length) {
        std::string message = "Function requires at least ";
        message += std::to_string(length);
        message += " arguments.";
        args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::Error(String::NewFromUtf8(args.GetIsolate(), message.c_str(), NewStringType::kNormal).ToLocalChecked())));
        return true;
    }
    return false;
}

template <bool AllowStringView = false>
class NativeString {
    char *data;
    size_t length;
    bool allocated = false;
    bool invalid = false;

    // Static thread-local state shared by all NativeString instances on this thread
    inline static thread_local std::vector<char> pool = std::vector<char>(128 * 1024);
    inline static thread_local size_t pool_offset = 0;
    inline static thread_local int ref_count = 0;

    static char* alloc(size_t size) {
        // Ensure size is a multiple of 8
        size = (size + 7) & ~7;

        // Fallback for allocations larger than the remaining pool space
        if (pool_offset + size > pool.size()) {
            // Mark for external cleanup if using instance-based logic
            // (Note: In a pure static alloc, you'd need a way to track this)
            return (char*)std::malloc(size);
        }

        char* ptr = pool.data() + pool_offset;
        pool_offset += size;
        return ptr;
    }

    // Provided for completeness, though the "pool" doesn't actually free individual slices
    static void free(char* ptr) {
        if (ptr < pool.data() || ptr >= pool.data() + pool.size()) {
            ::free(ptr);
        }
    }

public:
    NativeString(Isolate *isolate, const Local<Value> &value) {
        if (ref_count == 0) {
            pool_offset = 0; // Reset the "stack" when entering the first scope
        }
        ref_count++;

        if (value->IsUndefined()) {
            data = nullptr;
            length = 0;
        } else if (value->IsString()) {
            Local<String> string = Local<String>::Cast(value);

            /* StringView path is Latin-1, not Utf-8 */

            #if (V8_MAJOR_VERSION >= 14)
                // Fallback
                length = string->Utf8LengthV2(isolate);
                data = alloc(length);
                allocated = true;
                string->WriteUtf8V2(isolate, data, length);
            #else
                // Fallback
                length = string->Utf8Length(isolate);
                data = alloc(length);
                allocated = true;
                string->WriteUtf8(isolate, data, length, nullptr, String::WriteOptions::NO_NULL_TERMINATION);
            #endif


        } else if (value->IsArrayBufferView()) { /* DataView or TypedArray */
            Local<ArrayBufferView> arrayBufferView = Local<ArrayBufferView>::Cast(value);
            auto contents = arrayBufferView->Buffer()->GetBackingStore();
            length = arrayBufferView->ByteLength();
            data = (char *) contents->Data() + arrayBufferView->ByteOffset();
        } else if (value->IsArrayBuffer()) {
            Local<ArrayBuffer> arrayBuffer = Local<ArrayBuffer>::Cast(value);
            auto contents = arrayBuffer->GetBackingStore();
            length = contents->ByteLength();
            data = (char *) contents->Data();
        } else if (value->IsSharedArrayBuffer()) {
            Local<SharedArrayBuffer> arrayBuffer = Local<SharedArrayBuffer>::Cast(value);
            auto contents = arrayBuffer->GetBackingStore();
            length = contents->ByteLength();
            data = (char *) contents->Data();
        } else {
            invalid = true;
        }
    }

    bool isInvalid(const FunctionCallbackInfo<Value> &args) {
        if (invalid) {
            args.GetReturnValue().Set(args.GetIsolate()->ThrowException(v8::Exception::Error(String::NewFromUtf8(args.GetIsolate(), "Text and data can only be passed by String, ArrayBuffer or ArrayBufferView.", NewStringType::kNormal).ToLocalChecked())));
        }
        return invalid;
    }

    std::string_view getString() {
        return {data, length};
    }

    ~NativeString() {
        ref_count--;
        if (allocated) {
            free(data);
        }
    }
};