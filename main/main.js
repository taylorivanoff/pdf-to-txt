import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  shell,
  nativeTheme
} from 'electron';
import updater from 'electron-updater';
const { autoUpdater } = updater;
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import {
  createTray,
  updateTrayMenu,
  destroyTray,
  getIconPath
} from './tray.js';
import {
  collectPdfs,
  convertPdfToTxt,
  defaultOutPath,
  extractPdf
} from '../src/extract.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_NAME = 'PDF to TXT';
const START_MINIMIZED_ARG = '--start-minimised';
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let mainWindow = null;
let splashWindow = null;
let trayHandlers = null;
let isQuitting = false;
let manualUpdateCheck = false;
let convertCancelled = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  if (!app.isPackaged) {
    try {
      require('electron-reloader')({ filename: __filename, children: [] }, {
        watchRenderer: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/bun.lock', '**/package-lock.json']
      });
    } catch {
      // electron-reloader is a devDependency; ignore if missing.
    }
  }
}

const MIN_WIDTH = 420;
const MIN_HEIGHT = 420;
const DEFAULT_BOUNDS = { width: 720, height: 560 };
let saveBoundsTimer = null;

function normalizeBounds(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BOUNDS };
  return {
    x: Number.isFinite(raw.x) ? Math.round(raw.x) : undefined,
    y: Number.isFinite(raw.y) ? Math.round(raw.y) : undefined,
    width: Math.max(MIN_WIDTH, Math.round(raw.width || DEFAULT_BOUNDS.width)),
    height: Math.max(MIN_HEIGHT, Math.round(raw.height || DEFAULT_BOUNDS.height))
  };
}

function boundsVisibleOnAnyDisplay(bounds) {
  const displays = screen.getAllDisplays();
  if (!displays.length) return true;
  const cx = (bounds.x ?? 0) + bounds.width / 2;
  const cy = (bounds.y ?? 0) + bounds.height / 2;
  return displays.some((d) => {
    const { x, y, width, height } = d.bounds;
    const onCenter = cx >= x && cx < x + width && cy >= y && cy < y + height;
    const onOrigin = Number.isFinite(bounds.x)
      && Number.isFinite(bounds.y)
      && bounds.x < x + width
      && bounds.x + bounds.width > x
      && bounds.y < y + height
      && bounds.y + bounds.height > y;
    return onCenter || onOrigin;
  });
}

function getWindowBounds() {
  const saved = normalizeBounds(store.getWindowBounds());
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
    return { width: saved.width, height: saved.height };
  }
  if (!boundsVisibleOnAnyDisplay(saved)) {
    return { width: saved.width, height: saved.height };
  }
  return saved;
}

function saveWindowBounds(immediate = false) {
  const persist = () => {
    saveBoundsTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) return;
    store.setWindowBounds(normalizeBounds(mainWindow.getBounds()));
  };

  if (immediate) {
    if (saveBoundsTimer) {
      clearTimeout(saveBoundsTimer);
      saveBoundsTimer = null;
    }
    persist();
    return;
  }

  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(persist, 150);
}

function createSplash() {
  const splashPath = path.join(app.getAppPath(), 'resources', 'splash.html');
  splashWindow = new BrowserWindow({
    width: 280,
    height: 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: { nodeIntegration: false }
  });
  splashWindow.loadFile(splashPath);
  splashWindow.center();
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy();
    splashWindow = null;
  }
}

function platformWindowOptions() {
  const isMac = process.platform === 'darwin';
  if (isMac) {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 10, y: 7 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000'
    };
  }
  return {
    frame: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f3f3f3',
    autoHideMenuBar: true
  };
}

function applyWindowOpacity(value) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const opacity = Math.min(1, Math.max(0.35, Number(value) || 0.94));
  mainWindow.setOpacity(opacity);
}

