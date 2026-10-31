import { Enums } from "./enums.mjs";

/**
 * Performant & full-featured filesystem abstraction for Linux.JS 2.0/lstv.space kernel.
 * @copyright admin@lstv.space
 * 
 * This is a Linux-like filesystem abstraction that aims to replicate the behavior of a typical Linux filesystem.
 * It is a part of a larger project which aims to bring a lightweight Linux environment to the web, but can be used standalone to get a FS API.
 * It comes with it's own optimized filesystem and path utilities.
 * 
 * 
 * Supports Linux-compatible enums, permissions, symlinks, sockets, etc. and a rich selection of various backends.
 * Currently supported backends:
 * - TmpFs: Very fast in-memory storage. All features supported. Likely as light as an in-memory fs can get.
 * - IndexedDbFs: Persistent browser storage via IndexedDB. Note: hardlink support is wip.
 * - MemFs: In-memory archive format storage (supports compression, patching, fast state backup/restore, and instantly mounting a system image without touching any physical files with near-zero memory cost, good for temporary environments.) Note: hardlink support is wip.
 * - LocalStorageFs: LocalStorage/SessionStorage-backed storage. Note: hardlink support is wip.
 * - NodeFs: Host filesystem passthrough for virtually any native filesystem (Node.js only)
 * - RemoteFs: Remote connection via network to another instance (ws/http)
 * - WasmXFs: (Work in progress), virtual low-level filesystem inspired by XFS specifically for WASM applications.
 * - Other backends are very possible too. Perhaps the new browser file API could be supported.
 * 
 * Misc backends:
 * - ProcFs: A virtual filesystem that provides process and system information (/proc in Linux).
 * - SysFs: A virtual filesystem that provides system information (/sys in Linux).
 * - NullFs: Storage that sends all your writes to the void. Simple as that.
 * - jszfs: Read-only FS compatible with the old Linux.JS 1.0 virtual filesystem.
 * 
 * @example
 * const rootFs = new RootFs();
 * 
 * // Mount something as the root
 * rootFs.mount("/", new TmpFs({ data: TmpFs.basicLinuxFs() }));
 * 
 * console.log("Root directory: ", await rootFs.stat("/"));
 * 
 * const fd = await rootFs.open("/etc/os-release", Enums.O_RDONLY);
 * console.log(await rootFs.read(fd, 0, -1, RootFs.ENCODING.utf8));
 * fd.close();
 * 
 * const fd2 = await rootFs.open("/root/hello.txt", Enums.O_WRONLY | Enums.O_CREAT, Enums.S_IFREG | 0o644);
 * await rootFs.write(fd2, "Hello world");
 * fd2.close();
 * 
 * // Higher-level APIs are also available for easier use.
 * console.log(await rootFs.readFile(RootFs.join("/root", "hello.txt"), "utf8"));
 * 
 * // & of course cleanup is quite simple.
 * // For TmpFs/MemFs only: delete everything in the memory cache instantly.
 * rootFs.destroyStateAtMount("/");
 * rootFs.unmount("/");
 * rootFs.destroy(); // This also unmounts everything.
 * 
 * // There are also some filesystem-dependent extra non-standard flags.
 * // They are separated from regular flags, but can enhance performance, such as Enums.XO_STATONLY which avoids opening a fd when fetching stats of a file or Enums.XO_JS_STRING that can work directly with cached JS strings in some filesystems to avoid encoding/decoding.
 * // Usually RootFs decides those automatically so you should avoid using them directly unless you know they are suported and won't break access.
 */

/**
 * File stats object
 */
class Stats {
    mode = Enums.S_IFREG | 0o644;

    uid = 0; // File owner
    gid = 0; // File group

    atimeMs = 0;     // Last time the file was accessed
    mtimeMs = 0;     // Last time the file was modified
    ctimeMs = 0;     // Last time the file was either created or its metadata were modified (usually the creation date)
    birthtimeMs = 0; // First time the entry was actually created (though not always supported).

    size = -1;       // Size in bytes
    blocks = -1;     // Number of blocks allocated
    blksize = -1;    // FS Block size
    ino = -1;        // Inode number

    dev = 0;         // Device the file is stored on
    rdev = 0;        // Device identifier if the file is a device
    nlink = 1;       // Number of hard links to this file

    constructor(mode) {
        this.mode = mode;
    }

    static typeOf(mode) {
        return mode & Enums.S_IFMT;
    }

    get type() {
        return this.mode & Enums.S_IFMT;
    }

    // For whatever reason Node.js uses methods instead of getters

    isFile() {
        return this.type === Enums.S_IFREG;
    }

    isDirectory() {
        return this.type === Enums.S_IFDIR;
    }

    isSymlink() {
        return this.type === Enums.S_IFLNK;
    }

    isBlockDevice() {
        return this.type === Enums.S_IFBLK;
    }

    isCharacterDevice() {
        return this.type === Enums.S_IFCHR;
    }

    isFIFO() {
        return this.type === Enums.S_IFIFO;
    }

    isSocket() {
        return this.type === Enums.S_IFSOCK;
    }

    get permissions() {
        // todo: check if this is valid
        return this.mode & Enums.PERMS;
    }

    getPerms() {
        const mode = this.mode;
        return {
            owner: {
                read:  !!(mode & 0o400),
                write: !!(mode & 0o200),
                exec:  !!(mode & 0o100),
            },
            group: {
                read:  !!(mode & 0o040),
                write: !!(mode & 0o020),
                exec:  !!(mode & 0o010),
            },
            other: {
                read:  !!(mode & 0o004),
                write: !!(mode & 0o002),
                exec:  !!(mode & 0o001),
            },
        
            setuid:  !!(mode & 0o4000),
            setgid:  !!(mode & 0o2000),
            sticky:  !!(mode & 0o1000),
        }
    }
}

/**
 * Dirent
 * @see https://www.man7.org/linux/man-pages/man3/readdir.3.html
 */
