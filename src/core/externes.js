'use strict';

// Pesées des services externes (Bois, Matelas…) : le poids arrive après coup,
// on le saisit avec la date de l'enlèvement. Rangé dans <données>/externes/,
// un fichier par pesée pour que plusieurs postes puissent saisir sans se gêner.

const fs = require('fs');
const path = require('path');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

class Externes {
  constructor(dir) {
    this.dir = path.join(dir, 'externes');
  }

  fichier(id) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Identifiant invalide.');
    return path.join(this.dir, `${id}.json`);
  }

  list() {
    let noms;
    try {
      noms = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const out = [];
    for (const f of noms) {
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')));
      } catch { /* fichier en cours d'écriture ou abîmé : ignoré */ }
    }
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.creeLe).localeCompare(String(a.creeLe)));
  }

  // { id?, date, matiere, nb, tonnage, pesees, bon, commentaire }
  save(e, by) {
    const date = String((e && e.date) || '');
    if (!ISO.test(date)) throw new Error('La date est obligatoire.');
    const matiere = String(e.matiere || '').trim();
    if (!matiere) throw new Error('La matière est obligatoire.');
    const id = e.id && /^[a-z0-9-]+$/i.test(e.id) ? e.id : newId();
    let ancien = null;
    try {
      ancien = JSON.parse(fs.readFileSync(this.fichier(id), 'utf8'));
    } catch { /* nouvelle pesée */ }
    const out = {
      id,
      date,
      matiere: matiere.slice(0, 40),
      nb: num(e.nb),
      tonnage: num(e.tonnage),
      pesees: Array.isArray(e.pesees) ? e.pesees.map(num).filter((v) => v != null) : [],
      bon: String(e.bon || '').trim().slice(0, 40),
      commentaire: String(e.commentaire || '').trim().slice(0, 200),
      creePar: (ancien && ancien.creePar) || by || '',
      creeLe: (ancien && ancien.creeLe) || new Date().toISOString(),
      ...(ancien ? { modifiePar: by || '', modifieLe: new Date().toISOString() } : {}),
    };
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.fichier(id);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return out;
  }

  delete(id) {
    fs.rmSync(this.fichier(id), { force: true });
    return true;
  }
}

module.exports = { Externes };
