/**
 * Facade matching the Electron preload API (window.pdfToTxt).
 * Requires vendor/tauri-tray-bridge.js and withGlobalTauri.
 */
(function () {
  const bridge = window.tauriTrayBridge;
  if (!bridge) {
    console.error("tauriTrayBridge missing — load vendor/tauri-tray-bridge.js first");
    return;
  }

  function invoke(cmd, args) {
    return bridge.invoke(cmd, args || {});
  }

  function onEvent(event, cb) {
    let unlisten = null;
    bridge.listen(event, cb).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }

  window.pdfToTxt = {
    getState: async () => {
      const state = await bridge.getAppState();
      const dark =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      return { ...state, dark: !!dark };
    },
    getSettings: () => bridge.getSettings(),
    setSettings: (partial) => bridge.setSettings(partial),
    pickPdfs: () => invoke("dialog_pick_pdfs"),
    pickFolder: (title) => invoke("dialog_pick_folder", { title: title || "Choose folder" }),
    collectPdfs: (inputPath) => invoke("pdf_collect", { inputPath }),
    previewPdf: (pdfPath) => invoke("pdf_preview", { pdfPath }),
    convert: (payload) => invoke("pdf_convert", { payload: payload || {} }),
    cancel: () => invoke("pdf_cancel"),
    showItemInFolder: (filePath) => invoke("shell_show_item", { filePath }),
    openPath: (targetPath) => invoke("shell_open_path", { targetPath }),
    getPathForFile: (file) => {
      try {
        if (file && typeof file.path === "string" && file.path) return file.path;
        return "";
      } catch {
        return "";
      }
    },
    onSettingsChanged: (cb) => bridge.onSettingsChanged(cb),
    onProgress: (cb) => onEvent("pdf:progress", cb),
  };
})();