class Dirent {
    // d_ino = 0;    // Inode number (not applicable here)
    // d_off = 0;    // Offset to the next dirent (not applicable here)
    // d_reclen = 0; // Length of this record (not applicable here)
    d_type = 0;   // Type of file (not always supported)
    d_name = "";  // Name of the entry
}

class FsError extends Error {
    code = 0;

    constructor(code, message) {
        super(message || Enums.errCode(code));
        this.code = code;
    }
}

/**
 * Default filesystem starting-point for a LinuxJS 2.0/lstv.space environment.
 * This is a basic filesystem structure with essential directories and a default user.
 * You can use it to initialize a TmpFs or MemFs instance, or use as a base for patches for custom distributions.
 */
const DEFAULT_FS_DATA = [
    ["/", {}],

    ["/etc", {}],
    ["/etc/os-release", { contents: `NAME="LinuxJS"\nVERSION="2.0"\nID="linuxjs"\nVARIANT="lsw+lide-web"\nPRETTY_NAME="LinuxJS 2.0 (lstv.space, GNU/Linux)\nSUPPORT_END=2027-09-8"\nHOME_URL=https://lstv.space\nDEFAULT_HOSTNAME=linuxjs\nANSI_COLOR="0;38;2;60;110;180"\nLOGO=linuxjs-logo-icon`, mode: Enums.S_IFREG | 0o644 }],
    ["/etc/config.conf", { contents: "# Configuration file", mode: Enums.S_IFREG | 0o644 }],

    // Hostname
    ["/etc/hostname", {
        contents: "linuxjs\n",
        mode: Enums.S_IFREG | 0o644
    }],

    // Hosts
    ["/etc/hosts", {
        contents: `127.0.0.1 localhost\n127.0.1.1 linuxjs\n::1 localhost ip6-localhost ip6-loopback\n`,
        mode: Enums.S_IFREG | 0o644
    }],

    // Users
    ["/etc/passwd", {
        contents: `root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:user:/home/user:/bin/bash`,
        mode: Enums.S_IFREG | 0o644
    }],

    // Hashes
    ["/etc/shadow", {
        contents: "",
        mode: Enums.S_IFREG | 0o600
    }],

    // Groups
    ["/etc/group", {
        contents: `root:x:0:\nusers:x:1000:user`,
        mode: Enums.S_IFREG | 0o644
    }],

    // Enabled shells
    ["/etc/shells", {
        contents: `/bin/sh\n/bin/bash\n/bin/lsh`,
        mode: Enums.S_IFREG | 0o644
    }],

    // Mounts
    ["/etc/fstab", {
        contents: "",
        mode: Enums.S_IFREG | 0o644
    }],

    // Login defs
    ["/etc/login.defs", {
        contents: "UID_MIN 1000\nUID_MAX 60000\nSYS_UID_MIN 201\nSYS_UID_MAX 999\nGID_MIN 1000\nGID_MAX 60000\nSYS_GID_MIN 201\nSYS_GID_MAX 999\nCREATE_HOME yes\nENCRYPT_METHOD SHA512",
        mode: Enums.S_IFREG | 0o644
    }],

    ["/usr", {}],
    ["/usr/bin", {}],
    ["/usr/sbin", {}],

    ["/usr/lib", {}],
    ["/usr/lib/os-release", { mode: Enums.S_IFLNK | 0o777, contents: "/etc/os-release" }],

    ["/usr/lib64", {}],

    ["/usr/share", {}],
    ["/usr/share/xsessions", {}],
    ["/usr/share/wayland-sessions", {}],
    ["/usr/share/lidm-web-sessions", {}],

    ["/usr/local", {}],
    ["/usr/local/bin", {}],
    ["/usr/local/lib", {}],
    ["/usr/local/share", {}],

    ["/var/cache", {}],
    ["/var/lib", {}],
    ["/var/spool", {}],

    ["/etc/default", {}],
    ["/etc/init.d", {}],
    ["/etc/network", {}],
    ["/etc/systemd", {}],

    ["/bin",   { mode: Enums.S_IFLNK | 0o777, contents: "/usr/bin"   }],
    ["/sbin",  { mode: Enums.S_IFLNK | 0o777, contents: "/usr/sbin"  }],
    ["/lib",   { mode: Enums.S_IFLNK | 0o777, contents: "/usr/lib"   }],
    ["/lib64", { mode: Enums.S_IFLNK | 0o777, contents: "/usr/lib64" }],

    ["/var", {}],
    ["/var/log", {}],
    ["/var/tmp", {}],
    ["/var/run", { mode: Enums.S_IFLNK | 0o777, contents: "/run" }],

    ["/tmp", {}],  // This will be overridden by a TmpFs mount
    ["/dev", {}],  // This will be overridden by a TmpFs mount
    ["/run", {}],  // This will be overridden by a TmpFs mount
    ["/proc", {}], // This will be overridden by a ProcFs mount
    ["/sys", {}],  // This will be overridden by a SysFs mount

    ["/mnt", {}],

    ["/media", {}],
    ["/opt", {}],
    ["/boot", {}],

    ["/home", {}],
    ["/home/user", {}],
    ["/home/user/Documents", {}],
    ["/home/user/Downloads", {}],
    ["/home/user/Pictures", {}],
    ["/home/user/Music", {}],
    ["/home/user/Videos", {}],
    ["/home/user/Desktop", {}],
    ["/home/user/.config", {}],
    ["/home/user/.local", {}],
    ["/home/user/.cache", {}],
    ["/home/user/.bashrc", { contents: "# Bash configuration file", mode: Enums.S_IFREG | 0o644 }],
    ["/home/user/.profile", { contents: "# User profile configuration file", mode: Enums.S_IFREG | 0o644 }],
    ["/home/user/.bash_history", { contents: "", mode: Enums.S_IFREG | 0o644 }],

    ["/root", {}],
    ["/root/.bashrc", { contents: "# Root Bash configuration file", mode: Enums.S_IFREG | 0o644 }],
    ["/root/.profile", { contents: "# Root user profile configuration file", mode: Enums.S_IFREG | 0o644 }],
    ["/root/.bash_history", { contents: "", mode: Enums.S_IFREG | 0o644 }],
];

