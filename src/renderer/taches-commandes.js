'use strict';

/* global S, M, SVC, h, icon, call, api, toast, impQuand, fmtShortDate */
// Pastilles « Tâches » et « Commandes » à côté de « Important ».
//  - Tâches : comme « Important » (on ajoute, on valide), mais pour le service affiché seulement.
//  - Commandes : historique des commandes (matière, date), à faire / faite / non réalisée,
//    vu par tous les services une fois saisi (le service qui l'a saisie est indiqué).

const nsvState = { service: null, taches: [], tachesValidees: [], commandes: [], ouvert: null };
const ETATS_CMD = [
  { id: 'a-faire', label: 'À faire', cls: 'afaire' },
  { id: 'faite', label: 'Faite', cls: 'faite' },
  { id: 'non-realisee', label: 'Non réalisée', cls: 'nonrea' },
];

async function loadNotesService() {
  const service = S.service;
  if (!service) return false;
  try {
    const r = await call(api.nsvList(service));
    const avant = JSON.stringify([nsvState.service, nsvState.taches.map((m) => m.id), nsvState.commandes.map((m) => `${m.id}${m.etat}`)]);
    Object.assign(nsvState, { service, taches: r.taches, tachesValidees: r.tachesValidees, commandes: r.commandes });
    return avant !== JSON.stringify([service, r.taches.map((m) => m.id), r.commandes.map((m) => `${m.id}${m.etat}`)]);
  } catch {
    return false;
  }
}

async function renderNotesService() {
  const zone = document.getElementById('nsv-zone');
  if (!zone) return;
  const visible = S.screen === 'app' && S.view === 'saisie';
  zone.hidden = !visible;
  if (!visible) { nsvState.ouvert = null; zone.replaceChildren(); return; }
  if (nsvState.service !== S.service) { nsvState.ouvert = null; await loadNotesService(); }
  const basculer = (quoi) => (e) => {
    e.stopPropagation();
    nsvState.ouvert = nsvState.ouvert === quoi ? null : quoi;
    renderNotesService();
    if (nsvState.ouvert) setTimeout(() => { const i = zone.querySelector('.nsv-pop input'); if (i) i.focus(); });
  };
  const nT = nsvState.taches.length;
  const nC = nsvState.commandes.filter((c) => c.etat === 'a-faire').length;
  const enfants = [
    h('button', { class: `imp-pill nsv-pill nsv-taches${nT ? ' actif' : ''}`, title: 'Tâches de ce service (visibles par ce service seulement)', 'aria-expanded': String(nsvState.ouvert === 'taches'), onclick: basculer('taches') },
      icon('checkSquare', 13), nT ? `${nT} ${nT > 1 ? 'tâches' : 'tâche'}` : 'Tâches'),
    h('button', { class: `imp-pill nsv-pill nsv-cmd${nC ? ' actif' : ''}`, title: 'Commandes (vues par tous les services) : à faire, faites, non réalisées', 'aria-expanded': String(nsvState.ouvert === 'commandes'), onclick: basculer('commandes') },
      icon('box', 13), nC ? `${nC} ${nC > 1 ? 'commandes' : 'commande'} à faire` : 'Commandes'),
  ];
  const svc = (M.SERVICES.find((d) => d.id === S.service) || {}).label || '';
  if (nsvState.ouvert === 'taches') enfants.push(popTaches(svc));
  if (nsvState.ouvert === 'commandes') enfants.push(popCommandes(svc));
  zone.replaceChildren(...enfants);
}

async function nsvAction(promesse, ok) {
  try {
    await call(promesse);
    await loadNotesService();
    renderNotesService();
    if (ok) toast(ok);
  } catch (err) {
    toast(`Non enregistré : ${err.message}`);
  }
}

