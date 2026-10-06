'use strict';

/* global S, h, icon, call, api, ask, toast, fmtNum, plural, normTxt */
// Vue « Inventaire » : articles créés par les utilisateurs, catégories
// personnalisables, mouvements (entrée, sortie, comptage) et alertes de seuil.

const INV_TYPES = {
  entree: { label: 'Entrée', sign: '+', icon: 'plus', cls: 'in' },
  sortie: { label: 'Sortie', sign: '−', icon: 'upload', cls: 'out' },
  comptage: { label: 'Comptage', sign: '=', icon: 'checkSquare', cls: 'count' },
};
const invState = { data: { categories: [], articles: [] }, q: '', filtre: 'toutes', loadedAt: 0 };

const invNum = (v) => {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};
const invQte = (v, unite) => `${fmtNum(v)}${unite ? ` ${unite}` : ''}`;
const invDate = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

async function loadInventaire() {
  try {
    invState.data = await call(api.invList());
    invState.loadedAt = Date.now();
  } catch {
    invState.data = { categories: [], articles: [] };
  }
  updateInvBadge();
  return invState.data;
}

function updateInvBadge() {
  const b = document.getElementById('inv-badge');
  if (!b) return;
  const n = invState.data.articles.filter((a) => a.alerte).length;
  b.hidden = !n;
  b.textContent = n;
  b.title = n ? `${plural(n, 'article')} sous le seuil d'alerte` : '';
}

async function renderInventaire({ reload = true } = {}) {
  if (reload) await loadInventaire();
  const root = document.getElementById('inventaire');
  if (!document.getElementById('inv-bar')) {
    root.replaceChildren(
      h('div', { class: 'recap-head' }, h('h2', { id: 'inv-title' }), h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: categoriesDialog }, icon('list', 15), 'Catégories'),
        h('button', { class: 'btn accent inv-new', onclick: () => articleDialog() }, icon('plus', 16), 'Nouvel article')),
      h('div', { class: 'journal-bar', id: 'inv-bar' },
        h('div', { class: 'search' }, icon('search', 16),
          h('input', { type: 'text', id: 'inv-q', placeholder: 'Rechercher un article…', value: invState.q, oninput: (e) => { invState.q = e.target.value; renderInventaire({ reload: false }); } })),
        h('div', { id: 'inv-chips', class: 'inv-chips' })),
      h('div', { id: 'inv-list' }));
  }
  const { categories, articles } = invState.data;
  document.getElementById('inv-title').textContent = `Inventaire${S.siteName ? ` · ${S.siteName}` : ''}`;

  // Filtres : toutes, chaque catégorie, sans catégorie, stock bas
  const count = (pred) => articles.filter(pred).length;
  const sansCat = count((a) => !a.categorie || !categories.some((c) => c.id === a.categorie));
  const chips = [
    ['toutes', `Toutes (${articles.length})`],
    ...categories.map((c) => [c.id, `${c.nom} (${count((a) => a.categorie === c.id)})`]),
    ...(sansCat ? [['sans', `Sans catégorie (${sansCat})`]] : []),
  ];
  const bas = count((a) => a.alerte);
  document.getElementById('inv-chips').replaceChildren(
    ...chips.map(([id, label]) => h('button', { class: `chip${invState.filtre === id ? ' on' : ''}`, onclick: () => { invState.filtre = id; renderInventaire({ reload: false }); } }, label)),
    bas ? h('button', { class: `chip red-chip${invState.filtre === 'bas' ? ' on' : ''}`, onclick: () => { invState.filtre = 'bas'; renderInventaire({ reload: false }); } }, icon('alert', 13), `Stock bas (${bas})`) : null);

  const words = normTxt(invState.q).split(/\s+/).filter(Boolean);
  const f = invState.filtre;
  const visible = articles.filter((a) => {
    if (f === 'bas' && !a.alerte) return false;
    if (f === 'sans' && a.categorie && categories.some((c) => c.id === a.categorie)) return false;
    if (!['toutes', 'bas', 'sans'].includes(f) && a.categorie !== f) return false;
    const hay = normTxt(`${a.nom} ${a.note} ${a.unite} ${(categories.find((c) => c.id === a.categorie) || {}).nom || ''}`);
    return words.every((w) => hay.includes(w));
  });

  const list = document.getElementById('inv-list');
  if (!articles.length) {
    list.replaceChildren(h('div', { class: 'j-empty' }, icon('box', 32),
      h('p', {}, 'L\'inventaire est vide.'),
      h('p', { class: 'muted' }, 'Créez d\'abord vos catégories (bouton « Catégories »), puis vos articles avec « Nouvel article ».')));
    return;
  }
  if (!visible.length) {
    list.replaceChildren(h('div', { class: 'j-empty' }, h('p', {}, 'Aucun article ne correspond.')));
    return;
  }
  // Regroupement par catégorie, dans l'ordre des catégories
  const groups = [...categories.map((c) => ({ id: c.id, nom: c.nom })), { id: null, nom: 'Sans catégorie' }]
    .map((g) => ({ ...g, items: visible.filter((a) => (g.id ? a.categorie === g.id : !a.categorie || !categories.some((c) => c.id === a.categorie))) }))
    .filter((g) => g.items.length);
  list.replaceChildren(...groups.map((g) => h('div', { class: 'card inv-group' },
    h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('box', 16)), g.nom, h('span', { class: 'hint' }, plural(g.items.length, 'article'))),
    h('div', { class: 'card-body' }, h('table', { class: 'grid inv-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Article'), h('th', {}, 'Stock'), h('th', {}, 'Seuil'), h('th', {}, 'Dernier mouvement'), h('th', {}, ''))),
      h('tbody', {}, g.items.map(articleRow)))))));
}