/**
 * Root Filesystem base class.
 * This doesn't implement any actual storage, but provides the interface and common functionality for different types of filesystems.
 * It provides mounting, unmounting, higher-level operations for managing files and directories, error handling, and serves as a foundation for implementing filesystems.
 */
class RootFs {
    static ENCODING = {
        binary: 0,
        utf8: 1,
    }

    static PATH_SEPARATOR = "/";
    static PATH_SEPARATOR_CODE = 47;

    // --- Utility methods for path manipulation ---

    /**
     * Normalize a path to a canonical form.
     * @param {string} path The path to normalize.
     * @param {boolean|null} isAbsolute Optional. If true, the returned path will be absolute (starting with /). If false, it will be relative. If null, it will be inferred from the input path.
     * @param {boolean} allowExit If true, relative paths can go outside of their directory. If false, they can't.
     * @param {boolean} returnParts If true, returns an array of path parts instead of a string.
     * @returns {string|Array<string>} The normalized path.
     * 
     * Also this implementation is 2x to 4x faster than the previous one in LinuxJS :P
     */
    static normalize(path, isAbsolute = null, allowExit = true, returnParts = false) {
        const parts = [];
        const len = path.length;

        const fc = path.charCodeAt(0);
        if (isAbsolute === null) isAbsolute = fc === this.PATH_SEPARATOR_CODE || fc === 92;
        
        if(len === 0) {
            return returnParts? parts: (isAbsolute? this.PATH_SEPARATOR: ".");
        }
        
        let cleanParts = 0;
        let sStart = 0, seqBroken = false;
        for (let i = 0; i < len; i++) {
            const char = path.charCodeAt(i);

            const isSeparator = char === this.PATH_SEPARATOR_CODE || char === 92;
            const isEnd = !isSeparator && (i === len - 1);

            if (isSeparator || isEnd) {
                if (isEnd) {
                    if (char !== 46) seqBroken = true;
                    i++;
                }

                const dCount = i - sStart;
                if (!seqBroken && (isAbsolute || !allowExit || dCount === 1 || cleanParts > 0)) {
                    // Go up ("..")
                    if(dCount === 2) {
                        parts.pop();
                        cleanParts--
                    }

                    // Otherwise do nothing
                } else if (dCount > 0) {
                    parts.push(path.slice(sStart, i));
                    if(seqBroken) cleanParts++;
                }

                sStart = i + 1;
                seqBroken = false;
                continue;
            }

            if (char !== 46) seqBroken = true;
        }

        if(returnParts) return parts;

        if(parts.length === 0) {
            return isAbsolute? this.PATH_SEPARATOR: ".";
        }

        const normalizedPath = parts.join('/');
        return isAbsolute ? '/' + normalizedPath : normalizedPath;
    }

    /**
     * Helper to normalize and split a path into segments.
     * Same as normalize(path, .., true);
     * @param {string} path Path to split.
     * @param {boolean|null} isAbsolute Same as normalize
     * @param {boolean} allowExit Same as normalize
     * @returns {Array<string>} Path segments as an array.
     */
    static splitPath(path, isAbsolute = null, allowExit = true) {
        return RootFs.normalize(path, isAbsolute, allowExit, true);
    }

    /**
     * Convert bytesize to a readable string.
     */
    static toHuman(size, decimals = 0) {
        if (size < 0 || !Number.isFinite(size)) {
            return String(size);
        }

        if (size === 0) {
            return `0`;
        }

        if (size < 1024) {
            return `${size} B`;
        }

        const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
        let value = size;
        let unit = -1;

        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit++;
        }

