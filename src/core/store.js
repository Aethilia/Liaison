'use strict';

// Stockage des mains courantes : un fichier JSON par jour et par service
// (AAAA/MM/AAAA-MM-JJ_service.json). Le dossier peut être un partage réseau,
// ce qui permet à plusieurs postes de travailler sur les mêmes données sans
// s'écraser : chaque service écrit uniquement son propre fichier.

const fs = require('fs');
const path = require('path');
const { normalize, emptyService, SERVICES, daysInMonth } = require('./model');

const SERVICE_IDS = SERVICES.map((s) => s.id);

class ConflictError extends Error {
  constructor(current) {
    super('Ce service a été modifié depuis un autre poste.');
    this.code = 'CONFLICT';
    this.current = current;
  }
}

class Store {
  constructor(dir) {
    this.dir = dir;
  }

  fileFor(date, service) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Date invalide : ${date}`);
    if (!SERVICE_IDS.includes(service)) throw new Error(`Service inconnu : ${service}`);
    const [y, m] = date.split('-');
    return path.join(this.dir, y, m, `${date}_${service}.json`);
  }

  load(date, service) {
    const file = this.fileFor(date, service);
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return emptyService(date, service);
      throw err;
    }
    return normalize(JSON.parse(raw), date, service);
  }

  // Enregistre un service. `expectedRev` est la révision lue au chargement :
  // si le fichier a changé entre-temps (autre poste), on lève un ConflictError
  // sauf si `force` est vrai.
  save(data, { expectedRev, by, force = false } = {}) {
    const file = this.fileFor(data.date, data.service);
    const current = this.load(data.date, data.service);
    if (!force && expectedRev != null && current.rev !== expectedRev) throw new ConflictError(current);
    const out = normalize({ ...data, rev: current.rev + 1, updatedAt: new Date().toISOString(), updatedBy: by || null });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return out;
  }

  loadDay(date) {
    const out = {};
    for (const s of SERVICE_IDS) out[s] = this.load(date, s);
    return out;
  }

  loadRange(dates) {
    return dates.map((date) => ({ date, services: this.loadDay(date) }));
  }

  // Liste des responsables, commune à tous les postes qui partagent le dossier.
  loadUsers() {
    try {
      const users = JSON.parse(fs.readFileSync(path.join(this.dir, 'responsables.json'), 'utf8')).responsables;
      return Array.isArray(users) ? users.filter((u) => typeof u === 'string' && u.trim()) : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  saveUsers(users) {
    const clean = [...new Set(users.map((u) => String(u).trim()).filter(Boolean))];
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, 'responsables.json');
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ responsables: clean }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return clean;
  }

  // Agents déjà saisis comme absents, proposés ensuite à la saisie.
  loadAgents() {
    try {
      const agents = JSON.parse(fs.readFileSync(path.join(this.dir, 'agents.json'), 'utf8')).agents;
      return Array.isArray(agents) ? agents.filter((a) => typeof a === 'string' && a.trim()) : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  saveAgents(agents) {
    const seen = new Set();
    const clean = agents.map((a) => String(a).trim().replace(/\s+/g, ' ')).filter((a) => {
      const k = a.toLowerCase();
      if (!a || seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => a.localeCompare(b, 'fr'));
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, 'agents.json');
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ agents: clean }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return clean;
  }

  // Ajoute à la liste les agents absents d'un service qui n'y sont pas encore.
  rememberAgents(service) {
    const known = this.loadAgents();
    const lower = new Set(known.map((a) => a.toLowerCase()));
    const fresh = service.absents.map((a) => a.nom.trim()).filter((n) => n && !lower.has(n.toLowerCase()));
    return fresh.length ? this.saveAgents([...known, ...fresh]) : known;
  }

  // Petits fichiers JSON communs au site (écriture atomique).
  readJson(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  writeJson(name, value) {
    const file = path.join(this.dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return value;
  }

  // Réglages du site : couleurs des matières en sortie.
  loadSite() {
    const site = this.readJson('site.json', {});
    return { couleurs: {}, ...site };
  }

  saveSite(site) {
    return this.writeJson('site.json', site);
  }

  // Types de déchets non conformes déjà saisis, avec leur dernière unité.
  loadNcTypes() {
    const list = this.readJson('types-non-conformes.json', { types: [] }).types;
    return Array.isArray(list) ? list.filter((t) => t && typeof t.nom === 'string' && t.nom.trim()) : [];
  }

  saveNcTypes(types) {
    const seen = new Map();
    for (const t of types) {
      const nom = String(t.nom || '').trim().replace(/\s+/g, ' ');
      if (nom) seen.set(nom.toLowerCase(), { nom, unite: t.unite || '' });
    }
    const clean = [...seen.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    this.writeJson('types-non-conformes.json', { types: clean });
    return clean;
  }

  rememberNcTypes(service) {
    const known = this.loadNcTypes();
    const fresh = (service.nonConformes || []).filter((x) => x.type.trim()).map((x) => ({ nom: x.type.trim(), unite: x.unite }));
    const changed = fresh.some((f) => {
      const k = known.find((t) => t.nom.toLowerCase() === f.nom.toLowerCase());
      return !k || k.unite !== f.unite;
    });
    return changed ? this.saveNcTypes([...known, ...fresh]) : known;
  }

  // Tâches de relève : un fichier par tâche, pour que deux postes puissent en
  // créer ou en valider en même temps sans se gêner.
  taskFile(id) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`Identifiant de tâche invalide : ${id}`);
    return path.join(this.dir, 'taches', `${id}.json`);
  }

  listTasks() {
    let names;
    try {
      names = fs.readdirSync(path.join(this.dir, 'taches'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(this.dir, 'taches', name), 'utf8')));
      } catch { /* fichier en cours d'écriture : relu au prochain passage */ }
    }
    return out.sort((a, b) => String(a.creeLe).localeCompare(String(b.creeLe)));
  }

  saveTask(task) {
    this.taskFile(task.id);
    const out = { ...task, majLe: new Date().toISOString() };
    this.writeJson(path.join('taches', `${task.id}.json`), out);
    return out;
  }

  deleteTask(id) {
    try {
      fs.unlinkSync(this.taskFile(id));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return true;
  }

  // Chemin absolu d'une photo à partir de son chemin relatif (photos/AAAA/MM/…).
  photoPath(rel) {
    const abs = path.resolve(this.dir, rel);
    const root = path.resolve(this.dir, 'photos') + path.sep;
    if (!abs.startsWith(root)) throw new Error('Chemin de photo invalide.');
    return abs;
  }

  loadMonth(year, month) {
    return this.loadRange(daysInMonth(year, month));
  }
}

module.exports = { Store, ConflictError };