function popTaches(svc) {
  const champ = h('input', { type: 'text', placeholder: 'Nouvelle tâche…', maxLength: 300 });
  const ajouter = () => { const t = champ.value.trim(); if (t) nsvAction(api.nsvAjouterTache(S.service, t, S.user)); };
  champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ajouter(); } });
  return h('div', { class: 'imp-pop nsv-pop', onclick: (e) => e.stopPropagation() },
    h('div', { class: 'nsv-titre' }, `Tâches · ${svc}`, h('small', {}, 'visibles par ce service seulement')),
    nsvState.taches.length ? h('div', { class: 'imp-liste' }, nsvState.taches.map((m) => h('div', { class: 'imp-it' },
      h('p', {}, m.texte, h('small', {}, `${m.creePar || '?'} · ${impQuand(m.creeLe)}`)),
      h('button', { class: 'btn small', title: 'Valider : la tâche disparaît', onclick: () => nsvAction(api.nsvValiderTache(m.id, S.user), 'Tâche validée.') }, icon('check', 13), 'Valider'))))
      : h('p', { class: 'muted imp-vide' }, 'Aucune tâche en cours.'),
    h('div', { class: 'imp-ajout' }, champ, h('button', { class: 'btn small primary', onclick: ajouter }, icon('plus', 13), 'Ajouter')),
    nsvState.tachesValidees.length ? h('details', { class: 'imp-valides' }, h('summary', {}, `Validées récemment (${nsvState.tachesValidees.length})`),
      nsvState.tachesValidees.map((m) => h('div', { class: 'imp-it fait' }, h('p', {}, m.texte, h('small', {}, `validée par ${m.validePar || '?'} · ${impQuand(m.valideLe)}`))))) : null);
}

function popCommandes(svc) {
  const auj = new Date().toLocaleDateString('fr-CA');
  const deja = [...new Set(nsvState.commandes.map((c) => c.matiere))];
  const matiere = h('input', { type: 'text', placeholder: 'Matière commandée (ex. Big-bags)', maxLength: 80, list: 'nsv-matieres' });
  const date = h('input', { type: 'date', value: auj, 'aria-label': 'Date de la commande' });
  const ajouter = () => {
    const m = matiere.value.trim();
    if (!m) { matiere.focus(); return; }
    nsvAction(api.nsvAjouterCommande(S.service, { matiere: m, date: date.value || auj }, S.user), 'Commande ajoutée.');
  };
  matiere.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ajouter(); } });
  const ligne = (c) => {
    const etat = ETATS_CMD.find((x) => x.id === c.etat) || ETATS_CMD[0];
    return h('div', { class: `nsv-cmd-it ${etat.cls}` },
      h('div', { class: 'nsv-cmd-txt' }, h('b', {}, c.matiere),
        h('small', {}, `${c.service !== S.service && SVC[c.service] ? `${SVC[c.service].label} · ` : ''}commandée le ${fmtShortDate(c.date)}${c.majLe ? ` · ${etat.label.toLowerCase()} (${c.majPar || '?'}, ${impQuand(c.majLe)})` : ` · ${c.creePar || '?'}`}`)),
      h('div', { class: 'nsv-etats', role: 'group', 'aria-label': `État de la commande ${c.matiere}` }, ETATS_CMD.map((x) => h('button', {
        class: `nsv-etat ${x.cls}${x.id === c.etat ? ' on' : ''}`, 'aria-pressed': String(x.id === c.etat),
        onclick: () => { if (x.id !== c.etat) nsvAction(api.nsvEtatCommande(c.id, x.id, S.user)); },
      }, x.label))),
      h('button', { class: 'o-btn rm', title: 'Supprimer (erreur de saisie)', onclick: () => nsvAction(api.nsvSupprimer(c.id), 'Commande supprimée.') }, icon('x', 12)));
  };
  return h('div', { class: 'imp-pop nsv-pop nsv-pop-cmd', onclick: (e) => e.stopPropagation() },
    h('div', { class: 'nsv-titre' }, 'Commandes', h('small', {}, 'historique · vu par tous les services')),
    h('datalist', { id: 'nsv-matieres' }, [...new Set([...deja, ...M.matieresDuSite()])].map((n) => h('option', { value: n }))),
    h('div', { class: 'imp-ajout nsv-ajout-cmd' }, matiere, date, h('button', { class: 'btn small primary', onclick: ajouter }, icon('plus', 13), 'Ajouter')),
    nsvState.commandes.length ? h('div', { class: 'nsv-cmd-liste' }, nsvState.commandes.map(ligne)) : h('p', { class: 'muted imp-vide' }, 'Aucune commande pour ce service.'));
}

// Fermeture au clic ailleurs ou avec Échap.
document.addEventListener('click', () => { if (nsvState.ouvert) { nsvState.ouvert = null; renderNotesService(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nsvState.ouvert) { nsvState.ouvert = null; renderNotesService(); } });
