/**
 * This file is only the launcher for the Electron version of the application
 * No actual software logic here, see src/main.mjs
 */

const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

// if(fs.existsSync(".use-x11")) {
//     // Wayland is still quite (a lot) buggy with input (still in 2026 smh), so we provide a way for users to switch back to X11
//     // Still waiting for the day Wayland is half stable... any day now right

//     if (
//         process.platform === "linux" &&
//         process.env.XDG_SESSION_TYPE === "wayland" &&
//         !process.argv.includes("--ozone-platform=x11")
//     ) {
//         console.log("Wayland detected. Restarting with X11...");
//         const args = process.argv.slice(1).concat(["--ozone-platform=x11"]);

//         // const { spawn } = require("child_process");
//         // spawn(process.argv[0], args, {
//         //     stdio: "inherit",
//         //     env: process.env,
//         // });

//         // spawn seems to leave the process running even after the app is closed
//         // In general be sure to check if there aren't any hanging electron processes after closing the app, something seems to be doing a poor job at cleaning up

//         app.relaunch({ args });
//         app.exit(0);
//         process.exit(0);
//     }
// }

// For selfsigned certificates (only relevant for development where i use a local LS server)
app.commandLine.appendSwitch('ignore-certificate-errors');

// Help with some GPU encoding issues on Linux
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const path = require('path');
const stripJsonComments = require("./src/misc/strip-json-comments.js");

const configPath = path.join(__dirname, "config.jsonc");
let config = {};
if (fs.existsSync(configPath)) {
    const configString = fs.readFileSync(configPath, "utf-8");
    config = JSON.parse(stripJsonComments(configString));
} else {
    console.warn("Config file not found. Using default configuration.");
}

// Flavors have different icons. TODO; update icons dynamically
const ICON_BASE = config.flavor? "src/flavors/" + config.flavor + "/images" : "assets/images";

function createWindow(options = {}) {
    const window = new BrowserWindow({
        // Will be maximized
        width: options.width   || 800,
        height: options.height || 600,

        show: false,

        backgroundColor: "#1e1e1e", // No flashbangs

        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            sandbox: false
        },

        icon: options.icon || (process.platform === "win32" ? path.join(__dirname, ICON_BASE + "/favicon.ico") : path.join(__dirname, ICON_BASE + "/favicon.png")),
    });

    if(options.maximize !== false) {
        window.maximize();
    }

    window.loadFile('index.html');
    window.removeMenu(); // We have our own

    window.webContents.on("render-process-gone", (event, details) => {
        console.error("Renderer crashed:", details);

        if (details.reason === "crashed") {
            window.loadFile('crash.html');
        }
    });

    
    window.once("ready-to-show", () => {
        window.show();
        window.webContents.toggleDevTools();
    });
    return window;
}

ipcMain.handle('select-directory', async (event, operation) => {
    const properties = operation === 'export' ? ['openDirectory', 'createDirectory'] : ['openDirectory'];
    const result = await dialog.showOpenDialog({
        properties: properties
    });

    if (result.canceled) {
        return null;
    } else {
        return result.filePaths[0];
    }
});

// When menu is disabled, Electron also kindly fucks up the keyboard shortcuts, so we have to implement them ourselves
ipcMain.on('toggle-devtools', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
        window.webContents.toggleDevTools();
    }
});

ipcMain.on('hard-reload', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
        window.webContents.reloadIgnoringCache();
    }
});

ipcMain.on('new-window', (event, options) => {
    createWindow(options);
});

ipcMain.on('open-external', (event, url) => {
    shell.openExternal(url);
});

ipcMain.on('restart-app', (event) => {
    app.relaunch();
    // app.quit();
    app.exit(0);
    process.exit(0);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});