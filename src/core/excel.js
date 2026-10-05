'use strict';

// Export / import au format du classeur « main courante » (onglets JJ-MM).
// L'export part du fichier assets/modele.xlsx (onglets Légende + Modèle
// d'origine) dont il reprend la mise en forme ; voir excel-sheet.js.

const path = require('path');
const ExcelJS = require('exceljs');
const M = require('./model');
const { buildDaySheet, timeToFraction } = require('./excel-sheet');

const TEMPLATE = path.join(__dirname, '..', '..', 'assets', 'modele.xlsx');
const MODEL_SHEET = 'Modèle';

// Lignes du service matin ; les autres services sont décalés de `offset` lignes.
const ROWS = {
  bandeau: 3,
  absents: [7, 8],
  entrees: 11,
  sortiesStart: 15, // Bois, Matelas, Fer, DIB, UVE, DEEE, Sport, TV
  obsStart: 27,
  pageBreak: 39,
};
const ABSENT_CELLS = [['A', 'C', 0], ['E', 'G', 0], ['A', 'C', 1], ['E', 'G', 1]];

const CONSIGNES_PREFIX = M.CONSIGNES_PREFIX;

const sheetName = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;


function cellToTime(v) {
  if (v == null || v === '') return '';
  const p = (n) => String(n).padStart(2, '0');
  if (v instanceof Date) return `${p(v.getUTCHours())}:${p(v.getUTCMinutes())}`;
  if (typeof v === 'number') {
    const mins = Math.round((v % 1) * 1440);
    return `${p(Math.floor(mins / 60) % 24)}:${p(mins % 60)}`;
  }
  const s = String(v).trim();
  const m = /^(\d{1,2})[:hH](\d{2})/.exec(s);
  return m ? `${p(Number(m[1]))}:${m[2]}` : s;
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText(v.result);
    if (v.text) return String(v.text);
  }
  return String(v).trim();
}

function cellNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && 'result' in v) return cellNumber(v.result);
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Données complètes de l'application, dans un onglet masqué : l'import relit
// exactement ce qui a été saisi, quelle que soit la mise en page.
const DATA_SHEET = '_donnees';
const CHUNK = 30000;

function writeDataSheet(wb, days, tasks) {
  const ws = wb.addWorksheet(DATA_SHEET, { state: 'veryHidden' });
  const putJson = (key, value) => {
    const json = JSON.stringify(value);
    const parts = [];
    for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
    ws.addRow([key, ...parts]);
  };
  ws.addRow(['format', 'liaison-1.3']);
  for (const day of days) {
    for (const def of M.SERVICES) {
      const sv = day.services[def.id];
      if (sv && !M.isEmpty(M.normalize(sv, day.date, def.id))) putJson(`${day.date}|${def.id}`, sv);
    }
  }
  if (tasks.length) putJson('taches', tasks);
}

function readDataSheet(ws) {
  const services = {};
  let tasks = [];
  ws.eachRow((row) => {
    const values = row.values.slice(1).map((v) => (v == null ? '' : String(v)));
    const [key, ...parts] = values;
    if (!key || key === 'format') return;
    const data = JSON.parse(parts.join(''));
    if (key === 'taches') tasks = data;
    else services[key] = data;
  });
  const byDate = {};
  for (const [key, sv] of Object.entries(services)) {
    const [date, service] = key.split('|');
    if (!byDate[date]) byDate[date] = {};
    byDate[date][service] = M.normalize(sv, date, service);
  }
  const days = Object.keys(byDate).sort().map((date) => {
    const out = {};
    for (const def of M.SERVICES) out[def.id] = byDate[date][def.id] || M.emptyService(date, def.id);
    return { date, services: out };
  });
  return { days, tasks };
}

// Onglet « Photos » : une miniature par photo, avec sa date, son service et ce qu'elle illustre.
function writePhotosSheet(wb, days, loadPhoto) {
  const entries = [];
  for (const day of days) {
    for (const def of M.SERVICES) {
      const sv = M.normalize(day.services[def.id], day.date, def.id);
      for (const o of sv.observations) for (const rel of o.photos) entries.push({ day, def, quoi: `Observation ${o.heure || ''} : ${o.texte}`, rel });
      for (const x of sv.nonConformes) for (const rel of x.photos) entries.push({ day, def, quoi: `Non conforme : ${x.type}${x.provenance ? ` — ${x.provenance}` : ''}`, rel });
    }
  }
  if (!entries.length) return;
  const ws = wb.addWorksheet('Photos', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 12 }, { width: 12 }, { width: 44 }, { width: 46 }];
  const head = ws.addRow(['Date', 'Service', 'Élément', 'Photo']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2F4F' } };
  for (const e of entries) {
    const row = ws.addRow([sheetName(e.day.date), e.def.label, e.quoi, '']);
    row.alignment = { vertical: 'top', wrapText: true };
    const img = loadPhoto ? loadPhoto(e.rel) : null;
    if (!img) {
      row.getCell(4).value = `Photo introuvable (${e.rel})`;
      row.height = 20;
      continue;
    }
    const h = 150;
    const w = Math.round((img.width / img.height) * h);
    row.height = h * 0.78;
    const id = wb.addImage({ buffer: img.buffer, extension: 'jpeg' });
    ws.addImage(id, { tl: { col: 3, row: row.number - 1 }, ext: { width: Math.min(w, 320), height: h } });
  }
}

