/**
    Build script for the audio engine addon. This script downloads the Node.js headers and builds the addon for multiple Node.js versions and architectures.
    Has setup for both Node.js and Electron since Electron has it's own ABI and headers.

    Should work for Linux, macOS (untested) and Windows (untested).
*/

#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#ifdef _WIN32
#include <io.h>
#include <stdint.h>
#else
#include <glob.h>
#endif

/* List of platform features */
#ifdef _WIN32
#define OS "win32"
#define PLATFORM "win32"
#define IS_WINDOWS
#endif
#if defined(__linux__) || defined(__linux)
#define OS "linux"
#define PLATFORM "linux"
#define IS_LINUX
#endif
#ifdef __APPLE__
#define OS "darwin"
#define PLATFORM "mac"
#define IS_MACOS
#endif

#ifdef WITH_ASAN
#define OPT_FLAGS " -fsanitize=address -fno-omit-frame-pointer -g -O1"
#define LINK_FLAGS " -fsanitize=address"
#define LINUX_LINK_EXTRAS "-fsanitize=address"
#define MACOS_LINK_EXTRAS " -fsanitize=address"
#else
// #define OPT_FLAGS " -flto -O3"
// #define LINK_FLAGS " -flto -O3"
#define OPT_FLAGS " -g -O0"
#define LINK_FLAGS " -g -O0"
#define LINUX_LINK_EXTRAS "-stdlib=libc++ -lc++ -lc++abi -s" // Electron seems to want libc++
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
    {"v20.0.0", "115", "node"},
    {"v22.0.0", "127", "node"},
    {"v24.0.0", "137", "node"},
    {"v25.0.0", "141", "node"},
    {"v26.0.0", "147", "node"},

    {"v42.6.1", "146", "electron"},
    {"v43.2.0", "148", "electron"},
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
    if (run("if not exist dist mkdir dist") || run("if not exist fragments mkdir fragments") || run("if not exist targets mkdir targets") || run("if not exist targets\\node mkdir targets\\node") || run("if not exist targets\\electron mkdir targets\\electron")) {
        return;
    }
#else
    if (run("mkdir -p dist") || run("mkdir -p fragments") || run("mkdir -p targets") || run("mkdir -p targets/node") || run("mkdir -p targets/electron")) {
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
            run("tar xzf %s --strip-components=1 -C targets/%s/%s", path, versions[i].runtime, versions[i].name);
        }

        if(!buildingForElectron) {
#ifdef IS_WINDOWS
            sprintf(path, "targets/%s/%s/node.lib", versions[i].runtime, versions[i].name);
            if (!exists(path)) {
                run("curl https://nodejs.org/dist/%s/win-%s/node.lib > targets/%s/%s/node.lib", versions[i].name, windows_lib_arch, versions[i].runtime, versions[i].name);
            }
#endif

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
        printf("No versions were downloaded. Check your --version argument.\n");
        exit(1);
    }
}


const char* source_files[] = {
    "vst3sdk/base/source/*.cpp",
    "vst3sdk/pluginterfaces/base/*.cpp",
    "vst3sdk/public.sdk/source/vst/utility/*.cpp",
    "vst3sdk/public.sdk/source/vst/vstinitiids.cpp",
    "vst3sdk/public.sdk/source/main/" PLATFORM "main.cpp",
    "vst3sdk/public.sdk/source/main/pluginfactory.cpp",
    "vst3sdk/public.sdk/source/common/commoniids.cpp",
    "vst3sdk/public.sdk/source/common/commonstringconvert.cpp",
    "vst3sdk/public.sdk/source/common/threadchecker_" PLATFORM ".cpp",
    "vst3sdk/public.sdk/source/vst/hosting/module_" PLATFORM ".cpp",
    "vst3sdk/public.sdk/source/vst/hosting/module.cpp",
    "vst3sdk/public.sdk/source/vst/hosting/parameterchanges.cpp",
    "vst3sdk/public.sdk/source/vst/hosting/processdata.cpp",
    "vst3sdk/public.sdk/source/vst/hosting/connectionproxy.cpp",
    "vst3sdk/public.sdk/source/vst/hosting/eventlist.cpp",
    "vst3sdk/public.sdk/source/vst/hosting/pluginterfacesupport.cpp",
    "vst3sdk/public.sdk/source/vst/hosting/plugprovider.cpp",
    "vst3sdk/public.sdk/source/vst/hosting/hostclasses.cpp",
    "vst3sdk/public.sdk/source/vst/hosting/hostdataexchangehandler.cpp",
    "include/ring-buffer/TPCircularBuffer.cpp",
};

int source_has_wildcard(const char *source) {
    return strpbrk(source, "*?") != NULL;
}

