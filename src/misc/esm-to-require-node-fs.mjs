// I guess let's hope modules don't freak out :P
// In THEORY this should also make fs somewhat work in browsers out of the box, maybe.
const thing = (typeof require === 'undefined'? (typeof app !== 'undefined'? app.fileSystem: null): require('fs').promises);
function nop() { console.warn("Call to an unimplemented filesystem module method, arguments: ", arguments); }

const access = thing?.access || nop;
const appendFile = thing?.appendFile || nop;
const chmod = thing?.chmod || nop;
const chown = thing?.chown || nop;
const constants = thing?.constants || nop;
const copyFile = thing?.copyFile || nop;
const cp = thing?.cp || nop;
const glob = thing?.glob || nop;
const lchmod = thing?.lchmod || nop;
const lchown = thing?.lchown || nop;
const link = thing?.link || nop;
const lstat = thing?.lstat || nop;
const lutimes = thing?.lutimes || nop;
const mkdir = thing?.mkdir || nop;
const mkdtemp = thing?.mkdtemp || nop;
const mkdtempDisposable = thing?.mkdtempDisposable || nop;
const open = thing?.open || nop;
const opendir = thing?.opendir || nop;
const readFile = thing?.readFile || nop;
const readdir = thing?.readdir || nop;
const readlink = thing?.readlink || nop;
const realpath = thing?.realpath || nop;
const rename = thing?.rename || nop;
const rm = thing?.rm || nop;
const rmdir = thing?.rmdir || nop;
const stat = thing?.stat || nop;
const statfs = thing?.statfs || nop;
const symlink = thing?.symlink || nop;
const truncate = thing?.truncate || nop;
const unlink = thing?.unlink || nop;
const utimes = thing?.utimes || nop;
const watch = thing?.watch || nop;
const writeFile = thing?.writeFile || nop;

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