'use strict';

// Accès au jeu caché : réservé à deux responsables, reconnus par l'empreinte
// de leur nom (les noms n'apparaissent pas en clair dans le programme).
// Chacun choisit son code secret ; il est rangé chiffré (PBKDF2 + sel) dans
// <dossier principal>/jeu/codes.json, commun aux sites et aux postes.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const normNom = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const empreinte = (n) => crypto.createHash('sha256').update(`liaison-jeu:${normNom(n)}`).digest('hex');

// Empreintes des joueurs (normNom puis sha256, voir empreinte()).
const JOUEURS = new Set([]);

// LIAISON_JEU_JOUEURS (noms séparés par des virgules) : essais uniquement.
const joueursEssai = () => String(process.env.LIAISON_JEU_JOUEURS || '').split(',').map((x) => x.trim()).filter(Boolean).map(empreinte);
const estJoueur = (nom) => !!normNom(nom) && (JOUEURS.has(empreinte(nom)) || joueursEssai().includes(empreinte(nom)));

const hacher = (code, sel) => crypto.pbkdf2Sync(String(code), sel, 60000, 32, 'sha256').toString('hex');
const codeValide = (code) => typeof code === 'string' && code.length >= 4 && code.length <= 20;

class Jeu {
  // dirs : dossiers principaux connus (le premier reçoit les écritures, tous sont relus).
  constructor(dirs) {
    this.dirs = [...new Set(dirs)].map((d) => path.join(d, 'jeu'));
  }

  lire(dir) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'codes.json'), 'utf8'));
      return j && typeof j.codes === 'object' && j.codes ? j : { codes: {} };
    } catch {
      return { codes: {} };
    }
  }

  fiche(nom) {
    const cle = empreinte(nom);
    for (const dir of this.dirs) {
      const f = this.lire(dir).codes[cle];
      if (f && f.sel && f.hash) return f;
    }
    return null;
  }

  statut(nom) {
    if (!estJoueur(nom)) return { joueur: false };
    return { joueur: true, code: !!this.fiche(nom) };
  }

  verifier(nom, code) {
    if (!estJoueur(nom)) return false;
    const f = this.fiche(nom);
    if (!f) return false;
    const a = Buffer.from(hacher(code || '', f.sel), 'hex');
    const b = Buffer.from(f.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // Premier code : libre. Changement : l'ancien code est demandé.
  definir(nom, code, ancien) {
    if (!estJoueur(nom)) throw new Error('Action impossible.');
    if (!codeValide(code)) throw new Error('Le code doit faire de 4 à 20 caractères.');
    if (this.fiche(nom) && !this.verifier(nom, ancien)) throw new Error('Ancien code incorrect.');
    const sel = crypto.randomBytes(16).toString('hex');
    const fiche = { sel, hash: hacher(code, sel), majLe: new Date().toISOString() };
    let ecrit = 0;
    for (const dir of this.dirs) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const j = this.lire(dir);
        j.codes[empreinte(nom)] = fiche;
        const file = path.join(dir, 'codes.json');
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(j, null, 2), 'utf8');
        fs.renameSync(tmp, file);
        ecrit += 1;
      } catch { /* dossier en lecture seule : on garde les autres */ }
    }
    if (!ecrit) throw new Error('Impossible d\'enregistrer le code (dossier commun inaccessible).');
    return true;
  }
}

// Profil de jeu (partie en cours, difficulté débloquée) et scores : dans le
// premier dossier principal joignable, un fichier par joueur.
Jeu.prototype.lireJson = function lireJson(nomFichier, defaut) {
  for (const dir of this.dirs) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, nomFichier), 'utf8'));
    } catch { /* suivant */ }
  }
  return defaut;
};
Jeu.prototype.ecrireJson = function ecrireJson(nomFichier, data) {
  let ecrit = 0;
  for (const dir of this.dirs) {
    try {
      const file = path.join(dir, nomFichier);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
      fs.renameSync(tmp, file);
      ecrit += 1;
    } catch { /* dossier inaccessible */ }
  }
  if (!ecrit) throw new Error('Sauvegarde impossible (dossier commun inaccessible).');
  return data;
};
Jeu.prototype.profil = function profil(nom) {
  if (!estJoueur(nom)) throw new Error('Action impossible.');
  return this.lireJson(path.join('joueurs', `${empreinte(nom)}.json`), { partie: null, diffMax: 1 });
};
Jeu.prototype.sauverProfil = function sauverProfil(nom, p) {
  if (!estJoueur(nom)) throw new Error('Action impossible.');
  const s = JSON.stringify(p || {});
  if (s.length > 2e6) throw new Error('Sauvegarde trop volumineuse.');
  return this.ecrireJson(path.join('joueurs', `${empreinte(nom)}.json`), { partie: p.partie || null, diffMax: Math.min(8, Math.max(1, Number(p.diffMax) || 1)) });
};
Jeu.prototype.scores = function scores() {
  const l = this.lireJson('scores.json', { scores: [] }).scores;
  return Array.isArray(l) ? l : [];
};
Jeu.prototype.ajouterScore = function ajouterScore(nom, sc) {
  if (!estJoueur(nom)) throw new Error('Action impossible.');
  const l = this.scores();
  l.push({
    joueur: normNom(nom).split(' ')[0].replace(/^./, (c) => c.toUpperCase()),
    score: Number(sc.score) || 0, etage: Number(sc.etage) || 0, endless: Number(sc.endless) || 0,
    difficulte: Number(sc.difficulte) || 1, gagne: !!sc.gagne, equipe: (sc.equipe || []).slice(0, 6).map(String), date: new Date().toISOString(),
  });
  // Toutes les parties sont gardées (les 500 dernières) pour le classement.
  this.ecrireJson('scores.json', { scores: l.slice(-500) });
  return l.slice(-500);
};

module.exports = { Jeu, estJoueur, empreinte, normNom };
