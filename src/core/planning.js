'use strict';

// Planning des agents d'un site : liste des agents (par équipe) et, pour
// chaque semaine (du lundi au dimanche), le code de chaque agent par jour.
// Rangé dans <données>/planning/ : agents.json et semaines/AAAA-MM-JJ.json
// (date du lundi). Chaque modification relit le fichier avant d'écrire, pour
// ne pas écraser ce qu'un autre poste vient de saisir dans la même semaine.

const fs = require('fs');
const path = require('path');

const EQUIPES = ['matin', 'apresmidi', 'nuit', 'responsables', 'autres'];
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function lundiDe(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const j = (d.getUTCDay() + 6) % 7; // 0 = lundi
  d.setUTCDate(d.getUTCDate() - j);
  return d.toISOString().slice(0, 10);
}

function ajouterJours(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nettoyerCase(valeur) {
  const code = String((valeur && valeur.code) || '').trim();
  const texte = String((valeur && valeur.texte) || '').trim();
  const hs = Number(valeur && valeur.hs);
  const v = { code, texte };
  if (Number.isFinite(hs) && hs > 0) {
    v.hs = Math.round(hs * 100) / 100;
    // Type d'heures supp ponctuelles : bleues (normales), rouges (dimanche /
    // férié), vertes (nuit). Absent : déduit du jour à l'affichage.
    if (['bleu', 'rouge', 'vert'].includes(valeur.hsType)) v.hsType = valeur.hsType;
  }
  const couleur = couleurValide(valeur && valeur.couleur);
  if (couleur) v.couleur = couleur;
  // Responsable : service ponctuel ce jour-là (matin, après-midi, nuit).
  if (valeur && ['matin', 'apresmidi', 'nuit'].includes(valeur.service)) v.service = valeur.service;
  return code || texte || v.hs || v.service ? v : null;
}

const couleurValide = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '');

// Repères de la semaine : textes colorés (ex. « Congé de naissance du 14/10 au 14/11 »),
// la même couleur se retrouve sur les cases des agents concernés.
function nettoyerReperes(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const texte = String((x && x.texte) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (texte && !out.some((y) => y.texte === texte)) out.push({ texte, couleur: couleurValide(x.couleur) || '#ffd43b' });
  }
  return out;
}

function nettoyerCodes(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const code = String((x && x.code) || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,5}$/.test(code) || out.some((y) => y.code === code)) continue;
    out.push({ code, label: String(x.label || code).trim().slice(0, 40) || code, couleur: couleurValide(x.couleur) || '#868e96', absence: !!x.absence });
  }
  return out;
}

class Planning {
  constructor(dir) {
    this.dir = path.join(dir, 'planning');
  }

  readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return value;
  }

  // ---- Agents ----
  loadAgents() {
    const list = this.readJson(path.join(this.dir, 'agents.json'), { agents: [] }).agents;
    return (Array.isArray(list) ? list : []).filter((a) => a && a.id && a.nom);
  }

  // `agents` : liste complète dans l'ordre voulu [{ id?, nom, equipe }].
  saveAgents(agents) {
    const seen = new Set();
    const clean = [];
    for (const a of agents) {
      const nom = String(a.nom || '').trim();
      if (!nom || seen.has(nom.toLowerCase())) continue;
      seen.add(nom.toLowerCase());
      const ag = { id: a.id && /^[a-z0-9-]+$/i.test(a.id) ? a.id : newId(), nom, equipe: EQUIPES.includes(a.equipe) ? a.equipe : 'autres' };
      // Responsable : service de rattachement (matin, après-midi ou nuit).
      if (ag.equipe === 'responsables' && ['matin', 'apresmidi', 'nuit'].includes(a.service)) ag.service = a.service;
      // Arrivée / départ (facultatifs) : l'agent ne compte qu'entre ces dates.
      if (ISO.test(a.arrivee || '')) ag.arrivee = a.arrivee;
      if (ISO.test(a.depart || '') && !(ag.arrivee && a.depart < ag.arrivee)) ag.depart = a.depart;
      clean.push(ag);
    }
    this.writeJson(path.join(this.dir, 'agents.json'), { agents: clean });
    return clean;
  }

  // ---- Codes (abréviations) propres au site ----
  // [{ code, label, couleur, absence }] : complètent ou précisent les codes
  // de base de l'application (R, CP, MAL…).
  loadCodes() {
    return nettoyerCodes(this.readJson(path.join(this.dir, 'codes.json'), { codes: [] }).codes);
  }

  saveCodes(codes) {
    return this.writeJson(path.join(this.dir, 'codes.json'), { codes: nettoyerCodes(codes) }).codes;
  }

  // ---- Semaines ----
  fichierSemaine(lundi) {
    if (!ISO.test(lundi)) throw new Error(`Date invalide : ${lundi}`);
    return path.join(this.dir, 'semaines', `${lundi}.json`);
  }

  loadSemaine(dateQuelconque) {
    const lundi = lundiDe(dateQuelconque);
    const s = this.readJson(this.fichierSemaine(lundi), {});
    return { lundi, cases: s.cases || {}, notes: s.notes || '', reperes: nettoyerReperes(s.reperes), majLe: s.majLe || null, majPar: s.majPar || '' };
  }

  // Une case : agent + jour → { code, texte, hs? } (vide = travail normal, case effacée).
  // hs : heures supplémentaires du jour (ex. 1, 3.5).
  setCase(agentId, date, valeur, by) {
    if (!ISO.test(date)) throw new Error(`Date invalide : ${date}`);
    const sem = this.loadSemaine(date);
    const v = nettoyerCase(valeur);
    const ag = { ...(sem.cases[agentId] || {}) };
    if (v) ag[date] = v;
    else delete ag[date];
    if (Object.keys(ag).length) sem.cases[agentId] = ag;
    else delete sem.cases[agentId];
    return this.enregistrer(sem, by);
  }

  setNotes(date, notes, by) {
    const sem = this.loadSemaine(date);
    sem.notes = String(notes || '');
    return this.enregistrer(sem, by);
  }

  setReperes(date, reperes, by) {
    const sem = this.loadSemaine(date);
    sem.reperes = nettoyerReperes(reperes);
    return this.enregistrer(sem, by);
  }

  enregistrer(sem, by) {
    const out = { lundi: sem.lundi, cases: sem.cases, notes: sem.notes, reperes: nettoyerReperes(sem.reperes), majLe: new Date().toISOString(), majPar: by || '' };
    return this.writeJson(this.fichierSemaine(sem.lundi), out);
  }

  // Import d'un classeur (voir planning-import.js) : agents retrouvés par leur
  // nom (sinon ajoutés), et pour chaque semaine du classeur, les cases de ces
  // agents remplacées par celles du classeur. Les notes s'ajoutent.
  importer({ agents, semaines, codes = [] }, by) {
    // Abréviations nouvelles ajoutées, celles déjà détaillées gardées.
    const connus = this.loadCodes();
    const nouveaux = codes.filter((c) => !connus.some((x) => x.code === c.code));
    if (nouveaux.length) this.saveCodes([...connus, ...nouveaux]);
    const liste = this.loadAgents();
    const parNom = new Map(liste.map((a) => [a.nom.toLowerCase(), a]));
    let ajoutes = 0;
    for (const a of agents) {
      const ex = parNom.get(a.nom.toLowerCase());
      if (ex) {
        ex.equipe = a.equipe;
        if (a.service && !ex.service) ex.service = a.service;
        if (a.arrivee) ex.arrivee = a.arrivee;
        if (a.depart) ex.depart = a.depart;
      } else {
        const nv = { id: newId(), nom: a.nom, equipe: a.equipe, service: a.service, arrivee: a.arrivee, depart: a.depart };
        liste.push(nv);
        parNom.set(a.nom.toLowerCase(), nv);
        ajoutes += 1;
      }
    }
    const tous = this.saveAgents(liste);
    const ids = new Map(tous.map((a) => [a.nom.toLowerCase(), a.id]));
    let nbSemaines = 0;
    for (const [lundi, imp] of Object.entries(semaines)) {
      const sem = this.loadSemaine(lundi);
      const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(sem.lundi, i));
      for (const [nom, cases] of Object.entries(imp.cases || {})) {
        const id = ids.get(nom.toLowerCase());
        if (!id) continue;
        const ag = { ...(sem.cases[id] || {}) };
        for (const d of jours) {
          const v = nettoyerCase(cases[d]);
          if (v) ag[d] = v;
          else delete ag[d];
        }
        if (Object.keys(ag).length) sem.cases[id] = ag;
        else delete sem.cases[id];
      }
      const lignes = String(imp.notes || '').split('\n').map((x) => x.trim()).filter(Boolean);
      const deja = new Set(sem.notes.split('\n').map((x) => x.trim()));
      const nouvelles = lignes.filter((x) => !deja.has(x));
      if (nouvelles.length) sem.notes = [sem.notes.trim(), ...nouvelles].filter(Boolean).join('\n');
      sem.reperes = nettoyerReperes([...sem.reperes, ...(imp.reperes || [])]);
      this.enregistrer(sem, by);
      nbSemaines += 1;
    }
    return { agents: tous, ajoutes, nbSemaines, codes: this.loadCodes() };
  }

  // Fusion de deux agents (même personne, deux orthographes) : les cases de
  // `sourceId` rejoignent `cibleId` (celles de la cible priment), puis la
  // source est retirée de la liste.
  fusionner(sourceId, cibleId, by) {
    const agents = this.loadAgents();
    if (sourceId === cibleId || !agents.some((a) => a.id === sourceId) || !agents.some((a) => a.id === cibleId)) throw new Error('Agents à fusionner introuvables.');
    let dir = [];
    try {
      dir = fs.readdirSync(path.join(this.dir, 'semaines')).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    let semaines = 0;
    for (const f of dir) {
      const sem = this.loadSemaine(f.slice(0, 10));
      const src = sem.cases[sourceId];
      if (!src) continue;
      sem.cases[cibleId] = { ...src, ...(sem.cases[cibleId] || {}) };
      delete sem.cases[sourceId];
      this.enregistrer(sem, by);
      semaines += 1;
    }
    // Période de présence : la plus large des deux.
    const src = agents.find((a) => a.id === sourceId);
    const cible = agents.find((a) => a.id === cibleId);
    cible.arrivee = src.arrivee && cible.arrivee ? (src.arrivee < cible.arrivee ? src.arrivee : cible.arrivee) : undefined;
    cible.depart = src.depart && cible.depart ? (src.depart > cible.depart ? src.depart : cible.depart) : undefined;
    const restants = this.saveAgents(agents.filter((a) => a.id !== sourceId));
    return { agents: restants, semaines };
  }

  // Vide le planning (agents et semaines) pour repartir d'un classeur propre.
  // Les codes du site (abréviations détaillées) sont gardés.
  vider() {
    fs.rmSync(path.join(this.dir, 'semaines'), { recursive: true, force: true });
    this.writeJson(path.join(this.dir, 'agents.json'), { agents: [] });
    return [];
  }

  // Toutes les cases entre deux dates (incluses) : { agentId: { date: {code, texte} } }.
  casesEntre(debut, fin) {
    const out = {};
    for (let l = lundiDe(debut); l <= fin; l = ajouterJours(l, 7)) {
      const sem = this.loadSemaine(l);
      for (const [agent, jours] of Object.entries(sem.cases)) {
        for (const [d, v] of Object.entries(jours)) {
          if (d >= debut && d <= fin) (out[agent] = out[agent] || {})[d] = v;
        }
      }
    }
    return out;
  }
}

module.exports = { Planning, lundiDe, ajouterJours, EQUIPES };
