// TODO: Handle this properly
// I guess let's hope modules don't freak out
const thing = (typeof require === 'undefined' ? null : require('fs').promises);

const access = thing?.access;
const appendFile = thing?.appendFile;
const chmod = thing?.chmod;
const chown = thing?.chown;
const constants = thing?.constants;
const copyFile = thing?.copyFile;
const cp = thing?.cp;
const glob = thing?.glob;
const lchmod = thing?.lchmod;
const lchown = thing?.lchown;
const link = thing?.link;
const lstat = thing?.lstat;
const lutimes = thing?.lutimes;
const mkdir = thing?.mkdir;
const mkdtemp = thing?.mkdtemp;
const mkdtempDisposable = thing?.mkdtempDisposable;
const open = thing?.open;
const opendir = thing?.opendir;
const readFile = thing?.readFile;
const readdir = thing?.readdir;
const readlink = thing?.readlink;
const realpath = thing?.realpath;
const rename = thing?.rename;
const rm = thing?.rm;
const rmdir = thing?.rmdir;
const stat = thing?.stat;
const statfs = thing?.statfs;
const symlink = thing?.symlink;
const truncate = thing?.truncate;
const unlink = thing?.unlink;
const utimes = thing?.utimes;
const watch = thing?.watch;
const writeFile = thing?.writeFile;

export {
    access,
    appendFile,
    chmod,
    chown,
    constants,
    copyFile,
    cp,
    glob,
    lchmod,
    lchown,
    link,
    lstat,
    lutimes,
    mkdir,
    mkdtemp,
    mkdtempDisposable,
    open,
    opendir,
    readFile,
    readdir,
    readlink,
    realpath,
    rename,
    rm,
    rmdir,
    stat,
    statfs,
    symlink,
    truncate,
    unlink,
    utimes,
    watch,
    writeFile
}