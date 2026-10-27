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
// Sorties « à part » par défaut : des caisses, comptées à la pièce sans poids.
const QUANTITES_DEFAUT = ['DEEE', 'TV'];

const BENNES = ['Matelas', 'Fer', 'Bois', 'DIB', 'UVE'];
const PLATEAUX = ['Sport', 'Fer', 'Bois', 'DIB'];

const UNITES = ['pièce(s)', 'kg', 'T'];
// Stockage (bennes stockées sur site) : état de chaque ligne.
const ETATS_STOCKAGE = [{ id: 'vide', label: 'Vide' }, { id: 'pleine', label: 'Pleine' }, { id: 'en-cours', label: 'En cours' }];
const SERVICE_COMMANDES = 'matin'; // service qui saisit les commandes, vues en info par les autres
// Couleur par défaut des matières en sortie (les externes en vert) ; modifiable par site.
const COULEURS_DEFAUT = { Bois: { couleur: '#2f9e44', mode: 'nom' }, Matelas: { couleur: '#2f9e44', mode: 'nom' } };
const PALETTE = ['#2f9e44', '#1971c2', '#e8590c', '#c2255c', '#7048e8', '#f08c00', '#0c8599', '#868e96'];

const NB_ABSENTS = 4;
const NB_OBSERVATIONS = 12;
const SEUIL_ALERTE = 80; // % de remplissage à partir duquel la case passe en rouge

const sortieVide = (m) => (MATIERES_EXTERNES.includes(m) ? { nb: null } : { nb: null, tonnage: null, pesees: [] });

