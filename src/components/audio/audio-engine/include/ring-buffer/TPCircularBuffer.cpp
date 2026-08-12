//
//  TPCircularBuffer.c
//  Circular/Ring buffer implementation
//
//  https://github.com/michaeltyson/TPCircularBuffer
//
//  Created by Michael Tyson on 10/12/2011.
//
//  Copyright (C) 2012-2013 A Tasty Pixel
//
//  This software is provided 'as-is', without any express or implied
//  warranty.  In no event will the authors be held liable for any damages
//  arising from the use of this software.
//
//  Permission is granted to anyone to use this software for any purpose,
//  including commercial applications, and to alter it and redistribute it
//  freely, subject to the following restrictions:
//
//  1. The origin of this software must not be misrepresented; you must not
//     claim that you wrote the original software. If you use this software
//     in a product, an acknowledgment in the product documentation would be
//     appreciated but is not required.
//
//  2. Altered source versions must be plainly marked as such, and must not be
//     misrepresented as being the original software.
//
//  3. This notice may not be removed or altered from any source distribution.
//

//  Modified by thelstv in August 2026

#include "TPCircularBuffer.h"
#if defined(__APPLE__)
#include <mach/mach.h>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

static inline uint32_t round_page(uint32_t length) {
    long pageSize = sysconf(_SC_PAGESIZE);
    return (uint32_t)(((size_t)length + (size_t)pageSize - 1) & ~((size_t)pageSize - 1));
}
#endif
#include <stdio.h>
#include <stdlib.h>

#if defined(__APPLE__)
    #define reportResult(result,operation) (_reportResult((result),(operation),strrchr(__FILE__, '/')+1,__LINE__))
    static inline bool _reportResult(kern_return_t result, const char *operation, const char* file, int line) {
        if ( result != ERR_SUCCESS ) {
            printf("%s:%d: %s: %s\n", file, line, operation, mach_error_string(result)); 
            return false;
        }
        return true;
    }
#endif

