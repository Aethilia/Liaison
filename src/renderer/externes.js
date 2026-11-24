'use strict';

/* global S, M, h, icon, call, api, ask, toast, fmtNum, fmtTon, fmtShortDate, plural */
// Vue « Services externes » : les sorties gérées par un service externe
// (Bois, Matelas…) n'ont qu'un nombre de bennes dans la main courante ; le
// poids arrive plus tard. On le saisit ici, avec la date de l'enlèvement.

const extState = { mois: null, entrees: [], jours: [], loadedAt: 0 };

const extCle = (date, matiere) => `${date}|${matiere.toLowerCase()}`;

async function loadExternes() {
  try {
    extState.entrees = await call(api.extList());
  } catch {
    extState.entrees = [];
  }
  extState.loadedAt = Date.now();
  return extState.entrees;
}

// Enlèvements externes d'une liste de jours : { date, matiere, nb, services }.
function enlevementsExternes(jours) {
  const map = new Map();
  for (const d of jours) {
    for (const def of M.SERVICES) {
      const s = d.services[def.id];
      if (!s) continue;
      for (const r of M.allSorties(s)) {
        if (!r.externe || !(r.data.nb > 0)) continue;
        const k = extCle(d.date, r.nom);
        const e = map.get(k) || { date: d.date, matiere: r.nom, nb: 0, services: [] };
        e.nb += r.data.nb;
        e.services.push(def.label);
        map.set(k, e);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || a.matiere.localeCompare(b.matiere, 'fr'));
}

const peseesDe = (date, matiere) => extState.entrees.filter((e) => extCle(e.date, e.matiere) === extCle(date, matiere));

// Nombre d'enlèvements sans poids (mois en cours et précédent) : badge de l'onglet.
async function majBadgeExternes() {
  const b = document.getElementById('ext-badge');
  if (!b) return;
  try {
    const auj = new Date();
    const prec = new Date(auj.getFullYear(), auj.getMonth() - 1, 1);
    const jours = [...await call(api.loadMonth(prec.getFullYear(), prec.getMonth() + 1)), ...await call(api.loadMonth(auj.getFullYear(), auj.getMonth() + 1))];
    if (!extState.loadedAt) await loadExternes();
    const n = enlevementsExternes(jours).filter((e) => !peseesDe(e.date, e.matiere).length).length;
    b.hidden = !n;
    b.textContent = n;
    b.title = n ? `${plural(n, 'enlèvement')} externe(s) en attente de poids` : '';
  } catch {
    b.hidden = true;
  }
}

async function renderExternes({ reload = true } = {}) {
  if (!extState.mois) {
    const d = new Date();
    extState.mois = { y: d.getFullYear(), m: d.getMonth() + 1 };
  }
  const { y, m } = extState.mois;
  if (reload) {
    await loadExternes();
    extState.jours = await call(api.loadMonth(y, m)).catch(() => []);
  }
  const root = document.getElementById('externes');
  const prefixe = `${y}-${String(m).padStart(2, '0')}`;
  const aller = (n) => {
    const d = new Date(y, m - 1 + n, 1);
    extState.mois = { y: d.getFullYear(), m: d.getMonth() + 1 };
    renderExternes();
  };
  const titreMois = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  const head = h('div', { class: 'recap-head plan-head' },
    h('h2', {}, `Services externes${S.siteName ? ` · ${S.siteName}` : ''}`),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', title: 'Mois précédent', onclick: () => aller(-1) }, icon('chevronLeft', 16)),
    h('div', { class: 'plan-periode mois' }, titreMois),
    h('button', { class: 'btn', title: 'Mois suivant', onclick: () => aller(1) }, icon('chevronRight', 16)),
    h('button', { class: 'btn accent', onclick: () => ouvrirPesee({ date: '' }) }, icon('plus', 15), 'Pesée'));


  // Un cadre par service externe du site (Bois, Matelas, DEEE… et ceux ajoutés dans la saisie) :
  // ses enlèvements du mois (poids saisi ou en attente) puis ses pesées.
  const enl = enlevementsExternes(extState.jours);
  const pesees = extState.entrees.filter((e) => e.date.startsWith(prefixe));
  const externes = M.externesDuSite();
  for (const nom of new Set([...enl.map((e) => e.matiere), ...pesees.map((e) => e.matiere)])) {
    if (!externes.some((x) => x.nom.toLowerCase() === nom.toLowerCase())) externes.push({ nom, unite: 'bennes', retire: true });
  }
  const couleurs = { ...M.COULEURS_DEFAUT, ...((S.site && S.site.couleurs) || {}) };
  const memeMat = (a, b) => a.toLowerCase() === b.toLowerCase();
  const cadres = externes.map((x) => {
    const lesEnl = enl.filter((e) => memeMat(e.matiere, x.nom));
    const lesPes = pesees.filter((e) => memeMat(e.matiere, x.nom));
    const aPeser = lesEnl.filter((e) => !peseesDe(e.date, e.matiere).length).length;
    const total = lesEnl.reduce((n, e) => n + e.nb, 0);
    const ton = lesPes.reduce((n, e) => n + (e.tonnage || 0), 0);
    const col = (couleurs[x.nom] && couleurs[x.nom].couleur) || '#2f9e44';
    const unite = x.unite.charAt(0).toUpperCase() + x.unite.slice(1);
    const lignes = lesEnl.map((e) => {
      const p = peseesDe(e.date, e.matiere);
      const tp = p.reduce((s, y) => s + (y.tonnage || 0), 0);
      return h('tr', { class: p.length ? '' : 'ext-attente' },
        h('td', {}, fmtShortDate(e.date)),
        h('td', { class: 'num' }, h('b', {}, fmtNum(e.nb))),
        h('td', { class: 'muted' }, e.services.join(', ')),
        h('td', { class: 'num' }, p.length ? h('span', { class: 'ext-ok' }, icon('check', 13), fmtTon(tp)) : h('span', { class: 'ext-wait' }, 'en attente')),
        h('td', { class: 'num' }, p.length
          ? h('button', { class: 'o-btn', title: 'Modifier la pesée', onclick: () => ouvrirPesee(p[0]) }, icon('edit', 14))
          : h('button', { class: 'btn small', onclick: () => ouvrirPesee({ date: e.date, matiere: x.nom, nb: e.nb }) }, 'Saisir le poids')));
    });
    // Pesées sans enlèvement correspondant dans la main courante (saisies à part).
    const seules = lesPes.filter((e) => !lesEnl.some((y) => extCle(y.date, y.matiere) === extCle(e.date, e.matiere)));
    return h('div', { class: 'card ext-cadre', style: { '--mc': col } },
      h('div', { class: 'card-head' }, h('span', { class: 'ext-pastille' }), x.nom,
        h('span', { class: 'hint' }, [`compté en ${x.unite}`, aPeser ? `${aPeser} en attente de poids` : null, x.retire ? 'plus proposé en saisie' : null].filter(Boolean).join(' · ')),
        h('button', { class: 'btn small ghost ext-add', title: `Pesée de ${x.nom}`, onclick: () => ouvrirPesee({ date: '', matiere: x.nom }) }, icon('plus', 13), 'Pesée')),
      h('div', { class: 'card-body' },
        lignes.length || seules.length ? h('table', { class: 'grid ext-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', { class: 'num' }, unite), h('th', {}, 'Services'), h('th', { class: 'num' }, 'Poids'), h('th'))),
          h('tbody', {}, lignes, seules.map((e) => h('tr', { title: [e.commentaire, e.bon ? `Bon ${e.bon}` : ''].filter(Boolean).join(' · ') },
            h('td', {}, fmtShortDate(e.date)), h('td', { class: 'num' }, e.nb == null ? '' : fmtNum(e.nb)), h('td', { class: 'muted' }, 'pesée seule'),
            h('td', { class: 'num' }, h('span', { class: 'ext-ok' }, icon('check', 13), fmtTon(e.tonnage || 0))),
            h('td', { class: 'num' },
              h('button', { class: 'o-btn', title: 'Modifier', onclick: () => ouvrirPesee(e) }, icon('edit', 14)),
              h('button', { class: 'o-btn rm', title: 'Supprimer', onclick: () => supprimerPesee(e) }, icon('trash', 14)))))),
          h('tfoot', {}, h('tr', { class: 'total' }, h('td', {}, 'Total'), h('td', { class: 'num' }, `${fmtNum(total)} ${x.unite}`), h('td'), h('td', { class: 'num' }, ton ? `${fmtTon(ton)} reçus` : '—'), h('td'))))
          : h('p', { class: 'muted' }, `Aucune sortie de ${x.nom} ce mois-ci.`)));
  });
  root.replaceChildren(head, h('div', { class: 'ext-grille' }, cadres),
    h('p', { class: 'muted ext-aide' }, 'Un cadre par service externe. Pour en ajouter un : « + Service externe » sous les sorties, dans la saisie.'));
  if (reload) majBadgeExternes();
}

