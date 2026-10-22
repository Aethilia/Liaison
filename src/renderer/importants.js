'use strict';

/* global S, h, icon, call, api, toast, plural */
// « Important » : messages laissés par un responsable, visibles dans la saisie
// de tous les services jusqu'à ce qu'un responsable les valide. Une pastille
// dans la barre du haut (rouge s'il y en a), la liste au clic, et un fin
// liseré rouge le long de la saisie.

const impState = { actifs: [], valides: [], ouvert: false };

const impQuand = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à ') : '');

async function loadImportants() {
  try {
    const r = await call(api.impList());
    const avant = impState.actifs.map((m) => m.id).join();
    impState.actifs = r.actifs;
    impState.valides = r.valides;
    return avant !== impState.actifs.map((m) => m.id).join();
  } catch {
    return false;
  }
}

function renderImportants() {
  const zone = document.getElementById('imp-zone');
  if (!zone) return;
  const visible = S.screen === 'app' && S.view === 'saisie';
  zone.hidden = !visible;
  const form = document.getElementById('form');
  if (form) form.classList.toggle('imp-liseré', visible && impState.actifs.length > 0);
  if (!visible) { impState.ouvert = false; zone.replaceChildren(); return; }
  const n = impState.actifs.length;
  const pastille = h('button', {
    class: `imp-pill${n ? ' actif' : ''}`, title: n ? 'Messages importants à valider' : 'Laisser un message important',
    'aria-expanded': String(impState.ouvert),
    onclick: (e) => { e.stopPropagation(); impState.ouvert = !impState.ouvert; renderImportants(); if (impState.ouvert) setTimeout(() => { const i = zone.querySelector('.imp-pop input'); if (i && !n) i.focus(); }); },
  }, n ? [h('i', { class: 'imp-point' }), `${n} ${n > 1 ? 'importants' : 'important'}`] : [icon('flag', 13), 'Important']);
  const enfants = [pastille];
  if (impState.ouvert) {
    const champ = h('input', { type: 'text', placeholder: 'Nouveau message important…', maxLength: 300 });
    const ajouter = async () => {
      const t = champ.value.trim();
      if (!t) return;
      try {
        await call(api.impAjouter(t, S.user));
        champ.value = '';
        await loadImportants();
        renderImportants();
      } catch (err) {
        toast(`Non enregistré : ${err.message}`);
      }
    };
    champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ajouter(); } if (e.key === 'Escape') { impState.ouvert = false; renderImportants(); } });
    enfants.push(h('div', { class: 'imp-pop', onclick: (e) => e.stopPropagation() },
      n ? h('div', { class: 'imp-liste' }, impState.actifs.map((m) => h('div', { class: 'imp-it' },
        h('p', {}, m.texte, h('small', {}, `${m.creePar || '?'} · ${impQuand(m.creeLe)}`)),
        h('button', { class: 'btn small', title: 'Valider : le message disparaît pour tout le monde', onclick: async () => {
          try {
            await call(api.impValider(m.id, S.user));
            await loadImportants();
            if (!impState.actifs.length) impState.ouvert = false;
            renderImportants();
            toast('Message validé.');
          } catch (err) {
            toast(`Non validé : ${err.message}`);
          }
        } }, icon('check', 13), 'Valider'))))
        : h('p', { class: 'muted imp-vide' }, 'Aucun message en cours.'),
      h('div', { class: 'imp-ajout' }, champ, h('button', { class: 'btn small primary', onclick: ajouter }, icon('plus', 13), 'Ajouter')),
      impState.valides.length ? h('details', { class: 'imp-valides' }, h('summary', {}, `Validés récemment (${impState.valides.length})`),
        impState.valides.map((m) => h('div', { class: 'imp-it fait' }, h('p', {}, m.texte, h('small', {}, `validé par ${m.validePar || '?'} · ${impQuand(m.valideLe)}`))))) : null));
  }
  zone.replaceChildren(...enfants);
}

// Fermeture de la liste au clic ailleurs ou avec Échap.
document.addEventListener('click', () => { if (impState.ouvert) { impState.ouvert = false; renderImportants(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && impState.ouvert) { impState.ouvert = false; renderImportants(); } });
