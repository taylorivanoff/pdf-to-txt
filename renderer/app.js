(() => {
  const api = window.pdfToTxt;
  if (!api) return;

  const queueEl = document.getElementById('queue');
  const previewEl = document.getElementById('preview');
  const queueLabel = document.getElementById('queue-label');
  const outLabel = document.getElementById('out-label');
  const workspace = document.getElementById('workspace');
  const toast = document.getElementById('toast');
  const settingsOverlay = document.getElementById('settings-overlay');

  const btnAddFiles = document.getElementById('btn-add-files');
  const btnAddFolder = document.getElementById('btn-add-folder');
  const btnClear = document.getElementById('btn-clear');
  const btnPickOut = document.getElementById('btn-pick-out');
  const btnConvert = document.getElementById('btn-convert');
  const btnCancel = document.getElementById('btn-cancel');
  const btnReveal = document.getElementById('btn-reveal');
  const btnSettings = document.getElementById('btn-settings');
  const settingsClose = document.getElementById('settings-close');
  const settingAot = document.getElementById('setting-aot');
  const settingMinimised = document.getElementById('setting-minimised');
  const settingOpenDone = document.getElementById('setting-open-done');
  const settingOpacity = document.getElementById('setting-opacity');
  const settingOpacityOut = document.getElementById('setting-opacity-out');
  const settingsMeta = document.getElementById('settings-meta');

  let settings = {
    opacity: 0.94,
    alwaysOnTop: true,
    startMinimised: false,
    outDir: '',
    openWhenDone: false
  };
  /** @type {{ path: string, name: string, status: string, pages?: number, bytes?: number, outPath?: string, error?: string }[]} */
  let queue = [];
  let selectedPath = null;
  let converting = false;
  let toastTimer = null;

  function basename(filePath) {
    return String(filePath || '').replace(/^.*[\\/]/, '');
  }

  function opacityToPercent(opacity) {
    return Math.round((1 - Math.min(1, Math.max(0.35, Number(opacity) || 0.94))) * 100);
  }

  function percentToOpacity(percent) {
    return Math.min(1, Math.max(0.35, 1 - (Number(percent) || 0) / 100));
  }

  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle('error', !!isError);
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 2800);
  }

  function updateOutLabel() {
    outLabel.textContent = settings.outDir
      ? `Output: ${settings.outDir}`
      : 'Output: Documents/PDF to TXT (default)';
  }

  function syncChrome() {
    btnClear.disabled = !queue.length || converting;
    btnConvert.disabled = !queue.length || converting;
    btnCancel.classList.toggle('hidden', !converting);
    btnAddFiles.disabled = converting;
    btnAddFolder.disabled = converting;
    btnPickOut.disabled = converting;
    queueLabel.textContent = queue.length ? `Queue (${queue.length})` : 'Queue';
    const selected = queue.find((item) => item.path === selectedPath);
    btnReveal.disabled = !(selected && selected.outPath);
  }

  function renderQueue() {
    if (!queue.length) {
      queueEl.innerHTML = '<div class="list-empty">No PDFs yet.<br>Add files, a folder, or drop them here.</div>';
      syncChrome();
      return;
    }

    queueEl.innerHTML = '';
    for (const item of queue) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `row${item.path === selectedPath ? ' active' : ''}`;
      row.innerHTML = `
        <div class="row-body">
          <div class="row-title"></div>
          <div class="row-meta"></div>
        </div>
        <span class="badge"></span>
      `;
      row.querySelector('.row-title').textContent = item.name;
      const meta = [];
      if (item.pages != null) meta.push(`${item.pages} pages`);
      if (item.bytes != null) meta.push(`${item.bytes} bytes`);
      if (item.error) meta.push(item.error);
      else if (item.outPath) meta.push(basename(item.outPath));
      row.querySelector('.row-meta').textContent = meta.join(' · ') || item.path;
      const badge = row.querySelector('.badge');
      badge.textContent = item.status;
      if (item.status === 'done') badge.classList.add('ok');
      else if (item.status === 'error' || item.status === 'cancelled') badge.classList.add('err');
      else if (item.status === 'running') badge.classList.add('run');
      row.addEventListener('click', () => selectItem(item.path));
      queueEl.appendChild(row);
    }
    syncChrome();
  }

  async function selectItem(pdfPath) {
    selectedPath = pdfPath;
    renderQueue();
    previewEl.textContent = 'Extracting…';
    const result = await api.previewPdf(pdfPath);
    if (selectedPath !== pdfPath) return;
    if (!result.ok) {
      previewEl.textContent = result.error || 'Preview failed.';
      return;
    }
    const item = queue.find((q) => q.path === pdfPath);
    if (item) item.pages = result.pages;
    previewEl.textContent = result.text?.trim()
      ? result.text
      : '(No extractable text - this may be a scanned PDF.)';
    renderQueue();
  }

  function addFiles(paths) {
    const existing = new Set(queue.map((q) => q.path));
    let added = 0;
    for (const filePath of paths || []) {
      if (!filePath || existing.has(filePath)) continue;
      if (!String(filePath).toLowerCase().endsWith('.pdf')) continue;
      queue.push({
        path: filePath,
        name: basename(filePath),
        status: 'ready'
      });
      existing.add(filePath);
      added += 1;
    }
    renderQueue();
    if (added && !selectedPath) selectItem(queue[0].path);
    if (added) showToast(`Added ${added} PDF${added === 1 ? '' : 's'}`);
  }

  async function addFolder() {
    const folder = await api.pickFolder('Choose folder of PDFs');
    if (!folder) return;
    const result = await api.collectPdfs(folder);
    if (!result.ok) {
      showToast(result.error || 'Could not read folder', true);
      return;
    }
    addFiles(result.files);
  }

  function applySettings(next) {
    settings = { ...settings, ...next };
    settingAot.checked = !!settings.alwaysOnTop;
    settingMinimised.checked = !!settings.startMinimised;
    settingOpenDone.checked = !!settings.openWhenDone;
    settingOpacity.value = String(opacityToPercent(settings.opacity));
    settingOpacityOut.textContent = `${settingOpacity.value}%`;
    updateOutLabel();
  }

  function openSettings() {
    settingsOverlay.classList.remove('hidden');
  }

  function closeSettings() {
    settingsOverlay.classList.add('hidden');
  }

  async function runConvert() {
    if (!queue.length || converting) return;
    converting = true;
    for (const item of queue) {
      item.status = 'ready';
      item.error = undefined;
    }
    renderQueue();
    syncChrome();

    const result = await api.convert({
      files: queue.map((q) => q.path),
      outDir: settings.outDir || undefined
    });

    converting = false;
    syncChrome();

    if (!result.ok) {
      showToast(result.error || 'Convert failed', true);
      return;
    }

    const byPath = new Map((result.results || []).map((r) => [r.pdfPath, r]));
    for (const item of queue) {
      const r = byPath.get(item.path);
      if (!r) continue;
      if (r.ok) {
        item.status = 'done';
        item.pages = r.pages;
        item.bytes = r.bytes;
        item.outPath = r.outPath;
      } else {
        item.status = r.error === 'Cancelled.' ? 'cancelled' : 'error';
        item.error = r.error;
        item.outPath = r.outPath;
      }
    }
    if (result.outDir) {
      settings.outDir = result.outDir;
      updateOutLabel();
    }
    renderQueue();
    const okCount = (result.results || []).filter((r) => r.ok).length;
    showToast(
      result.cancelled
        ? `Cancelled after ${okCount} file${okCount === 1 ? '' : 's'}`
        : `Converted ${okCount} of ${queue.length}`
    );
  }

  btnAddFiles.addEventListener('click', async () => {
    const files = await api.pickPdfs();
    addFiles(files);
  });
  btnAddFolder.addEventListener('click', () => addFolder());
  btnClear.addEventListener('click', () => {
    queue = [];
    selectedPath = null;
    previewEl.textContent = 'Select a PDF to preview extracted text.';
    renderQueue();
  });
  btnPickOut.addEventListener('click', async () => {
    const folder = await api.pickFolder('Choose output folder');
    if (!folder) return;
    settings = await api.setSettings({ outDir: folder });
    updateOutLabel();
    showToast('Output folder updated');
  });
  btnConvert.addEventListener('click', () => runConvert());
  btnCancel.addEventListener('click', () => api.cancel());
  btnReveal.addEventListener('click', () => {
    const selected = queue.find((item) => item.path === selectedPath);
    if (selected?.outPath) api.showItemInFolder(selected.outPath);
  });
  btnSettings.addEventListener('click', openSettings);
  settingsClose.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  settingAot.addEventListener('change', async () => {
    applySettings(await api.setSettings({ alwaysOnTop: settingAot.checked }));
  });
  settingMinimised.addEventListener('change', async () => {
    applySettings(await api.setSettings({ startMinimised: settingMinimised.checked }));
  });
  settingOpenDone.addEventListener('change', async () => {
    applySettings(await api.setSettings({ openWhenDone: settingOpenDone.checked }));
  });
  settingOpacity.addEventListener('input', () => {
    settingOpacityOut.textContent = `${settingOpacity.value}%`;
  });
  settingOpacity.addEventListener('change', async () => {
    applySettings(await api.setSettings({ opacity: percentToOpacity(settingOpacity.value) }));
  });

  workspace.addEventListener('dragover', (e) => {
    e.preventDefault();
    workspace.classList.add('is-drag');
  });
  workspace.addEventListener('dragleave', () => workspace.classList.remove('is-drag'));
  workspace.addEventListener('drop', async (e) => {
    e.preventDefault();
    workspace.classList.remove('is-drag');
    const dropped = [...(e.dataTransfer?.files || [])];
    const paths = dropped
      .map((file) => api.getPathForFile(file))
      .filter(Boolean);
    if (!paths.length) {
      showToast('Could not read dropped paths', true);
      return;
    }
    const pdfs = paths.filter((f) => f.toLowerCase().endsWith('.pdf'));
    const others = paths.filter((f) => !f.toLowerCase().endsWith('.pdf'));
    addFiles(pdfs);
    for (const folderPath of others) {
      const result = await api.collectPdfs(folderPath);
      if (result.ok) addFiles(result.files);
    }
  });

  api.onProgress((payload) => {
    const item = queue.find((q) => q.path === payload.pdfPath);
    if (!item) return;
    item.status = payload.status;
    if (payload.pages != null) item.pages = payload.pages;
    if (payload.bytes != null) item.bytes = payload.bytes;
    if (payload.outPath) item.outPath = payload.outPath;
    if (payload.error) item.error = payload.error;
    renderQueue();
  });

  api.onSettingsChanged((next) => applySettings(next));

  api.getState().then((state) => {
    document.body.classList.add(`platform-${state.platform}`);
    if (state.dark) document.body.classList.add('dark');
    applySettings(state.settings || {});
    settingsMeta.textContent = `PDF to TXT v${state.version}`;
    renderQueue();
  });
})();
