'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, ConflictError } = require('./core/store');
const { exportWorkbook, importWorkbook } = require('./core/excel');
const M = require('./core/model');
const { spawn } = require('child_process');
const { UPDATE_DIR, findUpdate } = require('./core/update');

// Interface en français (heures sur 24 h dans les champs horaires).
app.commandLine.appendSwitch('lang', 'fr-FR');

let win;
let config;
let store;

const configFile = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  const defaults = { dataDir: path.join(app.getPath('documents'), 'Liaison'), poste: os.hostname() };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(configFile(), 'utf8')) };
  } catch {
    return { ...defaults, firstRun: true };
  }
}

function saveConfig(next) {
  config = { ...config, ...next };
  delete config.firstRun;
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  store = new Store(config.dataDir);
  return config;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    title: 'Liaison — Main courante',
    backgroundColor: '#f3f5f8',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Les erreurs sont renvoyées sous forme { error } pour être affichées proprement.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      if (err instanceof ConflictError) return { ok: false, code: 'CONFLICT', error: err.message, current: err.current };
      return { ok: false, error: err.message || String(err) };
    }
  });
}

handle('config:get', () => config);
handle('config:set', (next) => saveConfig(next));
handle('config:chooseDir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Dossier des mains courantes (local ou partage réseau)',
    defaultPath: config.dataDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});
handle('config:openDir', () => {
  fs.mkdirSync(config.dataDir, { recursive: true });
  return shell.openPath(config.dataDir);
});

handle('service:load', (date, service) => store.load(date, service));
handle('service:save', (data, opts = {}) => {
  const saved = store.save(data, { ...opts, by: config.poste });
  try {
    store.rememberAgents(saved);
  } catch { /* la liste d'agents est un confort : ne bloque pas l'enregistrement */ }
  return saved;
});
handle('day:load', (date) => store.loadDay(date));
handle('day:revs', (date) => {
  const day = store.loadDay(date);
  const out = {};
  for (const [k, v] of Object.entries(day)) out[k] = v.rev;
  return out;
});
handle('month:load', (year, month) => store.loadMonth(year, month));
handle('range:load', (from, to) => {
  const dates = [];
  for (let d = from; d <= to; d = M.addDays(d, 1)) dates.push(d);
  return store.loadRange(dates);
});
handle('users:load', () => store.loadUsers());
handle('users:save', (users) => store.saveUsers(users));
handle('agents:load', () => store.loadAgents());
handle('agents:save', (agents) => store.saveAgents(agents));

handle('excel:export', async ({ from, to, suggestedName }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Exporter la main courante',
    defaultPath: path.join(app.getPath('documents'), suggestedName || 'main-courante.xlsx'),
    filters: [{ name: 'Classeur Excel', extensions: ['xlsx'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const dates = [];
  for (let d = from; d <= to; d = M.addDays(d, 1)) dates.push(d);
  await exportWorkbook(store.loadRange(dates), r.filePath);
  return r.filePath;
});
handle('excel:open', (file) => shell.openPath(file));

// Import d'un classeur existant (ex. OCTOBRE_2026.xlsx). Les services déjà
// saisis dans l'application ne sont écrasés que si `overwrite` est vrai.
handle('excel:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Importer un classeur main courante',
    filters: [{ name: 'Classeur Excel', extensions: ['xlsx'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const yearMatch = /(20\d{2})/.exec(path.basename(file));
  const days = await importWorkbook(file, { year: yearMatch ? yearMatch[1] : new Date().getFullYear() });
  let filled = 0;
  let conflicts = 0;
  for (const d of days) {
    for (const s of Object.values(d.services)) {
      if (M.isEmpty(s)) continue;
      filled++;
      if (!M.isEmpty(store.load(s.date, s.service))) conflicts++;
    }
  }
  return { file, days: days.length, filled, conflicts };
});
handle('excel:import', async (file, { overwrite = false } = {}) => {
  const yearMatch = /(20\d{2})/.exec(path.basename(file));
  const days = await importWorkbook(file, { year: yearMatch ? yearMatch[1] : new Date().getFullYear() });
  let written = 0;
  let skipped = 0;
  for (const d of days) {
    for (const s of Object.values(d.services)) {
      if (M.isEmpty(s)) continue;
      const existing = store.load(s.date, s.service);
      if (!M.isEmpty(existing) && !overwrite) {
        skipped++;
        continue;
      }
      store.save(s, { by: `${config.poste} (import Excel)`, force: true });
      written++;
    }
  }
  return { written, skipped };
});

// Mises à jour : nouvel installateur déposé dans <dossier des données>/mises-a-jour.
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE || null;
const updateKind = () => (PORTABLE_EXE ? 'portable' : 'installation');

handle('update:check', () => {
  const dir = path.join(config.dataDir, UPDATE_DIR);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch { /* dossier en lecture seule : on vérifie quand même */ }
  return { current: app.getVersion(), kind: updateKind(), dir, update: app.isPackaged ? findUpdate(config.dataDir, app.getVersion(), updateKind()) : null };
});

handle('update:install', () => {
  const update = findUpdate(config.dataDir, app.getVersion(), updateKind());
  if (!update) throw new Error('Aucune nouvelle version trouvée dans le dossier des mises à jour.');
  if (PORTABLE_EXE) {
    // On ne peut pas remplacer l'exécutable en cours : la nouvelle version est copiée à côté.
    const target = path.join(path.dirname(PORTABLE_EXE), path.basename(update.file));
    fs.copyFileSync(update.file, target);
    spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // Copie locale puis installation silencieuse ; l'application se relance seule.
    const local = path.join(app.getPath('temp'), path.basename(update.file));
    fs.copyFileSync(update.file, local);
    spawn(local, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  }
  setTimeout(() => app.quit(), 500);
  return update.version;
});
handle('update:openDir', () => {
  const dir = path.join(config.dataDir, UPDATE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

handle('print', () => new Promise((resolve, reject) => {
  win.webContents.print({ printBackground: true }, (ok, reason) => (ok || reason === 'cancelled' ? resolve(ok) : reject(new Error(reason))));
}));

app.whenReady().then(() => {
  config = loadConfig();
  store = new Store(config.dataDir);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