function articleRow(a) {
  const d = a.dernier;
  return h('tr', { class: a.alerte ? 'inv-low' : '' },
    h('td', {}, h('button', { class: 'inv-name', title: 'Modifier l\'article', onclick: () => articleDialog(a) }, a.nom),
      a.note ? h('div', { class: 'muted inv-note' }, a.note) : null),
    h('td', { class: 'inv-stock' }, a.alerte ? icon('alert', 14) : null, h('b', {}, fmtNum(a.stock)), a.unite ? h('span', { class: 'muted' }, ` ${a.unite}`) : null),
    h('td', { class: 'muted' }, a.seuil != null ? invQte(a.seuil, a.unite) : '—'),
    h('td', { class: 'muted inv-last' }, d ? `${INV_TYPES[d.type].label} ${INV_TYPES[d.type].sign}${fmtNum(d.quantite)} · ${invDate(d.date)}${d.par ? ` · ${d.par}` : ''}` : 'Aucun'),
    h('td', { class: 'inv-actions' },
      h('button', { class: 'btn small inv-in', title: 'Entrée de stock', onclick: () => movementDialog(a, 'entree') }, '+ Entrée'),
      h('button', { class: 'btn small inv-out', title: 'Sortie de stock', onclick: () => movementDialog(a, 'sortie') }, '− Sortie'),
      h('button', { class: 'btn small ghost', title: 'Corriger le stock après un comptage', onclick: () => movementDialog(a, 'comptage') }, '= Comptage'),
      h('button', { class: 'o-btn', title: 'Historique', 'aria-label': `Historique de ${a.nom}`, onclick: () => historyDialog(a) }, icon('clock', 16))));
}

// Fenêtre générique : `build(form)` remplit le formulaire, `onOk()` valide (renvoie false pour rester ouvert).
function invDialog(title, build, { okLabel = 'Enregistrer', extraButtons = [] } = {}) {
  let dlg = document.getElementById('inv-dialog');
  if (!dlg) {
    dlg = h('dialog', { id: 'inv-dialog' });
    document.body.append(dlg);
  }
  return new Promise((resolve) => {
    const body = h('div', { class: 'inv-form' });
    const ok = build(body);
    const form = h('form', {
      class: 'dialog-body', onsubmit: async (e) => {
        e.preventDefault();
        const r = await ok();
        if (r !== false) {
          dlg.close();
          resolve(r);
        }
      },
    },
    h('h2', {}, title), body,
    h('div', { class: 'dialog-actions' }, ...extraButtons.map((b) => h('button', { type: 'button', class: `btn ${b.cls || 'ghost'}`, onclick: async () => { if (await b.onClick() !== false) { dlg.close(); resolve(null); } } }, b.label)),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { dlg.close(); resolve(null); } }, 'Annuler'),
      h('button', { type: 'submit', class: 'btn primary' }, okLabel)));
    dlg.replaceChildren(form);
    dlg.showModal();
    const first = form.querySelector('input, select, textarea');
    if (first) first.focus();
  });
}

