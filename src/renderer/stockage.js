'use strict';

/* global S, M, h, icon, call, api, ask, toast, fmtNum, plural, promptText, invDialog, invDate */
// Vue « Stockage » : zones de stockage du site avec taux de remplissage
// (barre du vert au rouge) et commentaire, mis à jour en continu.

const stkState = { zones: [], loadedAt: 0 };

async function loadStockage() {
  try {
    stkState.zones = await call(api.stkList());
    stkState.loadedAt = Date.now();
  } catch {
    stkState.zones = [];
  }
  updateStkBadge();
  return stkState.zones;
}

const stkPlein = (z) => z.remplissage != null && z.remplissage >= M.SEUIL_ALERTE;

function updateStkBadge() {
  const b = document.getElementById('stk-badge');
  if (!b) return;
  const n = stkState.zones.filter(stkPlein).length;
  b.hidden = !n;
  b.textContent = n;
  b.title = n ? `${plural(n, 'zone')} à ${M.SEUIL_ALERTE} % ou plus` : '';
}

async function saveZone(zone, patch) {
  try {
    const saved = await call(api.stkSave({ ...zone, ...patch, par: S.user }));
    const i = stkState.zones.findIndex((z) => z.id === saved.id);
    if (i >= 0) stkState.zones[i] = saved;
    else stkState.zones.push(saved);
    updateStkBadge();
    return saved;
  } catch (err) {
    toast(`Non enregistré : ${err.message}`);
    return null;
  }
}

// Ne pas redessiner pendant une saisie dans la vue.
const stkEditing = () => {
  const a = document.activeElement;
  return a && a.closest && a.closest('#stockage') && /INPUT|TEXTAREA/.test(a.tagName);
};

async function renderStockage({ reload = true } = {}) {
  if (reload) await loadStockage();
  if (stkEditing()) return;
  const root = document.getElementById('stockage');
  const zones = stkState.zones;
  root.replaceChildren(
    h('div', { class: 'recap-head' }, h('h2', {}, `Stockage${S.siteName ? ` · ${S.siteName}` : ''}`), h('span', { class: 'spacer' }),
      h('span', { class: 'muted' }, `Remplissage en % · alerte à ${M.SEUIL_ALERTE} %`),
      h('button', { class: 'btn accent stk-new', onclick: addZone }, icon('plus', 16), 'Nouvelle zone')),
    zones.length
      ? h('div', { class: 'stk-grid' }, zones.map(zoneCard))
      : h('div', { class: 'j-empty' }, icon('box', 32), h('p', {}, 'Aucune zone de stockage.'),
        h('p', { class: 'muted' }, 'Ajoutez vos zones (ex. « Zone A – palettes », « Hangar »…) avec « Nouvelle zone ».')));
}

