/**
 * This file is for the electron version of the application
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// Flavors have different icons. TODO; update icons dynamically
const ICON_BASE = "assets/images";

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            sandbox: false
        },

        icon: process.platform === "win32" ? path.join(__dirname, ICON_BASE + "/favicon.ico") : path.join(__dirname, ICON_BASE + "/favicon.png"),
    });

    mainWindow.maximize();
    mainWindow.loadFile('index.html');
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


app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    // app.on('browser-window-created', (event, window) => {
    //     window.setMenu(null);
    //     // window.webContents.openDevTools();
    // });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
