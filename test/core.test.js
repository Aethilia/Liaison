'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const M = require('../src/core/model');
const { Store } = require('../src/core/store');
const { exportWorkbook, importWorkbook, importWorkbookFull, timeToFraction, cellToTime } = require('../src/core/excel');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-'));

function sample(date = '2026-10-02', service = 'nuit') {
  const s = M.emptyService(date, service);
  s.responsable = 'DUPONT';
  s.absents[1] = { nom: 'Martin', motif: 'CP' };
  s.entrees = { plateaux: 12, pl: 7 };
  s.sorties.DIB = { nb: 2, tonnage: 5.54 };
  s.sorties.Fer = { nb: 1, tonnage: 4.74 };
  s.sorties.Bois.nb = 1;
  s.bennes.Fer = 85;
  s.plateaux.Sport = 40;
  s.observations = [{ heure: '22:15', texte: 'Benne fer pleine, appel prestataire.', important: true, auteur: '' }, { heure: '23:40', texte: 'RAS', important: false, auteur: '' }];
  s.consignes = 'Prévoir rotation DIB à 6h';
  return s;
}

test('relève : ordre des services et service en cours', () => {
  assert.deepEqual(M.previousService('2026-10-01', 'matin'), { date: '2026-09-30', service: 'nuit' });
  assert.deepEqual(M.previousService('2026-10-01', 'nuit'), { date: '2026-10-01', service: 'apresmidi' });
  assert.deepEqual(M.nextService('2026-10-31', 'nuit'), { date: '2026-11-01', service: 'matin' });
  assert.deepEqual(M.currentService(new Date(2026, 9, 2, 3, 30)), { date: '2026-10-01', service: 'nuit' });
  assert.deepEqual(M.currentService(new Date(2026, 9, 2, 5, 0)), { date: '2026-10-02', service: 'matin' });
  assert.deepEqual(M.currentService(new Date(2026, 9, 2, 13, 0)), { date: '2026-10-02', service: 'apresmidi' });
  assert.deepEqual(M.currentService(new Date(2026, 9, 2, 20, 0)), { date: '2026-10-02', service: 'nuit' });
});

test('totaux comme dans le modèle Excel', () => {
  assert.deepEqual(M.totals(sample()), { entrees: 19, sortiesNb: 4, tonnage: 10.28 });
  assert.equal(M.isEmpty(M.emptyService('2026-10-02', 'matin')), true);
  assert.equal(M.isEmpty(sample()), false);
});

test('observations longues réparties sur plusieurs lignes', () => {
  const s = M.emptyService('2026-10-02', 'matin');
  s.observations = [{ heure: '08:00', texte: 'mot '.repeat(60) }];
  const lines = M.layoutObservations(s);
  assert.ok(lines.length >= 3);
  assert.equal(lines[0].heure, '08:00');
  assert.equal(lines[1].heure, '');
  assert.ok(lines.every((l) => l.texte.length <= 95));
});

test('stockage : un fichier par service et détection des conflits', () => {
  const store = new Store(tmp());
  const a = store.save(sample('2026-10-02', 'matin'), { by: 'Poste A' });
  assert.equal(a.rev, 1);
  assert.ok(fs.existsSync(path.join(store.dir, '2026', '10', '2026-10-02_matin.json')));
  const b = store.save({ ...a, responsable: 'B' }, { expectedRev: 1, by: 'Poste B' });
  assert.equal(b.rev, 2);
  assert.throws(() => store.save({ ...a, responsable: 'C' }, { expectedRev: 1 }), (e) => e.code === 'CONFLICT' && e.current.responsable === 'B');
  assert.equal(store.save({ ...a, responsable: 'C' }, { expectedRev: 1, force: true }).responsable, 'C');
  assert.equal(store.load('2026-10-03', 'nuit').rev, 0);
  assert.equal(store.loadMonth(2026, 10).length, 31);
});

test('liste des responsables partagée dans le dossier des données', () => {
  const store = new Store(tmp());
  assert.deepEqual(store.loadUsers(), []);
  assert.deepEqual(store.saveUsers([' Marie Dupont ', 'Karim Benali', 'Marie Dupont', '']), ['Marie Dupont', 'Karim Benali']);
  assert.deepEqual(new Store(store.dir).loadUsers(), ['Marie Dupont', 'Karim Benali']);
});