void make_object_name(const char *source, char *object_name, size_t object_name_size) {
    size_t i;
    size_t j = 0;

    for (i = 0; source[i] != '\0' && j + 1 < object_name_size; i++) {
        char c = source[i];

        if (c == '/' || c == '\\' || c == '*' || c == '?') {
            c = '_';
        }

        object_name[j++] = c;
    }

    object_name[j] = '\0';
}

bool source_isC(const char *source) {
    size_t len = strlen(source);
    return len >= 2 && source[len - 2] == '.' && source[len - 1] == 'c';
}

void compile_vst3_source_unix(char *c_compiler, char *cpp_compiler, char *cpp_shared, char *c_shared, const char *source_file) {
    if (source_has_wildcard(source_file)) {
        glob_t matches;

        memset(&matches, 0, sizeof(matches));
        if (glob(source_file, 0, NULL, &matches) != 0) {
            printf("No sources matched %s\n", source_file);
            return;
        }

        for (size_t i = 0; i < matches.gl_pathc; i++) {
            char object_name[256];

            make_object_name(matches.gl_pathv[i], object_name, sizeof(object_name));

            char path[256];
            snprintf(path, sizeof(path), "fragments/%s.o", object_name);
            if (exists(path)) {
                printf("Skipping %s since it already exists\n", object_name);
                continue;
            }

            if (source_isC(matches.gl_pathv[i])) {
                run("%s %s %s -o %s", c_compiler, c_shared, matches.gl_pathv[i], path);
            } else {
                run("%s %s %s -o %s", cpp_compiler, cpp_shared, matches.gl_pathv[i], path);
            }
        }

        globfree(&matches);
        return;
    }

    char object_name[256];

    make_object_name(source_file, object_name, sizeof(object_name));
    char path[256];
    snprintf(path, sizeof(path), "fragments/%s.o", object_name);
    if(exists(path)) {
        printf("Skipping %s since it already exists\n", object_name);
        return;
    }
    if (source_isC(source_file)) {
        run("%s %s %s -o %s", c_compiler, c_shared, source_file, path);
    } else {
        run("%s %s %s -o %s", cpp_compiler, cpp_shared, source_file, path);
    }
}

#ifdef IS_WINDOWS
void compile_vst3_source_windows(char *c_compiler, char *cpp_compiler, char *cpp_shared, char *c_shared, const char *source_file) {
    if (source_has_wildcard(source_file)) {
        char search_pattern[256];
        char source_prefix[256];
        struct _finddata_t file_info;
        intptr_t search_handle;
        const char *wildcard = strpbrk(source_file, "*?");
        size_t prefix_len = wildcard ? (size_t)(wildcard - source_file) : strlen(source_file);

        if (prefix_len >= sizeof(source_prefix)) {
            prefix_len = sizeof(source_prefix) - 1;
        }

        memcpy(source_prefix, source_file, prefix_len);
        source_prefix[prefix_len] = '\0';

        snprintf(search_pattern, sizeof(search_pattern), "%s", source_file);
        for (size_t i = 0; search_pattern[i] != '\0'; i++) {
            if (search_pattern[i] == '/') {
                search_pattern[i] = '\\';
            }
        }

        search_handle = _findfirst(search_pattern, &file_info);
        if (search_handle == -1L) {
            printf("No sources matched %s\n", source_file);
            return;
        }

        do {
            char matched_source[512];
            char object_name[256];

            snprintf(matched_source, sizeof(matched_source), "%s%s", source_prefix, file_info.name);
            for (size_t i = 0; matched_source[i] != '\0'; i++) {
                if (matched_source[i] == '/') {
                    matched_source[i] = '\\';
                }
            }
            make_object_name(matched_source, object_name, sizeof(object_name));
            if (source_isC(matched_source)) {
                run("%s %s %s /Fo:fragments\\%s.obj", c_compiler, c_shared, matched_source, object_name);
            } else {
                run("%s %s %s /Fo:fragments\\%s.obj", cpp_compiler, cpp_shared, matched_source, object_name);
            }
        } while (_findnext(search_handle, &file_info) == 0);

        _findclose(search_handle);
        return;
    }

    char source_path[256];
    char object_name[256];

    snprintf(source_path, sizeof(source_path), "%s", source_file);
    for (size_t i = 0; source_path[i] != '\0'; i++) {
        if (source_path[i] == '/') {
            source_path[i] = '\\';
        }
    }

    make_object_name(source_path, object_name, sizeof(object_name));
    if (source_isC(source_path)) {
        run("%s %s %s /Fo:fragments\\%s.obj", c_compiler, c_shared, source_path, object_name);
    } else {
        run("%s %s %s /Fo:fragments\\%s.obj", cpp_compiler, cpp_shared, source_path, object_name);
    }
}
#endif

