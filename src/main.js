'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, ConflictError, VersionError } = require('./core/store');
const { exportWorkbook, importWorkbookFull } = require('./core/excel');
const M = require('./core/model');
const { spawn } = require('child_process');
const { summarizeSite } = require('./core/dashboard');
const { Inventaire } = require('./core/inventaire');
const { UPDATE_DIR, findUpdate } = require('./core/update');

// Interface en français (heures sur 24 h dans les champs horaires).
app.commandLine.appendSwitch('lang', 'fr-FR');

let win;
let config;
let store;

// Chaque poste note sa version dans le dossier commun (voir newestVersion).
function openStore(dir) {
  const st = new Store(dir, { appVersion: app.getVersion() });
  try {
    st.registerPoste(config.poste, app.getVersion());
  } catch { /* dossier inaccessible : signalé à la première lecture */ }
  return st;
}

const configFile = () => path.join(app.getPath('userData'), 'config.json');

// Un poste peut connaître plusieurs sites (un dossier de données chacun) ;
// `dataDir` est le site actif.
function withSites(cfg) {
  const sites = (Array.isArray(cfg.sites) ? cfg.sites : []).filter((x) => x && x.dataDir);
  if (cfg.dataDir && !sites.some((x) => x.dataDir === cfg.dataDir)) sites.unshift({ dataDir: cfg.dataDir });
  return { ...cfg, sites };
}

function loadConfig() {
  const defaults = { dataDir: path.join(app.getPath('documents'), 'Liaison'), poste: os.hostname() };
  try {
    return withSites({ ...defaults, ...JSON.parse(fs.readFileSync(configFile(), 'utf8')) });
  } catch {
    return withSites({ ...defaults, firstRun: true });
  }
}

function saveConfig(next) {
  config = withSites({ ...config, ...next });
  delete config.firstRun;
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  store = openStore(config.dataDir);
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
      if (err instanceof VersionError) return { ok: false, code: 'VERSION', error: err.message, version: err.version };
      return { ok: false, error: err.message || String(err) };
    }
  });
}

handle('config:get', () => ({ ...config, appVersion: app.getVersion() }));
handle('config:set', (next) => ({ ...saveConfig(next), appVersion: app.getVersion() }));
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
    store.rememberNcTypes(saved);
  } catch { /* ces listes sont un confort : elles ne bloquent pas l'enregistrement */ }
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
handle('site:load', () => store.loadSite());

// Sites connus de ce poste, avec leurs responsables et superviseurs.
const DEFAULT_SITE_NAME = 'Tronc principal';
// Sans nom enregistré : « Tronc principal » pour le premier site (historique), sinon le nom du dossier.
const siteName = (st, dataDir) => st.loadSite().nom || (config.sites[0] && config.sites[0].dataDir === dataDir ? DEFAULT_SITE_NAME : path.basename(dataDir));
handle('sites:overview', () => config.sites.map(({ dataDir }) => {
  try {
    const st = new Store(dataDir);
    return {
      dataDir,
      nom: siteName(st, dataDir),
      responsables: st.loadUsers(),
      superviseurs: st.loadSupervisors(),
      actif: dataDir === config.dataDir,
    };
  } catch (err) {
    return { dataDir, nom: path.basename(dataDir), responsables: [], superviseurs: [], actif: dataDir === config.dataDir, erreur: err.message };
  }
}));
handle('sites:info', (dataDir) => new Store(dataDir).loadSite());
handle('sites:rename', (dataDir, nom) => {
  const st = new Store(dataDir);
  return st.saveSite({ ...st.loadSite(), nom: String(nom || '').trim() });
});
handle('sites:select', (dataDir) => {
  if (!config.sites.some((x) => x.dataDir === dataDir)) throw new Error('Site inconnu sur ce poste.');
  return { ...saveConfig({ dataDir }), appVersion: app.getVersion() };
});
// Inventaire du site actif (indépendant de la main courante).
const inv = () => new Inventaire(config.dataDir);
handle('inv:list', () => inv().list());
handle('inv:saveCategories', (cats) => inv().saveCategories(cats));
handle('inv:saveArticle', (a) => inv().saveArticle(a, a.par || config.poste));
handle('inv:deleteArticle', (id) => inv().deleteArticle(id));
handle('inv:addMovement', (m) => inv().addMovement(m, m.par || config.poste));
handle('inv:deleteMovement', (id) => inv().deleteMovement(id));
handle('inv:history', (id) => inv().history(id));
handle('sup:list', () => store.loadSupervisors());
handle('sup:save', (nom, pin) => store.saveSupervisor(nom, pin));
handle('sup:remove', (nom) => store.removeSupervisor(nom));
// Le code PIN est vérifié sur le site où le superviseur est enregistré.
handle('auth:verify', (dataDir, nom, pin) => {
  if (!config.sites.some((x) => x.dataDir === dataDir)) return false;
  return new Store(dataDir).verifyPin(nom, pin);
});
handle('dashboard:site', (dataDir) => {
  if (!config.sites.some((x) => x.dataDir === dataDir)) throw new Error('Site inconnu sur ce poste.');
  return summarizeSite(new Store(dataDir));
});
handle('site:save', (site) => store.saveSite(site));
handle('nc:load', () => store.loadNcTypes());
handle('nc:save', (types) => store.saveNcTypes(types));
handle('tasks:list', () => store.listTasks());
handle('tasks:save', (task) => store.saveTask(task));
handle('tasks:delete', (id) => store.deleteTask(id));