test('export Excel : onglet par jour à hauteur variable, puis réimport fidèle', async () => {
  const dir = tmp();
  const file = path.join(dir, 'export.xlsx');
  const s = sample();
  s.sorties.Fer = { nb: 2, tonnage: 10.28, pesees: [5.54, 4.74] };
  s.sortiesExtra = [{ nom: 'Sapins', nb: 1, tonnage: 0.8, pesees: [], couleur: '#2f9e44' }];
  s.nonConformes = [{ type: 'Frigo', quantite: 1, unite: 'pièce(s)', provenance: 'Particulier', commentaire: '', photos: [] }];
  const tasks = [{ id: 'a1', texte: 'Vider la benne fer', creeLe: '2026-10-02T20:10:00Z', creePar: 'DUPONT', origine: { date: '2026-10-02', service: 'nuit' }, faite: null }];
  await exportWorkbook([{ date: '2026-10-02', services: { nuit: s } }, { date: '2026-10-03', services: {} }], file, { tasks, site: { couleurs: { Fer: { couleur: '#1971c2', mode: 'ligne' } } } });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  assert.deepEqual(wb.worksheets.filter((w) => w.state !== 'veryHidden').map((w) => w.name), ['Légende', 'Modèle', 'Synthèse', '02-10', '03-10']);
  const ws = wb.getWorksheet('02-10');
  const values = [];
  ws.eachRow((row) => row.eachCell((c) => values.push(c.value)));
  const texts = values.map((v) => (v && v.formula ? `=${v.formula}` : String(v)));
  for (const expected of ['SERVICE NUIT  ·  20H - 4H', 'DUPONT', 'Sapins *', '=5.54+4.74', 'DÉCHETS NON CONFORMES', 'Frigo', 'TÂCHES POUR LA RELÈVE', 'Vider la benne fer', '⚠ Benne fer pleine, appel prestataire.']) {
    assert.ok(texts.includes(expected), expected);
  }

  const { days, tasks: back } = await importWorkbookFull(file);
  assert.deepEqual(days.map((d) => d.date), ['2026-10-02']);
  const nuit = days[0].services.nuit;
  for (const k of ['responsable', 'absents', 'entrees', 'sorties', 'sortiesExtra', 'nonConformes', 'bennes', 'plateaux', 'observations', 'consignes']) {
    assert.deepEqual(nuit[k], M.normalize(s)[k], k);
  }
  assert.equal(back[0].texte, 'Vider la benne fer');
});

test('import d\'un classeur rempli à la main au format d\'origine', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, '..', 'assets', 'modele.xlsx'));
  const ws = wb.addWorksheet('02-10');
  ws.getCell('A3').value = new Date(Date.UTC(2026, 9, 2));
  ws.getCell('G77').value = 'DUPONT';
  ws.getCell('C85').value = 12;
  ws.getCell('D92').value = 5.54;
  ws.getCell('F90').value = 0.85;
  ws.getCell('A101').value = (22 * 60 + 15) / 1440;
  ws.getCell('B101').value = 'Benne fer pleine';
  const file = path.join(tmp(), 'main.xlsx');
  await wb.xlsx.writeFile(file);
  const [day] = await importWorkbook(file);
  const nuit = day.services.nuit;
  assert.equal(day.date, '2026-10-02');
  assert.equal(nuit.responsable, 'DUPONT');
  assert.equal(nuit.entrees.plateaux, 12);
  assert.equal(nuit.sorties.DIB.tonnage, 5.54);
  assert.equal(nuit.bennes.Fer, 85);
  assert.deepEqual(nuit.observations[0], { heure: '22:15', texte: 'Benne fer pleine', important: false, auteur: '', photos: [] });
});

test('import du modèle vierge fourni', async () => {
  const days = await importWorkbook(path.join(__dirname, '..', 'assets', 'modele.xlsx'));
  assert.deepEqual(days, []);
});

test('conversion des heures', () => {
  assert.equal(timeToFraction('22:15'), (22 * 60 + 15) / 1440);
  assert.equal(cellToTime((22 * 60 + 15) / 1440), '22:15');
  assert.equal(cellToTime(new Date(Date.UTC(1899, 11, 30, 7, 5))), '07:05');
  assert.equal(cellToTime('7h05'), '07:05');
});

test('mises à jour : détection de la version la plus récente dans le dossier commun', () => {
  const { findUpdate, compareVersions } = require('../src/core/update');
  const dir = tmp();
  assert.equal(findUpdate(dir, '1.0.0'), null);
  fs.mkdirSync(path.join(dir, 'mises-a-jour'));
  for (const f of ['Liaison-Installation-1.0.0.exe', 'Liaison-Installation-1.2.0.exe', 'Liaison-Installation-1.10.0.exe', 'Liaison-Portable-1.3.0.exe', 'autre.exe']) {
    fs.writeFileSync(path.join(dir, 'mises-a-jour', f), '');
  }
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(findUpdate(dir, '1.0.0').version, '1.10.0');
  assert.equal(findUpdate(dir, '1.10.0'), null);
  assert.equal(findUpdate(dir, '1.0.0', 'portable').version, '1.3.0');
});