function zoneCard(z) {
  const bar = h('div', { class: 'stk-bar' }, h('i'));
  const paint = (v) => {
    bar.firstChild.style.width = `${Math.min(100, v || 0)}%`;
    bar.firstChild.style.background = v == null ? '' : M.fillColor(v);
    card.classList.toggle('plein', v != null && v >= M.SEUIL_ALERTE);
  };
  const pct = h('input', { type: 'text', inputMode: 'decimal', class: 'stk-pct', value: z.remplissage == null ? '' : fmtNum(z.remplissage), 'aria-label': `Remplissage ${z.nom}` });
  const range = h('input', { type: 'range', min: 0, max: 100, step: 5, value: z.remplissage ?? 0, 'aria-label': `Curseur ${z.nom}` });
  const commit = async (v) => {
    if (v === z.remplissage) return;
    const saved = await saveZone(z, { remplissage: v });
    if (saved) Object.assign(z, saved);
    meta.textContent = zoneMeta(z);
  };
  pct.addEventListener('input', () => {
    const v = parsePct(pct.value);
    if (!Number.isNaN(v)) { paint(v); range.value = v ?? 0; }
  });
  pct.addEventListener('change', () => {
    const v = parsePct(pct.value);
    if (Number.isNaN(v)) {
      toast('Remplissage invalide.');
      pct.value = z.remplissage == null ? '' : fmtNum(z.remplissage);
      return;
    }
    commit(v);
  });
  pct.addEventListener('keydown', (e) => { if (e.key === 'Enter') pct.blur(); });
  range.addEventListener('input', () => { pct.value = range.value; paint(Number(range.value)); });
  range.addEventListener('change', () => commit(Number(range.value)));
  const com = h('textarea', { rows: 2, placeholder: 'Commentaire (contenu, consignes…)', value: z.commentaire || '' });
  com.value = z.commentaire || '';
  com.addEventListener('change', async () => {
    const saved = await saveZone(z, { commentaire: com.value });
    if (saved) Object.assign(z, saved);
    meta.textContent = zoneMeta(z);
  });
  const meta = h('div', { class: 'muted stk-meta' }, zoneMeta(z));
  const card = h('div', { class: 'card stk-card' },
    h('div', { class: 'stk-head' },
      h('button', { class: 'inv-name', title: 'Renommer la zone', onclick: () => renameZone(z) }, z.nom),
      h('span', { class: 'spacer' }),
      h('button', { class: 'o-btn', title: 'Historique', 'aria-label': `Historique de ${z.nom}`, onclick: () => zoneHistory(z) }, icon('clock', 15)),
      h('button', { class: 'o-btn rm', title: 'Supprimer la zone', 'aria-label': `Supprimer ${z.nom}`, onclick: () => deleteZone(z) }, icon('x', 15))),
    h('div', { class: 'stk-fill' }, bar, h('div', { class: 'stk-val' }, pct, h('span', {}, '%'))),
    range, com, meta);
  paint(z.remplissage);
  return card;
}

function parsePct(text) {
  const t = String(text || '').trim().replace('%', '').replace(',', '.').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : NaN;
}

const zoneMeta = (z) => (z.majPar || z.majLe ? `Mis à jour ${invDate(z.majLe)}${z.majPar ? ` par ${z.majPar}` : ''}` : '');

async function addZone() {
  const nom = (await promptText('Nouvelle zone de stockage', 'Nom (ex. Zone A – palettes)', { text: 'La zone sera visible par tous les postes du site.' }) || '').trim();
  if (!nom) return;
  if (await saveZone({}, { nom, remplissage: null, commentaire: '' })) renderStockage({ reload: false });
}

async function renameZone(z) {
  const nom = (await promptText('Renommer la zone', z.nom) || '').trim();
  if (!nom || nom === z.nom) return;
  if (await saveZone(z, { nom })) renderStockage({ reload: false });
}

async function deleteZone(z) {
  if (await ask('Supprimer la zone ?', `« ${z.nom} » et son historique seront supprimés pour tous les postes du site.`,
    [{ label: 'Annuler', value: 'no' }, { label: 'Supprimer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
  try {
    await call(api.stkDelete(z.id));
  } catch (err) {
    toast(err.message);
  }
  renderStockage();
}

async function zoneHistory(z) {
  const hist = z.historique || [];
  await invDialog(`Historique · ${z.nom}`, (body) => {
    body.append(hist.length
      ? h('div', { class: 'inv-hist-box' }, h('table', { class: 'grid inv-hist' },
        h('thead', {}, h('tr', {}, ['Date', 'Remplissage', 'Par', 'Commentaire'].map((x) => h('th', {}, x)))),
        h('tbody', {}, hist.map((x) => h('tr', {},
          h('td', {}, invDate(x.date)),
          h('td', {}, x.remplissage == null ? '—' : h('b', { class: x.remplissage >= M.SEUIL_ALERTE ? 'red' : '' }, `${fmtNum(x.remplissage)} %`)),
          h('td', {}, x.par),
          h('td', { class: 'muted' }, x.commentaire))))))
      : h('div', { class: 'empty' }, 'Aucun historique pour cette zone.'));
    return async () => true;
  }, { okLabel: 'Fermer' });
}
