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
