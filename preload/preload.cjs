const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pdfToTxt', {
  getState: () => ipcRenderer.invoke('app:getState'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  pickPdfs: () => ipcRenderer.invoke('dialog:pickPdfs'),
  pickFolder: (title) => ipcRenderer.invoke('dialog:pickFolder', title),
  collectPdfs: (inputPath) => ipcRenderer.invoke('pdf:collect', inputPath),
  previewPdf: (pdfPath) => ipcRenderer.invoke('pdf:preview', pdfPath),
  convert: (payload) => ipcRenderer.invoke('pdf:convert', payload),
  cancel: () => ipcRenderer.invoke('pdf:cancel'),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItem', filePath),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  onSettingsChanged: (cb) => {
    const listener = (_e, settings) => cb(settings);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
  onProgress: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('pdf:progress', listener);
    return () => ipcRenderer.removeListener('pdf:progress', listener);
  }
});
