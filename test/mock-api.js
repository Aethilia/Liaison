// API factice en mémoire pour tester l'interface dans un navigateur sans Electron.
(function () {
  const db = {};
  const key = (d, s) => `${d}_${s}`;
  const ok = (value) => Promise.resolve({ ok: true, value: JSON.parse(JSON.stringify(value)) });
  const M = () => window.LiaisonModel;
  const load = (d, s) => (db[key(d, s)] ? JSON.parse(JSON.stringify(db[key(d, s)])) : M().emptyService(d, s));
  let config = { dataDir: 'C:\\Partage\\Liaison', poste: 'Pont-bascule', appVersion: '1.10.2' };
  let users = window.__users || [];
  let agents = window.__agents || [];
  let site = window.__site || { couleurs: {} };
  let ncTypes = window.__ncTypes || [];
  const tasks = window.__tasks || {};
  const photos = {};
  const plan = window.__plan || { agents: [], sem: {} };
  window.__plan = plan;
  const lundi = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
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
    funPickSound: (genre) => ok(genre === 'gif' ? (window.__gifPick || null) : (window.__sonPick || null)),
    funReadSound: (rel) => ok(String(rel).includes('gif') ? (window.__gifUrl || '') : (window.__sonUrl || 'data:audio/wav;base64,')),
    funFind: (nom, cle = 'fun') => ok(site[cle] && (site[cle].user === nom || site[cle].user === '*') ? { dataDir: config.dataDir, fun: site[cle] } : null),
    funSaveAll: (fun, farce, clic, caca, bonhomme, sons) => { site = { ...site, fun, ...(farce !== undefined ? { farce } : {}), ...(clic !== undefined ? { clic } : {}), ...(caca !== undefined ? { caca } : {}), ...(bonhomme !== undefined ? { bonhomme } : {}), ...(sons !== undefined ? { sons } : {}) }; return ok({ sites: 1, echecs: [] }); },
    setFullScreen: () => ok(true),
    funSons: (nom) => ok([...(site.sons || []), ...(site.clic && site.clic.son ? [{ zone: 'agent', ...site.clic }] : [])].filter((r) => r.user === '*' || r.user === nom)
      .map((r) => ({ zone: r.zone, url: r.son ? (window.__sonUrl || 'data:audio/wav;base64,') : null, gif: r.gif ? (window.__gifUrl || null) : null, pos: r.pos, taille: r.taille, duree: r.duree }))),
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
    planAgents: () => ok(plan.agents),
    planSaveAgents: (list) => { plan.agents = list.filter((a) => a.nom).map((a, i) => ({ id: a.id || `ag${Date.now().toString(36)}${i}`, nom: a.nom.trim(), equipe: a.equipe || 'autres', ...(a.service && a.equipe === 'responsables' ? { service: a.service } : {}), ...(a.role ? { role: a.role } : {}), ...(a.roles && a.roles.length > 1 ? { roles: a.roles } : {}), ...(a.arrivee ? { arrivee: a.arrivee } : {}), ...(a.depart ? { depart: a.depart } : {}) })); return ok(plan.agents); },
    planSemaine: (d) => { const l = lundi(d); const s = plan.sem[l] || { cases: {}, notes: '' }; return ok({ lundi: l, cases: s.cases, notes: s.notes, reperes: s.reperes || [] }); },
    planSetCase: (id, d, v) => { const l = lundi(d); const s = plan.sem[l] = plan.sem[l] || { cases: {}, notes: '' }; s.cases[id] = s.cases[id] || {}; if (v && (v.code || v.texte || v.hs || v.service)) s.cases[id][d] = { code: v.code || '', texte: v.texte || '', ...(v.service ? { service: v.service } : {}), ...(v.hs ? { hs: v.hs, ...(v.hsType ? { hsType: v.hsType } : {}) } : {}), ...(v.couleur ? { couleur: v.couleur } : {}) }; else delete s.cases[id][d]; return ok({ lundi: l, ...s }); },
    planFusionner: (src, cible) => { for (const w of Object.values(plan.sem)) if (w.cases[src]) { w.cases[cible] = { ...w.cases[src], ...(w.cases[cible] || {}) }; delete w.cases[src]; } plan.agents = plan.agents.filter((a) => a.id !== src); return ok({ agents: plan.agents, semaines: 1 }); },
    planVider: () => { plan.agents = []; plan.sem = {}; return ok([]); },
    planSimList: (mois) => ok((plan.sims || []).filter((x) => x.mois === mois)),
    planSimSave: (sim, par) => { plan.sims = plan.sims || []; const x = { ...sim, id: sim.id || `s${Date.now().toString(36)}`, majPar: par || '' }; plan.sims = plan.sims.filter((y) => y.id !== x.id).concat(x); return ok(x); },
    planSimDelete: (id) => { plan.sims = (plan.sims || []).filter((y) => y.id !== id); return ok(true); },
    planAppliquer: (list) => { let poses = 0; let ignores = 0; for (const c of list) { const l = lundi(c.date); const s = plan.sem[l] = plan.sem[l] || { cases: {}, notes: '' }; s.cases[c.agentId] = s.cases[c.agentId] || {}; if (s.cases[c.agentId][c.date]) ignores++; else { s.cases[c.agentId][c.date] = { code: c.code, texte: '' }; poses++; } } return ok({ poses, ignores }); },
    planCodes: () => ok(plan.codes || []),
    planRoles: () => ok(plan.rolesCouleurs || {}),
    planSaveRoles: (c) => { plan.rolesCouleurs = c; return ok(c); },
    planSaveCodes: (c) => { plan.codes = c; return ok(c); },
    planSetReperes: (d, rep) => { const l = lundi(d); const s = plan.sem[l] = plan.sem[l] || { cases: {}, notes: '' }; s.reperes = rep; return ok({ lundi: l, ...s }); },
    planImportChoisir: () => ok(window.__planImport ? window.__planImport.apercu : null),
    planImportAppliquer: () => { const imp = window.__planImport; for (const a of imp.agents) if (!plan.agents.some((x) => x.nom === a.nom)) plan.agents.push({ id: `ag${plan.agents.length}x`, ...a }); for (const [l, w] of Object.entries(imp.semaines)) { const s = plan.sem[l] = plan.sem[l] || { cases: {}, notes: '' }; for (const [nom, j] of Object.entries(w.cases)) s.cases[plan.agents.find((x) => x.nom === nom).id] = j; s.reperes = w.reperes || []; } plan.codes = [...(plan.codes || []), ...(imp.codes || [])]; return ok({ codes: plan.codes, agents: plan.agents, ajoutes: imp.agents.length, nbSemaines: Object.keys(imp.semaines).length }); },
    planSetNotes: (d, n) => { const l = lundi(d); const s = plan.sem[l] = plan.sem[l] || { cases: {}, notes: '' }; s.notes = n; return ok({ lundi: l, ...s }); },
    planEntre: (a, b) => { const out = {}; for (const s of Object.values(plan.sem)) for (const [id, j] of Object.entries(s.cases)) for (const [d, v] of Object.entries(j)) if (d >= a && d <= b) (out[id] = out[id] || {})[d] = v; return ok(out); },
    impList: () => { const t = window.__imp || []; return ok({ actifs: t.filter((m) => !m.valideLe).reverse(), valides: t.filter((m) => m.valideLe).reverse().slice(0, 5) }); },
    impAjouter: (texte, par) => { const m = { id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, texte, creePar: par || '', creeLe: new Date().toISOString(), validePar: '', valideLe: null }; (window.__imp = window.__imp || []).push(m); return ok(m); },
    impValider: (id, par) => { const m = (window.__imp || []).find((x) => x.id === id); if (m && !m.valideLe) Object.assign(m, { validePar: par || '', valideLe: new Date().toISOString() }); return ok(m); },
    extList: () => ok([...(window.__ext || (window.__ext = []))].sort((a, b) => b.date.localeCompare(a.date))),
    extSave: (e, par) => { window.__ext = window.__ext || []; const x = { ...e, id: e.id || `e${Date.now().toString(36)}`, creePar: par || '' }; window.__ext = window.__ext.filter((y) => y.id !== x.id).concat(x); return ok(x); },
    extDelete: (id) => { window.__ext = (window.__ext || []).filter((y) => y.id !== id); return ok(true); },
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