        return value.toFixed(decimals) + " " + units[unit];
    }

    static basename(path) {
        const normalized = RootFs.normalize(path);
        const lastSepIndex = normalized.lastIndexOf(RootFs.PATH_SEPARATOR);
        if (lastSepIndex === -1) {
            return normalized;
        }
        return normalized.substring(lastSepIndex + 1);
    }

    static dirname(path) {
        const normalized = RootFs.normalize(path);
        const lastSepIndex = normalized.lastIndexOf(RootFs.PATH_SEPARATOR);
        if (lastSepIndex === -1) {
            return normalized;
        }
        return normalized.substring(0, lastSepIndex);
    }

    static relative(from, to) {
        const fromParts = RootFs.normalize(from, true, true, true);
        const toParts = RootFs.normalize(to, true, true, true);

        // Find the common prefix
        let i = 0;
        while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
            i++;
        }

        // Calculate the number of levels to go up
        const upLevels = fromParts.length - i;

        // Create the relative path
        let relativePath = "";
        for (let j = 0; j < upLevels; j++) {
            relativePath += "../";
        }
        for (let j = i; j < toParts.length; j++) {
            relativePath += toParts[j] + "/";
        }

        return relativePath.slice(0, -1); // Remove the trailing slash
    }

    static isAbsolute(path) {
        const fc = path.charCodeAt(0);
        return fc === this.PATH_SEPARATOR_CODE || fc === 92;
    }

    /**
     * Ensures that a path has a trailing path separator.
     * @param {string} npath The path to ensure has a trailing separator.
     * @param {boolean} isAbsolute Whether the path is absolute.
     * @param {boolean} normalize Whether to normalize the path.
     * @returns {string} The path with a trailing separator.
     */
    static ensureTrailing(npath, isAbsolute = null, normalize = true) {
        npath = RootFs.normalize(npath, isAbsolute);
        if (!npath.endsWith(RootFs.PATH_SEPARATOR)) {
            return npath + RootFs.PATH_SEPARATOR;
        }
        return npath;
    }

    /**
     * Move up x directory levels in a given path. Normalizes the path
     * @param {string} path Path
     * @param {number} [levels=1] How many levels to go up
     */
    static up(path, levels = 1) {
        const normalized = RootFs.normalize(path);

        let lI = path.length;
        if(lI < 0) return "/";

        for (let i = 0; i < levels; i++) {
            lI = normalized.lastIndexOf(RootFs.PATH_SEPARATOR, lI - 1);
            if(lI === -1) return RootFs.PATH_SEPARATOR;
        }

        return normalized.substring(0, lI);
    }

    /**
     * Join multiple path segments into a single normalized path.
     * @param  {...string} parts Path segments to join.
     * @returns {string} The joined and normalized path.
     */
    static join(...parts) {
        return RootFs.normalize(parts.join(RootFs.PATH_SEPARATOR));
    }

    /**
     * Joins relative paths with an absolute base path without allowing the relative path to escape outside of the base directory.
     * @param {*} base Base path
     * @param  {...any} parts Parts to join
     * @returns {string} Merged path
     * 
     * @example
     * RootFs.resolveSafe("/home/user", "../../dir/../hello.txt"); // -> /home/user/hello.txt
     */
    static resolveSafe(base, ...parts) {
        // absolute=true
        base = RootFs.normalize(base, true);

        // absolute=false, allowExit=false
        return base + (base.endsWith(RootFs.PATH_SEPARATOR)? "": RootFs.PATH_SEPARATOR) + RootFs.normalize(parts.join(RootFs.PATH_SEPARATOR), false, false);
    }

    static parseOpenFlagsString(str) {
        if(typeof str === "number") return str;
        if(typeof str !== "string" || str.length > 3) throw new TypeError(`Invalid open flag: ${str}`);

        let i = 0;

        switch (str[0]) {
            case "r":
                i |= str[1] === "+" ? Enums.O_RDWR : Enums.O_RDONLY;
                break;
    
            case "w":
                i |= Enums.O_WRONLY | Enums.O_CREAT | Enums.O_TRUNC;
                break;
    
            case "a":
                i |= Enums.O_WRONLY | Enums.O_CREAT | Enums.O_APPEND;
                break;
    
            default:
                throw new TypeError(`Invalid open flag: ${str}`);
        }
    
        if (str.includes("+")) {
            i &= ~Enums.O_WRONLY;
            i |= Enums.O_RDWR;
        }

        if (str.includes("x")) i |= Enums.O_EXCL;
        if (str.includes("s")) i |= Enums.O_SYNC;
    
        return i;
    }

    /**
     * Approximately convert a windows path to a unix-style path (replace \ with /, remove drive letter, and I guess replaces C:/users with /home).
     */
    static win32toUnix(path) {
        const normalized = RootFs.normalize(path, true, true, true);
        const firstIsDriveLetter = normalized[0]?.length === 2 && normalized[0][1] === ":";
        if(firstIsDriveLetter) normalized.shift();
        if(normalized[0].toLowerCase() === "users") normalized[0] = "home";
        return (firstIsDriveLetter? RootFs.PATH_SEPARATOR: "") + normalized.join(RootFs.PATH_SEPARATOR);
    }

    // Mounts is an array of [mountPoint, fs] pairs.
    #mounts = [];

    /**
     * Create a new RootFs instance.
     * @param {boolean} tmpFs Whether to mount the root TmpFs filesystems and others.
     */
    constructor(tmpFs = true) {
        this._tmpRoot = tmpFs;
    }

    static fsTypes = {}

    /**
     * Mount a filesystem at a given mount point.
     * @param {string} mountPoint The mount point where the filesystem will be mounted.
     * @param {*} fs The filesystem to mount.
     * @returns {number} Error code if mount failed.
     */
    async mount(mountPoint, fs) {
        mountPoint = RootFs.ensureTrailing(mountPoint, true);

        if(mountPoint !== "/") {
            try {
                let stat = await this.stat(mountPoint, Enums.XO_STATONLY | Enums.XO_IGNORE_NO_FS);
                if(stat !== -1) {
                    if(stat.isFile()) return Enums.errno.ENOTDIR;
                }
            } catch(e) {
                console.log(e);
                return typeof e === "number"? e: -1;
            }
        } else if(this._tmpRoot) {
            // Unmount the default root
            await this.unmount("/");
        }

        // Technically, Linux allows you to mount the same path multiple times...
        // for(const [mp, fs] of this.#mounts) {
        //     if(mountPoint === mp) {
        //         throw new Error("Can't mount: directory \"" + mountPoint + "\" is already mounted");
        //     }
        // }

        this.#mounts.push([mountPoint, fs]);

        // Sort mounts by length of mount point, descending
        this.#mounts.sort((a, b) => b[0].length - a[0].length);
        return true;
    }

    /**
     * Unmount a filesystem from a given mount point.
     * @param {string} mountPoint The mount point to unmount.
     */
    async unmount(mountPoint) {
        mountPoint = RootFs.ensureTrailing(mountPoint, true);
        this.#mounts = this.#mounts.filter(([mp, fs]) => mp !== mountPoint);

        // todo: also close all open file descriptors
    }

    /**
     * Returns a list of mounts and their types
     * @returns {Array}
     */
    lsmount(__includeFsRef = false){
        return this.#mounts.map(([a, b]) => [a, {
            type: b?.name || b?.constructor?.fsType || b?.constructor?.name,
            size: b?.size ?? -1,
            used: b?.used ?? -1,
            ... __includeFsRef? {__fs: b}: null
        }]);
    }

    /**
     * FS operations are always async since they may access the network or other devices, including real filesystem APIs.
     * Filesystem resolution steps:
     * - Normalize path
     * - Resolve filesystem so we know how and where we can access data
     * - Resolve directory
     * - Open path & follow symlinks and check permissions
     * - Obtain handle
     * 
     * @returns {*} fd
     */
    async open(dir, flags = Enums.O_RDONLY, mode = 0, extraFlags = 0, extraData = undefined, absolutePath = true) {
        dir = RootFs.normalize(dir, absolutePath);

        if(typeof flags === "string") {
            flags = RootFs.parseOpenFlagsString(flags);
        }

        // Mounts are sorted by length of mount point, descending.
        const dirWithSep = RootFs.ensureTrailing(dir, null, false);
        for(const ent of this.#mounts) {
            const mp = ent[0];
            const fs = ent[1];

            if(dirWithSep.startsWith(mp)) {
                if(!fs || typeof fs.open !== "function") {
                    throw new Error("Invalid filesystem mounted at " + mp);
                }

                dir = "/" + dir.slice(mp.length); // Remove mountpoint from directory
                const fd = await fs.open(dir, flags, mode, extraFlags, extraData);
                if(!fd || typeof fd === "number") throw new FsError(fd);
                return fd;
            }
        }

        if(!(extraFlags & Enums.XO_IGNORE_NO_FS))
            throw new FsError(Enums.errno.ENOENT, "No filesystem mounted at " + dir + " to satisfy the request");
        else return -1;
    }

    async readDir(dir, extraFlags = Enums.XO_READ_DIR, close = true) {
        const fd = await this.open(dir, Enums.O_RDONLY, null, extraFlags);
        try {
            return await fd._fs.readDir(fd, extraFlags);
        } catch(e) {
            console.error("Error reading directory: ", e);
            throw e;
        } finally {
            if(close) fd._fs.close(fd);
        }
    }

    /**
     * Read from a file descriptor. If the file descriptor is invalid, an error will be thrown.
     * @param {*} fd File descriptor to read from
     * @param {*} first Offset to read from
     * @param {*} nbytes Number of bytes to read
     * @param {*} encoding ENUM RootFs.ENCODING or binary/utf8
     * @param {*} close Whether to close the file descriptor after reading
     * @returns {*} Data read
     */
    async read(fd, first = 0, nbytes = -1, encoding = RootFs.ENCODING.binary, close = true) {
        if(!fd || !fd._fs) throw new FsError(Enums.errno.EBADF);
        try {
            return await fd._fs.read(fd, first, nbytes, typeof encoding === "string"? RootFs.ENCODING[encoding]: encoding);
        } catch(e) {
            console.error("Error reading from fd: ", e);
            throw e;
        } finally {
            if(close) fd._fs.close(fd);
        }
    }

    /**
     * Write to a file descriptor. If the file descriptor is invalid, an error will be thrown.
     * @param {*} fd File descriptor to write to
     * @param {*} newData Data to write
     * @param {*} first Offset to write at
     * @param {*} nbytes Number of bytes to write
     * @param {*} close Whether to close the file descriptor after writing
     * @returns {*} Number of bytes written
     */
    async write(fd, newData, first = 0, nbytes = -1, close = true) {
        if(!fd || !fd._fs) throw new FsError(Enums.errno.EBADF);
        try {
            return await fd._fs.write(fd, newData, first, nbytes);
        } catch(e) {
            console.error("Error writing to fd: ", e);
            throw e;
        } finally {
            if(close) fd._fs.close(fd);
        }
    }

    /**
     * A higher-level method that simply resolves & reads a file content at a path.
     * Note: file access can involve network/other operations, depending on the type of the fs mounted at a given path, so don't rely on this being guaranteed to resolve in a specified time.
     * @param {*} dir Path to the file to read
     * @param {*} encoding ENUM RootFs.ENCODING or binary/utf8
     * @param {*} options More read options
     * @returns {string|Uint8Array|ArrayBuffer} File content
     */
    async readFile(dir, encoding, options = {}) {
        const fd = await this.open(dir);
        try {
            return await this.read(fd, options.start ?? 0, options.nbytes ?? -1, encoding, options.close ?? true);
        } catch(e) {
            if(options.close ?? true) await this.close(fd);
            throw e;
        }
    }

    /**
     * A higher-level that writes data to a file at a given path. If the file doesn't exist, it will be created. If it exists, it will be truncated.
     * @param {*} dir Path to the file to write
     * @param {*} newData Data to write
     * @param {*} options More write options
     * @returns {*} Number of bytes written
     */
    async writeFile(dir, newData, options = {}) {
        const fd = await this.open(dir, Enums.O_WRONLY | Enums.O_CREAT | Enums.O_TRUNC);
        return await this.write(fd, newData, options.start ?? 0, options.nbytes ?? -1, options.close ?? true);
    }

    async appendFile(dir, newData, options = {}) {
        const fd = await this.open(dir, Enums.O_WRONLY | Enums.O_APPEND | Enums.O_CREAT);
        return await this.write(fd, newData, options.start ?? 0, options.nbytes ?? -1, options.close ?? true);
    }

    async close(fd) {
        if(!fd || !fd._fs) throw new FsError(Enums.errno.EBADF);
        return await fd._fs.close(fd);
    }

    async exists(dir) {
        try {
            const fd = await this.open(dir, Enums.O_RDONLY);
            await this.close(fd);
            return true;
        } catch(e) {
            if(e.message.startsWith(Enums.errCode(Enums.errno.ENOENT))) {
                return false;
            }
            throw e;
        }
    }

    async stat(dir, extraFlags = Enums.XO_STATONLY) {
        const stat = new Stats;
        const fd = await this.open(dir, Enums.O_RDONLY, null, extraFlags, stat);

        if(fd < 0) {
            if(extraFlags & Enums.XO_IGNORE_NO_FS) return -1;
            throw new FsError(Enums.errno.EBADF);
        }

        if(fd === stat) return stat; // ""fast stat"" via the special flag
        fd._fs.stat(fd, stat);
        await this.close(fd);
        return stat;
    }

    /**
     * Removes a file or directory.
     * @param {*} dir Path to the file or directory to remove.
     * @param {*} options More options.
     * @returns {*} Promise resolving to the result of the operation.
     */
    async unlink(dir, options = {}) {
        const fd = await this.open(dir, Enums.O_WRONLY);
        const result = await fd._fs.unlink(fd);
        await this.close(fd);
        return result;
    }

    async mkdir(dir, mode = 0o777) {
        const fd = await this.open(dir, Enums.O_WRONLY | Enums.O_CREAT);
        const result = await fd._fs.mkdir(fd, mode);
        await this.close(fd);
        return result;
    }

    // todo
    destroy() {
        for(const [mp, fs] of this.#mounts) {
            if(fs.destroy) fs.destroy();
        }
        this.#mounts = [];
    }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Temporary in-memory-only filesystem for testing and development.
 * This is a simple implementation that uses a Map to store file data in memory.
 */
