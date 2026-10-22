'use strict';

// Messages « Important » d'un site : affichés dans la saisie de tous les
// services jusqu'à ce qu'un responsable les valide. Rangés dans
// <données>/importants/, un fichier par message (plusieurs postes en même temps).

const fs = require('fs');
const path = require('path');

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

class Importants {
  constructor(dir) {
    this.dir = path.join(dir, 'importants');
  }

  fichier(id) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Identifiant invalide.');
    return path.join(this.dir, `${id}.json`);
  }

  ecrire(m) {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.fichier(m.id);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(m, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return m;
  }

  // Messages en cours, puis les derniers validés (`recents`).
  list(recents = 5) {
    let noms;
    try {
      noms = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch (err) {
      if (err.code === 'ENOENT') return { actifs: [], valides: [] };
      throw err;
    }
    const tous = [];
    for (const f of noms) {
      try {
        tous.push(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')));
      } catch { /* en cours d'écriture : ignoré */ }
    }
    const actifs = tous.filter((m) => !m.valideLe).sort((a, b) => String(b.creeLe).localeCompare(String(a.creeLe)));
    const valides = tous.filter((m) => m.valideLe).sort((a, b) => String(b.valideLe).localeCompare(String(a.valideLe))).slice(0, recents);
    return { actifs, valides };
  }

  ajouter(texte, by) {
    const t = String(texte || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!t) throw new Error('Le message est vide.');
    return this.ecrire({ id: newId(), texte: t, creePar: by || '', creeLe: new Date().toISOString(), validePar: '', valideLe: null });
  }

  valider(id, by) {
    const m = JSON.parse(fs.readFileSync(this.fichier(id), 'utf8'));
    if (m.valideLe) return m; // déjà validé par un autre poste
    return this.ecrire({ ...m, validePar: by || '', valideLe: new Date().toISOString() });
  }
}

module.exports = { Importants };
