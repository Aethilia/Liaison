'use strict';

// Pastilles « Tâches » et « Commandes » de la saisie : les tâches sont propres à
// chaque service (le matin ne voit que les siennes) ; les commandes, une fois
// saisies, sont vues par tous les services (le service qui l'a saisie est noté). Rangées dans <données>/notes-service/,
// un fichier par entrée pour que plusieurs postes écrivent en même temps.
//  - tâche : { type: 'tache', service, texte, creePar, creeLe, validePar, valideLe }
//  - commande de bennes : { type: 'commande', service, matiere, nb, date, etat, creePar, creeLe, majPar, majLe }
//    etat : 'a-faire' | 'faite' | 'non-realisee' (on garde tout : historique)

const fs = require('fs');
const path = require('path');

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const ETATS_COMMANDE = ['a-faire', 'faite', 'non-realisee'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SERVICE = /^[a-z]{2,20}$/;

class NotesService {
  constructor(dir) {
    this.dir = path.join(dir, 'notes-service');
  }

  fichier(id) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Identifiant invalide.');
    return path.join(this.dir, `${id}.json`);
  }

  lire(id) {
    return JSON.parse(fs.readFileSync(this.fichier(id), 'utf8'));
  }

  ecrire(m) {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.fichier(m.id);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(m, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return m;
  }

  tout() {
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
      } catch { /* en cours d'écriture : ignoré */ }
    }
    return out;
  }

  // Tâches en cours et dernières validées du service ; commandes de tous les services (plus récentes d'abord).
  list(service, recents = 5) {
    const tout = this.tout();
    const taches = tout.filter((m) => m.type === 'tache' && m.service === service);
    const commandes = tout.filter((m) => m.type === 'commande')
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.creeLe).localeCompare(String(a.creeLe)));
    return {
      taches: taches.filter((m) => !m.valideLe).sort((a, b) => String(b.creeLe).localeCompare(String(a.creeLe))),
      tachesValidees: taches.filter((m) => m.valideLe).sort((a, b) => String(b.valideLe).localeCompare(String(a.valideLe))).slice(0, recents),
      commandes,
    };
  }

  ajouterTache(service, texte, by) {
    if (!SERVICE.test(service || '')) throw new Error('Service inconnu.');
    const t = String(texte || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!t) throw new Error('La tâche est vide.');
    return this.ecrire({ id: newId(), type: 'tache', service, texte: t, creePar: by || '', creeLe: new Date().toISOString(), validePar: '', valideLe: null });
  }

  validerTache(id, by) {
    const m = this.lire(id);
    if (m.valideLe) return m; // déjà validée par un autre poste
    return this.ecrire({ ...m, validePar: by || '', valideLe: new Date().toISOString() });
  }

  ajouterCommande(service, { matiere, date, nb } = {}, by) {
    if (!SERVICE.test(service || '')) throw new Error('Service inconnu.');
    const mat = String(matiere || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!mat) throw new Error('Indiquez la matière commandée.');
    if (!ISO.test(date || '')) throw new Error('Date de commande invalide.');
    const n = Math.round(Number(nb ?? 1));
    if (!(n >= 1 && n <= 99)) throw new Error('Nombre de bennes : de 1 à 99.');
    return this.ecrire({ id: newId(), type: 'commande', service, matiere: mat, nb: n, date, etat: 'a-faire', creePar: by || '', creeLe: new Date().toISOString(), majPar: '', majLe: null });
  }

  etatCommande(id, etat, by) {
    if (!ETATS_COMMANDE.includes(etat)) throw new Error('État inconnu.');
    const m = this.lire(id);
    return this.ecrire({ ...m, etat, majPar: by || '', majLe: new Date().toISOString() });
  }

  supprimer(id) {
    try {
      fs.unlinkSync(this.fichier(id));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return true;
  }
}

module.exports = { NotesService, ETATS_COMMANDE };
