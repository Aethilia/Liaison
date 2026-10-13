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
      clean.push({ id: a.id && /^[a-z0-9-]+$/i.test(a.id) ? a.id : newId(), nom, equipe: EQUIPES.includes(a.equipe) ? a.equipe : 'autres' });
    }
    this.writeJson(path.join(this.dir, 'agents.json'), { agents: clean });
    return clean;
  }

  // ---- Semaines ----
  fichierSemaine(lundi) {
    if (!ISO.test(lundi)) throw new Error(`Date invalide : ${lundi}`);
    return path.join(this.dir, 'semaines', `${lundi}.json`);
  }

  loadSemaine(dateQuelconque) {
    const lundi = lundiDe(dateQuelconque);
    const s = this.readJson(this.fichierSemaine(lundi), {});
    return { lundi, cases: s.cases || {}, notes: s.notes || '', majLe: s.majLe || null, majPar: s.majPar || '' };
  }

  // Une case : agent + jour → { code, texte } (vide = travail normal, case effacée).
  setCase(agentId, date, valeur, by) {
    if (!ISO.test(date)) throw new Error(`Date invalide : ${date}`);
    const sem = this.loadSemaine(date);
    const code = String((valeur && valeur.code) || '').trim();
    const texte = String((valeur && valeur.texte) || '').trim();
    const ag = { ...(sem.cases[agentId] || {}) };
    if (code || texte) ag[date] = { code, texte };
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

  enregistrer(sem, by) {
    const out = { lundi: sem.lundi, cases: sem.cases, notes: sem.notes, majLe: new Date().toISOString(), majPar: by || '' };
    return this.writeJson(this.fichierSemaine(sem.lundi), out);
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
