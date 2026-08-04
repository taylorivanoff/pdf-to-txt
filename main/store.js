import Store from 'electron-store';

const store = new Store({
  name: 'pdf-to-txt',
  defaults: {
    opacity: 1,
    alwaysOnTop: false,
    startMinimised: false,
    outDir: '',
    openWhenDone: false,
    windowBounds: null
  }
});

// Scaffold initially wrote alwaysOnTop:true; utilities should not float by default.
if (!store.get('_aotDefaultOff')) {
  store.set('alwaysOnTop', false);
  store.set('_aotDefaultOff', true);
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function getSettings() {
  return {
    opacity: clamp(store.get('opacity', 0.94), 0.35, 1, 0.94),
    alwaysOnTop: !!store.get('alwaysOnTop', false),
    startMinimised: !!store.get('startMinimised', false),
    outDir: String(store.get('outDir', '') || ''),
    openWhenDone: !!store.get('openWhenDone', false)
  };
}

export function setSettings(partial = {}) {
  if (partial.opacity !== undefined) store.set('opacity', clamp(partial.opacity, 0.35, 1, 0.94));
  if (partial.alwaysOnTop !== undefined) store.set('alwaysOnTop', !!partial.alwaysOnTop);
  if (partial.startMinimised !== undefined) store.set('startMinimised', !!partial.startMinimised);
  if (partial.outDir !== undefined) store.set('outDir', String(partial.outDir || ''));
  if (partial.openWhenDone !== undefined) store.set('openWhenDone', !!partial.openWhenDone);
  return getSettings();
}

export function getWindowBounds() {
  return store.get('windowBounds', null);
}

export function setWindowBounds(bounds) {
  store.set('windowBounds', bounds);
}
