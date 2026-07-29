#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>

/* List of platform features */
#ifdef _WIN32
#define OS "win32"
#define IS_WINDOWS
#endif
#ifdef __linux
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
} versions[] = {
    {"v22.0.0", "127"},
    {"v24.0.0", "137"},
    {"v26.0.0", "147"}
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

/* Downloads headers, creates folders */
void prepare(const char *windows_lib_arch) {
#ifdef IS_WINDOWS
    if (run("if not exist dist mkdir dist") || run("if not exist targets mkdir targets")) {
        return;
    }
#else
    if (run("mkdir -p dist") || run("mkdir -p targets")) {
        return;
    }
#endif

    /* For all versions */
    for (unsigned int i = 0; i < sizeof(versions) / sizeof(struct node_version); i++) {
        if (selected_version && strcmp(versions[i].name, selected_version)) {
            continue;
        }

        char path[256];
        sprintf(path, "node-%s-headers.tar.gz", versions[i].name);
        if (!exists(path)) {
            run("curl -OJ https://nodejs.org/dist/%s/node-%s-headers.tar.gz", versions[i].name, versions[i].name);
        }
        run("tar xzf node-%s-headers.tar.gz -C targets", versions[i].name);

        sprintf(path, "targets/node-%s/node.lib", versions[i].name);
        if (!exists(path)) {
            run("curl https://nodejs.org/dist/%s/win-%s/node.lib > targets/node-%s/node.lib", versions[i].name, windows_lib_arch, versions[i].name);
        }

        /* v8-fast-api-calls.h is missing from the Node.js header distribution; fetch the matching Node version */
        sprintf(path, "targets/node-%s/include/node/v8-fast-api-calls.h", versions[i].name);
        if (!exists(path)) {
            run("curl -fL https://raw.githubusercontent.com/nodejs/node/%s/deps/v8/include/v8-fast-api-calls.h > targets/node-%s/include/node/v8-fast-api-calls.h", versions[i].name, versions[i].name);
        }

        if (latest_only) {
            break;
        }
    }
}

/* Build for Unix systems */
void build(char *compiler, char *cpp_compiler, char *cpp_linker, char *os, const char *arch) {

    char *c_shared = "-DWIN32_LEAN_AND_MEAN -DLIBUS_USE_LIBUV -DLIBUS_USE_QUIC -I uWebSockets/uSockets/lsquic/include -I uWebSockets/uSockets/boringssl/include -pthread -DLIBUS_USE_OPENSSL" OPT_FLAGS " -c -fPIC -I uWebSockets/uSockets/src uWebSockets/uSockets/src/*.c uWebSockets/uSockets/src/eventing/*.c uWebSockets/uSockets/src/crypto/*.c";
    char *cpp_shared = "-DWIN32_LEAN_AND_MEAN -DUWS_WITH_PROXY -DLIBUS_USE_LIBUV -DLIBUS_USE_QUIC -I uWebSockets/uSockets/boringssl/include -pthread -DLIBUS_USE_OPENSSL" OPT_FLAGS " -c -fPIC -std=c++20 -I uWebSockets/uSockets/src -I uWebSockets/src src/addon.cpp uWebSockets/uSockets/src/crypto/sni_tree.cpp";

    for (unsigned int i = 0; i < sizeof(versions) / sizeof(struct node_version); i++) {
        if (selected_version && strcmp(versions[i].name, selected_version)) {
            continue;
        }

        if(!addon_only) {
            run("%s %s -I targets/node-%s/include/node", compiler, c_shared, versions[i].name);
            run("%s %s -I targets/node-%s/include/node", cpp_compiler, cpp_shared, versions[i].name);
        }
        run("%s -pthread -flto %s *.o uWebSockets/uSockets/boringssl/%s/ssl/libssl.a uWebSockets/uSockets/boringssl/%s/crypto/libcrypto.a%s -I uWebSockets/libdeflate -std=c++20 -shared %s -o dist/akeno_%s_%s_%s.node", cpp_compiler, opt_flags, arch, arch, lsquic_libs, cpp_linker, os, arch, versions[i].abi);

        if(addon_only || latest_only) {
            break; // Only build for one version
        }
    }
}

void copy_files() {
#ifdef IS_WINDOWS
    run("copy \"src\\akeno.js\" dist /Y");
#else
    run("cp src/akeno.js dist/akeno.js");
#endif
}

/* Special case for windows */
void build_windows(char *compiler, char *cpp_compiler, char *cpp_linker, char *os, const char *arch) {

    char *c_shared = "-DWIN32_LEAN_AND_MEAN -DLIBUS_USE_LIBUV -DLIBUS_USE_QUIC -IuWebSockets/uSockets/lsquic/include -IuWebSockets/uSockets/lsquic/wincompat -IuWebSockets/uSockets/boringssl/include -DLIBUS_USE_OPENSSL -O3 -c -IuWebSockets/uSockets/src uWebSockets/uSockets/src/*.c uWebSockets/uSockets/src/eventing/*.c uWebSockets/uSockets/src/crypto/*.c";
    char *cpp_shared = "-DWIN32_LEAN_AND_MEAN -DUWS_WITH_PROXY -DLIBUS_USE_LIBUV -DLIBUS_USE_QUIC -IuWebSockets/uSockets/lsquic/include -IuWebSockets/uSockets/lsquic/wincompat -IuWebSockets/uSockets/boringssl/include -DLIBUS_USE_OPENSSL -O3 -c -std=c++20 -IuWebSockets/uSockets/src -IuWebSockets/src src/addon.cpp uWebSockets/uSockets/src/crypto/sni_tree.cpp";

    for (unsigned int i = 0; i < sizeof(versions) / sizeof(struct node_version); i++) {
        if (selected_version && strcmp(versions[i].name, selected_version)) {
            continue;
        }

        if (!addon_only) {
            run("del /Q *.obj >NUL 2>&1");
            run("cl %s /I targets/node-%s/include/node", c_shared, versions[i].name);
            run("cl %s /I targets/node-%s/include/node", cpp_shared, versions[i].name);
        }

        run("link /NOLOGO /DLL /OUT:dist\\akeno_%s_%s_%s.node *.obj uWebSockets\\uSockets\\boringssl\\%s\\ssl\\ssl.lib uWebSockets\\uSockets\\boringssl\\%s\\crypto\\crypto.lib%s targets\\node-%s\\node.lib BrotliEnc.lib BrotliCommon.lib Ws2_32.lib Crypt32.lib Bcrypt.lib Iphlpapi.lib Userenv.lib Psapi.lib Advapi32.lib", os, arch, versions[i].abi, arch, arch, versions[i].name);

        if (addon_only || latest_only) {
            break;
        }
    }
}

int main(int argc, char **argv) {
#ifdef IS_WINDOWS
    printf("[Warning] Building Akeno-uWS for Windows is not supported and Akeno does not support Windows. Any Windows build is considered experimental/unsupported and can break or not be up to expectations. Use at your own risk\n\n");
#endif
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "--version=", 10) == 0) {
            selected_version = argv[i] + 10;
        } else if (!strcmp(argv[i], "--version") && i + 1 < argc) {
            selected_version = argv[++i];
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
    build_windows(OS, X64);
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

    copy_files();
}