test('absents au-delà des 4 cases : reportés dans les N.B. puis relus', async () => {
  const s = M.emptyService('2026-10-05', 'matin');
  s.absents = [
    { nom: 'A', motif: 'CP' }, { nom: 'B', motif: 'RTT' }, { nom: 'C', motif: 'CP' }, { nom: 'D', motif: 'Maladie' },
    { nom: 'Élodie Martin', motif: 'Formation' }, { nom: 'F', motif: '' },
  ];
  s.observations = [{ heure: '06:00', texte: 'RAS', important: false, auteur: '' }];
  s.consignes = 'Rien de spécial';
  const file = path.join(tmp(), 'absents.xlsx');
  await exportWorkbook([{ date: s.date, services: { matin: s } }], file);
  const [day] = await importWorkbook(file);
  assert.deepEqual(day.services.matin.absents, s.absents);
  assert.equal(day.services.matin.consignes, 'Rien de spécial');
  assert.equal(day.services.matin.observations.length, 1);
  assert.equal(M.normalize({ absents: [{ nom: 'X' }] }, '2026-10-05', 'matin').absents.length, 4);
});

test('mémoire des agents : ajout automatique sans doublon', () => {
  const store = new Store(tmp());
  const s = M.emptyService('2026-10-05', 'matin');
  s.absents[0] = { nom: 'Martin', motif: 'CP' };
  s.absents.push({ nom: ' martin ', motif: 'CP' }, { nom: 'Bernard', motif: '' });
  assert.deepEqual(store.rememberAgents(s), ['Bernard', 'Martin']);
  assert.deepEqual(store.rememberAgents(s), ['Bernard', 'Martin']);
});

test('protection : un service enregistré par une version plus récente n\'est pas écrasé', () => {
  const dir = tmp();
  const recent = new Store(dir, { appVersion: '1.5.0' });
  const s = sample('2026-10-06', 'matin');
  s.futurChamp = { inventaire: 42 };
  s.observations[0].futur = 'x';
  const saved = recent.save(s);
  assert.equal(saved.appVersion, '1.5.0');
  assert.deepEqual(saved.futurChamp, { inventaire: 42 });
  assert.equal(saved.observations[0].futur, 'x');
  const old = new Store(dir, { appVersion: '1.4.0' });
  assert.throws(() => old.save({ ...saved, responsable: 'X' }), (e) => e.code === 'VERSION' && e.version === '1.5.0');
  assert.throws(() => old.save({ ...saved }, { force: true }), (e) => e.code === 'VERSION');
  // Registre des postes
  old.registerPoste('PC A', '1.4.0');
  recent.registerPoste('PC B', '1.5.0');
  assert.deepEqual({ ...old.newestVersion(), vu: undefined }, { poste: 'PC B', version: '1.5.0', vu: undefined });
});

test('superviseurs : code PIN haché, la liste des responsables est conservée', () => {
  const store = new Store(tmp());
  store.saveUsers(['Marie', 'Karim']);
  store.saveSupervisor('Paul Chef', '4821');
  store.saveUsers(['Marie', 'Karim', 'Julie']);
  assert.deepEqual(store.loadUsers(), ['Marie', 'Karim', 'Julie']);
  assert.deepEqual(store.loadSupervisors(), ['Paul Chef']);
  assert.equal(store.verifyPin('Paul Chef', '4821'), true);
  assert.equal(store.verifyPin('Paul Chef', '0000'), false);
  assert.ok(!JSON.stringify(store.readJson('responsables.json', {})).includes('4821'));
  assert.throws(() => store.saveSupervisor('X', '12'));
  assert.deepEqual(store.removeSupervisor('Paul Chef'), []);
});

test('tableau de bord : services du jour, non clôturés, alertes', () => {
  const { summarizeSite } = require('../src/core/dashboard');
  const store = new Store(tmp());
  const now = new Date(2026, 9, 6, 15, 0); // après-midi du 6
  const hier = M.emptyService('2026-10-05', 'nuit');
  hier.responsable = 'Karim';
  hier.observations = [{ heure: '23:00', texte: 'Fuite', important: true }];
  store.save(hier);
  const matin = M.emptyService('2026-10-06', 'matin');
  matin.cloture = { at: '2026-10-06T12:50:00Z' };
  matin.bennes.Fer = 92;
  store.save(matin);
  store.saveTask({ id: 't1', texte: 'Appeler', creeLe: '2026-10-06T07:00:00Z', origine: { date: '2026-10-06', service: 'matin' }, faite: null });
  const d = summarizeSite(store, now);
  assert.deepEqual(d.today.map((t) => t.etat), ['clos', 'en-cours', 'vide']);
  assert.ok(d.nonClotures.some((x) => x.date === '2026-10-05' && x.service === 'nuit'));
  assert.ok(d.vides > 0);
  assert.equal(d.importantes[0].texte, 'Fuite');
  assert.equal(d.taches.length, 1);
  assert.deepEqual(d.boxs.alertes.map((a) => a.nom), ['Fer']);
});

