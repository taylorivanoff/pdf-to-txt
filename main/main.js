import { app, ipcMain, dialog, nativeTheme, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { configureAppIsolation, run } = require('electron-tray-base');

configureAppIsolation({
  appId: 'io.github.taylorivanoff.pdf-to-txt',
  appName: 'PDF to TXT'
});

import * as store from './store.js';
import {
  collectPdfs,
  convertPdfToTxt,
  defaultOutPath,
  extractPdf
} from '../src/extract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'PDF to TXT';

let convertCancelled = false;

function resolveOutDir(requested) {
  const settings = store.getSettings();
  const chosen = (requested || settings.outDir || '').trim();
  if (chosen) return chosen;
  return path.join(app.getPath('documents'), 'PDF to TXT');
}

run({
  appName: APP_NAME,
  appId: 'io.github.taylorivanoff.pdf-to-txt',
  iconPath: path.join(app.getAppPath(), 'resources', 'icon.png'),
  splashPath: path.join(app.getAppPath(), 'resources', 'splash.html'),
  store: { instance: store.prefsStore },
  window: {
    html: path.join(__dirname, '..', 'renderer', 'index.html'),
    preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
    minWidth: 420,
    minHeight: 420,
    defaultBounds: { width: 720, height: 560 },
    fullscreenable: false
  },
  dev: { entryModule: { filename: fileURLToPath(import.meta.url) } },
  hooks: {
    getSettings: () => store.getSettings(),
    setSettings: (partial) => store.setSettings(partial),
    onBeforeQuit: () => {
      convertCancelled = true;
    },
    getAppState: () => ({
      settings: store.getSettings(),
      platform: process.platform,
      version: app.getVersion(),
      dark: nativeTheme.shouldUseDarkColors
    }),
    registerIpc: ({ sendToRenderer, getMainWindow }) => {
      ipcMain.handle('dialog:pickPdfs', async () => {
        const result = await dialog.showOpenDialog(getMainWindow(), {
          title: 'Choose PDF files',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        });
        if (result.canceled || !result.filePaths.length) return [];
        return result.filePaths;
      });

      ipcMain.handle('dialog:pickFolder', async (_e, title = 'Choose folder') => {
        const result = await dialog.showOpenDialog(getMainWindow(), {
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
  }
});
