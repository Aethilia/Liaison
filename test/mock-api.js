// API factice en mémoire pour tester l'interface dans un navigateur sans Electron.
(function () {
  const db = {};
  const key = (d, s) => `${d}_${s}`;
  const ok = (value) => Promise.resolve({ ok: true, value: JSON.parse(JSON.stringify(value)) });
  const M = () => window.LiaisonModel;
  const load = (d, s) => (db[key(d, s)] ? JSON.parse(JSON.stringify(db[key(d, s)])) : M().emptyService(d, s));
  let config = { dataDir: 'C:\\Partage\\Liaison', poste: 'Pont-bascule' };
  let users = window.__users || [];
  let agents = window.__agents || [];
  let site = window.__site || { couleurs: {} };
  let ncTypes = window.__ncTypes || [];
  const tasks = window.__tasks || {};
  const photos = {};
  const SAMPLE_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#8aa"/><circle cx="80" cy="70" r="30" fill="#dde"/><rect x="120" y="60" width="90" height="70" fill="#567"/></svg>');
  window.__tasks = tasks;
  window.__db = db;
  window.api = {
    getConfig: () => ok(config),
    setConfig: (c) => { config = { ...config, ...c }; return ok(config); },
    chooseDir: () => ok(null),
    openDataDir: () => ok(true),
    loadService: (d, s) => ok(load(d, s)),
    saveService: (data, { expectedRev, force } = {}) => {
      const current = load(data.date, data.service);
      if (!force && expectedRev != null && current.rev !== expectedRev) return Promise.resolve({ ok: false, code: 'CONFLICT', error: 'conflit', current });
      const out = { ...data, rev: current.rev + 1, updatedAt: new Date().toISOString(), updatedBy: config.poste };
      db[key(data.date, data.service)] = out;
      for (const a of out.absents) if (a.nom && !agents.includes(a.nom)) agents.push(a.nom);
      for (const n of out.nonConformes || []) if (n.type && !ncTypes.some((t) => t.nom === n.type)) ncTypes.push({ nom: n.type, unite: n.unite });
      return ok(out);
    },
    loadDay: (d) => ok({ matin: load(d, 'matin'), apresmidi: load(d, 'apresmidi'), nuit: load(d, 'nuit') }),
    dayRevs: (d) => ok({ matin: load(d, 'matin').rev, apresmidi: load(d, 'apresmidi').rev, nuit: load(d, 'nuit').rev }),
    loadMonth: (y, m) => ok(M().daysInMonth(y, m).map((d) => ({ date: d, services: { matin: load(d, 'matin'), apresmidi: load(d, 'apresmidi'), nuit: load(d, 'nuit') } }))),
    loadRange: (from, to) => {
      const out = [];
      for (let d = from; d <= to; d = M().addDays(d, 1)) out.push({ date: d, services: { matin: load(d, 'matin'), apresmidi: load(d, 'apresmidi'), nuit: load(d, 'nuit') } });
      return ok(out);
    },
    loadUsers: () => ok(users),
    saveUsers: (u) => { users = [...new Set(u.map((x) => x.trim()).filter(Boolean))]; return ok(users); },
    loadAgents: () => ok(agents),
    saveAgents: (a) => { agents = [...new Set(a.map((x) => x.trim()).filter(Boolean))].sort(); return ok(agents); },
    loadSite: () => ok(site),
    saveSite: (x) => { site = x; return ok(site); },
    loadNcTypes: () => ok(ncTypes),
    saveNcTypes: (t) => { ncTypes = t; return ok(ncTypes); },
    listTasks: () => ok(Object.values(tasks).sort((a, b) => a.creeLe.localeCompare(b.creeLe))),
    saveTask: (t) => { tasks[t.id] = { ...t, majLe: new Date().toISOString() }; return ok(tasks[t.id]); },
    deleteTask: (id) => { delete tasks[id]; return ok(true); },
    pickPhotos: () => ok(window.__photoPick ? [window.__photoPick] : []),
    savePhotoData: (d) => { photos['photos/x' + Object.keys(photos).length + '.jpg'] = d; return ok('photos/x' + (Object.keys(photos).length - 1) + '.jpg'); },
    readPhoto: (rel) => ok(photos[rel] || SAMPLE_IMG),
    openPhoto: () => ok(true),
    exportExcel: () => ok(null),
    openFile: () => ok(true),
    pickImport: () => ok(null),
    runImport: () => ok({ written: 0, skipped: 0 }),
    print: () => ok(true),
    checkUpdate: () => ok({ current: '1.0.0', kind: 'installation', dir: 'C:\\Partage\\Liaison\\mises-a-jour', update: window.__update || null }),
    installUpdate: () => ok('1.1.0'),
    openUpdateDir: () => ok(true),
  };
})();