// Fenêtre de saisie d'une pesée : date (modifiable), matière, bennes, poids, bon.
function ouvrirPesee(e) {
  const noms = [...new Set([...M.externesDuSite().map((x) => x.nom), ...extState.entrees.map((x) => x.matiere)])];
  const date = h('input', { type: 'date', value: e.date || '', required: true });
  const matiere = h('input', { type: 'text', value: e.matiere || noms[0] || '', list: 'ext-matieres', maxLength: 40 });
  const nb = h('input', { type: 'text', value: e.nb ?? '', inputMode: 'numeric', maxLength: 4, placeholder: 'ex. 2' });
  const poids = h('input', { type: 'text', value: e.tonnage == null ? '' : (e.pesees && e.pesees.length > 1 ? e.pesees.join('+') : String(e.tonnage)).replace(/\./g, ','), placeholder: 'ex. 5,540 ou 5,54+4,74', inputMode: 'decimal' });
  const bon = h('input', { type: 'text', value: e.bon || '', maxLength: 40, placeholder: 'Facultatif' });
  const com = h('input', { type: 'text', value: e.commentaire || '', maxLength: 200, placeholder: 'Facultatif' });
  const champ = (label, el) => h('label', { class: 'field' }, h('span', {}, label), el);
  const dlg = h('dialog', { class: 'plan-fusion ext-dialog' }, h('div', { class: 'dialog-body' },
    h('h2', {}, e.id ? 'Modifier la pesée' : 'Pesée d\'un service externe'),
    h('datalist', { id: 'ext-matieres' }, noms.map((n) => h('option', { value: n }))),
    h('div', { class: 'ext-form' }, champ('Date de l\'enlèvement', date), champ('Matière', matiere), champ(`Nombre de ${M.uniteExterne(e.matiere || noms[0])}`, nb), champ('Poids (T)', poids), champ('N° de bon', bon), champ('Commentaire', com)),
    h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost', onclick: () => dlg.close() }, 'Annuler'),
      h('button', { class: 'btn primary', onclick: async () => {
        if (!date.value) { toast('Indiquez la date de l\'enlèvement.'); date.focus(); return; }
        if (nb.value.trim() !== '' && !(Number(nb.value.trim().replace(',', '.')) >= 0)) { toast('Nombre : un nombre, ex. 2.'); nb.focus(); return; }
        const t = M.parseTonnage(poids.value);
        if (!t.ok) { toast('Poids illisible : ex. 5,540 ou 5,54+4,74.'); poids.focus(); return; }
        try {
          await call(api.extSave({ id: e.id, date: date.value, matiere: matiere.value.trim(), nb: nb.value.trim() === '' ? null : Number(nb.value.trim().replace(',', '.')), tonnage: t.total, pesees: t.pesees, bon: bon.value, commentaire: com.value }, S.user));
          dlg.close();
          toast('Pesée enregistrée.');
          await renderExternes();
          majBadgeExternes();
        } catch (err) {
          toast(`Non enregistré : ${err.message}`);
        }
      } }, 'Enregistrer'))));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  (e.date ? poids : date).focus();
}

async function supprimerPesee(e) {
  if (await ask('Supprimer cette pesée ?', `${e.matiere} du ${fmtShortDate(e.date)}${e.tonnage != null ? ` · ${fmtTon(e.tonnage)}` : ''}`,
    [{ label: 'Annuler', value: 'no' }, { label: 'Supprimer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
  try {
    await call(api.extDelete(e.id));
  } catch (err) {
    toast(`Non supprimé : ${err.message}`);
  }
  await renderExternes();
  majBadgeExternes();
}