const field2 = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);

async function articleDialog(article = null) {
  const a = article || { nom: '', categorie: invState.filtre && !['toutes', 'bas', 'sans'].includes(invState.filtre) ? invState.filtre : null, unite: '', seuil: null, note: '' };
  const units = [...new Set(invState.data.articles.map((x) => x.unite).filter(Boolean))].sort();
  const els = {};
  const saved = await invDialog(article ? `Modifier « ${article.nom} »` : 'Nouvel article', (body) => {
    els.nom = h('input', { type: 'text', value: a.nom, required: true, placeholder: 'ex. Gants anti-coupure' });
    els.cat = h('select', {}, h('option', { value: '' }, 'Sans catégorie'),
      invState.data.categories.map((c) => h('option', { value: c.id, selected: c.id === a.categorie }, c.nom)));
    els.unite = h('input', { type: 'text', value: a.unite, placeholder: 'ex. paires, rouleaux, L, kg…', list: 'inv-units' });
    els.seuil = h('input', { type: 'text', inputMode: 'decimal', value: a.seuil != null ? fmtNum(a.seuil) : '', placeholder: 'Laisser vide pour aucune alerte' });
    els.note = h('input', { type: 'text', value: a.note, placeholder: 'Emplacement, référence fournisseur… (facultatif)' });
    body.append(
      field2('Nom de l\'article', els.nom),
      h('div', { class: 'row' }, field2('Catégorie', els.cat), field2('Unité', els.unite)),
      h('datalist', { id: 'inv-units' }, units.map((u) => h('option', { value: u }))),
      field2('Seuil d\'alerte', els.seuil, 'Une alerte discrète s\'affiche quand le stock descend à ce niveau ou en dessous.'),
      field2('Note', els.note));
    return async () => {
      const seuil = invNum(els.seuil.value);
      if (Number.isNaN(seuil)) {
        toast('Seuil invalide.');
        return false;
      }
      try {
        return await call(api.invSaveArticle({ ...a, nom: els.nom.value, categorie: els.cat.value || null, unite: els.unite.value, seuil, note: els.note.value, par: S.user }));
      } catch (err) {
        toast(err.message);
        return false;
      }
    };
  }, {
    extraButtons: article ? [{
      label: 'Supprimer', cls: 'danger', onClick: async () => {
        if (await ask('Supprimer l\'article ?', `« ${article.nom} » et tout son historique seront supprimés pour tous les postes du site.`,
          [{ label: 'Annuler', value: 'no' }, { label: 'Supprimer', value: 'yes', cls: 'danger' }]) !== 'yes') return false;
        await call(api.invDeleteArticle(article.id));
        toast(`« ${article.nom} » supprimé.`);
        renderInventaire();
        return true;
      },
    }] : [],
  });
  if (saved) {
    toast(article ? 'Article modifié.' : `« ${saved.nom} » ajouté à l'inventaire.`);
    renderInventaire();
  }
}

const pad2 = (n) => String(n).padStart(2, '0');
const localDateTime = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

async function movementDialog(article, type) {
  const t = INV_TYPES[type];
  const els = {};
  const saved = await invDialog(`${t.label} · ${article.nom}`, (body) => {
    els.q = h('input', { type: 'text', inputMode: 'decimal', required: true, placeholder: type === 'comptage' ? 'Quantité réellement comptée' : 'Quantité' });
    els.date = h('input', { type: 'datetime-local', value: localDateTime() });
    els.com = h('input', { type: 'text', placeholder: type === 'sortie' ? 'ex. distribué à l\'équipe de nuit' : type === 'entree' ? 'ex. livraison fournisseur' : 'ex. inventaire mensuel' });
    body.append(
      h('div', { class: 'inv-current' }, 'Stock actuel : ', h('b', {}, invQte(article.stock, article.unite)),
        type === 'comptage' ? h('span', { class: 'muted' }, ' — le stock sera remplacé par la quantité comptée.') : null),
      h('div', { class: 'row' }, field2(type === 'comptage' ? `Quantité comptée${article.unite ? ` (${article.unite})` : ''}` : `Quantité${article.unite ? ` (${article.unite})` : ''}`, els.q), field2('Date', els.date)),
      field2('Commentaire (facultatif)', els.com));
    return async () => {
      const q = invNum(els.q.value);
      if (q == null || Number.isNaN(q) || q < 0) {
        toast('Quantité invalide.');
        return false;
      }
      try {
        return await call(api.invAddMovement({ article: article.id, type, quantite: q, date: els.date.value ? new Date(els.date.value).toISOString() : null, commentaire: els.com.value, par: S.user }));
      } catch (err) {
        toast(err.message);
        return false;
      }
    };
  }, { okLabel: t.label });
  if (saved) {
    await renderInventaire();
    const a = invState.data.articles.find((x) => x.id === article.id);
    toast(a && a.alerte ? `⚠ ${a.nom} : stock bas (${invQte(a.stock, a.unite)}).` : `Mouvement enregistré (${t.label.toLowerCase()}).`);
  }
}