test('synthèse Excel : vrais graphiques dans le classeur', async () => {
  const JSZip = require('jszip');
  const days = ['2026-10-01', '2026-10-02', '2026-10-03'].map((date, i) => {
    const s = M.emptyService(date, 'matin');
    s.entrees = { plateaux: 4 + i, pl: 2 };
    s.sorties.Fer = { nb: 1, tonnage: 5 + i, pesees: [] };
    s.sorties.DIB = { nb: 2, tonnage: 3, pesees: [] };
    const n = M.emptyService(date, 'nuit');
    n.entrees = { plateaux: 1, pl: 1 };
    return { date, services: { matin: s, nuit: n } };
  });
  const file = path.join(tmp(), 'synthese.xlsx');
  const externes = [{ date: days[0].date, matiere: 'Bois', nb: 1, tonnage: 4.5 }, { date: '2000-01-01', matiere: 'Bois', tonnage: 99 }];
  await exportWorkbook(days, file, { siteName: 'Site Nord', externes });
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const charts = Object.keys(zip.files).filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f));
  assert.ok(charts.length >= 3, `graphiques : ${charts.length}`);
  const all = (await Promise.all(charts.map((f) => zip.file(f).async('string')))).join('');
  assert.ok(all.includes('<c:doughnutChart>') && all.includes('<c:barChart>'));
  assert.ok(all.includes('<c:grouping val="stacked"/>')); // tonnage par jour avec les pesées externes
  assert.ok(all.includes('Bois (externe)'));
  assert.ok(all.includes("'Synthèse'!$B$"));
  const ct = await zip.file('[Content_Types].xml').async('string');
  assert.ok(ct.includes('drawingml.chart+xml'));
  // Le classeur reste lisible et réimportable.
  const back = await importWorkbook(file);
  assert.equal(back.length, 3);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  assert.equal(wb.getWorksheet('Synthèse').getCell('A1').value, 'SYNTHÈSE  ·  SITE NORD');
});

test('inventaire : catégories, articles, mouvements, stock et seuil', () => {
  const { Inventaire, computeStock } = require('../src/core/inventaire');
  const dir = tmp();
  const inv = new Inventaire(dir);
  const [epi, conso] = inv.saveCategories([{ nom: 'EPI' }, { nom: 'Consommables' }, { nom: 'epi' }]);
  assert.equal(inv.loadCategories().length, 2);
  const gants = inv.saveArticle({ nom: 'Gants', categorie: epi.id, unite: 'paires', seuil: 10 }, 'PC A');
  const sacs = inv.saveArticle({ nom: 'Sacs', categorie: conso.id, unite: 'rouleaux' }, 'PC A');
  inv.addMovement({ article: gants.id, type: 'entree', quantite: 50, date: '2026-10-01T08:00:00Z' }, 'Marie');
  inv.addMovement({ article: gants.id, type: 'sortie', quantite: 12, date: '2026-10-02T08:00:00Z' }, 'Karim');
  inv.addMovement({ article: gants.id, type: 'comptage', quantite: 9, date: '2026-10-03T08:00:00Z', commentaire: 'Inventaire mensuel' }, 'Julie');
  inv.addMovement({ article: gants.id, type: 'sortie', quantite: 1, date: '2026-10-04T08:00:00Z' }, 'Julie');
  const list = inv.list();
  const g = list.articles.find((a) => a.id === gants.id);
  assert.equal(g.stock, 8);
  assert.equal(g.alerte, true);
  assert.equal(list.articles.find((a) => a.id === sacs.id).alerte, false);
  const h = inv.history(gants.id);
  assert.deepEqual(h.map((m) => m.stockApres), [8, 9, 38, 50]);
  assert.equal(h[1].commentaire, 'Inventaire mensuel');
  assert.throws(() => inv.addMovement({ article: gants.id, type: 'sortie', quantite: -2 }));
  // Supprimer une catégorie laisse ses articles sans catégorie.
  inv.saveCategories([{ id: conso.id, nom: 'Consommables' }]);
  assert.equal(inv.list().articles.find((a) => a.id === gants.id).categorie, null);
  // Suppression d'un article et de son historique.
  inv.deleteArticle(gants.id);
  assert.equal(inv.list().articles.length, 1);
  assert.equal(inv.history(gants.id).length, 0);
  assert.equal(computeStock([]).stock, 0);
});