class TmpFs {
    static fsType = "tmpfs";

    fs = new Map;

    // This is currently more of just a hint
    size = 1024 * 1024 * 64;

    get used() {
        // todo
        let total = 0;
        for(const [dir, ent] of this.fs.entries()) {
            const size = ((ent?.contents) && (ent.contents.length || ent.contents.byteSize)) || 0;
            total += size;
            total += dir.length + 512; // ~estimate 512B for metadata
        }
        return total;
    }

    constructor(source, options, dump, order) {
        // Root
        this.fs.set("/", {
            mode: Enums.S_IFDIR | 0o555
        });
    }

    // Applicable only to TmpFs
    // Warning: ndir must already be correctly normalized.
    setData(data) {
        for(const [ndir, entry] of data) {
            this.fs.set(ndir, entry);
        }
        return this;
    }

    /**
     * Takes normalized directory/path, returns file descriptor or error code.
     *
     * @param {*} ndir Path to open.
     * @param {*} flags Open flags, see open(2).
     * @param {*} mode File type and permissions used when using O_CREAT. For example, Enums.S_IFREG | 0o644 to create a file, etc.
     * @returns {*} File descriptor or errno.
     * 
     * dir, flags, mode, extraFlags, extraData
     */
    open(ndir, flags, mode = Enums.S_IFREG | 0o644, extraFlags = 0, extraData = undefined) {
        let data = this.fs.get(ndir);

        if(extraFlags & Enums.XO_STATONLY) {
            if (!data) return Enums.errno.ENOENT;
            return this.stat({ data }, extraData ?? {}, true);
        }

        const type = Stats.typeOf(data? data.mode: mode);
        const isFile = type !== Enums.S_IFDIR;

        const accessMode = flags & Enums.O_ACCMODE;
        const canRead =  accessMode === Enums.O_RDONLY ||
                         accessMode === Enums.O_RDWR;
        const canWrite = accessMode === Enums.O_WRONLY ||
                         accessMode === Enums.O_RDWR;

        const createFile = (flags & Enums.O_CREAT);

        if (!data) {
            if (!createFile) {
                return Enums.errno.ENOENT;
            }

            this.create(ndir, mode);
        } else {
            /*
             * O_CREAT | O_EXCL must fail if the path already exists.
             */
            if (createFile && (flags & Enums.O_EXCL)) {
                return Enums.errno.EEXIST;
            }
        }

        /*
         * Directories can be opened, but only for reading/searching.
         * Opening a directory for writing is an error.
         */
        if (!isFile && canWrite) {
            return Enums.errno.EISDIR;
        }

        /*
         * O_TRUNC only applies to regular files opened for writing.
         */
        if ((flags & Enums.O_TRUNC) && isFile && canWrite) {
            data.contents = new Uint8Array(0);

            const now = Date.now();
            data.mtime = now;
            data.ctime = now;
        }

        return {
            _fs: this,
            data,
            flags,
            ndir,
            offset: (flags & Enums.O_APPEND) && isFile
                ? data.contents.length
                : 0,
            closed: false,
            readable: canRead,
            writable: canWrite
        };
    }