void build_vst3sdk(char *c_compiler, char *cpp_compiler, char *cpp_shared, char *c_shared) {
    size_t count = sizeof(source_files) / sizeof(source_files[0]);

    for (size_t i = 0; i < count; i++) {
#ifdef IS_WINDOWS
        compile_vst3_source_windows(c_compiler, cpp_compiler, cpp_shared, c_shared, source_files[i]);
#else
        compile_vst3_source_unix(c_compiler, cpp_compiler, cpp_shared, c_shared, source_files[i]);
#endif
    }
}

/* Build for Unix systems */
void build(char *compiler, char *cpp_compiler, char *cpp_linker, char *os, const char *arch) {
    char *cpp_shared = "-pthread" OPT_FLAGS " -stdlib=libc++ -c -fPIC -std=c++20 -DRELEASE -Ivst3sdk -Ivst3sdk/public.sdk -Ivst3sdk/pluginterfaces -Iinclude";
    char *c_shared = "-pthread" OPT_FLAGS " -c -fPIC -std=c11 -DRELEASE -Ivst3sdk -Ivst3sdk/public.sdk -Ivst3sdk/pluginterfaces -Iinclude";

    build_vst3sdk(compiler, cpp_compiler, cpp_shared, c_shared);

    char *runtimeExtras = "";
    if (buildingForElectron) {
        runtimeExtras = " -DELECTRON";
    }

    for (unsigned int i = 0; i < sizeof(versions) / sizeof(struct node_version); i++) {
        if (selected_version && strcmp(versions[i].name, selected_version)) {
            continue;
        }

        run("%s %s audio-engine.cpp %s -I targets/%s/%s/include/node", cpp_compiler, cpp_shared, runtimeExtras, versions[i].runtime, versions[i].name);
        run("%s -pthread %s *.o fragments/*.o -std=c++20 -shared %s -o dist/%s_%s_%s_%s.node", cpp_compiler, OPT_FLAGS, cpp_linker, os, arch, versions[i].abi, versions[i].runtime);

        if(addon_only || latest_only) {
            break; // Only build for one version
        }
    }
}

#ifdef IS_WINDOWS
/* Special case for windows (Untested, no idea if it works) */
void build_windows(char *compiler, char *cpp_compiler, char *cpp_linker, char *os, const char *arch) {
    char *cpp_shared = "-DWIN32_LEAN_AND_MEAN -O3 -c -std=c++20 -DRELEASE -Ivst3sdk -Ivst3sdk/public.sdk -Ivst3sdk/pluginterfaces -Iinclude";
    char *c_shared = "-DWIN32_LEAN_AND_MEAN -O3 -c -std=c11 -DRELEASE -Ivst3sdk -Ivst3sdk/public.sdk -Ivst3sdk/pluginterfaces -Iinclude";

    run("del /Q *.obj >NUL 2>&1");

    build_vst3sdk(compiler, cpp_compiler, cpp_shared, c_shared);

    char *runtimeExtras = "";
    if (buildingForElectron) {
        runtimeExtras = " -DELECTRON";
    }

    for (unsigned int i = 0; i < sizeof(versions) / sizeof(struct node_version); i++) {
        if (selected_version && strcmp(versions[i].name, selected_version)) {
            continue;
        }

        run("cl %s %s /I targets/%s/%s/include/node", cpp_shared, runtimeExtras, versions[i].runtime, versions[i].name);
        run("link /NOLOGO /DLL /OUT:dist\\%s_%s_%s_%s.node *.obj fragments\\*.obj targets\\%s\\%s\\node.lib", os, arch, versions[i].abi, versions[i].runtime, versions[i].runtime, versions[i].name);

        if (addon_only || latest_only) {
            break;
        }
    }
}
#endif

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
        const char *windows_lib_arch = X64;

        printf("[Preparing]\n");
#ifdef IS_WINDOWS
        windows_lib_arch = windows_arch_name(arch);
        if (!windows_lib_arch) {
            windows_lib_arch = X64;
        }
#endif
        prepare(windows_lib_arch);
    }
    printf("\n[Building]\n");

#ifdef IS_WINDOWS
    {
        const char *windows_build_arch = windows_arch_name(arch);

        if (!windows_build_arch) {
            windows_build_arch = X64;
        }

        build_windows("cl", "cl", "link", OS, windows_build_arch);
    }
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
    build("clang-21",
          "clang++-21",
          LINUX_LINK_EXTRAS,
          OS,
          arch);
#endif
#endif
}