test('état des boxs : liste du site modifiable, anciennes valeurs conservées', () => {
  const s = M.emptyService('2026-10-01', 'matin');
  assert.deepEqual(M.boxNames({}, s).bennes, M.BENNES);
  const site = { boxs: { bennes: ['Fer', 'Gravats'], plateaux: ['Sport'] } };
  s.bennes.Matelas = 90; // ligne retirée depuis, mais renseignée dans ce service
  s.bennes.Gravats = 85;
  assert.deepEqual(M.boxNames(site, s).bennes, ['Fer', 'Gravats', 'Matelas']);
  assert.deepEqual(M.boxNames(site, null).plateaux, ['Sport']);
  assert.deepEqual(M.boxAlerts(s).map((a) => a.nom).sort(), ['Gravats', 'Matelas']);
  const back = M.normalize(JSON.parse(JSON.stringify(s)));
  assert.equal(back.bennes.Gravats, 85);
});


test('stockage et commandes : normalisation et export Excel', async () => {
  const s = M.normalize({ date: '2026-10-05', service: 'matin', stockage: [{ type: 'Benne Fer', nombre: 2, etat: 'pleine' }, { type: 'Benne DIB', nombre: 1, etat: '???' }],
    commandes: [{ quoi: 'Gants', quantite: 20, fournisseur: 'Würth', date: '2026-10-07' }] });
  assert.equal(s.stockage[1].etat, 'vide');
  assert.equal(s.commandes[0].quantite, '20');
  assert.equal(s.commandes[0].recue, false);
  assert.equal(M.isEmpty(s), false);
  const X = require('../src/core/excel');
  const ExcelJS = require('exceljs');
  const file = path.join(tmp(), 'cmd.xlsx');
  const day = { date: '2026-10-05', services: { matin: s, apresmidi: M.emptyService('2026-10-05', 'apresmidi'), nuit: M.emptyService('2026-10-05', 'nuit') } };
  await X.exportWorkbook([day], file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const vals = [];
  wb.worksheets.find((w) => w.name.startsWith('05')).eachRow((r) => r.eachCell((c) => vals.push(c.value)));
  for (const v of ['STOCKAGE', 'COMMANDES', 'Benne Fer', 'Pleine', 'Gants', 'Würth', '07/10/2026']) assert.ok(vals.includes(v), v);
  const back = await X.importWorkbookFull(file, { year: 2026 });
  assert.equal(back.days[0].services.matin.commandes[0].fournisseur, 'Würth');
});

test('tonnage des entrées : réglage du site (CPTP par défaut)', async () => {
  assert.equal(M.entreesTonnage({ nom: 'CPTP' }), true);
  assert.equal(M.entreesTonnage({ nom: 'CTVO' }), false);
  assert.equal(M.entreesTonnage({ nom: 'CPTP', entreesTonnage: false }), false);
  const s = M.normalize({ date: '2026-10-05', service: 'matin', entrees: { pl: 3, tonnage: 12.54 } });
  assert.equal(s.entrees.tonnage, 12.54);
  assert.equal(M.normalize({ entrees: { pl: 1 } }, '2026-10-05', 'matin').entrees.tonnage, null);
  const X = require('../src/core/excel');
  const ExcelJS = require('exceljs');
  const file = path.join(tmp(), 'ent.xlsx');
  const day = { date: '2026-10-05', services: { matin: s, apresmidi: M.emptyService('2026-10-05', 'apresmidi'), nuit: M.emptyService('2026-10-05', 'nuit') } };
  await X.exportWorkbook([day], file, { site: { nom: 'CPTP' } });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const vals = [];
  wb.worksheets.find((w) => w.name.startsWith('05')).eachRow((r) => r.eachCell((c) => vals.push(c.value)));
  assert.ok(vals.includes('Tonnage (T)') && vals.includes(12.54));
  const back = await X.importWorkbookFull(file, { year: 2026 });
  assert.equal(back.days[0].services.matin.entrees.tonnage, 12.54);
});

test('planning : agents, cases par semaine, notes et période', () => {
  const { Planning, lundiDe } = require('../src/core/planning');
  assert.equal(lundiDe('2026-10-18'), '2026-10-12'); // dimanche → lundi
  assert.equal(lundiDe('2026-10-12'), '2026-10-12');
  const p = new Planning(tmp());
  const [a, b] = p.saveAgents([{ nom: 'Dupont', equipe: 'matin' }, { nom: 'Martin', equipe: 'nuit' }, { nom: 'dupont', equipe: 'nuit' }]);
  assert.equal(p.loadAgents().length, 2);
  p.setCase(a.id, '2026-10-13', { code: 'CP' }, 'PC');
  p.setCase(a.id, '2026-10-14', { code: 'H', texte: '13H-18H' }, 'PC');
  p.setCase(b.id, '2026-10-19', { code: 'MAL' }, 'PC'); // semaine suivante
  p.setNotes('2026-10-15', 'Formation incendie jeudi', 'PC');
  const s = p.loadSemaine('2026-10-16');
  assert.equal(s.lundi, '2026-10-12');
  assert.equal(s.cases[a.id]['2026-10-13'].code, 'CP');
  assert.equal(s.notes, 'Formation incendie jeudi');
  p.setCase(a.id, '2026-10-13', { code: '' }, 'PC'); // effacée
  assert.equal(p.loadSemaine('2026-10-13').cases[a.id]['2026-10-13'], undefined);
  const per = p.casesEntre('2026-10-01', '2026-10-31');
  assert.equal(per[a.id]['2026-10-14'].texte, '13H-18H');
  assert.equal(per[b.id]['2026-10-19'].code, 'MAL');
});

test('CPTP : deux services (matin 6H-13H, soir 18H-3H), un seul bloc de stockage', async () => {
  const cptp = { nom: 'CPTP' };
  assert.deepEqual(M.servicesDuSite(cptp).map((d) => `${d.id}:${d.label}:${d.horaires}`), ['matin:Matin:6H - 13H', 'nuit:Soir:18H - 3H']);
  assert.equal(M.servicesDuSite({ nom: 'CTVO' }).length, 3);
  assert.equal(M.servicesDuSite({ nom: 'CPTP', deuxServices: false }).length, 3);
  assert.deepEqual(M.currentService(new Date(2026, 9, 2, 5, 30), cptp), { date: '2026-10-01', service: 'nuit' });
  assert.deepEqual(M.currentService(new Date(2026, 9, 2, 6, 0), cptp), { date: '2026-10-02', service: 'matin' });
  assert.deepEqual(M.currentService(new Date(2026, 9, 2, 14, 0), cptp), { date: '2026-10-02', service: 'nuit' });
  assert.deepEqual(M.currentService(new Date(2026, 9, 3, 2, 0), cptp), { date: '2026-10-02', service: 'nuit' });
  assert.deepEqual(M.previousService('2026-10-02', 'nuit', cptp), { date: '2026-10-02', service: 'matin' });
  assert.deepEqual(M.nextService('2026-10-02', 'matin', cptp), { date: '2026-10-02', service: 'nuit' });
  // Sans site : comportement habituel à trois services.
  assert.deepEqual(M.nextService('2026-10-02', 'matin'), { date: '2026-10-02', service: 'apresmidi' });

  const s = M.emptyService('2026-10-02', 'matin');
  assert.deepEqual(M.boxNames(cptp, s), { bennes: ['Stockage'], plateaux: [] });
  assert.deepEqual(M.boxNames({ nom: 'CPTP', boxs: { stockage: ['Quai A', 'Quai B'], bennes: ['Fer'] } }, s).bennes, ['Quai A', 'Quai B']);
  s.bennes.Stockage = 85;
  assert.deepEqual(M.boxAlerts(s, cptp).map((a) => a.type), ['Stockage']);

  const X = require('../src/core/excel');
  const file = path.join(tmp(), 'cptp.xlsx');
  await X.exportWorkbook([{ date: '2026-10-02', services: { matin: s, nuit: M.emptyService('2026-10-02', 'nuit') } }], file, { site: cptp });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const vals = [];
  wb.worksheets.find((w) => w.name.startsWith('02')).eachRow((r) => r.eachCell((c) => vals.push(c.value)));
  assert.ok(vals.includes('SERVICE SOIR  ·  18H - 3H') && vals.includes('SERVICE MATIN  ·  6H - 13H'));
  assert.ok(!vals.some((v) => typeof v === 'string' && v.includes('APRÈS-MIDI')));
  assert.ok(vals.includes('Stockage') && !vals.includes('Bennes'));
});

test('sorties : matières ajoutées ou retirées pour le site', () => {
  const site = { matieres: ['Fer', 'DIB', 'Carton'] };
  const s = M.normalize({ sorties: { Bois: { nb: 2 }, Carton: { nb: 1, tonnage: 0.5 } } }, '2026-10-02', 'matin');
  // Bois a été retiré du site mais garde ses chiffres dans ce service.
  assert.deepEqual(M.allSorties(s, site).filter((r) => !r.extra).map((r) => r.nom), ['Fer', 'DIB', 'Carton', 'Bois']);
  assert.equal(M.allSorties(s, site).find((r) => r.nom === 'Bois').externe, true);
  assert.equal(M.totals(s).tonnage, 0.5);
  assert.equal(M.stats([{ date: s.date, services: { matin: s } }]).matieres.find((m) => m.nom === 'Carton').tonnage, 0.5);
  assert.deepEqual(M.allSorties(M.emptyService('2026-10-02', 'matin')).map((r) => r.nom), M.MATIERES);
});

test('planning : import d\'un classeur (format CTVO), heures supp et repères colorés', async () => {
  const { lirePlanningExcel, convertirCase } = require('../src/core/planning-import');
  const { Planning } = require('../src/core/planning');
  assert.deepEqual(convertirCase('MATIN(+1)'), { code: 'H', texte: 'MATIN', hs: 1 });
  assert.deepEqual(convertirCase('(+3h30)'), { code: 'HS', texte: '', hs: 3.5 });
  assert.deepEqual(convertirCase('CP (K)'), { code: 'CP', texte: '(K)' });
  assert.equal(convertirCase('REPOS').code, 'R');
  assert.equal(convertirCase('-5'), null);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('CTV2026');
  const jaune = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  const bloc = (r0, horaire, noms, resp) => {
    noms.forEach((n, i) => { ws.getCell(r0, 2 + i).value = horaire; ws.getCell(r0 + 1, 2 + i).value = n; });
    if (resp) ['MATIN', 'AM', 'NUIT'].forEach((t, i) => { ws.getCell(r0, 12 + i).value = t; ws.getCell(r0 + 1, 12 + i).value = resp[i]; });
    for (let j = 0; j < 7; j++) ws.getCell(r0 + 2 + j, 1).value = new Date(Date.UTC(2026, 9, 12 + j));
  };
  bloc(1, '5H-13H', ['Agent A', 'Agent B', 'Agent C'], ['Resp M', 'Resp A', 'Resp N']);
  bloc(11, '13H-20H', ['Agent D', 'Agent E', 'Agent F']);
  bloc(21, '20H-4H', ['Agent G', 'Agent H', 'Agent I']);
  ws.getCell(3, 2).value = 'CP';
  ws.getCell(3, 2).fill = jaune;
  ws.getCell(4, 3).value = '(+2)';
  ws.getCell(13, 3).value = 'MAL';
  ws.getCell(5, 13).value = 'REPOS';
  ws.getCell(13, 12).value = 'Agent A en CP du 12/10 au 16/10';
  ws.getCell(13, 12).fill = jaune;
  ws.getCell(15, 12).value = 'Réunion sécurité jeudi';
  ws.getCell(26, 4).value = 'FDC'; // Agent I : fin de contrat le jeudi 15/10
  ws.getCell(27, 4).value = 'FDC';
  const file = path.join(tmp(), 'planning.xlsx');
  await wb.xlsx.writeFile(file);

  const d = await lirePlanningExcel(file, { aujourdhui: '2026-10-14' });
  assert.equal(d.nbSemaines, 1);
  assert.equal(d.agents.length, 12);
  assert.deepEqual(d.agents.filter((a) => a.equipe === 'responsables').map((a) => `${a.nom}:${a.service}`), ['Resp M:matin', 'Resp A:apresmidi', 'Resp N:nuit']);
  assert.equal(d.agents.find((a) => a.nom === 'Agent G').equipe, 'nuit');
  assert.equal(d.agents.find((a) => a.nom === 'Agent I').depart, '2026-10-14');
  assert.deepEqual(d.codes.find((c) => c.code === 'FDC'), { code: 'FDC', label: 'Fin de contrat', couleur: '#495057', absence: true });
  const sem = d.semaines['2026-10-12'];
  assert.deepEqual(sem.cases['Agent A']['2026-10-12'], { code: 'CP', texte: '', couleur: '#ffff00' });
  assert.deepEqual(sem.cases['Agent B']['2026-10-13'], { code: 'HS', texte: '', hs: 2 });
  assert.equal(sem.cases['Agent E']['2026-10-12'].code, 'MAL');
  assert.equal(sem.cases['Resp A']['2026-10-14'].code, 'R');
  assert.deepEqual(sem.reperes, [{ texte: 'Agent A en CP du 12/10 au 16/10', couleur: '#ffff00' }]);
  assert.equal(sem.notes, 'Réunion sécurité jeudi');

  const p = new Planning(tmp());
  p.saveAgents([{ nom: 'Agent A', equipe: 'autres' }]);
  p.setCase(p.loadAgents()[0].id, '2026-10-15', { code: 'ABS' }, 'PC');
  const r = p.importer(d, 'PC');
  assert.equal(r.ajoutes, 11);
  assert.equal(p.loadAgents().find((x) => x.nom === 'Resp N').service, 'nuit');
  const rn = p.loadAgents().find((x) => x.nom === 'Resp N');
  p.setCase(rn.id, '2026-10-19', { service: 'matin' }, 'PC'); // changement ponctuel
  assert.deepEqual(p.loadSemaine('2026-10-19').cases[rn.id]['2026-10-19'], { code: '', texte: '', service: 'matin' });
  const a = p.loadAgents().find((x) => x.nom === 'Agent A');
  assert.equal(a.equipe, 'matin');
  const s = p.loadSemaine('2026-10-12');
  assert.equal(s.cases[a.id]['2026-10-15'], undefined); // remplacé par le classeur
  assert.equal(s.cases[a.id]['2026-10-12'].couleur, '#ffff00');
  assert.equal(s.reperes.length, 1);
  p.importer(d, 'PC'); // deux fois : pas de doublon
  assert.equal(p.loadAgents().length, 12);
  assert.equal(p.loadSemaine('2026-10-12').reperes.length, 1);
  assert.equal(p.loadSemaine('2026-10-12').notes, 'Réunion sécurité jeudi');
});

test('planning : fusion de deux agents et vidage', () => {
  const { Planning } = require('../src/core/planning');
  const p = new Planning(tmp());
  const [a, b] = p.saveAgents([{ nom: 'Agent Un', equipe: 'matin' }, { nom: 'Agent 1', equipe: 'matin' }]);
  p.setCase(a.id, '2026-10-12', { code: 'CP' }, 'PC');
  p.setCase(b.id, '2026-10-12', { code: 'MAL' }, 'PC');
  p.setCase(b.id, '2026-10-13', { code: 'R' }, 'PC');
  p.setCase(b.id, '2026-10-20', { code: 'ABS' }, 'PC');
  p.saveCodes([{ code: 'PAT', label: 'Paternité', absence: true }]);
  const r = p.fusionner(b.id, a.id, 'PC');
  assert.deepEqual(r.agents.map((x) => x.nom), ['Agent Un']);
  assert.equal(r.semaines, 2);
  const c = p.casesEntre('2026-10-12', '2026-10-25');
  assert.deepEqual(Object.keys(c), [a.id]);
  assert.equal(c[a.id]['2026-10-12'].code, 'CP'); // la case de l'agent gardé prime
  assert.equal(c[a.id]['2026-10-13'].code, 'R');
  assert.equal(c[a.id]['2026-10-20'].code, 'ABS');
  assert.throws(() => p.fusionner(a.id, a.id));
  p.vider();
  assert.deepEqual(p.loadAgents(), []);
  assert.deepEqual(p.casesEntre('2026-10-12', '2026-10-25'), {});
  assert.equal(p.loadCodes().length, 1);
});

test('planning : arrivée et départ des agents (enregistrement, fusion)', () => {
  const { Planning } = require('../src/core/planning');
  const p = new Planning(tmp());
  const [a, b] = p.saveAgents([
    { nom: 'Agent Un', equipe: 'matin', arrivee: '2026-02-09' },
    { nom: 'Agent 1', equipe: 'matin', arrivee: '2025-11-03', depart: '2026-02-08' },
    { nom: 'Agent Faux', equipe: 'nuit', arrivee: '2026-05-01', depart: '2026-04-01' },
  ]);
  assert.equal(a.arrivee, '2026-02-09');
  assert.equal(b.depart, '2026-02-08');
  assert.equal(p.loadAgents()[2].depart, undefined); // départ avant l'arrivée : ignoré
  const r = p.fusionner(b.id, a.id, 'PC');
  const gardé = r.agents.find((x) => x.id === a.id);
  assert.equal(gardé.arrivee, '2025-11-03'); // période la plus large
  assert.equal(gardé.depart, undefined); // toujours présent
});

test('services externes : pesées saisies après coup', () => {
  const { Externes } = require('../src/core/externes');
  const x = new Externes(tmp());
  assert.throws(() => x.save({ matiere: 'Bois' }, 'PC'), /date/);
  const e = x.save({ date: '2026-10-05', matiere: 'Bois', nb: 2, tonnage: 10.28, pesees: [5.54, 4.74], bon: 'B123' }, 'PC');
  x.save({ date: '2026-10-07', matiere: 'Matelas', nb: 1, tonnage: 1.2 }, 'PC');
  assert.deepEqual(x.list().map((y) => y.date), ['2026-10-07', '2026-10-05']);
  const modif = x.save({ ...e, date: '2026-10-06', tonnage: 10.3 }, 'Autre');
  assert.equal(modif.creePar, 'PC');
  assert.equal(modif.modifiePar, 'Autre');
  assert.equal(x.list().find((y) => y.id === e.id).date, '2026-10-06');
  x.delete(e.id);
  assert.equal(x.list().length, 1);
});

test('important : messages affichés jusqu\'à validation', () => {
  const { Importants } = require('../src/core/importants');
  const x = new Importants(tmp());
  assert.deepEqual(x.list(), { actifs: [], valides: [] });
  assert.throws(() => x.ajouter('  ', 'PC'), /vide/);
  const a = x.ajouter('Benne Fer à changer avant 10H', 'Resp nuit');
  x.ajouter('Portail quai 2 bloqué', 'Resp AM');
  assert.equal(x.list().actifs.length, 2);
  const v = x.valider(a.id, 'Resp matin');
  assert.equal(v.validePar, 'Resp matin');
  assert.equal(x.valider(a.id, 'Autre').validePar, 'Resp matin'); // déjà validé : inchangé
  const l = x.list();
  assert.deepEqual(l.actifs.map((m) => m.texte), ['Portail quai 2 bloqué']);
  assert.deepEqual(l.valides.map((m) => m.texte), ['Benne Fer à changer avant 10H']);
});
