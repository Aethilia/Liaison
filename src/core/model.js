// Structure de la main courante, calquée sur l'onglet « Modèle » du classeur Excel.
// Partagé entre Electron (require) et l'interface (balise <script>), d'où l'IIFE.
(function () {
'use strict';

const SERVICES = [
  { id: 'matin', label: 'Matin', horaires: '5H - 13H', titre: 'SERVICE MATIN  ·  5H - 13H', couleur: '#C55A11', offset: 0 },
  { id: 'apresmidi', label: 'Après-midi', horaires: '13H - 20H', titre: 'SERVICE APRÈS-MIDI  ·  13H - 20H', couleur: '#2E75B6', offset: 37 },
  { id: 'nuit', label: 'Nuit', horaires: '20H - 4H', titre: 'SERVICE NUIT  ·  20H - 4H', couleur: '#1F2F4F', offset: 74 },
];

const MOTIFS = ['CP', 'Maladie', 'RTT', 'Récupération', 'Formation', 'Accident du travail', 'Congé exceptionnel', 'Absence injustifiée', 'Autre'];

// Matières en sortie : Bois et Matelas sont gérés par un service externe (nombre seulement).
const MATIERES = ['Bois', 'Matelas', 'Fer', 'DIB', 'UVE', 'DEEE', 'Sport', 'TV'];
const MATIERES_EXTERNES = ['Bois', 'Matelas'];

const BENNES = ['Matelas', 'Fer', 'Bois', 'DIB', 'UVE'];
const PLATEAUX = ['Sport', 'Fer', 'Bois', 'DIB'];

const UNITES = ['pièce(s)', 'kg', 'T'];
// Couleur par défaut des matières en sortie (les externes en vert) ; modifiable par site.
const COULEURS_DEFAUT = { Bois: { couleur: '#2f9e44', mode: 'nom' }, Matelas: { couleur: '#2f9e44', mode: 'nom' } };
const PALETTE = ['#2f9e44', '#1971c2', '#e8590c', '#c2255c', '#7048e8', '#f08c00', '#0c8599', '#868e96'];

const NB_ABSENTS = 4;
const NB_OBSERVATIONS = 12;
const SEUIL_ALERTE = 80; // % de remplissage à partir duquel la case passe en rouge

function emptyService(date, service) {
  const sorties = {};
  for (const m of MATIERES) sorties[m] = MATIERES_EXTERNES.includes(m) ? { nb: null } : { nb: null, tonnage: null, pesees: [] };
  const bennes = {};
  for (const b of BENNES) bennes[b] = null;
  const plateaux = {};
  for (const p of PLATEAUX) plateaux[p] = null;
  return {
    date,
    service,
    responsable: '',
    absents: Array.from({ length: NB_ABSENTS }, () => ({ nom: '', motif: '' })),
    entrees: { plateaux: null, pl: null },
    sorties,
    sortiesExtra: [], // sorties ponctuelles (ex. sapins) : { nom, nb, tonnage, pesees, couleur }
    bennes,
    plateaux,
    nonConformes: [], // { type, quantite, unite, provenance, commentaire, photos }
    observations: [],
    consignes: '',
    cloture: null,
    rev: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

// Complète un enregistrement lu sur disque avec les champs manquants (fichiers anciens ou partiels).
function normalize(data, date, service) {
  data = data || {};
  const base = emptyService(date || data.date, service || data.service);
  const out = { ...base, ...data, date: base.date, service: base.service };
  // 4 lignes d'absents comme sur la feuille, davantage si besoin.
  out.absents = (Array.isArray(data.absents) ? data.absents : []).map((a) => ({ nom: (a && a.nom) || '', motif: (a && a.motif) || '' }));
  while (out.absents.length < NB_ABSENTS) out.absents.push({ nom: '', motif: '' });
  out.entrees = { ...base.entrees, ...(data.entrees || {}) };
  out.sorties = {};
  for (const m of MATIERES) {
    out.sorties[m] = { ...base.sorties[m], ...((data.sorties || {})[m] || {}) };
    if (!MATIERES_EXTERNES.includes(m)) out.sorties[m].pesees = cleanPesees(out.sorties[m].pesees);
  }
  out.sortiesExtra = (Array.isArray(data.sortiesExtra) ? data.sortiesExtra : []).map((x) => ({
    nom: (x && x.nom) || '', nb: numOrNull(x && x.nb), tonnage: numOrNull(x && x.tonnage), pesees: cleanPesees(x && x.pesees), couleur: (x && x.couleur) || '',
  }));
  out.nonConformes = (Array.isArray(data.nonConformes) ? data.nonConformes : []).map((x) => ({
    type: (x && x.type) || '', quantite: numOrNull(x && x.quantite), unite: (x && x.unite) || UNITES[0],
    provenance: (x && x.provenance) || '', commentaire: (x && x.commentaire) || '', photos: cleanList(x && x.photos),
  }));
  out.bennes = { ...base.bennes, ...(data.bennes || {}) };
  out.plateaux = { ...base.plateaux, ...(data.plateaux || {}) };
  out.observations = Array.isArray(data.observations)
    ? data.observations.map((o) => ({ heure: o.heure || '', texte: o.texte || '', important: !!o.important, auteur: o.auteur || '', photos: cleanList(o.photos) }))
    : [];
  return out;
}

function isEmpty(s) {
  if (!s) return true;
  if (s.responsable || s.consignes || s.cloture) return false;
  if (s.absents.some((a) => a.nom || a.motif)) return false;
  if (s.entrees.plateaux != null || s.entrees.pl != null) return false;
  if (Object.values(s.sorties).some((v) => v.nb != null || v.tonnage != null)) return false;
  if (Object.values(s.bennes).some((v) => v != null)) return false;
  if (Object.values(s.plateaux).some((v) => v != null)) return false;
  if ((s.sortiesExtra || []).some((x) => x.nom || x.nb != null || x.tonnage != null)) return false;
  if ((s.nonConformes || []).some((x) => x.type || x.quantite != null)) return false;
  return !s.observations.some((o) => o.heure || o.texte || (o.photos && o.photos.length));
}

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function cleanPesees(list) {
  return Array.isArray(list) ? list.map(numOrNull).filter((v) => v != null) : [];
}
function cleanList(list) {
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x) : [];
}

// Tonnage saisi : « 5,54 », « 5T540 » ou plusieurs bennes « 5,54+4T740+3 ».
function parsePoids(str) {
  const s = String(str).trim();
  const m = /^(\d+)\s*[tT]\s*(\d{1,3})$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2].padEnd(3, '0')) / 1000;
  const n = Number(s.replace(/\s/g, '').replace(/[tT]$/, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && s !== '' ? n : null;
}

function parseTonnage(str) {
  const parts = String(str).split('+').map((p) => p.trim());
  if (parts.length === 1 && parts[0] === '') return { ok: true, total: null, pesees: [] };
  const values = parts.filter((p) => p !== '').map(parsePoids);
  if (!values.length || values.some((v) => v == null)) return { ok: false };
  const total = Math.round(values.reduce((a, b) => a + b, 0) * 1000) / 1000;
  return { ok: true, total, pesees: values.length > 1 ? values : [] };
}

// Toutes les lignes de sorties : matières habituelles puis ponctuelles.
function allSorties(s) {
  return [
    ...MATIERES.map((m) => ({ nom: m, externe: MATIERES_EXTERNES.includes(m), data: s.sorties[m], extra: false })),
    ...(s.sortiesExtra || []).map((x, i) => ({ nom: x.nom, externe: false, data: x, extra: true, index: i })),
  ];
}

// Couleur de remplissage d'un box : vert (vide) → orange → rouge (plein).
function fillColor(v) {
  const p = Math.max(0, Math.min(100, Number(v) || 0));
  return `hsl(${Math.round(120 - 1.2 * p)}, 70%, ${p > 50 ? 45 : 40}%)`;
}

function newTaskId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);

function totals(s) {
  const entrees = num(s.entrees.plateaux) + num(s.entrees.pl);
  let nb = 0;
  let tonnage = 0;
  for (const row of allSorties(s)) {
    nb += num(row.data.nb);
    tonnage += num(row.data.tonnage);
  }
  return { entrees, sortiesNb: nb, tonnage: Math.round(tonnage * 1000) / 1000 };
}

// Répartit les observations (et les consignes de relève) sur les lignes N.B. du
// modèle Excel : une observation trop longue continue sur la ligne suivante.
const LARGEUR_LIGNE_NB = 95;
const CONSIGNES_PREFIX = '► Consignes relève :';
const IMPORTANT_PREFIX = '⚠ ';
const ABSENTS_PREFIX = '► Autres absents :';

function wrapText(text, width) {
  const out = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > width) {
        out.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    out.push(line);
  }
  return out;
}

function layoutObservations(s, width = LARGEUR_LIGNE_NB) {
  const lines = [];
  for (const o of s.observations) {
    if (!o.heure && !o.texte) continue;
    wrapText(`${o.important ? IMPORTANT_PREFIX : ''}${o.texte || ''}`, width).forEach((t, i) => lines.push({ heure: i === 0 ? o.heure || '' : '', texte: t }));
  }
  // La feuille n'a que 4 cases d'absents : les suivants vont dans les N.B.
  const autres = s.absents.slice(NB_ABSENTS).filter((a) => a.nom || a.motif);
  if (autres.length) {
    const txt = autres.map((a) => `${a.nom || '?'}${a.motif ? ` (${a.motif})` : ''}`).join(', ');
    wrapText(`${ABSENTS_PREFIX} ${txt}`, width).forEach((t) => lines.push({ heure: '', texte: t }));
  }
  if (s.consignes && s.consignes.trim()) {
    wrapText(`${CONSIGNES_PREFIX} ${s.consignes.trim()}`, width).forEach((t) => lines.push({ heure: '', texte: t }));
  }
  return lines;
}

// Service précédent dans l'ordre de relève : nuit (veille) → matin → après-midi → nuit.
function previousService(date, service) {
  if (service === 'matin') return { date: addDays(date, -1), service: 'nuit' };
  if (service === 'apresmidi') return { date, service: 'matin' };
  return { date, service: 'apresmidi' };
}

function nextService(date, service) {
  if (service === 'matin') return { date, service: 'apresmidi' };
  if (service === 'apresmidi') return { date, service: 'nuit' };
  return { date: addDays(date, 1), service: 'matin' };
}

// Service en cours selon l'heure : entre minuit et 5H on est encore sur la nuit de la veille.
function currentService(now = new Date()) {
  const h = now.getHours();
  const today = toISODate(now);
  if (h < 5) return { date: addDays(today, -1), service: 'nuit' };
  if (h < 13) return { date: today, service: 'matin' };
  if (h < 20) return { date: today, service: 'apresmidi' };
  return { date: today, service: 'nuit' };
}

function toISODate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function daysInMonth(year, month) {
  const n = new Date(year, month, 0).getDate();
  const p = (x) => String(x).padStart(2, '0');
  return Array.from({ length: n }, (_, i) => `${year}-${p(month)}-${p(i + 1)}`);
}

const api = {
  UNITES, COULEURS_DEFAUT, PALETTE, parsePoids, parseTonnage, allSorties, fillColor, newTaskId,
  SERVICES, MOTIFS, MATIERES, MATIERES_EXTERNES, BENNES, PLATEAUX, NB_ABSENTS, NB_OBSERVATIONS, SEUIL_ALERTE, CONSIGNES_PREFIX, IMPORTANT_PREFIX, ABSENTS_PREFIX,
  emptyService, normalize, isEmpty, totals, wrapText, layoutObservations, previousService, nextService, currentService,
  toISODate, parseISODate, addDays, daysInMonth,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.LiaisonModel = api;
})();