function createWindow() {
  if (mainWindow) return mainWindow;

  const bounds = getWindowBounds();
  const settings = store.getSettings();

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: false,
    alwaysOnTop: settings.alwaysOnTop,
    minimizable: true,
    maximizable: true,
    fullscreenable: false,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    icon: getIconPath(),
    ...platformWindowOptions(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    }, false);
  } else {
    mainWindow.setSize(bounds.width, bounds.height, false);
  }

  mainWindow.setMenu(null);
  applyWindowOpacity(settings.opacity);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    closeSplash();
    applyWindowOpacity(store.getSettings().opacity);
    const startMinimised = process.argv.includes(START_MINIMIZED_ARG) || store.getSettings().startMinimised;
    if (!startMinimised) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('resize', () => saveWindowBounds(false));
  mainWindow.on('move', () => saveWindowBounds(false));
  mainWindow.on('resized', () => saveWindowBounds(true));
  mainWindow.on('moved', () => saveWindowBounds(true));
  mainWindow.on('close', (event) => {
    saveWindowBounds(true);
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('hide', () => saveWindowBounds(true));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function showWindow() {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function toggleWindow() {
  if (!mainWindow || !mainWindow.isVisible()) showWindow();
  else hideWindow();
}

function syncLoginItemArgs() {
  const login = app.getLoginItemSettings();
  if (!login.openAtLogin) return;
  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
    args: store.getSettings().startMinimised ? [START_MINIMIZED_ARG] : []
  });
}

function applyAlwaysOnTop(value) {
  store.setSettings({ alwaysOnTop: value });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(value);
  if (trayHandlers) updateTrayMenu(trayHandlers, APP_NAME);
  sendToRenderer('settings:changed', store.getSettings());
}

function setStartMinimised(value) {
  store.setSettings({ startMinimised: value });
  syncLoginItemArgs();
  if (trayHandlers) updateTrayMenu(trayHandlers, APP_NAME);
  sendToRenderer('settings:changed', store.getSettings());
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function showUpdateDialog(options) {
  return dialog.showMessageBox({ noLink: true, ...options });
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) {
      await showUpdateDialog({
        type: 'info',
        title: APP_NAME,
        message: 'Updates are only available in the installed app.',
        buttons: ['OK']
      });
    }
    return;
  }
  manualUpdateCheck = manual;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    if (manual) {
      await showUpdateDialog({
        type: 'error',
        title: APP_NAME,
        message: 'Could not check for updates.',
        detail: err?.message || String(err),
        buttons: ['OK']
      });
    }
    manualUpdateCheck = false;
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (!manualUpdateCheck) return;
    showUpdateDialog({
      type: 'info',
      title: APP_NAME,
      message: `Update ${info.version} available.`,
      detail: 'Downloading in the background. You will be prompted when it is ready to install.',
      buttons: ['OK']
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    showUpdateDialog({
      type: 'info',
      title: APP_NAME,
      message: 'You are up to date.',
      detail: `Version ${info?.version || app.getVersion()} is the latest.`,
      buttons: ['OK']
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    manualUpdateCheck = false;
    showUpdateDialog({
      type: 'info',
      title: APP_NAME,
      message: `Version ${info.version} is ready to install.`,
      detail: 'Restart the app to apply the update.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall(true, true);
      }
    });
  });

  autoUpdater.on('error', (err) => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    showUpdateDialog({
      type: 'error',
      title: APP_NAME,
      message: 'Could not check for updates.',
      detail: err?.message || String(err),
      buttons: ['OK']
    });
  });

  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), UPDATE_CHECK_INTERVAL_MS);
}

function resolveOutDir(requested) {
  const settings = store.getSettings();
  const chosen = (requested || settings.outDir || '').trim();
  if (chosen) return chosen;
  return path.join(app.getPath('documents'), 'PDF to TXT');
}