function emptyService(date, service) {
  const sorties = {};
  for (const m of MATIERES) sorties[m] = sortieVide(m);
  const bennes = {};
  for (const b of BENNES) bennes[b] = null;
  const plateaux = {};
  for (const p of PLATEAUX) plateaux[p] = null;
  return {
    date,
    service,
    responsable: '',
    absents: Array.from({ length: NB_ABSENTS }, () => ({ nom: '', motif: '' })),
    entrees: { plateaux: null, pl: null, tonnage: null }, // tonnage : sites qui pèsent les entrées (CPTP)
    sorties,
    sortiesExtra: [], // sorties ponctuelles (ex. sapins) : { nom, nb, tonnage, pesees, couleur }
    quantites: {}, // sorties à part, sans poids (ex. pneus, extincteurs) : { nom: quantité }
    bennes,
    plateaux,
    nonConformes: [], // { type, quantite, unite, provenance, commentaire, photos }
    stockage: [], // { type, nombre, etat: vide | pleine | en-cours }
    commandes: [], // { quoi, quantite, fournisseur, date, recue } — saisies par le matin
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
  out.absents = (Array.isArray(data.absents) ? data.absents : []).map((a) => ({ ...a, nom: (a && a.nom) || '', motif: (a && a.motif) || '' }));
  while (out.absents.length < NB_ABSENTS) out.absents.push({ nom: '', motif: '' });
  out.entrees = { ...base.entrees, ...(data.entrees || {}) };
  out.sorties = {};
  // Matières d'origine, plus celles ajoutées par le site (présentes dans le fichier).
  for (const m of new Set([...MATIERES, ...Object.keys(data.sorties || {})])) {
    out.sorties[m] = { ...(base.sorties[m] || sortieVide(m)), ...((data.sorties || {})[m] || {}) };
    if (!MATIERES_EXTERNES.includes(m)) out.sorties[m].pesees = cleanPesees(out.sorties[m].pesees);
  }
  // Les champs inconnus (ajoutés par une version plus récente) sont conservés tels quels.
  out.sortiesExtra = (Array.isArray(data.sortiesExtra) ? data.sortiesExtra : []).map((x) => ({
    ...x,
    nom: (x && x.nom) || '', nb: numOrNull(x && x.nb), tonnage: numOrNull(x && x.tonnage), pesees: cleanPesees(x && x.pesees), couleur: (x && x.couleur) || '',
  }));
  out.quantites = {};
  for (const [k, v] of Object.entries(data.quantites && typeof data.quantites === 'object' ? data.quantites : {})) out.quantites[k] = numOrNull(v);
  out.nonConformes = (Array.isArray(data.nonConformes) ? data.nonConformes : []).map((x) => ({
    ...x,
    type: (x && x.type) || '', quantite: numOrNull(x && x.quantite), unite: (x && x.unite) || UNITES[0],
    provenance: (x && x.provenance) || '', commentaire: (x && x.commentaire) || '', photos: cleanList(x && x.photos),
  }));
  out.stockage = (Array.isArray(data.stockage) ? data.stockage : []).map((x) => ({
    ...x,
    type: (x && x.type) || '', nombre: numOrNull(x && x.nombre),
    etat: ETATS_STOCKAGE.some((e) => e.id === (x && x.etat)) ? x.etat : 'vide',
  }));
  out.commandes = (Array.isArray(data.commandes) ? data.commandes : []).map((x) => ({
    ...x,
    quoi: (x && x.quoi) || '', quantite: (x && x.quantite != null) ? String(x.quantite) : '',
    fournisseur: (x && x.fournisseur) || '', date: (x && x.date) || '', recue: !!(x && x.recue),
  }));
  out.bennes = { ...base.bennes, ...(data.bennes || {}) };
  out.plateaux = { ...base.plateaux, ...(data.plateaux || {}) };
  out.observations = Array.isArray(data.observations)
    ? data.observations.map((o) => ({ ...o, heure: o.heure || '', texte: o.texte || '', important: !!o.important, auteur: o.auteur || '', photos: cleanList(o.photos) }))
    : [];
  return out;
}

function isEmpty(s) {
  if (!s) return true;
  if (s.responsable || s.consignes || s.cloture) return false;
  if (s.absents.some((a) => a.nom || a.motif)) return false;
  if (s.entrees.plateaux != null || s.entrees.pl != null || s.entrees.tonnage != null) return false;
  if (Object.values(s.sorties).some((v) => v.nb != null || v.tonnage != null)) return false;
  if (Object.values(s.bennes).some((v) => v != null)) return false;
  if (Object.values(s.plateaux).some((v) => v != null)) return false;
  if (Object.values(s.quantites || {}).some((v) => v != null)) return false;
  if ((s.sortiesExtra || []).some((x) => x.nom || x.nb != null || x.tonnage != null)) return false;
  if ((s.nonConformes || []).some((x) => x.type || x.quantite != null)) return false;
  if ((s.stockage || []).some((x) => x.type || x.nombre != null)) return false;
  if ((s.commandes || []).some((x) => x.quoi || x.quantite || x.fournisseur)) return false;
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

// Case « Tonnage » des entrées : réglage du site, activé d'office pour le CPTP.
function entreesTonnage(site) {
  if (site && typeof site.entreesTonnage === 'boolean') return site.entreesTonnage;
  return /cptp/i.test((site && site.nom) || '');
}

// État des boxs en un seul bloc « Stockage » (CPTP, ou réglage `boxUnique`) :
// les lignes sont rangées dans `bennes`, il n'y a plus de plateaux.
function boxUnique(site) {
  if (site && typeof site.boxUnique === 'boolean') return site.boxUnique;
  return /cptp/i.test((site && site.nom) || '');
}

// Clé de la liste dans site.boxs (le bloc unique a sa propre liste « stockage »).
const boxCle = (site, group) => (boxUnique(site) && group === 'bennes' ? 'stockage' : group);

function boxTitres(site) {
  return boxUnique(site)
    ? { bennes: 'Stockage', plateaux: 'Plateaux', benne: 'Stockage', plateau: 'Plateau' }
    : { bennes: 'Bennes', plateaux: 'Plateaux', benne: 'Benne', plateau: 'Plateau' };
}

// Bennes et plateaux affichés : liste du site (modifiable) ou liste d'origine,
// plus ceux encore renseignés dans le service (lignes retirées depuis).
function boxNames(site, s) {
  const cfg = (site && site.boxs) || {};
  const unique = boxUnique(site);
  const out = {};
  for (const [k, def] of [['bennes', unique ? ['Stockage'] : BENNES], ['plateaux', unique ? [] : PLATEAUX]]) {
    const saved = unique ? (k === 'bennes' ? cfg.stockage : null) : cfg[k];
    const list = Array.isArray(saved) ? saved.filter((n) => typeof n === 'string' && n) : [...def];
    if (s && s[k]) for (const [n, v] of Object.entries(s[k])) if (v != null && !list.includes(n)) list.push(n);
    out[k] = list;
  }
  return out;
}

function boxAlerts(s, site) {
  const t = boxTitres(site);
  const list = (k, type) => Object.entries(s[k] || {}).filter(([, v]) => v != null && v >= SEUIL_ALERTE).map(([nom, v]) => ({ type, nom, v }));
  return [...list('bennes', t.benne), ...list('plateaux', t.plateau)];
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

// Matières en sortie d'un site : liste réglée (ajouts / retraits) ou liste d'origine.
function matieresDuSite(site) {
  const list = site && Array.isArray(site.matieres) ? site.matieres.filter((n) => typeof n === 'string' && n) : null;
  const aPart = quantitesDuSite(site);
  return (list || [...MATIERES]).filter((n) => !aPart.includes(n));
}

// Toutes les lignes de sorties : matières du site (plus celles retirées depuis
// mais renseignées dans ce service) puis ponctuelles.
// Sorties à part, comptées à la pièce (liste du site) : hors total des sorties et du tonnage.
function quantitesDuSite(site) {
  return site && Array.isArray(site.quantites) ? site.quantites.filter((n) => typeof n === 'string' && n) : [...QUANTITES_DEFAUT];
}

function allQuantites(s, site) {
  const noms = quantitesDuSite(siteDe(site));
  for (const [k, v] of Object.entries(s.quantites || {})) if (!noms.includes(k) && v != null) noms.push(k);
  return noms.map((nom) => ({ nom, nb: (s.quantites || {})[nom] ?? null }));
}

function allSorties(s, site) {
  const noms = matieresDuSite(siteDe(site));
  for (const [m, v] of Object.entries(s.sorties)) if (!noms.includes(m) && v && (v.nb != null || v.tonnage != null)) noms.push(m);
  return [
    ...noms.map((m) => ({ nom: m, externe: MATIERES_EXTERNES.includes(m), data: s.sorties[m] || (s.sorties[m] = sortieVide(m)), extra: false })),
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

// Chiffres d'une période (récap, feuille Synthèse) : days = [{ date, services }].
function stats(days, services = SERVICES) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const matieres = new Map();
  const quantites = new Map();
  const entSvc = Object.fromEntries(services.map((d) => [d.id, { service: d.id, plateaux: 0, pl: 0 }]));
  const motifs = new Map();
  const nc = new Map();
  const parJour = [];
  const k = { entrees: 0, sorties: 0, tonnage: 0, observations: 0, importantes: 0, clos: 0, services: 0, nonConformes: 0, absents: 0 };
  for (const day of days) {
    let tonJour = 0;
    for (const def of services) {
      const s = normalize(day.services[def.id], day.date, def.id);
      k.services += 1;
      if (s.cloture) k.clos += 1;
      entSvc[def.id].plateaux += n(s.entrees.plateaux);
      entSvc[def.id].pl += n(s.entrees.pl);
      for (const r of allSorties(s)) {
        const nom = r.nom || 'Sortie ponctuelle';
        const m = matieres.get(nom) || { nom, nb: 0, tonnage: 0, externe: r.externe, extra: r.extra };
        m.nb += n(r.data.nb);
        m.tonnage += n(r.data.tonnage);
        matieres.set(nom, m);
        tonJour += n(r.data.tonnage);
      }
      for (const q of allQuantites(s)) if (q.nb != null) quantites.set(q.nom, (quantites.get(q.nom) || 0) + n(q.nb));
      for (const a of s.absents) {
        if (!a.nom) continue;
        k.absents += 1;
        const key = a.motif || 'Non précisé';
        motifs.set(key, (motifs.get(key) || 0) + 1);
      }
      for (const x of s.nonConformes) {
        if (!x.type) continue;
        k.nonConformes += 1;
        const key = `${x.type.toLowerCase()}|${x.unite}`;
        const e = nc.get(key) || { type: x.type, unite: x.unite, quantite: 0, lignes: 0 };
        e.quantite += n(x.quantite);
        e.lignes += 1;
        nc.set(key, e);
      }
      const obs = s.observations.filter((o) => o.heure || o.texte);
      k.observations += obs.length;
      k.importantes += obs.filter((o) => o.important).length;
    }
    parJour.push({ date: day.date, tonnage: Math.round(tonJour * 1000) / 1000 });
  }
  const list = [...matieres.values()].map((m) => ({ ...m, tonnage: Math.round(m.tonnage * 1000) / 1000 }));
  const entrees = Object.values(entSvc);
  k.entrees = entrees.reduce((a, e) => a + e.plateaux + e.pl, 0);
  k.sorties = list.reduce((a, m) => a + m.nb, 0);
  k.tonnage = Math.round(list.reduce((a, m) => a + m.tonnage, 0) * 1000) / 1000;
  return {
    kpis: k,
    matieres: list,
    quantites: [...quantites.entries()].map(([nom, nb]) => ({ nom, nb })),
    entrees,
    parJour,
    motifs: [...motifs.entries()].map(([motif, nb]) => ({ motif, nb })).sort((a, b) => b.nb - a.nb),
    nonConformes: [...nc.values()].sort((a, b) => a.type.localeCompare(b.type, 'fr')),
  };
}

// Compare deux numéros de version « 1.4.0 » : -1, 0 ou 1.
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// Organisation des services d'un site. Par défaut matin / après-midi / nuit ;
// le CPTP (ou tout site réglé avec `deuxServices`) ne tourne qu'en matin 6H-13H
// et soir 18H-3H. Le soir garde l'identifiant « nuit » : même logique de date
// (une vacation rattachée au jour où elle commence).
const SERVICES_TOUS = SERVICES.map((d) => ({ ...d }));
const PROFIL_DEUX = {
  matin: { horaires: '6H - 13H', titre: 'SERVICE MATIN  ·  6H - 13H' },
  nuit: { label: 'Soir', horaires: '18H - 3H', titre: 'SERVICE SOIR  ·  18H - 3H' },
};
let profil = null; // site actif (interface) : réglé par setProfil

function deuxServices(site) {
  if (site && typeof site.deuxServices === 'boolean') return site.deuxServices;
  return /cptp/i.test((site && site.nom) || '');
}

function servicesDuSite(site) {
  if (!deuxServices(site)) return SERVICES_TOUS.map((d) => ({ ...d }));
  return SERVICES_TOUS.filter((d) => d.id !== 'apresmidi').map((d) => ({ ...d, ...PROFIL_DEUX[d.id] }));
}

// Interface : SERVICES devient la liste du site choisi (modifiée sur place).
function setProfil(site) {
  profil = site || null;
  SERVICES.splice(0, SERVICES.length, ...servicesDuSite(profil));
  return SERVICES;
}

const siteDe = (site) => (site === undefined ? profil : site);

// Service précédent dans l'ordre de relève : nuit (veille) → matin → après-midi → nuit.
function previousService(date, service, site) {
  const deux = deuxServices(siteDe(site));
  if (service === 'matin') return { date: addDays(date, -1), service: 'nuit' };
  if (service === 'apresmidi' || deux) return { date, service: 'matin' };
  return { date, service: 'apresmidi' };
}

function nextService(date, service, site) {
  const deux = deuxServices(siteDe(site));
  if (service === 'matin') return { date, service: deux ? 'nuit' : 'apresmidi' };
  if (service === 'apresmidi') return { date, service: 'nuit' };
  return { date: addDays(date, 1), service: 'matin' };
}

// Service en cours selon l'heure : entre minuit et 5H on est encore sur la nuit de la veille.
// Deux services : avant 6H soir de la veille, matin jusqu'à 13H, puis le soir.
function currentService(now = new Date(), site) {
  const h = now.getHours();
  const today = toISODate(now);
  if (deuxServices(siteDe(site))) {
    if (h < 6) return { date: addDays(today, -1), service: 'nuit' };
    if (h < 13) return { date: today, service: 'matin' };
    return { date: today, service: 'nuit' };
  }
  if (h < 5) return { date: addDays(today, -1), service: 'nuit' };
  if (h < 13) return { date: today, service: 'matin' };
  if (h < 20) return { date: today, service: 'apresmidi' };
  return { date: today, service: 'nuit' };
}

// Jours fériés (France) d'une année : fixes + ceux qui suivent Pâques.
const feriesCache = new Map();
function joursFeries(annee) {
  if (feriesCache.has(annee)) return feriesCache.get(annee);
  // Dimanche de Pâques (algorithme de Meeus / Jones / Butcher).
  const a = annee % 19; const b = Math.floor(annee / 100); const c = annee % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31); const jour = ((h + l - 7 * m + 114) % 31) + 1;
  const p2 = (n) => String(n).padStart(2, '0');
  const paques = `${annee}-${p2(mois)}-${p2(jour)}`;
  const out = new Map([
    [`${annee}-01-01`, 'Jour de l\'an'], [addDays(paques, 1), 'Lundi de Pâques'], [`${annee}-05-01`, 'Fête du Travail'],
    [`${annee}-05-08`, 'Victoire 1945'], [addDays(paques, 39), 'Ascension'], [addDays(paques, 50), 'Lundi de Pentecôte'],
    [`${annee}-07-14`, 'Fête nationale'], [`${annee}-08-15`, 'Assomption'], [`${annee}-11-01`, 'Toussaint'],
    [`${annee}-11-11`, 'Armistice'], [`${annee}-12-25`, 'Noël'],
  ]);
  feriesCache.set(annee, out);
  return out;
}
const ferie = (iso) => joursFeries(Number(iso.slice(0, 4))).get(iso) || null;

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
  stats, compareVersions, UNITES, ETATS_STOCKAGE, SERVICE_COMMANDES, COULEURS_DEFAUT, PALETTE, parsePoids, parseTonnage, allSorties, fillColor, newTaskId,
  boxNames, boxAlerts, boxUnique, boxTitres, boxCle, matieresDuSite, quantitesDuSite, allQuantites, entreesTonnage, deuxServices, servicesDuSite, setProfil, SERVICES_TOUS,
  SERVICES, MOTIFS, MATIERES, MATIERES_EXTERNES, QUANTITES_DEFAUT, BENNES, PLATEAUX, NB_ABSENTS, NB_OBSERVATIONS, SEUIL_ALERTE, CONSIGNES_PREFIX, IMPORTANT_PREFIX, ABSENTS_PREFIX,
  emptyService, normalize, isEmpty, totals, wrapText, layoutObservations, previousService, nextService, currentService,
  toISODate, parseISODate, addDays, daysInMonth, joursFeries, ferie,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.LiaisonModel = api;
})();
