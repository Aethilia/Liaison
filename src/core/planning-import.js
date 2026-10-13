'use strict';

// Lecture d'un classeur de planning (format du CTVO) : chaque semaine est faite
// de blocs « équipe » — une ligne d'horaires (5H-13H, 13H-20H, 20H-4H), la
// ligne des noms, puis une ligne par jour (date en début de ligne). Les
// responsables sont dans les colonnes titrées MATIN / AM / NUIT du bloc, les
// textes libres autour sont repris dans les notes de la semaine.

const ExcelJS = require('exceljs');
const { lundiDe, ajouterJours } = require('./planning');

const HORAIRE = /^\s*\d{1,2}\s*h/i;
const RESP = new Set(['MATIN', 'AM', 'APM', 'NUIT']);
// Colonne d'un responsable → son service de rattachement.
const SERVICE_RESP = { MATIN: 'matin', AM: 'apresmidi', APM: 'apresmidi', NUIT: 'nuit' };
const MAX_TEXTE = 40;

// Valeur d'une case du classeur → { code, texte } du planning (H = texte libre).
// Les abréviations du classeur sont gardées telles quelles (PAT, AT, ASA…) :
// leur libellé, leur couleur et le fait de compter comme absence se règlent
// dans l'onglet « Codes » du planning.
const CODES = [
  [/^(RE)?REPOS\b/, 'R'],
  [/^(1\/2\s*)?CP\b|^CONG[ÉE]S? PAY/, 'CP'],
  [/^(ARR[ÊE]T\s+)?MAL(ADIE)?\b|^PROLONGATION/, 'MAL'],
  [/^CN\b|^NAISS|^CONG[ÉE] DE NAISSANCE/, 'CN'],
  [/^PAT(ERNIT[ÉE])?(?![A-Z])/, 'PAT'],
  [/^AT\b/, 'AT'],
  [/^ASA\b/, 'ASA'],
  [/^CS\b|^CONG[ÉE]S? SP[ÉE]CIAUX/, 'CS'],
  [/^ABS(ENCE)?\b|^ENFANTS? MALADES?/, 'ABS'],
  [/^FCO\b/, 'FCO'],
  [/^FOR(MATION)?\b/, 'FOR'],
  [/^VM\b|^VISITE M[ÉE]DICALE/, 'VM'],
  [/^INT(EMP[ÉE]RIES?)?\b/, 'INT'],
  [/^RET(ARD)?\b/, 'RET'],
  [/^T$/, 'T'],
];

function texteCellule(v) {
  if (v == null) return '';
  if (v instanceof Date) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return texteCellule(v.result);
    if (v.text) return String(v.text);
    return '';
  }
  return String(v);
}

// Couleurs du thème Office par défaut (fond « couleur du thème » d'Excel).
const THEME = ['ffffff', '000000', 'e7e6e6', '44546a', '4472c4', 'ed7d31', 'a5a5a5', 'ffc000', '5b9bd5', '70ad47'];

