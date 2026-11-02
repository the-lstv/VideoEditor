import { RootFs } from './fs.mjs';
import { Enums } from './enums.mjs';

// import fs from 'fs';
const fs = require('fs');

// NodeFs & server are separated to not take space in the browser

// todo: work in progress

/**
 * Node.js-based filesystem for direct host-machine storage.
 */
class NodeFs {
    static fsType = "nodefs";

    constructor(source, options, dump, order) {
        // super(source, options, dump, order);
        if(typeof process === "undefined") throw new Error("NodeFs can only be used in Node.js environments");
    }

    async init() {}

    open(ndir, flags, mode = Enums.S_IFREG | 0o644, extraFlags = 0, extraData = undefined) {
        const fd = fs.openSync(ndir, flags, mode);
        return {
            _fs: this,
            data: { mode },
            flags,
            ndir,
            offset: 0,
            closed: false,
            readable: true,
            writable: true,
            nodeFd: fd
        };
    }

    read(fd, first, nbytes, encoding) {
        if(nbytes === -1) {
            nbytes = fs.fstatSync(fd.nodeFd).size - first;
        }

        const buffer = Buffer.alloc(nbytes);
        const bytesRead = fs.readSync(fd.nodeFd, buffer, 0, buffer.length, first);
        return encoding === RootFs.ENCODING.utf8 ? buffer.toString("utf8", 0, bytesRead) : buffer.slice(0, bytesRead);
    }

    async readdir(ndir) {
        return await fs.promises.readdir(ndir);
    }

    write(fd, newData, first, nbytes) {
        const buffer = Buffer.isBuffer(newData) ? newData : Buffer.from(newData);
        if(nbytes === -1) {
            nbytes = buffer.length;
        }

        const bytesWritten = fs.writeSync(fd.nodeFd, buffer, 0, nbytes === -1? buffer.length: nbytes, first);
        return bytesWritten;
    }

    stat(fd, out, ncheck = false) {
        if(!ncheck) {
            if (!fd || !fd._fs || !fd.data || fd.closed) {
                throw new Error(Enums.errno.EBADF);
            }
        }

        const stats = fs.fstatSync(fd.nodeFd);
        out.size = stats.size;
        out.mode = stats.mode;
        out.mtimeMs = stats.mtimeMs;
        out.ctimeMs = stats.ctimeMs;
        out.atimeMs = stats.atimeMs;
        out.uid = stats.uid;
        out.gid = stats.gid;
        return out;
    }

    close(fd) {
        fs.closeSync(fd.nodeFd);
        fd._fs = null;
        fd.data = null;
        fd.closed = true;
        return 0;
    }
}

class RemoteFsServer {
    constructor(rootfs, options = {}) {}
    start() {}
    stop() {}
}

RootFs.fsTypes[NodeFs.fsType] = NodeFs;
export { NodeFs, RemoteFsServer }