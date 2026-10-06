'use strict';

// Zones de stockage d'un site : taux de remplissage et commentaire, mis à jour
// en continu (indépendant des services). Un fichier par zone dans
// <données>/stockage/ pour que plusieurs postes puissent saisir en même temps.

const fs = require('fs');
const path = require('path');

const HISTORIQUE_MAX = 30;
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

class Stockage {
  constructor(dir) {
    this.dir = path.join(dir, 'stockage');
  }

  file(id) {
    if (!/^[a-z0-9-]+$/i.test(String(id))) throw new Error(`Identifiant invalide : ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  read(id) {
    try {
      return JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  list() {
    let names;
    try {
      names = fs.readdirSync(this.dir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const out = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(this.dir, n), 'utf8')));
      } catch { /* fichier en cours d'écriture : relu au prochain passage */ }
    }
    return out.sort((a, b) => String(a.creeLe).localeCompare(String(b.creeLe)));
  }

  // Crée ou met à jour une zone ; chaque changement de remplissage ou de
  // commentaire est gardé dans un court historique.
  saveZone(zone, by) {
    const nom = String(zone.nom || '').trim();
    if (!nom) throw new Error('Le nom de la zone est obligatoire.');
    const id = zone.id || newId();
    const current = (zone.id && this.read(id)) || {};
    let remplissage = zone.remplissage;
    if (remplissage === '' || remplissage === undefined) remplissage = null;
    if (remplissage != null) {
      remplissage = Number(remplissage);
      if (!Number.isFinite(remplissage) || remplissage < 0) throw new Error('Remplissage invalide.');
      remplissage = Math.round(remplissage * 10) / 10;
    }
    const commentaire = String(zone.commentaire || '').trim();
    const now = new Date().toISOString();
    const changed = !zone.id || current.remplissage !== remplissage || (current.commentaire || '') !== commentaire;
    const historique = [...(current.historique || [])];
    if (changed && (remplissage != null || commentaire)) {
      historique.unshift({ date: now, par: by || '', remplissage, commentaire });
      historique.length = Math.min(historique.length, HISTORIQUE_MAX);
    }
    const out = {
      ...current,
      id,
      nom,
      remplissage,
      commentaire,
      historique,
      creeLe: current.creeLe || now,
      majLe: changed ? now : current.majLe || now,
      majPar: changed ? by || '' : current.majPar || '',
    };
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file(id)}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
    fs.renameSync(tmp, this.file(id));
    return out;
  }

  deleteZone(id) {
    fs.rmSync(this.file(id), { force: true });
    return true;
  }
}

module.exports = { Stockage };
