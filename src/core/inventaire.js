'use strict';

// Inventaire d'un site, indépendant de la main courante. Rangé dans
// <données>/inventaire/ : categories.json, un fichier par article
// (articles/<id>.json) et un fichier par mouvement (mouvements/<id>.json),
// pour que plusieurs postes puissent saisir en même temps sans se gêner.

const fs = require('fs');
const path = require('path');

const TYPES = ['entree', 'sortie', 'comptage'];
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v) => Math.round(v * 1000) / 1000;

// Stock courant à partir des mouvements, dans l'ordre chronologique :
// entrée = +q, sortie = −q, comptage = le stock devient q.
function computeStock(mouvements) {
  let stock = 0;
  const sorted = [...mouvements].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.creeLe).localeCompare(String(b.creeLe)));
  const history = sorted.map((m) => {
    if (m.type === 'entree') stock += m.quantite;
    else if (m.type === 'sortie') stock -= m.quantite;
    else if (m.type === 'comptage') stock = m.quantite;
    stock = round(stock);
    return { ...m, stockApres: stock };
  });
  return { stock, history };
}

class Inventaire {
  constructor(dir) {
    this.dir = path.join(dir, 'inventaire');
  }

  file(...parts) {
    return path.join(this.dir, ...parts);
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

  readDir(sub) {
    let names;
    try {
      names = fs.readdirSync(this.file(sub));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const out = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(this.file(sub, n), 'utf8')));
      } catch { /* fichier en cours d'écriture : relu au prochain passage */ }
    }
    return out;
  }

  checkId(id) {
    if (!/^[a-z0-9-]+$/i.test(String(id))) throw new Error(`Identifiant invalide : ${id}`);
    return id;
  }

  // ---- Catégories (personnalisables) ----
  loadCategories() {
    const list = this.readJson(this.file('categories.json'), { categories: [] }).categories;
    return Array.isArray(list) ? list.filter((c) => c && c.id && c.nom) : [];
  }

  // `categories` : [{ id?, nom }] dans l'ordre voulu ; une catégorie retirée
  // laisse ses articles « Sans catégorie ».
  saveCategories(categories) {
    const seen = new Set();
    const clean = [];
    for (const c of categories) {
      const nom = String(c.nom || '').trim();
      if (!nom || seen.has(nom.toLowerCase())) continue;
      seen.add(nom.toLowerCase());
      clean.push({ id: c.id ? this.checkId(c.id) : newId(), nom });
    }
    this.writeJson(this.file('categories.json'), { categories: clean });
    const ids = new Set(clean.map((c) => c.id));
    for (const a of this.readDir('articles')) {
      if (a.categorie && !ids.has(a.categorie)) this.writeJson(this.file('articles', `${a.id}.json`), { ...a, categorie: null });
    }
    return clean;
  }

  // ---- Articles ----
  saveArticle(article, by) {
    const nom = String(article.nom || '').trim();
    if (!nom) throw new Error('Le nom de l\'article est obligatoire.');
    const id = article.id ? this.checkId(article.id) : newId();
    const current = this.readJson(this.file('articles', `${id}.json`), {});
    const out = {
      ...current,
      id,
      nom,
      categorie: article.categorie || null,
      unite: String(article.unite || '').trim(),
      seuil: num(article.seuil),
      note: String(article.note || '').trim(),
      creeLe: current.creeLe || new Date().toISOString(),
      creePar: current.creePar || by || '',
      majLe: new Date().toISOString(),
    };
    return this.writeJson(this.file('articles', `${id}.json`), out);
  }

  // Supprime l'article et son historique.
  deleteArticle(id) {
    this.checkId(id);
    for (const m of this.readDir('mouvements')) {
      if (m.article === id) fs.rmSync(this.file('mouvements', `${m.id}.json`), { force: true });
    }
    fs.rmSync(this.file('articles', `${id}.json`), { force: true });
    return true;
  }

  // ---- Mouvements ----
  addMovement({ article, type, quantite, date, commentaire }, by) {
    this.checkId(article);
    if (!TYPES.includes(type)) throw new Error(`Type de mouvement inconnu : ${type}`);
    const q = num(quantite);
    if (q == null || q < 0) throw new Error('Quantité invalide.');
    if (!fs.existsSync(this.file('articles', `${article}.json`))) throw new Error('Article introuvable (supprimé depuis un autre poste ?).');
    const m = {
      id: newId(), article, type, quantite: q,
      date: date || new Date().toISOString(), commentaire: String(commentaire || '').trim(),
      par: by || '', creeLe: new Date().toISOString(),
    };
    return this.writeJson(this.file('mouvements', `${m.id}.json`), m);
  }

  deleteMovement(id) {
    fs.rmSync(this.file('mouvements', `${this.checkId(id)}.json`), { force: true });
    return true;
  }

  history(articleId) {
    return computeStock(this.readDir('mouvements').filter((m) => m.article === articleId)).history.reverse();
  }

  // Vue d'ensemble : catégories, articles avec stock courant et alerte de seuil.
  list() {
    const categories = this.loadCategories();
    const byArticle = new Map();
    for (const m of this.readDir('mouvements')) {
      if (!byArticle.has(m.article)) byArticle.set(m.article, []);
      byArticle.get(m.article).push(m);
    }
    const articles = this.readDir('articles').map((a) => {
      const mv = byArticle.get(a.id) || [];
      const { stock, history } = computeStock(mv);
      const dernier = history[history.length - 1] || null;
      return { ...a, stock, mouvements: mv.length, dernier, alerte: a.seuil != null && stock <= a.seuil };
    }).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    return { categories, articles };
  }
}

module.exports = { Inventaire, computeStock, TYPES };