bool _TPCircularBufferInit(TPCircularBuffer *buffer, uint32_t length, size_t structSize) {
    
    assert(length > 0);
    
    if ( structSize != sizeof(TPCircularBuffer) ) {
        fprintf(stderr, "TPCircularBuffer: Header version mismatch. Check for old versions of TPCircularBuffer in your project\n");
        abort();
    }
    
    // Keep trying until we get our buffer, needed to handle race conditions
    int retries = 3;
    while ( true ) {

        buffer->length = (uint32_t)round_page(length);    // We need whole page sizes

        #if defined(__APPLE__)
            // Temporarily allocate twice the length, so we have the contiguous address space to
            // support a second instance of the buffer directly after
            vm_address_t bufferAddress;
            kern_return_t result = vm_allocate(mach_task_self(),
                                            &bufferAddress,
                                            buffer->length * 2,
                                            VM_FLAGS_ANYWHERE); // allocate anywhere it'll fit
            if ( result != ERR_SUCCESS ) {
                if ( retries-- == 0 ) {
                    reportResult(result, "Buffer allocation");
                    return false;
                }
                // Try again if we fail
                continue;
            }
            
            // Now replace the second half of the allocation with a virtual copy of the first half. Deallocate the second half...
            result = vm_deallocate(mach_task_self(),
                                bufferAddress + buffer->length,
                                buffer->length);
            if ( result != ERR_SUCCESS ) {
                if ( retries-- == 0 ) {
                    reportResult(result, "Buffer deallocation");
                    return false;
                }
                // If this fails somehow, deallocate the whole region and try again
                vm_deallocate(mach_task_self(), bufferAddress, buffer->length);
                continue;
            }
            
            // Re-map the buffer to the address space immediately after the buffer
            vm_address_t virtualAddress = bufferAddress + buffer->length;
            vm_prot_t cur_prot, max_prot;
            result = vm_remap(mach_task_self(),
                            &virtualAddress,   // mirror target
                            buffer->length,    // size of mirror
                            0,                 // auto alignment
                            0,                 // force remapping to virtualAddress
                            mach_task_self(),  // same task
                            bufferAddress,     // mirror source
                            0,                 // MAP READ-WRITE, NOT COPY
                            &cur_prot,         // unused protection struct
                            &max_prot,         // unused protection struct
                            VM_INHERIT_DEFAULT);
            if ( result != ERR_SUCCESS ) {
                if ( retries-- == 0 ) {
                    reportResult(result, "Remap buffer memory");
                    return false;
                }
                // If this remap failed, we hit a race condition, so deallocate and try again
                vm_deallocate(mach_task_self(), bufferAddress, buffer->length);
                continue;
            }
            
            if ( virtualAddress != bufferAddress+buffer->length ) {
                // If the memory is not contiguous, clean up both allocated buffers and try again
                if ( retries-- == 0 ) {
                    printf("Couldn't map buffer memory to end of buffer\n");
                    return false;
                }

                vm_deallocate(mach_task_self(), virtualAddress, buffer->length);
                vm_deallocate(mach_task_self(), bufferAddress, buffer->length);
                continue;
            }
            
            buffer->buffer = (void*)bufferAddress;
            buffer->fillCount = 0;
            buffer->head = buffer->tail = 0;
            buffer->atomic = true;
            
            return true;
        #else
            // Temporarily allocate twice the length, so we have the contiguous address space to
            // support a second instance of the buffer directly after
            char shmName[64];
            void *bufferAddress;
            void *virtualAddress;
            int fd;

            snprintf(shmName, sizeof(shmName), "/TPCircularBuffer-%d-%p", getpid(), (void*)buffer);
            fd = shm_open(shmName, O_RDWR | O_CREAT | O_EXCL, 0600);
            if ( fd == -1 ) {
                if ( retries-- == 0 ) {
                    printf("Buffer allocation\n");
                    return false;
                }
                continue;
            }

            shm_unlink(shmName);

            if ( ftruncate(fd, buffer->length) != 0 ) {
                close(fd);
                if ( retries-- == 0 ) {
                    printf("Buffer allocation\n");
                    return false;
                }
                continue;
            }

            bufferAddress = mmap(NULL, buffer->length * 2, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
            if ( bufferAddress == MAP_FAILED ) {
                close(fd);
                if ( retries-- == 0 ) {
                    printf("Buffer allocation\n");
                    return false;
                }
                continue;
            }

            if ( mmap(bufferAddress,
                        buffer->length,
                        PROT_READ | PROT_WRITE,
                        MAP_SHARED | MAP_FIXED,
                        fd,
                        0) == MAP_FAILED ) {
                munmap(bufferAddress, buffer->length * 2);
                close(fd);
                if ( retries-- == 0 ) {
                    printf("Buffer deallocation\n");
                    return false;
                }
                continue;
            }

            virtualAddress = mmap((char*)bufferAddress + buffer->length,
                                    buffer->length,
                                    PROT_READ | PROT_WRITE,
                                    MAP_SHARED | MAP_FIXED,
                                    fd,
                                    0);
            close(fd);
            if ( virtualAddress == MAP_FAILED ) {
                munmap(bufferAddress, buffer->length * 2);
                if ( retries-- == 0 ) {
                    printf("Remap buffer memory\n");
                    return false;
                }
                continue;
            }

            if ( virtualAddress != (void*)((char*)bufferAddress + buffer->length) ) {
                munmap(bufferAddress, buffer->length * 2);
                if ( retries-- == 0 ) {
                    printf("Couldn't map buffer memory to end of buffer\n");
                    return false;
                }
                continue;
            }

            buffer->buffer = bufferAddress;
            buffer->fillCount = 0;
            buffer->head = buffer->tail = 0;
            buffer->atomic = true;

            return true;
        #endif
    }

    return false;
}

void TPCircularBufferCleanup(TPCircularBuffer *buffer) {
    #if defined(__APPLE__)
        vm_deallocate(mach_task_self(), (vm_address_t)buffer->buffer, buffer->length * 2);
    #else
        munmap(buffer->buffer, buffer->length * 2);
    #endif
    memset(buffer, 0, sizeof(TPCircularBuffer));
}

void TPCircularBufferClear(TPCircularBuffer *buffer) {
    uint32_t fillCount;

    if (TPCircularBufferTail(buffer, &fillCount)) {
        TPCircularBufferConsume(buffer, fillCount);
    }
}

void  TPCircularBufferSetAtomic(TPCircularBuffer *buffer, bool atomic) {
    buffer->atomic = atomic;
}