    /**
     * Destroy a file descriptor/handle.
     *
     * @param {*} fd File descriptor to be closed.
     * @returns {*} 0 on success or errno.
     */
    close(fd) {
        if (!fd || fd.closed || !fd._fs) {
            return Enums.errno.EBADF;
        }

        fd._fs = null;
        fd.data = null;
        fd.closed = true;

        return 0;
    }


    /**
     * Validate a file descriptor.
     *
     * kind:
     *   0 = regular file
     *   1 = directory
     *
     * @param {*} fd File descriptor.
     * @param {*} kind Expected object type.
     */
    checkFd(fd, kind) {
        if (!fd || !fd._fs || !fd.data || fd.closed) {
            throw new FsError(Enums.errno.EBADF);
        }

        if(!fd.data.mode) {
            // throw new FsError(Enums.errno.EINVAL);
            // todo: this should be normalized beforehand
            fd.data.mode = Enums.S_IFDIR | 0o555;
        }

        const type = Stats.typeOf(fd.data.mode);
        const isFile = type !== Enums.S_IFDIR;

        if (kind === 1 && isFile) {
            throw new FsError(Enums.errno.ENOTDIR);
        }

        if (kind === 0 && !isFile) {
            throw new FsError(Enums.errno.EISDIR);
        }
    }

    create(ndir, mode, uid = 0, gid = 0) {
        const now = Date.now();

        const data = {
            mode,
            uid,
            gid,
            atime: now,
            mtime: now,
            ctime: now,
            birthtime: now
        };

        this.fs.set(ndir, data);
        return 0;
    }

    /**
     * Helper to create a directory, not an official hook
     * todo: recurse & check parents
     */
    mkdir(ndir, perms = 0o755, recursive = false, uid = 0, gid = 0) {
        if (this.fs.has(ndir)) {
            return Enums.errno.EEXIST;
        }

        this.create(ndir, Enums.S_IFDIR | perms, uid, gid);
        return 0;
    }

