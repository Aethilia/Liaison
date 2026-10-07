// API factice en mémoire pour tester l'interface dans un navigateur sans Electron.
(function () {
  const db = {};
  const key = (d, s) => `${d}_${s}`;
  const ok = (value) => Promise.resolve({ ok: true, value: JSON.parse(JSON.stringify(value)) });
  const M = () => window.LiaisonModel;
  const load = (d, s) => (db[key(d, s)] ? JSON.parse(JSON.stringify(db[key(d, s)])) : M().emptyService(d, s));
  let config = { dataDir: 'C:\\Partage\\Liaison', poste: 'Pont-bascule', appVersion: '1.5.7' };
  let users = window.__users || [];
  let agents = window.__agents || [];
  let site = window.__site || { couleurs: {} };
  let ncTypes = window.__ncTypes || [];
  const tasks = window.__tasks || {};
  const photos = {};
  const inv = window.__inv || { categories: [], articles: {}, mouvements: [], seq: 0 };
  window.__inv = inv;
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
    funPickSound: () => ok(window.__sonPick || null),
    funReadSound: () => ok(window.__sonUrl || 'data:audio/wav;base64,'),
    funFind: (nom) => ok(site.fun && site.fun.user === nom ? { dataDir: config.dataDir, fun: site.fun } : null),
    funReadPhoto: (rel) => ok(photos[rel] || SAMPLE_IMG),
    sitesOverview: () => ok((window.__sites || [{ dataDir: config.dataDir, nom: 'Tronc principal', superviseurs: [] }]).map((x) => ({
      responsables: users, superviseurs: [], ...x, actif: x.dataDir === config.dataDir,
    }))),
    renameSite: () => ok({}),
    siteInfo: () => ok({}),
    selectSite: (d) => { config = { ...config, dataDir: d }; return ok(config); },
    listSupervisors: () => ok(((window.__sites || [])[0] || {}).superviseurs || []),
    saveSupervisor: () => ok([]),
    removeSupervisor: () => ok([]),
    verifyPin: (d, n, pin) => ok(pin === '1234'),
    siteDashboard: (d) => {
      const live = M().currentService();
      const day = { matin: load(live.date, 'matin'), apresmidi: load(live.date, 'apresmidi'), nuit: load(live.date, 'nuit') };
      const imp = [];
      Object.values(db).forEach((sv) => (sv.observations || []).forEach((o) => { if (o.important) imp.push({ date: sv.date, service: sv.service, heure: o.heure, texte: o.texte }); }));
      return ok({
        site: '', live,
        today: M().SERVICES.map((def) => ({ service: def.id, etat: day[def.id].cloture ? 'clos' : def.id === live.service ? 'en-cours' : M().isEmpty(day[def.id]) ? 'vide' : 'ouvert', responsable: day[def.id].responsable, observations: day[def.id].observations.length, importantes: day[def.id].observations.filter((o) => o.important).length, alertes: 0, totaux: {} })),
        taches: Object.values(tasks).filter((t) => !t.faite),
        nonClotures: [], vides: 3,
        importantes: imp, nonConformes: [], boxs: null,
        stockBas: invView().articles.filter((a) => a.alerte).map((a) => ({ nom: a.nom, stock: a.stock, seuil: a.seuil, unite: a.unite })),
      });
    },
    exportExcel: () => ok(null),
    openFile: () => ok(true),
    pickImport: () => ok(null),
    runImport: () => ok({ written: 0, skipped: 0 }),
    print: () => ok(true),
    checkUpdate: () => ok({ current: '1.0.0', kind: 'installation', dir: 'C:\\Partage\\Liaison\\mises-a-jour', update: window.__update || null }),
    installUpdate: () => ok('1.1.0'),
    openUpdateDir: () => ok(true),
    invList: () => ok(invView()),
    invSaveCategories: (cats) => {
      inv.categories = cats.filter((c) => c.nom).map((c) => ({ id: c.id || `c${++inv.seq}`, nom: c.nom.trim() }));
      const ids = new Set(inv.categories.map((c) => c.id));
      for (const a of Object.values(inv.articles)) if (a.categorie && !ids.has(a.categorie)) a.categorie = null;
      return ok(inv.categories);
    },
    invSaveArticle: (a) => {
      if (!String(a.nom || '').trim()) return Promise.resolve({ ok: false, error: 'Le nom de l\'article est obligatoire.' });
      const id = a.id || `a${++inv.seq}`;
      inv.articles[id] = { ...inv.articles[id], ...a, id, nom: a.nom.trim(), seuil: typeof a.seuil === 'number' ? a.seuil : null };
      return ok(inv.articles[id]);
    },
    invDeleteArticle: (id) => { delete inv.articles[id]; inv.mouvements = inv.mouvements.filter((m) => m.article !== id); return ok(true); },
    invAddMovement: (m) => {
      const out = { ...m, id: `m${++inv.seq}`, date: m.date || new Date().toISOString(), creeLe: new Date().toISOString() };
      inv.mouvements.push(out);
      return ok(out);
    },
    invDeleteMovement: (id) => { inv.mouvements = inv.mouvements.filter((m) => m.id !== id); return ok(true); },
    invHistory: (id) => ok(invStock(inv.mouvements.filter((m) => m.article === id)).history.reverse()),
  };
  function invStock(mv) {
    let stock = 0;
    const history = [...mv].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.creeLe).localeCompare(String(b.creeLe))).map((m) => {
      if (m.type === 'entree') stock += m.quantite; else if (m.type === 'sortie') stock -= m.quantite; else stock = m.quantite;
      return { ...m, stockApres: stock };
    });
    return { stock, history };
  }
  function invView() {
    const articles = Object.values(inv.articles).map((a) => {
      const { stock, history } = invStock(inv.mouvements.filter((m) => m.article === a.id));
      return { ...a, stock, mouvements: history.length, dernier: history[history.length - 1] || null, alerte: a.seuil != null && stock <= a.seuil };
    }).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    return { categories: inv.categories, articles };
  }
})();
