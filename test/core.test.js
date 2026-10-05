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
  assert.deepEqual(wb.worksheets.filter((w) => w.state !== 'veryHidden').map((w) => w.name), ['Légende', 'Modèle', '02-10', '03-10']);
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
