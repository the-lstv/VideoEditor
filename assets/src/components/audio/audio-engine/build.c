/**
    Build script for the audio engine addon. This script downloads the Node.js headers and builds the addon for multiple Node.js versions and architectures.
    Has setup for both Node.js and Electron since Electron has it's own ABI and headers.

    Should work for Linux, macOS (untested) and Windows (untested).
*/

#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>

/* List of platform features */
#ifdef _WIN32
#define OS "win32"
#define IS_WINDOWS
#endif
#if defined(__linux__) || defined(__linux)
#define OS "linux"
#define IS_LINUX
#endif
#ifdef __APPLE__
#define OS "darwin"
#define IS_MACOS
#endif

#ifdef WITH_ASAN
#define OPT_FLAGS " -fsanitize=address -fno-omit-frame-pointer -g -O1"
#define LINK_FLAGS " -fsanitize=address"
#define LINUX_LINK_EXTRAS "-fsanitize=address"
#define MACOS_LINK_EXTRAS " -fsanitize=address"
#else
#define OPT_FLAGS " -flto -O3"
#define LINK_FLAGS " -flto -O3"
#define LINUX_LINK_EXTRAS "-static-libstdc++ -static-libgcc -s"
#define MACOS_LINK_EXTRAS ""
#endif

const char *ARM = "arm";
const char *ARM64 = "arm64";
const char *X64 = "x64";

int addon_only = 0;
int latest_only = 0;
int debug_mode = 0;
int disable_http3 = 0;
char *selected_version = NULL;

// We can build either for Electron or Node.js since Electron is weird.
int buildingForElectron = 0;

int exists(const char *fname) {
    FILE *file;
    if ((file = fopen(fname, "r"))) {
        fclose(file);
        return 1;
    }
    return 0;
}

/* System, but with string replace */
int run(const char *cmd, ...) {
    char buf[2048];
    va_list args;
    va_start(args, cmd);
    vsprintf(buf, cmd, args);
    va_end(args);
    printf("--> %s\n\n", buf);
    return system(buf);
}

/* List of Node.js versions */
struct node_version {
    char *name;
    char *abi;
    char *runtime;
} versions[] = {
    {"v22.0.0", "127", "node"},
    {"v24.0.0", "137", "node"},
    {"v25.0.0", "141", "node"},
    {"v26.0.0", "147", "node"},

    {"v43.0.0", "148", "electron"},
};

int arch_is(const char *arch, const char *expected) {
    return strcmp(arch, expected) == 0;
}

const char *windows_arch_name(const char *arch) {
    if (arch_is(arch, X64)) {
        return "x64";
    }
    if (arch_is(arch, ARM64)) {
        return "arm64";
    }
    if (arch_is(arch, ARM)) {
        return "arm";
    }
    return NULL;
}

const char *windows_build_dir(const char *arch) {
    if (arch_is(arch, X64)) {
        return "win-x64";
    }
    if (arch_is(arch, ARM64)) {
        return "win-arm64";
    }
    return NULL;
}

/* Downloads node headers, creates folders */
void prepare(const char *windows_lib_arch) {
#ifdef IS_WINDOWS
    if (run("if not exist dist mkdir dist") || run("if not exist targets mkdir targets") || run("if not exist targets\\node mkdir targets\\node") || run("if not exist targets\\electron mkdir targets\\electron")) {
        return;
    }
#else
    if (run("mkdir -p dist") || run("mkdir -p targets") || run("mkdir -p targets/node") || run("mkdir -p targets/electron")) {
        return;
    }
#endif
    /* For all versions */
    int j = 0;
    for (unsigned int i = 0; i < sizeof(versions) / sizeof(struct node_version); i++) {
        if (selected_version && strcmp(versions[i].name, selected_version)) {
            continue;
        }

        if(buildingForElectron && strcmp(versions[i].runtime, "electron") != 0) {
            continue;
        } else if(!buildingForElectron && strcmp(versions[i].runtime, "node") != 0) {
            continue;
        }

        char source[256];
        if(buildingForElectron) {
            sprintf(source, "https://artifacts.electronjs.org/headers/dist/%s/node-%s-headers.tar.gz", versions[i].name, versions[i].name);
        } else {
            sprintf(source, "https://nodejs.org/dist/%s/node-%s-headers.tar.gz", versions[i].name, versions[i].name);
        }

        run("mkdir -p targets/%s/%s", versions[i].runtime, versions[i].name);

        char path[256];
        sprintf(path, "targets/%s/node-%s-headers.tar.gz", versions[i].runtime, versions[i].name);
        if (!exists(path)) {
            run("cd targets/%s && curl -OJ %s", versions[i].runtime, source);
        }

        run("tar xzf %s --strip-components=1 -C targets/%s/%s", path, versions[i].runtime, versions[i].name);

        if(!buildingForElectron) {
            sprintf(path, "targets/%s/%s/node.lib", versions[i].runtime, versions[i].name);
            if (!exists(path)) {
                run("curl https://nodejs.org/dist/%s/win-%s/node.lib > targets/%s/%s/node.lib", versions[i].name, windows_lib_arch, versions[i].runtime, versions[i].name);
            }

            /* v8-fast-api-calls.h is missing from the Node.js header distribution; fetch the matching Node version */
            sprintf(path, "targets/%s/%s/include/node/v8-fast-api-calls.h", versions[i].runtime, versions[i].name);
            if (!exists(path)) {
                run("curl -fL https://raw.githubusercontent.com/nodejs/node/%s/deps/v8/include/v8-fast-api-calls.h > targets/%s/%s/include/node/v8-fast-api-calls.h", versions[i].name, versions[i].runtime, versions[i].name);
            }
        }

        j++;

        if (latest_only) {
            break;
        }
    }

    if (j == 0) {
        printf("No versions were built. Check your --version argument.\n");
    }
}