    /**
     * Read from a file.
     *
     * `first` is the byte/character offset to read from.
     * `nbytes === -1` means read until EOF.
     *
     * @param {*} fd File descriptor.
     * @param {*} first Offset.
     * @param {*} nbytes Number of bytes/characters.
     * @param {*} encoding Output encoding.
     * @returns {*} Data.
     */
    read(fd, first, nbytes, encoding) {
        this.checkFd(fd, 0);

        if (!fd.readable) {
            throw new FsError(Enums.errno.EBADF);
        }

        const data = fd.data;

        if (first < 0) {
            throw new FsError(Enums.errno.EINVAL);
        }

        if (first > data.contents.length) {
            first = data.contents.length;
        }

        const end = nbytes === -1
            ? data.contents.length
            : Math.min(first + Math.max(0, nbytes), data.contents.length);

        /*
         * A successful read is an access to the file.
         */
        data.atime = Date.now();

        const result = data.contents.slice(first, end);

        /*
         * If the descriptor has an offset, advance it.
         */
        fd.offset = end;

        return this._toEncoding(result, encoding);
    }

    readDir(fd, extraFlags) {
        this.checkFd(fd, 1);

        const dir = RootFs.ensureTrailing(fd.ndir);

        const entries = [];

        // todo: optimize & make it not O(n)

        for(let [ndir, ent] of this.fs.entries()) {
            ndir = RootFs.ensureTrailing(ndir);

            if(ndir === dir) continue;
            if(!ndir.startsWith(dir)) continue;

            const relativePath = ndir.slice(dir.length, ndir.length - 1);
            if(relativePath.includes(RootFs.PATH_SEPARATOR)) continue;

            entries.push(relativePath);
        }

        return entries;
    }


    /**
     * Write to a file.
     *
     * `first` is the offset to write at.
     * `nbytes === -1` means write all of newData starting at `first`.
     *
     * O_APPEND causes the write to happen at EOF regardless of `first`.
     *
     * @param {*} fd File descriptor.
     * @param {*} newData Data to write.
     * @param {*} first Offset.
     * @param {*} nbytes Number of bytes/characters.
     * @returns {*} Number of bytes/characters written.
     */
    write(fd, newData, first, nbytes) {
        this.checkFd(fd, 0);

        if (!fd.writable) {
            throw new FsError(Enums.errno.EBADF);
        }

        const data = fd.data;

        /*
         * Convert ArrayBuffer into Uint8Array.
         */
        if (data.contents instanceof ArrayBuffer) {
            data.contents = new Uint8Array(data.contents);
        }

        /*
         * O_APPEND ignores the supplied offset.
         */
        if (fd.flags & Enums.O_APPEND) {
            first = data.contents.length;
        }

        /*
         * sldkfjklsdjl
         */
        if (first === undefined || first === null) {
            first = fd.offset ?? 0;
        }

        if (first < 0) {
            throw new FsError(Enums.errno.EINVAL);
        }

        if (nbytes === -1) {
            nbytes = newData.length;
        }

        if (nbytes === 0) {
            return 0;
        }

        if(data.contents === undefined) {
            if(typeof newData === "string") {
                data.contents = "";
            } else {
                data.contents = new Uint8Array;
            }
        }

        const writeSize = Math.min(nbytes, newData.length);
        const actualBytes = first; // todo

        /*
         * Normalize input according to the file's representation.
         */
        if (data.contents instanceof Uint8Array) {
            if (typeof newData === "string") {
                newData = encoder.encode(newData);
            }

            if (!(newData instanceof Uint8Array)) {
                throw new FsError(Enums.errno.EINVAL);
            }

            const requiredLength = first + actualBytes;

            if (requiredLength > data.contents.length) {
                const newContents = new Uint8Array(requiredLength);

                newContents.set(data.contents, 0);
                newContents.set(newData.slice(first, sourceEnd), first);

                data.contents = newContents;
            } else {
                data.contents.set(
                    newData.slice(first, sourceEnd),
                    first
                );
            }

            fd.offset = first + actualBytes;

            const now = Date.now();
            data.mtime = now;
            data.ctime = now;

            return actualBytes;
        } else if (typeof data.contents === "string") {
            if (typeof newData !== "string") {
                newData = decoder.decode(newData);
            }

            /*
             * Important: Writing beyond EOF appends for string files.
             */

            // console.log(first, data.contents, newData, writeSize, actualBytes)

            if(first === 0) {
                data.contents = writeSize === newData.length? newData: newData.substring(0, writeSize);
            } else {
                data.contents =
                    data.contents.substring(0, first) +
                    newData.substring(0, writeSize) +
                    data.contents.substring(first + writeSize);
            }

            fd.offset = first + writeSize;

            const now = Date.now();
            data.mtime = now;
            data.ctime = now;

            return writeSize;
        }

        throw new FsError(Enums.errno.EINVAL);
    }


    /**
     * Return file metadata.
     *
     * @param {*} fd File descriptor.
     * @returns {*} stat-like object.
     */
    stat(fd, out, ncheck = false) {
        if(!ncheck) this.checkFd(fd);
        const data = fd.data;

        const now = Date.now();
        data.mtime ??= now;
        data.ctime ??= now;
        data.atime ??= now;
        data.birthtime ??= now;
        data.mode  ??= Enums.S_IFDIR | 0o755;

        out.size = !data.contents? 0:
                   data.contents instanceof Uint8Array
                 ? data.contents.byteLength
                 : data.contents.length;

        out.mode =    data.mode;

        out.mtimeMs = data.mtime;
        out.ctimeMs = data.ctime;
        out.atimeMs = data.atime;

        out.uid =     data.uid ?? 0;
        out.gid =     data.gid ?? 0;
        return out;
    }

    /**
     * In the case of this fs the file gets simply dereferenced from memory since we aren't really linking anything but using JS objects.
     * Todo: ...
     * 
     * @param {*} fd File descriptor.
     * @returns {number} Zero on success, errno enum on error.
     */
    unlink(fd) {
        this.checkFd(fd);

        if (Stats.typeOf(fd.data.mode) === Enums.S_IFDIR) {
            return Enums.errno.EISDIR;
        }

        this.fs.delete(fd.ndir);
        return 0;
    }