// days : [{ date, services }] ; options : { tasks, site, siteName, loadPhoto(rel) → { buffer, width, height } }
async function exportWorkbook(days, file, { tasks = [], site = {}, siteName = '', loadPhoto = null } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  const model = wb.getWorksheet(MODEL_SHEET);
  for (const day of days) {
    buildDaySheet(wb.addWorksheet(sheetName(day.date)), model, day, { tasks, site, siteName });
  }
  writePhotosSheet(wb, days, loadPhoto);
  writeDataSheet(wb, days, tasks);
  wb.calcProperties = { fullCalcOnLoad: true };
  if (days.length) wb.views = [{ activeTab: 2, firstSheet: 0 }];
  await wb.xlsx.writeFile(file);
  return file;
}

// Lecture d'un classeur rempli à la main au format d'origine (cases fixes).
function readService(ws, def, date) {
  const o = def.offset;
  const v = (addr) => ws.getCell(addr).value;
  const s = M.emptyService(date, def.id);
  s.responsable = cellText(v(`G${ROWS.bandeau + o}`));
  s.absents = ABSENT_CELLS.map(([cn, cm, dr]) => {
    const r = ROWS.absents[dr] + o;
    return { nom: cellText(v(`${cn}${r}`)), motif: cellText(v(`${cm}${r}`)) };
  });
  s.entrees.plateaux = cellNumber(v(`C${ROWS.entrees + o}`));
  s.entrees.pl = cellNumber(v(`F${ROWS.entrees + o}`));
  M.MATIERES.forEach((m, i) => {
    const r = ROWS.sortiesStart + i + o;
    s.sorties[m].nb = cellNumber(v(`C${r}`));
    if (!M.MATIERES_EXTERNES.includes(m)) s.sorties[m].tonnage = cellNumber(v(`D${r}`));
  });
  const pct = (x) => {
    const n = cellNumber(x);
    if (n == null) return null;
    return Math.round((n <= 1 ? n * 100 : n) * 10) / 10;
  };
  M.BENNES.forEach((b, i) => {
    s.bennes[b] = pct(v(`F${ROWS.sortiesStart + i + o}`));
  });
  M.PLATEAUX.forEach((p, i) => {
    s.plateaux[p] = pct(v(`H${ROWS.sortiesStart + i + o}`));
  });
  // Les lignes sans heure prolongent l'observation précédente ; les autres
  // absents et les consignes écrits par l'application sont reconnus à leur préfixe.
  const blocks = {};
  let block = null;
  for (let i = 0; i < M.NB_OBSERVATIONS; i++) {
    const r = ROWS.obsStart + i + o;
    const heure = cellToTime(v(`A${r}`));
    const texte = cellText(v(`B${r}`));
    if (!heure && !texte) continue;
    if (!heure) {
      const prefix = [[CONSIGNES_PREFIX, 'consignes'], [M.ABSENTS_PREFIX, 'absents']].find(([p]) => texte.startsWith(p));
      if (prefix) {
        block = prefix[1];
        blocks[block] = texte.slice(prefix[0].length).trim();
        continue;
      }
      if (block) {
        blocks[block] = `${blocks[block]} ${texte}`.trim();
        continue;
      }
    } else {
      block = null;
    }
    const last = s.observations[s.observations.length - 1];
    if (!heure && last) last.texte = last.texte ? `${last.texte} ${texte}` : texte;
    else s.observations.push({ heure, texte, important: false, auteur: '' });
  }
  for (const obs of s.observations) {
    if (obs.texte.startsWith(M.IMPORTANT_PREFIX)) {
      obs.important = true;
      obs.texte = obs.texte.slice(M.IMPORTANT_PREFIX.length);
    }
  }
  if (blocks.consignes) s.consignes = blocks.consignes;
  if (blocks.absents) {
    for (const m of blocks.absents.matchAll(/\s*([^,(]+?)\s*(?:\(([^)]*)\))?\s*(?:,|$)/g)) {
      if (m[1] || m[2]) s.absents.push({ nom: m[1] === '?' ? '' : m[1], motif: m[2] || '' });
    }
  }
  return s;
}

function sheetDate(ws, year) {
  const a3 = ws.getCell('A3').value;
  if (a3 instanceof Date) return a3.toISOString().slice(0, 10);
  const m = /^(\d{2})-(\d{2})$/.exec(ws.name);
  if (!m || !year) return null;
  return `${year}-${m[2]}-${m[1]}`;
}

// Lit un classeur au format main courante. `year` sert de repli si la date
// n'est pas renseignée dans le bandeau (A3).
// Lit un classeur : celui exporté par l'application (onglet de données masqué)
// ou un classeur rempli à la main au format d'origine.
async function importWorkbookFull(file, { year } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const data = wb.getWorksheet(DATA_SHEET);
  if (data) return readDataSheet(data);
  return { days: readLegacy(wb, year), tasks: [] };
}

async function importWorkbook(file, opts) {
  return (await importWorkbookFull(file, opts)).days;
}

function readLegacy(wb, year) {
  const out = [];
  wb.eachSheet((ws) => {
    if (!/^\d{2}-\d{2}$/.test(ws.name)) return;
    const date = sheetDate(ws, year);
    if (!date) return;
    const services = {};
    for (const def of M.SERVICES) services[def.id] = M.normalize(readService(ws, def, date), date, def.id);
    out.push({ date, services });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { exportWorkbook, importWorkbook, importWorkbookFull, sheetName, timeToFraction, cellToTime };