// Photos : réduites (1600 px max, JPEG) et rangées dans <données>/photos/AAAA/MM/.
const PHOTO_MAX = 1600;
function storePhoto(img, date) {
  if (img.isEmpty()) throw new Error('Image illisible.');
  const { width, height } = img.getSize();
  const scale = Math.min(1, PHOTO_MAX / Math.max(width, height));
  const resized = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : img;
  const [y, m] = String(date).split('-');
  const rel = path.posix.join('photos', y, m, `${date}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`);
  const abs = store.photoPath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, resized.toJPEG(82));
  return rel;
}
handle('photo:pick', async (date) => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Ajouter des photos',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return [];
  return r.filePaths.map((f) => storePhoto(nativeImage.createFromPath(f), date));
});
handle('photo:saveData', (dataUrl, date) => storePhoto(nativeImage.createFromDataURL(dataUrl), date));
handle('photo:read', (rel, thumb = false) => {
  const img = nativeImage.createFromPath(store.photoPath(rel));
  if (img.isEmpty()) throw new Error('Photo introuvable.');
  return (thumb ? img.resize({ height: 160, quality: 'good' }) : img).toDataURL();
});
handle('photo:open', (rel) => shell.openPath(store.photoPath(rel)));

// Son personnel de l'intro fun : copié dans <données>/fun/ pour tous les postes.
const SON_TYPES = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm', flac: 'audio/flac' };
handle('fun:pickSound', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choisir le son de l\'intro',
    filters: [{ name: 'Sons', extensions: Object.keys(SON_TYPES) }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  if (fs.statSync(src).size > 10 * 1024 * 1024) throw new Error('Fichier trop lourd (10 Mo maximum).');
  const ext = path.extname(src).slice(1).toLowerCase();
  const rel = `fun/son-${Date.now().toString(36)}.${ext}`;
  fs.mkdirSync(path.join(config.dataDir, 'fun'), { recursive: true });
  fs.copyFileSync(src, path.join(config.dataDir, rel));
  return { rel, nom: path.basename(src) };
});
handle('fun:readSound', (rel) => {
  const abs = path.resolve(config.dataDir, rel);
  if (!abs.startsWith(path.resolve(config.dataDir, 'fun') + path.sep)) throw new Error('Chemin de son invalide.');
  const type = SON_TYPES[path.extname(abs).slice(1).toLowerCase()] || 'audio/mpeg';
  return `data:${type};base64,${fs.readFileSync(abs).toString('base64')}`;
});
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
  // Miniatures des photos pour l'onglet « Photos » du classeur.
  const loadPhoto = (rel) => {
    try {
      const img = nativeImage.createFromPath(store.photoPath(rel));
      if (img.isEmpty()) return null;
      const small = img.resize({ height: 300, quality: 'good' });
      const { width, height } = small.getSize();
      return { buffer: small.toJPEG(80), width, height };
    } catch {
      return null;
    }
  };
  const site = store.loadSite();
  await exportWorkbook(store.loadRange(dates), r.filePath, { tasks: store.listTasks(), site, siteName: siteName(store, config.dataDir), loadPhoto });
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
  const { days } = await importWorkbookFull(file, { year: yearMatch ? yearMatch[1] : new Date().getFullYear() });
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
  const { days, tasks } = await importWorkbookFull(file, { year: yearMatch ? yearMatch[1] : new Date().getFullYear() });
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
  // Tâches contenues dans un classeur exporté par l'application : on ajoute celles qui manquent.
  const known = new Set(store.listTasks().map((t) => t.id));
  for (const t of tasks) if (t && t.id && !known.has(t.id)) store.saveTask(t);
  return { written, skipped };
});

// Mises à jour : nouvel installateur déposé dans <dossier des données>/mises-a-jour.
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE || null;
const updateKind = () => (PORTABLE_EXE ? 'portable' : 'installation');

// Cherche la version la plus récente dans le dossier mises-a-jour de tous les
// sites connus du poste (site actif d'abord).
function findAnyUpdate() {
  let best = null;
  const dirs = [config.dataDir, ...withSites(config).sites.map((x) => x.dataDir)];
  for (const dir of [...new Set(dirs)]) {
    let u = null;
    try {
      u = findUpdate(dir, app.getVersion(), updateKind());
    } catch { /* dossier inaccessible */ }
    if (u && (!best || M.compareVersions(u.version, best.version) > 0)) best = u;
  }
  return best;
}

handle('update:check', () => {
  const dir = path.join(config.dataDir, UPDATE_DIR);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch { /* dossier en lecture seule : on vérifie quand même */ }
  let newest = null;
  try {
    newest = store.newestVersion();
  } catch { /* sans importance */ }
  return {
    current: app.getVersion(), kind: updateKind(), dir,
    update: app.isPackaged ? findAnyUpdate() : null,
    newer: newest && M.compareVersions(newest.version, app.getVersion()) > 0 ? newest : null,
  };
});

handle('update:install', () => {
  const update = findAnyUpdate();
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
  store = openStore(config.dataDir);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