async function categoriesDialog() {
  const rows = invState.data.categories.map((c) => ({ ...c }));
  let listEl;
  const draw = () => listEl.replaceChildren(...(rows.length ? rows.map((c, i) => h('div', { class: 'row inv-cat-row' },
    h('input', { type: 'text', value: c.nom, oninput: (e) => { c.nom = e.target.value; } }),
    h('button', { type: 'button', class: 'o-btn rm', title: 'Supprimer la catégorie (les articles restent, sans catégorie)', onclick: () => { rows.splice(i, 1); draw(); } }, icon('x', 15))))
    : [h('div', { class: 'empty' }, 'Aucune catégorie.')]));
  const saved = await invDialog('Catégories de l\'inventaire', (body) => {
    listEl = h('div', { class: 'inv-cats' });
    draw();
    const add = h('input', { type: 'text', placeholder: 'Nouvelle catégorie (ex. EPI, Consommables…)' });
    const doAdd = () => {
      if (add.value.trim()) rows.push({ nom: add.value.trim() });
      add.value = '';
      draw();
      add.focus();
    };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
    body.append(listEl, h('div', { class: 'row' }, add, h('button', { type: 'button', class: 'btn ghost', onclick: doAdd }, 'Ajouter')),
      h('small', { class: 'muted' }, 'Renommer : modifier le nom. Supprimer : la croix (les articles passent « Sans catégorie »).'));
    return async () => call(api.invSaveCategories(rows));
  });
  if (saved) {
    toast('Catégories enregistrées.');
    renderInventaire();
  }
}

async function historyDialog(article) {
  let history = await call(api.invHistory(article.id)).catch(() => []);
  let tableEl;
  const draw = () => tableEl.replaceChildren(...(history.length ? [h('table', { class: 'grid inv-hist' },
    h('thead', {}, h('tr', {}, ['Date', 'Mouvement', 'Stock après', 'Par', 'Commentaire', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, history.map((m) => h('tr', {},
      h('td', {}, invDate(m.date)),
      h('td', {}, h('span', { class: `inv-type ${INV_TYPES[m.type].cls}` }, `${INV_TYPES[m.type].label} ${INV_TYPES[m.type].sign}${fmtNum(m.quantite)}`)),
      h('td', {}, h('b', {}, invQte(m.stockApres, article.unite))),
      h('td', {}, m.par),
      h('td', { class: 'muted' }, m.commentaire),
      h('td', {}, h('button', {
        type: 'button', class: 'o-btn rm', title: 'Annuler ce mouvement (erreur de saisie)', onclick: async () => {
          if (await ask('Supprimer ce mouvement ?', 'Le stock sera recalculé sans lui.', [{ label: 'Annuler', value: 'no' }, { label: 'Supprimer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
          await call(api.invDeleteMovement(m.id));
          history = await call(api.invHistory(article.id)).catch(() => []);
          draw();
          renderInventaire();
        },
      }, icon('trash', 14)))))))] : [h('div', { class: 'empty' }, 'Aucun mouvement pour cet article.')]));
  await invDialog(`Historique · ${article.nom}`, (body) => {
    tableEl = h('div', { class: 'inv-hist-box' });
    draw();
    body.append(tableEl);
    return async () => true;
  }, { okLabel: 'Fermer' });
}