function registerIpc() {
  ipcMain.handle('app:getState', () => ({
    settings: store.getSettings(),
    platform: process.platform,
    version: app.getVersion(),
    dark: nativeTheme.shouldUseDarkColors
  }));

  ipcMain.handle('settings:get', () => store.getSettings());

  ipcMain.handle('settings:set', (_e, partial) => {
    const prev = store.getSettings();
    const settings = store.setSettings(partial || {});
    if (partial?.alwaysOnTop !== undefined && partial.alwaysOnTop !== prev.alwaysOnTop) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
    }
    if (partial?.opacity !== undefined) applyWindowOpacity(settings.opacity);
    if (partial?.startMinimised !== undefined) syncLoginItemArgs();
    if (trayHandlers) updateTrayMenu(trayHandlers, APP_NAME);
    sendToRenderer('settings:changed', settings);
    return settings;
  });

  ipcMain.handle('dialog:pickPdfs', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose PDF files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePaths.length) return [];
    return result.filePaths;
  });

  ipcMain.handle('dialog:pickFolder', async (_e, title = 'Choose folder') => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('pdf:collect', async (_e, inputPath) => {
    try {
      const files = await collectPdfs(inputPath);
      return { ok: true, files };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('pdf:preview', async (_e, pdfPath) => {
    try {
      const result = await extractPdf(pdfPath);
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('pdf:convert', async (_e, payload = {}) => {
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!files.length) return { ok: false, error: 'No PDF files selected.' };

    convertCancelled = false;
    const outDir = resolveOutDir(payload.outDir);
    fs.mkdirSync(outDir, { recursive: true });
    store.setSettings({ outDir });

    const results = [];
    for (let i = 0; i < files.length; i += 1) {
      if (convertCancelled) {
        results.push({ pdfPath: files[i], ok: false, error: 'Cancelled.' });
        sendToRenderer('pdf:progress', { index: i, total: files.length, pdfPath: files[i], status: 'cancelled' });
        break;
      }

      const pdfPath = files[i];
      const outPath = defaultOutPath(pdfPath, outDir);
      sendToRenderer('pdf:progress', { index: i, total: files.length, pdfPath, outPath, status: 'running' });
      try {
        const converted = await convertPdfToTxt(pdfPath, outPath);
        results.push({ ok: true, ...converted });
        sendToRenderer('pdf:progress', {
          index: i,
          total: files.length,
          pdfPath,
          outPath: converted.outPath,
          pages: converted.pages,
          bytes: converted.bytes,
          status: 'done'
        });
      } catch (err) {
        const error = err?.message || String(err);
        results.push({ ok: false, pdfPath, outPath, error });
        sendToRenderer('pdf:progress', { index: i, total: files.length, pdfPath, outPath, status: 'error', error });
      }
    }

    const settings = store.getSettings();
    if (settings.openWhenDone && results.some((r) => r.ok)) {
      shell.openPath(outDir);
    }

    return { ok: true, outDir, results, cancelled: convertCancelled };
  });

  ipcMain.handle('pdf:cancel', () => {
    convertCancelled = true;
    return { ok: true };
  });

  ipcMain.handle('shell:showItem', (_e, filePath) => {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  });

  ipcMain.handle('shell:openPath', async (_e, targetPath) => {
    if (!targetPath) return { ok: false };
    const err = await shell.openPath(targetPath);
    return { ok: !err, error: err || null };
  });
}

app.whenReady().then(() => {
  syncLoginItemArgs();
  createSplash();
  registerIpc();
  createWindow();

  trayHandlers = {
    showWindow,
    hideWindow,
    toggleWindow,
    getSettings: () => store.getSettings(),
    setAlwaysOnTop: applyAlwaysOnTop,
    setStartMinimised,
    checkForUpdates: () => checkForUpdates(true),
    quit: () => {
      isQuitting = true;
      app.quit();
    }
  };
  createTray(getIconPath(), trayHandlers, APP_NAME);
  setupAutoUpdater();

  app.on('activate', () => {
    showWindow();
  });
});

app.on('window-all-closed', () => {
  if (isQuitting) app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  convertCancelled = true;
  saveWindowBounds(true);
  closeSplash();
  destroyTray();
});