    _toEncoding(data, encoding) {
        if(encoding === RootFs.ENCODING.utf8) return typeof data === "string"? data: decoder.decode(data);
        if(typeof data === "string") {
            return encoder.encode(data);
        }
        return data;
    }

    destroy() {
        this.fs.clear();
    }
}

/**
 * An in-memory zip-based filesystem.
 * Stores data in a zip format in memory, supports compression, can be easily loaded/saved and patched.
 */
class MemFs {
    static fsType = "memfs";
}

/**
 * Very simple localStorage-based filesystem for small amounts of data.
 */
class LocalStorageFs extends TmpFs {
    static fsType = "localfs";
}

/**
 * Remote cloud filesystem over WebSocket & HTTP.
 */
class RemoteFs {
    static fsType = "remotefs";

    constructor(source, options, dump, order) {
        this.source = source;

        this.ws = new LS.WebSocket(this.source);
        this.ws.on('open',    this.wsOpened.bind(this));
        this.ws.on('message', this.wsMessage.bind(this));
        this.ws.on('close',   this.wsClosed.bind(this));
    }

    async init() {}

    wsOpened() {
        console.log('WebSocket opened');
    }

    wsMessage(event) {
        console.log('WebSocket message:', event.data);
    }

    wsClosed() {
        console.log('WebSocket closed');
    }

    destroy() {
        this.ws.destroy();
    }
}

/**
 * Filesystem for acessing files from a HTTP server over the network.
 * This is a simple implementation that uses the Fetch API to retrieve files from a remote server.
 * It does not support writing or modifying files, only reading (though perhaps via PATCH or PUT requests?).
 * 
 * Reading a file makes a GET request to the server and returns the file's contents.
 */
class HttpFs {
    static fsType = "httpfs";

    constructor(source, options, dump, order) {
        this.source = source;
    }

    async init() {
        if(typeof fetch === "undefined") throw new Error("HttpFs can only be used in environments that support the Fetch API");
    }

    async open(ndir, flags, mode = Enums.S_IFREG | 0o644, extraFlags = 0, extraData = undefined) {
        // HttpFs is read-only, so we only support reading files.
        if(flags & (Enums.O_WRONLY | Enums.O_RDWR | Enums.O_CREAT | Enums.O_TRUNC | Enums.O_APPEND)) {
            throw new FsError(Enums.errno.EROFS);
        }

        // We just return a file descriptor object.
        return {
            _fs: this,
            data: { mode },
            flags,
            ndir,
            offset: 0,
            closed: false,
            readable: true,
            writable: false
        };
    }

    async read(fd, first, nbytes, encoding) {
        const url = this.source + fd.ndir;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        if (nbytes === -1) {
            nbytes = data.length - first;
        }

        const result = data.slice(first, first + nbytes);
        return encoding === RootFs.ENCODING.utf8 ? new TextDecoder().decode(result) : result;
    }

    async readdir(fd, extraFlags) {
        const url = this.source + fd.ndir;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
        }

        const text = await response.text();

        // Assuming the server returns a newline-separated list of filenames.
        // Todo: more robust parsing based on server response format (e.g., JSON, HTML, etc.)
        return text.split('\n').filter(name => name.length > 0);
    }
}

/**
 * IndexedDB-based filesystem for local browser storage.
 */
class IndexedDbFs {
    static fsType = "indexeddbfs";
}

/**
 * WASM filesystem (to be implemented)
 */
class WasmFs {
    static fsType = "wasmfs";
}

/**
 * ProcFs, a virtual filesystem that provides information about processes and system resources.
 */
class ProcFs {
    static fsType = "proc";
}

/**
 * SysFs, a virtual filesystem that provides information about the system and kernel.
 */
class SysFs {
    static fsType = "sys";
}

/**
 * NullFs, a virtual filesystem that discards all data written to it
 * Allows to obtain a file descriptor for any path for whatever reason.
 * Yeah I am also not sure why this is useful but it sure does break all the benchmarks! World's fastest filesystem!
 */
class NullFs {
    static fsType = "nullfs";

    open(ndir, flags, mode = Enums.S_IFREG | 0o644, extraFlags = 0, extraData = undefined) {
        // This fs accepts opening whatever file you throw at it with whatever type you want.
        // It doesn't actually store anything, so it doesn't care about the path.
        return {
            _fs: this,
            data: { mode },
            flags,
            ndir,
            offset: 0,
            closed: false,
            readable: true,
            writable: true
        };
    }

    // Noop
    read(fd, first, nbytes, encoding) {
        return encoding === RootFs.ENCODING.utf8 ? "" : new Uint8Array(0);
    }

    // Noop
    write(fd, newData, first, nbytes) {
        return nbytes; // pretend we wrote everything
    }

    stat(fd, out, ncheck = false) {
        if(!ncheck) {
            if (!fd || !fd._fs || !fd.data || fd.closed) {
                throw new FsError(Enums.errno.EBADF);
            }
        }

        out.size = 0;
        out.mode = fd.data.mode ?? Enums.S_IFREG | 0o644;
        out.mtimeMs = Date.now();
        out.ctimeMs = Date.now();
        out.atimeMs = Date.now();
        out.uid = 0;
        out.gid = 0;
        return out;
    }

    close(fd) {
        fd._fs = null;
        fd.data = null;
        fd.closed = true;
        return 0;
    }
}

// Register fs types
for(const fs of [TmpFs, MemFs, LocalStorageFs, RemoteFs, IndexedDbFs, WasmFs, ProcFs, SysFs, NullFs, HttpFs]) {
    if(!fs.fsType) continue;
    RootFs.fsTypes[fs.fsType] = fs;
}

globalThis.RootFs = RootFs;

export { Stats, Dirent, FsError, RootFs, DEFAULT_FS_DATA, TmpFs, MemFs, LocalStorageFs, RemoteFs, IndexedDbFs, WasmFs, ProcFs, SysFs, NullFs, HttpFs }