/* Build for Unix systems */
void build(char *compiler, char *cpp_compiler, char *cpp_linker, char *os, const char *arch) {
    char *cpp_shared = "-pthread" OPT_FLAGS " -c -fPIC -std=c++20 audio-engine.cpp -Ivst3sdk -Ivst3sdk/public.sdk -Ivst3sdk/pluginterfaces -Iinclude";

    for (unsigned int i = 0; i < sizeof(versions) / sizeof(struct node_version); i++) {
        if (selected_version && strcmp(versions[i].name, selected_version)) {
            continue;
        }

        run("%s %s -I targets/%s/%s/include/node", cpp_compiler, cpp_shared, versions[i].runtime, versions[i].name);
        run("%s -pthread -flto %s *.o -std=c++20 -shared %s -o dist/%s_%s_%s_%s.node", cpp_compiler, OPT_FLAGS, cpp_linker, os, arch, versions[i].abi, versions[i].runtime);

        if(addon_only || latest_only) {
            break; // Only build for one version
        }
    }
}

/* Special case for windows (Untested, no idea if it works) */
void build_windows(char *compiler, char *cpp_compiler, char *cpp_linker, char *os, const char *arch) {
    char *cpp_shared = "-DWIN32_LEAN_AND_MEAN -O3 -c -std=c++20 audio-engine.cpp -Ivst3sdk -Ivst3sdk/public.sdk -Ivst3sdk/pluginterfaces -Iinclude";

    for (unsigned int i = 0; i < sizeof(versions) / sizeof(struct node_version); i++) {
        if (selected_version && strcmp(versions[i].name, selected_version)) {
            continue;
        }

        // if (!addon_only) {
        // }
        run("del /Q *.obj >NUL 2>&1");
        run("cl %s /I targets/%s/%s/include/node", cpp_shared, versions[i].runtime, versions[i].name);

        run("link /NOLOGO /DLL /OUT:dist\\%s_%s_%s_%s.node *.obj targets\\%s\\%s\\node.lib", os, arch, versions[i].abi, versions[i].runtime, versions[i].runtime, versions[i].name);

        if (addon_only || latest_only) {
            break;
        }
    }
}

int main(int argc, char **argv) {
#ifdef IS_WINDOWS
    printf("[Warning] Windows is not supported. Any Windows build is considered experimental/unsupported and can break or not be up to expectations, and performance/stability may be poor. Use at your own risk\n\n");
#endif
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--addon-only")) {
            addon_only = 1;
            printf("Only building for one Node.js version and skipping preparation, assuming you have built before\n");
        }
        if (!strcmp(argv[i], "--latest-only")) {
            latest_only = 1;
            printf("Only building for one Node.js version.\n");
        }
        if (!strcmp(argv[i], "--debug")) {
            debug_mode = 1;
            printf("Debug build enabled (-g -O0).\n");
        }
        if (strncmp(argv[i], "--version=", 10) == 0) {
            selected_version = argv[i] + 10;
        } else if (!strcmp(argv[i], "--version") && i + 1 < argc) {
            selected_version = argv[++i];
        }
        if (!strcmp(argv[i], "--disable-http3")) {
            disable_http3 = 1;
            printf("Disabling HTTP/3 support.\n");
        }
        if (!strcmp(argv[i], "--electron")) {
            buildingForElectron = 1;
            printf("Building for Electron.\n");
        }
    }

    const char *arch = X64;
#ifdef __arm__
    arch = ARM;
#endif
#ifdef __aarch64__
    arch = ARM64;
#endif

    if (!addon_only) {
        printf("[Preparing]\n");
        prepare("x64");
    }
    printf("\n[Building]\n");

#ifdef IS_WINDOWS
    build_windows("cl", "cl", "link", OS, windows_arch_name(arch));
#else
#ifdef IS_MACOS

    /* Apple special case */
    build("clang -target x86_64-apple-macos12",
          "clang++ -stdlib=libc++ -target x86_64-apple-macos12",
          "-undefined dynamic_lookup" MACOS_LINK_EXTRAS,
          OS,
          X64);

    /* Try and build for arm64 macOS 12 */
    build("clang -target arm64-apple-macos12",
          "clang++ -stdlib=libc++ -target arm64-apple-macos12",
          "-undefined dynamic_lookup" MACOS_LINK_EXTRAS,
          OS,
          ARM64);

#else
    /* Linux does not cross-compile but picks whatever arch the host is on (we run on both x64 and ARM64) */
    build("clang-18",
          "clang++-18",
          LINUX_LINK_EXTRAS,
          OS,
          arch);
#endif
#endif
}
