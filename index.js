/**
 * This file is for the electron version of the application
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const stripJsonComments = require("./assets/src/misc/strip-json-comments.js");

const configPath = path.join(__dirname, "config.jsonc");
let config = {};
if (fs.existsSync(configPath)) {
    const configString = fs.readFileSync(configPath, "utf-8");
    config = JSON.parse(stripJsonComments(configString));
} else {
    console.warn("Config file not found. Using default configuration.");
}

// Flavors have different icons. TODO; update icons dynamically
const ICON_BASE = config.flavor? "assets/src/flavors/" + config.flavor + "/images" : "assets/images";

function createWindow() {
    const window = new BrowserWindow({
        width: 800,
        height: 600,

        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            sandbox: false
        },

        icon: process.platform === "win32" ? path.join(__dirname, ICON_BASE + "/favicon.ico") : path.join(__dirname, ICON_BASE + "/favicon.png"),
    });

    window.maximize();
    window.loadFile('index.html');
    window.removeMenu();
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

ipcMain.on('new-window', (event) => {
    createWindow();
});

ipcMain.on('open-external', (event, url) => {
    shell.openExternal(url);
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
