'use strict';

// Export / import au format du classeur « main courante » (onglets JJ-MM).
// L'export part du fichier assets/modele.xlsx (onglets Légende + Modèle d'origine)
// et recopie l'onglet Modèle pour chaque jour, mise en forme comprise.

const path = require('path');
const ExcelJS = require('exceljs');
const M = require('./model');

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
const utcDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

function timeToFraction(hhmm) {
  const m = /^(\d{1,2})[:hH](\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  return (Number(m[1]) * 60 + Number(m[2])) / 1440;
}

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

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

// Recopie l'onglet Modèle dans un nouvel onglet (ExcelJS n'a pas de copie native).
function copySheet(wb, src, name) {
  const ws = wb.addWorksheet(name, {
    pageSetup: clone(src.pageSetup),
    views: clone(src.views),
    properties: clone(src.properties),
  });
  src.columns.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width;
  });
  src.eachRow({ includeEmpty: true }, (row, r) => {
    const dst = ws.getRow(r);
    if (row.height) dst.height = row.height;
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const d = dst.getCell(c);
      d.style = clone(cell.style);
      if (cell.type === ExcelJS.ValueType.Formula) d.value = { formula: cell.formula };
      else if (cell.type !== ExcelJS.ValueType.Merge) d.value = clone(cell.value);
    });
  });
  for (const range of src.model.merges) ws.mergeCells(range);
  for (const [addr, dv] of Object.entries(src.dataValidations.model)) ws.getCell(addr).dataValidation = clone(dv);
  for (const cf of src.conditionalFormattings || []) {
    const copy = clone(cf);
    // Un identifiant x14 neuf par onglet, sinon Excel signale le fichier comme à réparer.
    for (const rule of copy.rules) delete rule.x14Id;
    ws.addConditionalFormatting(copy);
  }
  for (const s of M.SERVICES) if (s.offset > 0) ws.getRow(s.offset + 2).addPageBreak();
  return ws;
}

function fillService(ws, s, def) {
  const o = def.offset;
  const set = (addr, value) => {
    ws.getCell(addr).value = value === '' || value === undefined ? null : value;
  };
  set(`A${ROWS.bandeau + o}`, utcDate(s.date));
  set(`G${ROWS.bandeau + o}`, s.responsable);

  s.absents.slice(0, ABSENT_CELLS.length).forEach((a, i) => {
    const [cn, cm, dr] = ABSENT_CELLS[i];
    const r = ROWS.absents[dr] + o;
    set(`${cn}${r}`, a.nom);
    set(`${cm}${r}`, a.motif);
  });

  set(`C${ROWS.entrees + o}`, s.entrees.plateaux);
  set(`F${ROWS.entrees + o}`, s.entrees.pl);

  M.MATIERES.forEach((m, i) => {
    const r = ROWS.sortiesStart + i + o;
    set(`C${r}`, s.sorties[m].nb);
    if (!M.MATIERES_EXTERNES.includes(m)) set(`D${r}`, s.sorties[m].tonnage);
  });

  M.BENNES.forEach((b, i) => {
    const v = s.bennes[b];
    set(`F${ROWS.sortiesStart + i + o}`, v == null ? null : v / 100);
  });
  M.PLATEAUX.forEach((p, i) => {
    const v = s.plateaux[p];
    set(`H${ROWS.sortiesStart + i + o}`, v == null ? null : v / 100);
  });

  const lines = M.layoutObservations(s);
  if (lines.length > M.NB_OBSERVATIONS) {
    const kept = lines.slice(0, M.NB_OBSERVATIONS);
    kept[M.NB_OBSERVATIONS - 1] = { ...kept[M.NB_OBSERVATIONS - 1], texte: `${kept[M.NB_OBSERVATIONS - 1].texte.slice(0, 80)} … (suite dans l'application)` };
    lines.length = 0;
    lines.push(...kept);
  }
  lines.forEach((l, i) => {
    const r = ROWS.obsStart + i + o;
    const t = timeToFraction(l.heure);
    set(`A${r}`, t != null ? t : l.heure);
    set(`B${r}`, l.texte);
  });
}

// days : [{ date: 'AAAA-MM-JJ', services: { matin, apresmidi, nuit } }]
async function exportWorkbook(days, file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  const model = wb.getWorksheet(MODEL_SHEET);
  for (const day of days) {
    const ws = copySheet(wb, model, sheetName(day.date));
    for (const def of M.SERVICES) fillService(ws, M.normalize(day.services[def.id], day.date, def.id), def);
  }
  wb.calcProperties = { fullCalcOnLoad: true };
  if (days.length) wb.views = [{ activeTab: 2, firstSheet: 0 }];
  await wb.xlsx.writeFile(file);
  return file;
}

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
async function importWorkbook(file, { year } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out = [];
  wb.eachSheet((ws) => {
    if (!/^\d{2}-\d{2}$/.test(ws.name)) return;
    const date = sheetDate(ws, year);
    if (!date) return;
    const services = {};
    for (const def of M.SERVICES) services[def.id] = readService(ws, def, date);
    out.push({ date, services });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { exportWorkbook, importWorkbook, sheetName, timeToFraction, cellToTime };
