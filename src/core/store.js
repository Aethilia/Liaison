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

  loadMonth(year, month) {
    return this.loadRange(daysInMonth(year, month));
  }
}

module.exports = { Store, ConflictError };