// Fond d'une cellule en #rrggbb (null si aucun, blanc ou presque blanc).
function couleurCellule(cell) {
  const f = cell && cell.fill;
  if (!f || f.type !== 'pattern' || f.pattern !== 'solid' || !f.fgColor) return null;
  let hex = null;
  if (typeof f.fgColor.argb === 'string' && /^[0-9a-f]{8}$/i.test(f.fgColor.argb)) hex = f.fgColor.argb.slice(2).toLowerCase();
  else if (Number.isInteger(f.fgColor.theme) && THEME[f.fgColor.theme]) hex = THEME[f.fgColor.theme];
  if (!hex) return null;
  let [rr, gg, bb] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const tint = Number(f.fgColor.tint) || 0;
  if (tint) [rr, gg, bb] = [rr, gg, bb].map((c) => Math.round(tint > 0 ? c + (255 - c) * tint : c * (1 + tint)));
  if (rr > 240 && gg > 240 && bb > 240) return null;
  return `#${[rr, gg, bb].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function dateCellule(v) {
  if (v && typeof v === 'object' && !(v instanceof Date) && 'result' in v) v = v.result;
  return v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : null;
}

// Heures supplémentaires notées « (+1) », « MATIN+2 », « (+3h30) »…
// Détail proposé pour les abréviations trouvées (modifiable ensuite).
const DETAILS = {
  PAT: { label: 'Paternité', couleur: '#e87ba4', absence: true },
  AT: { label: 'Accident du travail', couleur: '#b42318', absence: true },
  ASA: { label: 'Autorisation spéciale d\'absence', couleur: '#f08c00', absence: true },
  CS: { label: 'Congés spéciaux', couleur: '#12b886', absence: true },
  FCO: { label: 'Formation continue', couleur: '#5f3dc4', absence: true },
  FDC: { label: 'Fin de contrat', couleur: '#495057', absence: true },
  MAP: { label: 'Mise à pied', couleur: '#862e9c', absence: true },
};
const DE_BASE = new Set(['R', 'CP', 'MAL', 'CN', 'ABS', 'FOR', 'VM', 'INT', 'RET', 'T', 'H', 'HS']);
// Mots qui ne sont pas des abréviations (gardés en texte).
const PAS_CODE = new Set(['NUIT', 'CPTP', 'MIDI', 'SOIR']);

const HEURES_SUP = /\(?\s*\+\s*(\d{1,2})(?:\s*h\s*(\d{1,2})?)?\s*\)?/i;

function convertirCase(brut) {
  let t = String(brut || '').replace(/\s+/g, ' ').trim();
  let hs = null;
  const h = HEURES_SUP.exec(t);
  if (h) {
    hs = Math.round((Number(h[1]) + (h[2] ? Number(h[2]) / 60 : 0)) * 100) / 100;
    t = `${t.slice(0, h.index)} ${t.slice(h.index + h[0].length)}`.replace(/^[\s:/*-]+|[\s:/*-]+$/g, '').trim();
  }
  const avecHs = (v) => (hs ? { ...v, hs } : v);
  if (!t || /^[\d.,*-]+$/.test(t)) return hs ? { code: 'HS', texte: '', hs } : null; // vide, compteur ou repère
  const maj = t.toUpperCase();
  const couper = (x) => (x.length > MAX_TEXTE ? `${x.slice(0, MAX_TEXTE - 1)}…` : x);
  for (const [re, code] of CODES) {
    const m = re.exec(maj);
    if (!m) continue;
    // Texte en plus du code (« CP (K) » → « (K) »), sauf si c'est juste le code.
    const reste = t.slice(m[0].length).replace(/^[\s:/-]+/, '').trim();
    // Mot complet (« ARRÊT MALADIE », « Congé de naissance ») : gardé en texte.
    const mot = m[0].trim();
    const garde = mot.length > code.length + 1 && !/^CP$|^REPOS$|^REREPOS$/.test(mot) ? `${mot} ${reste}`.trim() : reste;
    return avecHs({ code, texte: couper(garde.toUpperCase() === code ? '' : garde) });
  }
  // Autre abréviation (2 à 4 lettres seules, ex. MAP, APM, NA) : gardée comme code.
  const ab = /^([A-Z]{2,4})(?:\s*(\(.*\)))?$/.exec(t);
  if (ab && !PAS_CODE.has(ab[1])) return avecHs({ code: ab[1], texte: couper(ab[2] || '') });
  return avecHs({ code: 'H', texte: couper(t.replace(/(\d)h\b/g, '$1H').replace(/(\d)h(\d)/g, '$1H$2')) });
}

// Texte libre digne d'une note : une phrase (pas un nom, un jour ou un horaire seul).
const JOURS = /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|jours?)$/i;
const estNote = (t) => t.length >= 8 && /\s/.test(t) && /[a-zà-ÿ]{2}/i.test(t) && !JOURS.test(t) && !HORAIRE.test(t);

// Nom d'agent plausible (pas « CP », « REPOS », « (+1) » ni un horaire).
function estNom(qui) {
  if (!/[a-zà-ÿ]{3,}/i.test(qui) || HORAIRE.test(qui)) return false;
  const v = convertirCase(qui);
  return !!v && !v.hs && (v.code === 'H' || !DE_BASE.has(v.code));
}

function equipeDe(horaire) {
  const h = Number((/^\s*(\d{1,2})/.exec(horaire) || [])[1]);
  if (h >= 4 && h <= 9) return 'matin';
  if (h >= 10 && h <= 16) return 'apresmidi';
  return 'nuit';
}

// Lit une feuille : [{ lundi, blocs: [{ equipe, agents: {nom: {date: case}}, responsables: {...}, notes: [] }] }]
function lireFeuille(ws) {
  const semaines = new Map(); // lundi → { cases: {nom: {date: v}}, equipes: {nom: equipe}, resp: Set, notes: [] }
  const n = ws.rowCount;
  const valeur = (r, c) => ws.getRow(r).getCell(c).value;
  for (let r = 1; r <= n; r++) {
    const row = ws.getRow(r);
    const horaires = [];
    const resp = [];
    row.eachCell((cell, c) => {
      const t = texteCellule(cell.value).trim();
      if (HORAIRE.test(t)) horaires.push({ c, t });
      else if (RESP.has(t.toUpperCase())) resp.push({ c, svc: SERVICE_RESP[t.toUpperCase()] });
    });
    if (horaires.length < 3) continue;
    const equipe = equipeDe(horaires[0].t);
    const nom = (c) => texteCellule(valeur(r + 1, c)).replace(/\s+/g, ' ').trim();
    const colsAgents = horaires.map((x) => x.c).filter((c) => nom(c));
    const colsResp = resp.filter((x) => nom(x.c));
    if (!colsAgents.length) continue;
    // Colonne des dates : la première qui contient une date sous les noms.
    let colDate = null;
    for (let c = 1; c <= 4 && !colDate; c++) if (dateCellule(valeur(r + 2, c))) colDate = c;
    if (!colDate) continue;
    const exclues = new Set([...horaires.map((x) => x.c), ...colsResp.map((x) => x.c), colDate]);
    let lundi = null;
    const notes = [];
    let fin = r + 1;
    for (let k = r + 2; k <= Math.min(n, r + 9); k++) {
      const date = dateCellule(valeur(k, colDate));
      if (!date) break;
      fin = k;
      if (!lundi) lundi = lundiDe(date);
      const sem = semaines.get(lundi) || { cases: {}, equipes: {}, resp: new Map(), notes: [], reperes: [] };
      semaines.set(lundi, sem);
      const poser = (c, estResp, svc) => {
        const qui = nom(c);
        const cell = ws.getRow(k).getCell(c);
        const v = convertirCase(texteCellule(cell.value));
        const couleur = v && couleurCellule(cell);
        if (couleur) v.couleur = couleur;
        if (estResp) sem.resp.set(qui, svc);
        else sem.equipes[qui] = equipe;
        const cle = `${estResp ? 'R' : 'A'}|${qui}`;
        sem.cases[cle] = sem.cases[cle] || {};
        if (v) sem.cases[cle][date] = v;
      };
      colsAgents.forEach((c) => poser(c, false));
      colsResp.forEach((x) => poser(x.c, true, x.svc));
    }
    if (!lundi) continue;
    // Textes libres du bloc (à droite des noms) → notes de la semaine.
    const maxAgent = Math.max(...colsAgents);
    for (let k = r; k <= fin; k++) {
      ws.getRow(k).eachCell((cell, c) => {
        if (c <= maxAgent || exclues.has(c) || dateCellule(cell.value)) return;
        const t = texteCellule(cell.value).replace(/\s+/g, ' ').trim();
        if (estNote(t)) notes.push({ texte: t, couleur: couleurCellule(cell) });
      });
    }
    const sem = semaines.get(lundi);
    // Note colorée → repère de la semaine (la couleur renvoie aux cases) ; sinon note.
    for (const x of notes) {
      if (x.couleur) { if (!sem.reperes.some((y) => y.texte === x.texte)) sem.reperes.push(x); } else if (!sem.notes.includes(x.texte)) sem.notes.push(x.texte);
    }
  }
  return semaines;
}

// Classeur complet → données prêtes à importer dans le planning.
// Les feuilles nommées CTVAAAA (une par année) passent après les autres.
async function lirePlanningExcel(file, { aujourdhui = new Date().toISOString().slice(0, 10) } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const feuilles = [...wb.worksheets].sort((a, b) => Number(/^CTV\d{4}$/i.test(a.name)) - Number(/^CTV\d{4}$/i.test(b.name)));
  const semaines = new Map();
  for (const ws of feuilles) {
    for (const [lundi, sem] of lireFeuille(ws)) {
      // Une semaine vide (modèle de l'année suivante) n'écrase rien.
      const pleine = Object.values(sem.cases).some((j) => Object.keys(j).length) || sem.notes.length || sem.reperes.length;
      if (pleine || !semaines.has(lundi)) semaines.set(lundi, sem);
    }
  }
  const lundis = [...semaines.keys()].sort();
  const lundiActuel = lundiDe(aujourdhui);

  // Tous les agents du classeur, y compris ceux partis ou arrivés en cours de
  // route : arrivée = première semaine où il apparaît (après la première du
  // classeur), départ = fin de la dernière semaine où il apparaît (s'il n'est
  // plus dans les semaines en cours ou à venir). Équipe : celle de la semaine
  // en cours (ou de sa dernière semaine connue).
  const passees = lundis.filter((l) => l <= lundiActuel);
  const reference = passees.length ? passees[passees.length - 1] : lundis[0];
  const retenus = new Map(); // CLÉ en majuscules → { nom, equipe, premier, dernier }
  const ecartes = new Set();
  const cleDe = (cle) => cle.toUpperCase();
  for (const l of lundis) {
    const sem = semaines.get(l);
    const vus = [...Object.entries(sem.equipes).map(([qui, eq]) => [`A|${qui}`, qui, eq]), ...[...sem.resp].map(([qui, svc]) => [`R|${qui}`, qui, 'responsables', svc])];
    for (const [cle, qui, eq, svc] of vus) {
      if (!estNom(qui)) { ecartes.add(qui); continue; }
      const k = cleDe(cle);
      const a = retenus.get(k) || { nom: qui, equipe: eq, premier: l, dernier: l };
      a.dernier = l;
      // Nom et équipe : ceux de la semaine de référence (ou la plus récente avant).
      if (l <= reference || a.premier > reference) { a.nom = qui; a.equipe = eq; if (svc) a.service = svc; }
      retenus.set(k, a);
    }
  }
  // Les deux premières semaines du classeur servent de point de départ : un nom
  // vu seulement la toute première semaine est un reste de mise en page.
  const debutClasseur = ajouterJours(lundis[0], 7);
  for (const [k, a] of retenus) {
    if (a.dernier === lundis[0] && lundis.length > 1) { retenus.delete(k); ecartes.add(a.nom); continue; }
    if (a.premier > debutClasseur) a.arrivee = a.premier;
    if (a.dernier < reference) a.depart = ajouterJours(a.dernier, 6);
  }
  // Fin de contrat (FDC) : départ la veille du premier FDC, s'il n'a plus
  // travaillé ensuite (plus aucune case autre que FDC).
  const casesDe = (k) => {
    const out = {};
    for (const l of lundis) for (const [cle, jours] of Object.entries(semaines.get(l).cases)) if (cleDe(cle) === k) Object.assign(out, jours);
    return out;
  };
  for (const [k, a] of retenus) {
    const c = casesDe(k);
    const dates = Object.keys(c).sort();
    const premierFdc = dates.find((d) => c[d].code === 'FDC');
    if (premierFdc && dates.every((d) => d < premierFdc || c[d].code === 'FDC')) a.depart = ajouterJours(premierFdc, -1);
  }
  // Un responsable qui porte le nom d'un agent est distingué.
  const nomsAgents = new Set([...retenus.entries()].filter(([k]) => k.startsWith('A|')).map(([, a]) => a.nom.toLowerCase()));
  for (const [k, a] of retenus) if (k.startsWith('R|') && nomsAgents.has(a.nom.toLowerCase())) a.nom = `${a.nom} (resp.)`;

  const sortie = {};
  let nbCases = 0;
  for (const l of lundis) {
    const sem = semaines.get(l);
    const cases = {};
    for (const [cle, jours] of Object.entries(sem.cases)) {
      const a = retenus.get(cleDe(cle));
      if (!a) continue;
      cases[a.nom] = { ...(cases[a.nom] || {}), ...jours };
      nbCases += Object.keys(jours).length;
    }
    sortie[l] = { cases, notes: sem.notes.join('\n'), reperes: sem.reperes };
  }
  const anciens = [];
  // Abréviations rencontrées qui ne sont pas des codes de l'application.
  const codes = new Map();
  for (const sem of Object.values(sortie)) {
    for (const jours of Object.values(sem.cases)) {
      for (const v of Object.values(jours)) {
        if (!DE_BASE.has(v.code) && !codes.has(v.code)) codes.set(v.code, { code: v.code, ...(DETAILS[v.code] || { label: v.code, couleur: '#868e96', absence: false }) });
      }
    }
  }
  return {
    agents: [...retenus.values()].map(({ nom, equipe, service, arrivee, depart }) => ({ nom, equipe, ...(service ? { service } : {}), ...(arrivee ? { arrivee } : {}), ...(depart ? { depart } : {}) })),
    partis: [...retenus.values()].filter((a) => a.depart).length,
    arrives: [...retenus.values()].filter((a) => a.arrivee).length,
    codes: [...codes.values()],
    semaines: sortie,
    debut: lundis[0] || null,
    fin: lundis.length ? lundis[lundis.length - 1] : null,
    nbSemaines: lundis.length,
    nbCases,
    anciens,
    ecartes: [...ecartes].sort((a, b) => a.localeCompare(b, 'fr')),
  };
}

module.exports = { lirePlanningExcel, convertirCase, lireFeuille };
