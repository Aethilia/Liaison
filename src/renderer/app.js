'use strict';

/* global LiaisonModel */
const M = window.LiaisonModel;
// `api` est exposé par preload.js (window.api).
/* global api */

const SVC = Object.fromEntries(M.SERVICES.map((s) => [s.id, s]));
const POLL_MS = 8000;
const SAVE_DELAY_MS = 700;

const S = {
  config: null,
  view: 'saisie',
  date: null,
  service: 'matin',
  data: {}, // services du jour affiché
  prev: null, // service précédent (passation)
  dirty: false,
  saveTimer: null,
  saving: null,
  conflict: null,
  recapMonth: null, // { year, month }
};

/* ---------- Utilitaires ---------- */

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val);
        else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && !k.startsWith('data-') && !k.startsWith('aria-')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const nowHHMM = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtLongDate = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(M.parseISODate(iso));
const fmtShortDate = (iso) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(M.parseISODate(iso));
const fmtMonth = (y, m) => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
const fmtTime = (isoTs) => (isoTs ? new Date(isoTs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
const fmtDateTime = (isoTs) => (isoTs ? new Date(isoTs).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const fmtNum = (v, max = 3) => (v == null ? '' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: max }));
const fmtTon = (v) => `${Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} T`;

function getPath(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, p, v) {
  const keys = p.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = v;
}

// Accepte « 5,54 », « 5.54 » et la notation du terrain « 5T540 » pour les tonnages.
function parseValue(type, raw) {
  if (type === 'text' || type === 'time') return { ok: true, v: raw };
  const s = String(raw).trim();
  if (s === '') return { ok: true, v: null };
  if (type === 'ton') {
    const m = /^(\d+)\s*[tT]\s*(\d{1,3})$/.exec(s);
    if (m) return { ok: true, v: Number(m[1]) + Number(m[2].padEnd(3, '0')) / 1000 };
  }
  const n = Number(s.replace(/\s|%|[tT]$/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  if (type === 'int' && !Number.isInteger(n)) return { ok: false };
  if (type === 'pct' && n > 100) return { ok: false };
  return { ok: true, v: n };
}

function display(type, v) {
  if (v == null) return '';
  if (type === 'text' || type === 'time') return v;
  return fmtNum(v);
}

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    t.hidden = true;
  }, ms);
}

// Boîte de dialogue de confirmation ; renvoie la valeur du bouton choisi.
function ask(title, text, buttons) {
  const dlg = $('#confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  const actions = $('#confirm-actions');
  actions.replaceChildren(h('span', { class: 'spacer' }), ...buttons.map((b) => h('button', { class: `btn ${b.cls || 'ghost'}`, value: b.value }, b.label)));
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue || null), { once: true });
  });
}

async function call(promise) {
  const r = await promise;
  if (!r.ok) {
    const err = new Error(r.error);
    Object.assign(err, r);
    throw err;
  }
  return r.value;
}

const cur = () => S.data[S.service];
const isClosed = (s) => !!(s && s.cloture);
const boxAlerts = (s) => [
  ...M.BENNES.filter((b) => s.bennes[b] >= M.SEUIL_ALERTE).map((b) => ({ type: 'Benne', nom: b, v: s.bennes[b] })),
  ...M.PLATEAUX.filter((p) => s.plateaux[p] >= M.SEUIL_ALERTE).map((p) => ({ type: 'Plateau', nom: p, v: s.plateaux[p] })),
];

/* ---------- Chargement / enregistrement ---------- */

async function loadDay() {
  S.data = await call(api.loadDay(S.date));
  await loadPrev();
}

async function loadPrev() {
  const p = M.previousService(S.date, S.service);
  S.prev = p.date === S.date ? S.data[p.service] : await call(api.loadService(p.date, p.service));
}

function markDirty() {
  S.dirty = true;
  setStatus('Modifications en cours…', 'saving');
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

async function save({ force = false } = {}) {
  clearTimeout(S.saveTimer);
  if (S.saving) {
    await S.saving;
    if (!S.dirty) return;
  }
  const target = cur();
  if (!target || !S.dirty) return;
  S.saving = (async () => {
    S.dirty = false;
    setStatus('Enregistrement…', 'saving');
    try {
      const saved = await call(api.saveService(JSON.parse(JSON.stringify(target)), { expectedRev: target.rev, force }));
      target.rev = saved.rev;
      target.updatedAt = saved.updatedAt;
      target.updatedBy = saved.updatedBy;
      S.conflict = null;
      renderConflict();
      setStatus(`Enregistré à ${fmtTime(saved.updatedAt)}`, 'saved');
      renderTabs();
    } catch (err) {
      S.dirty = true;
      if (err.code === 'CONFLICT') {
        S.conflict = { service: target.service, date: target.date, current: err.current };
        renderConflict();
        setStatus('Conflit : modifié sur un autre poste', 'error');
      } else {
        setStatus(`Erreur d'enregistrement : ${err.message}`, 'error');
      }
    }
  })();
  await S.saving;
  S.saving = null;
}

async function flush() {
  if (S.dirty && !S.conflict) await save();
}

function setStatus(text, cls = '') {
  const el = $('#save-status');
  el.textContent = text;
  el.className = cls;
}

/* ---------- Rendu : en-tête et onglets ---------- */

function renderHeader() {
  $('#date-text').textContent = fmtLongDate(S.date);
  $('#date-input').value = S.date;
  $('#poste').textContent = S.config.poste ? `Poste : ${S.config.poste}` : '';
  $('#data-dir').textContent = `Données : ${S.config.dataDir}`;
  document.body.dataset.service = S.service;
}

function serviceState(id) {
  const s = S.data[id];
  const live = M.currentService();
  if (isClosed(s)) return { cls: 'done', label: 'Clôturé' };
  if (live.date === S.date && live.service === id) return { cls: 'live', label: 'En cours' };
  if (s && !M.isEmpty(s)) return { cls: 'draft', label: 'Non clôturé' };
  return { cls: '', label: 'Vide' };
}

function renderTabs() {
  const tabs = M.SERVICES.map((def) => {
    const s = S.data[def.id];
    const st = serviceState(def.id);
    const alerts = s ? boxAlerts(s).length : 0;
    return h('button', {
      class: `tab${def.id === S.service ? ' active' : ''}`,
      style: { '--tab-color': def.couleur },
      onclick: () => switchService(def.id),
    },
    h('span', { class: 'swatch', style: { background: def.couleur } }),
    h('div', {}, h('div', { class: 't-title' }, def.label), h('div', { class: 't-sub' }, def.horaires, s && s.responsable ? ` · ${s.responsable}` : '')),
    h('div', { class: 't-state' },
      alerts ? h('span', { class: 'pill alert', title: 'Boxs remplis à 80 % ou plus' }, `${alerts} box${alerts > 1 ? 's' : ''} ≥ ${M.SEUIL_ALERTE} %`) : null,
      ' ',
      h('span', { class: `pill ${st.cls}` }, st.label)));
  });
  $('#service-tabs').replaceChildren(...tabs);
}

function renderConflict() {
  const el = $('#conflict');
  if (!S.conflict || S.conflict.service !== S.service || S.conflict.date !== S.date) {
    el.hidden = true;
    return;
  }
  const c = S.conflict.current;
  el.hidden = false;
  el.replaceChildren(
    h('div', {}, h('b', {}, 'Ce service a été modifié sur un autre poste'),
      ` (${c.updatedBy || 'poste inconnu'}, ${fmtDateTime(c.updatedAt)}). Vos dernières modifications ne sont pas enregistrées.`),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn small', onclick: () => resolveConflict('theirs') }, 'Reprendre leur version'),
    h('button', { class: 'btn small primary', onclick: () => resolveConflict('mine') }, 'Garder ma version'),
  );
}

async function resolveConflict(choice) {
  if (choice === 'mine') {
    S.conflict = null;
    S.dirty = true;
    await save({ force: true });
  } else {
    S.data[S.service] = S.conflict.current;
    S.conflict = null;
    S.dirty = false;
    renderSaisie();
    setStatus('Version de l\'autre poste rechargée');
  }
  renderConflict();
}

/* ---------- Rendu : formulaire de saisie ---------- */

function field(bind, type, attrs = {}) {
  const s = cur();
  const el = h('input', {
    type: type === 'time' ? 'time' : 'text',
    'data-bind': bind,
    'data-type': type,
    readOnly: isClosed(s),
    ...attrs,
  });
  if (['int', 'dec', 'ton', 'pct'].includes(type)) {
    el.inputMode = 'decimal';
    el.classList.add('num');
  }
  el.value = display(type, getPath(s, bind));
  return el;
}

function card(title, body, { wide = false, hint = null, cls = '' } = {}) {
  return h('div', { class: `card${wide ? ' wide' : ''} ${cls}` },
    h('div', { class: 'card-head' }, title, hint ? h('span', { class: 'hint' }, hint) : null),
    h('div', { class: 'card-body' }, body));
}

function renderSaisie() {
  renderHeader();
  renderTabs();
  renderConflict();
  renderForm();
  renderPassation();
}

function renderForm() {
  const s = cur();
  const def = SVC[S.service];
  const closed = isClosed(s);

  const banner = h('div', { class: 'service-banner' },
    h('div', {}, h('div', { class: 'sb-date' }, fmtLongDate(S.date)), h('div', { class: 'sb-title' }, def.titre)),
    h('label', { class: 'sb-resp' }, 'Responsable', field('responsable', 'text', { placeholder: 'Nom du chef de service', 'aria-label': 'Responsable' })),
    closed
      ? h('button', { class: 'btn', onclick: reopenService }, 'Rouvrir')
      : h('button', { class: 'btn', onclick: closeService }, 'Clôturer le service'));

  const closedNote = closed
    ? h('div', { class: 'closed-note' }, h('b', {}, 'Service clôturé'), ` le ${fmtDateTime(s.cloture.at)}`,
      s.cloture.par ? ` par ${s.cloture.par}` : '', s.cloture.poste ? ` (poste ${s.cloture.poste})` : '',
      '. Les informations sont transmises au service suivant. Cliquez sur « Rouvrir » pour corriger.')
    : null;

  const motifs = h('datalist', { id: 'motifs' }, M.MOTIFS.map((m) => h('option', { value: m })));
  const absents = card('Agents absents', h('div', { class: 'absents' },
    s.absents.map((_, i) => h('div', { class: 'absent' },
      field(`absents.${i}.nom`, 'text', { placeholder: 'Nom de l\'agent' }),
      field(`absents.${i}.motif`, 'text', { placeholder: 'Motif', list: 'motifs' })))), { hint: 'Motif : choisir ou taper librement' });

  const entrees = card('Entrées — passages de véhicules', h('div', { class: 'entrees' },
    h('label', { class: 'field' }, h('span', {}, 'Plateaux'), field('entrees.plateaux', 'int')),
    h('label', { class: 'field' }, h('span', {}, 'Poids lourds (PL)'), field('entrees.pl', 'int')),
    h('div', { class: 'total-box' }, h('span', {}, 'TOTAL'), h('b', { id: 'calc-entrees' }, '0'))));

  const sorties = card('Sorties', h('table', { class: 'grid' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Matière'), h('th', {}, 'Nb sorties'), h('th', {}, 'Tonnage (T)'))),
    h('tbody', {}, M.MATIERES.map((m) => h('tr', {},
      h('td', { class: 'label' }, m),
      h('td', {}, field(`sorties.${m}.nb`, 'int')),
      M.MATIERES_EXTERNES.includes(m)
        ? h('td', { class: 'ext' }, 'service externe')
        : h('td', {}, field(`sorties.${m}.tonnage`, 'ton', { title: 'En tonnes : 5,54 ou 5T540' }))))),
    h('tfoot', {}, h('tr', { class: 'total' }, h('td', {}, 'TOTAL'), h('td', { id: 'calc-nb' }), h('td', { id: 'calc-ton' })))),
  { hint: 'Tonnage : 5,54 ou 5T540' });

  const boxRow = (group, nom) => h('div', { class: 'box-row' },
    h('span', {}, nom),
    h('div', { class: 'bar', 'data-bar': `${group}.${nom}` }, h('i')),
    h('div', { class: 'pct' }, field(`${group}.${nom}`, 'pct', { 'aria-label': `${group === 'bennes' ? 'Benne' : 'Plateau'} ${nom}` })));
  const boxs = card('État des boxs', h('div', { class: 'boxs' },
    h('div', {}, h('h4', {}, 'Bennes'), M.BENNES.map((b) => boxRow('bennes', b))),
    h('div', {}, h('h4', {}, 'Plateaux'), M.PLATEAUX.map((p) => boxRow('plateaux', p)))),
  { hint: `Remplissage en % · alerte à ${M.SEUIL_ALERTE} %` });

  const obsList = h('div', { class: 'obs-list', id: 'obs-list' },
    s.observations.length
      ? s.observations.map((o, i) => h('div', { class: 'obs' },
        field(`observations.${i}.heure`, 'time', { 'aria-label': 'Heure' }),
        autoGrow(h('textarea', { 'data-bind': `observations.${i}.texte`, 'data-type': 'text', rows: 1, readOnly: closed, placeholder: 'Observation', value: o.texte })),
        closed ? h('span') : h('button', { class: 'rm', title: 'Supprimer', 'aria-label': 'Supprimer l\'observation', onclick: () => removeObservation(i) }, '×')))
      : h('div', { class: 'empty' }, 'Aucune observation pour ce service.'));
  const obs = card('N.B. — observations', [obsList,
    h('div', { class: 'obs-foot' },
      closed ? null : h('button', { class: 'btn accent small', onclick: () => addObservation() }, '+ Ajouter une observation'),
      h('span', { class: 'usage', id: 'calc-usage' }))],
  { wide: true, hint: 'Entrée : nouvelle ligne · Maj+Entrée : retour à la ligne' });

  const consignes = card('Consignes pour la relève', h('div', { class: 'consignes' },
    autoGrow(h('textarea', {
      'data-bind': 'consignes', 'data-type': 'text', readOnly: closed, value: s.consignes,
      placeholder: 'Ce que le service suivant doit savoir ou faire : rotations à prévoir, matériel en panne, consignes du chef…',
    }))), { wide: true, hint: 'Affichées en priorité au service suivant' });

  $('#form').replaceChildren(...[banner, closedNote, motifs, absents, entrees, sorties, boxs, obs, consignes].filter(Boolean));
  $('#form').querySelectorAll('textarea').forEach(fitTextarea);
  updateComputed();
}

function autoGrow(el) {
  el.addEventListener('input', () => fitTextarea(el));
  return el;
}
function fitTextarea(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}

function updateComputed() {
  const s = cur();
  if (!s) return;
  const t = M.totals(s);
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set('calc-entrees', fmtNum(t.entrees));
  set('calc-nb', fmtNum(t.sortiesNb));
  set('calc-ton', fmtTon(t.tonnage));
  document.querySelectorAll('[data-bar]').forEach((bar) => {
    const v = getPath(s, bar.dataset.bar);
    const alert = v != null && v >= M.SEUIL_ALERTE;
    bar.firstChild.style.width = `${Math.min(100, v || 0)}%`;
    bar.classList.toggle('alert', alert);
    const input = bar.parentElement.querySelector('input');
    if (input) input.classList.toggle('alert', alert);
  });
  const usage = document.getElementById('calc-usage');
  if (usage) {
    const n = M.layoutObservations(s).length;
    usage.textContent = `${n} / ${M.NB_OBSERVATIONS} lignes de la feuille Excel`;
    usage.classList.toggle('over', n > M.NB_OBSERVATIONS);
    usage.title = n > M.NB_OBSERVATIONS ? 'Au-delà de 12 lignes, la fin sera coupée à l\'export Excel (elle reste dans l\'application).' : '';
  }
}

function onFormInput(e) {
  const el = e.target;
  const bind = el.dataset && el.dataset.bind;
  if (!bind || el.readOnly) return;
  const r = parseValue(el.dataset.type, el.value);
  el.classList.toggle('invalid', !r.ok);
  if (!r.ok) return;
  setPath(cur(), bind, r.v);
  updateComputed();
  if (bind.startsWith('bennes') || bind.startsWith('plateaux') || bind === 'responsable') renderTabs();
  markDirty();
}

function onFormBlur(e) {
  const el = e.target;
  if (!el.dataset || !el.dataset.bind || el.classList.contains('invalid')) return;
  const type = el.dataset.type;
  if (type !== 'text' && type !== 'time') el.value = display(type, getPath(cur(), el.dataset.bind));
}

function onFormKey(e) {
  const el = e.target;
  if (e.key === 'Enter' && !e.shiftKey && el.tagName === 'TEXTAREA' && /^observations\.\d+\.texte$/.test(el.dataset.bind || '')) {
    e.preventDefault();
    const i = Number(el.dataset.bind.split('.')[1]);
    const next = document.querySelector(`[data-bind="observations.${i + 1}.texte"]`);
    if (next) next.focus();
    else addObservation();
  }
}

function addObservation() {
  const s = cur();
  if (isClosed(s)) return;
  s.observations.push({ heure: nowHHMM(), texte: '' });
  renderForm();
  markDirty();
  const last = document.querySelector(`[data-bind="observations.${s.observations.length - 1}.texte"]`);
  if (last) last.focus();
}

function removeObservation(i) {
  const s = cur();
  s.observations.splice(i, 1);
  renderForm();
  markDirty();
}

async function closeService() {
  const s = cur();
  const warnings = [];
  if (!s.responsable) warnings.push('• Le responsable n\'est pas renseigné.');
  if (M.BENNES.every((b) => s.bennes[b] == null) && M.PLATEAUX.every((p) => s.plateaux[p] == null)) warnings.push('• L\'état des boxs n\'est pas renseigné.');
  if (!s.observations.some((o) => o.texte)) warnings.push('• Aucune observation saisie.');
  const text = `Le service ${SVC[S.service].label.toLowerCase()} du ${fmtLongDate(S.date)} sera marqué comme terminé et transmis au service suivant.${warnings.length ? `\n\nÀ vérifier :\n${warnings.join('\n')}` : ''}`;
  const r = await ask('Clôturer le service ?', text, [
    { label: 'Annuler', value: 'no' },
    { label: 'Clôturer', value: 'yes', cls: 'primary' },
  ]);
  if (r !== 'yes') return;
  s.cloture = { at: new Date().toISOString(), par: s.responsable || null, poste: S.config.poste || null };
  S.dirty = true;
  await save();
  renderSaisie();
  toast('Service clôturé et transmis à la relève.');
}

async function reopenService() {
  const r = await ask('Rouvrir le service ?', 'Le service repassera en saisie pour être corrigé. Pensez à le clôturer à nouveau.', [
    { label: 'Annuler', value: 'no' },
    { label: 'Rouvrir', value: 'yes', cls: 'primary' },
  ]);
  if (r !== 'yes') return;
  cur().cloture = null;
  S.dirty = true;
  await save();
  renderSaisie();
}

/* ---------- Rendu : passation (relève) ---------- */

function renderPassation() {
  const p = M.previousService(S.date, S.service);
  const prev = S.prev;
  const def = SVC[p.service];
  const style = { '--prev-color': def.couleur, '--prev-soft': `var(--${p.service}-soft)` };
  const head = h('div', { class: 'card-head' }, `Relève · service ${def.label.toLowerCase()}`, h('span', { class: 'hint' }, fmtShortDate(p.date)));

  if (!prev || M.isEmpty(prev)) {
    $('#passation').replaceChildren(h('div', { class: 'card', style }, head,
      h('div', { class: 'pass-section' }, h('div', { class: 'empty' }, 'Le service précédent n\'a rien saisi.'))));
    return;
  }

  const t = M.totals(prev);
  const alerts = boxAlerts(prev);
  const obs = prev.observations.filter((o) => o.heure || o.texte);
  const absents = prev.absents.filter((a) => a.nom);
  const etat = isClosed(prev)
    ? h('span', { class: 'pill done' }, `Clôturé ${fmtDateTime(prev.cloture.at)}`)
    : h('span', { class: 'pill draft' }, 'Non clôturé');

  const cardEl = h('div', { class: 'card', style }, head,
    h('div', { class: 'pass-section' },
      h('div', { class: 'kv' }, h('span', {}, 'Responsable'), h('b', {}, prev.responsable || '—')),
      h('div', { class: 'kv' }, h('span', {}, 'État'), etat),
      prev.updatedBy ? h('div', { class: 'kv muted' }, h('span', {}, 'Dernière saisie'), h('span', {}, `${prev.updatedBy}, ${fmtDateTime(prev.updatedAt)}`)) : null),
    h('div', { class: 'pass-section' }, h('h5', {}, 'Consignes'),
      prev.consignes ? h('div', { class: 'pass-consignes' }, prev.consignes) : h('div', { class: 'empty' }, 'Aucune consigne transmise.')),
    h('div', { class: 'pass-section' }, h('h5', {}, `Boxs à ${M.SEUIL_ALERTE} % ou plus`),
      alerts.length
        ? h('div', { class: 'alert-list' }, alerts.map((a) => h('span', { class: 'pill alert' }, `${a.type} ${a.nom} : ${fmtNum(a.v)} %`)))
        : h('div', { class: 'empty' }, 'Aucun box en alerte.'),
      isClosed(cur()) ? null : h('button', { class: 'btn small', style: { marginTop: '8px' }, onclick: takeOverBoxes }, 'Reprendre l\'état des boxs')),
    h('div', { class: 'pass-section' }, h('h5', {}, `Observations (${obs.length})`),
      obs.length
        ? h('ul', { class: 'pass-obs' }, obs.map((o) => h('li', {}, h('b', {}, o.heure || ''), h('span', {}, o.texte))))
        : h('div', { class: 'empty' }, 'Aucune observation.')),
    h('div', { class: 'pass-section' }, h('h5', {}, 'Activité'),
      h('div', { class: 'kv' }, h('span', {}, 'Entrées'), h('b', {}, fmtNum(t.entrees))),
      h('div', { class: 'kv' }, h('span', {}, 'Sorties'), h('b', {}, fmtNum(t.sortiesNb))),
      h('div', { class: 'kv' }, h('span', {}, 'Tonnage'), h('b', {}, fmtTon(t.tonnage))),
      absents.length ? h('div', { class: 'kv' }, h('span', {}, 'Absents'), h('span', {}, absents.map((a) => `${a.nom}${a.motif ? ` (${a.motif})` : ''}`).join(', '))) : null));

  $('#passation').replaceChildren(cardEl);
}

async function takeOverBoxes() {
  const s = cur();
  const hasValues = M.BENNES.some((b) => s.bennes[b] != null) || M.PLATEAUX.some((p) => s.plateaux[p] != null);
  if (hasValues) {
    const r = await ask('Remplacer l\'état des boxs ?', 'L\'état des boxs déjà saisi pour ce service sera remplacé par celui du service précédent.', [
      { label: 'Annuler', value: 'no' },
      { label: 'Remplacer', value: 'yes', cls: 'primary' },
    ]);
    if (r !== 'yes') return;
  }
  s.bennes = { ...S.prev.bennes };
  s.plateaux = { ...S.prev.plateaux };
  renderForm();
  renderTabs();
  markDirty();
  toast('État des boxs repris du service précédent — ajustez si besoin.');
}

/* ---------- Navigation ---------- */

async function goTo(date, service = S.service) {
  await flush();
  S.date = date;
  S.service = service;
  S.conflict = null;
  await loadDay();
  if (S.view === 'recap') {
    const d = M.parseISODate(date);
    S.recapMonth = { year: d.getFullYear(), month: d.getMonth() + 1 };
    await renderRecap();
  }
  renderSaisie();
  setStatus(cur().updatedAt ? `Dernier enregistrement ${fmtDateTime(cur().updatedAt)}${cur().updatedBy ? ` · ${cur().updatedBy}` : ''}` : 'Aucune saisie pour ce service');
}

async function switchService(id) {
  if (id === S.service) return;
  await flush();
  S.service = id;
  await loadPrev();
  renderSaisie();
}

function setView(view) {
  S.view = view;
  document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#view-saisie').hidden = view !== 'saisie';
  $('#view-recap').hidden = view !== 'recap';
  if (view === 'recap') {
    const d = M.parseISODate(S.date);
    S.recapMonth = { year: d.getFullYear(), month: d.getMonth() + 1 };
    flush().then(renderRecap);
  }
}

// Recharge les services modifiés depuis un autre poste.
async function poll() {
  if (document.hidden || S.view !== 'saisie' || S.saving) return;
  let revs;
  try {
    revs = await call(api.dayRevs(S.date));
  } catch {
    return;
  }
  let changed = false;
  for (const id of Object.keys(revs)) {
    const local = S.data[id];
    if (!local || revs[id] === local.rev) continue;
    if (id === S.service && S.dirty) continue; // le conflit sera signalé à l'enregistrement
    S.data[id] = await call(api.loadService(S.date, id));
    changed = true;
    if (id === S.service) {
      const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.bind : null;
      renderForm();
      if (focused) {
        const el = document.querySelector(`[data-bind="${focused}"]`);
        if (el) el.focus();
      }
      toast(`Service mis à jour depuis le poste ${S.data[id].updatedBy || 'distant'}.`);
    }
  }
  const p = M.previousService(S.date, S.service);
  if (p.date !== S.date) {
    const prev = await call(api.loadService(p.date, p.service));
    if (!S.prev || prev.rev !== S.prev.rev) {
      S.prev = prev;
      changed = true;
    }
  } else {
    S.prev = S.data[p.service];
  }
  if (changed) {
    renderTabs();
    renderPassation();
  }
}

/* ---------- Récapitulatif mensuel ---------- */

async function renderRecap() {
  const { year, month } = S.recapMonth;
  const days = await call(api.loadMonth(year, month));
  const parMatiere = Object.fromEntries(M.MATIERES.map((m) => [m, { nb: 0, tonnage: 0 }]));
  const parMotif = {};
  const tot = { plateaux: 0, pl: 0, entrees: 0, nb: 0, tonnage: 0, absents: 0, clos: 0, saisis: 0 };
  const n = (v) => (typeof v === 'number' ? v : 0);

  const rows = days.map((d) => {
    const row = { plateaux: 0, pl: 0, nb: 0, tonnage: 0, absents: 0, obs: 0, alerts: 0 };
    const dots = M.SERVICES.map((def) => {
      const s = d.services[def.id];
      const empty = M.isEmpty(s);
      if (!empty) tot.saisis++;
      if (isClosed(s)) tot.clos++;
      row.plateaux += n(s.entrees.plateaux);
      row.pl += n(s.entrees.pl);
      for (const m of M.MATIERES) {
        row.nb += n(s.sorties[m].nb);
        row.tonnage += n(s.sorties[m].tonnage);
        parMatiere[m].nb += n(s.sorties[m].nb);
        parMatiere[m].tonnage += n(s.sorties[m].tonnage);
      }
      for (const a of s.absents) {
        if (!a.nom) continue;
        row.absents++;
        const k = a.motif || 'Non précisé';
        parMotif[k] = (parMotif[k] || 0) + 1;
      }
      row.obs += s.observations.filter((o) => o.texte).length;
      row.alerts += boxAlerts(s).length;
      const cls = isClosed(s) ? 'done' : empty ? '' : 'draft';
      return h('span', { class: `dot ${cls}`, style: { '--c': def.couleur }, title: `${def.label} : ${isClosed(s) ? 'clôturé' : empty ? 'vide' : 'non clôturé'}${s.responsable ? ` — ${s.responsable}` : ''}` });
    });
    tot.plateaux += row.plateaux;
    tot.pl += row.pl;
    tot.nb += row.nb;
    tot.tonnage += row.tonnage;
    tot.absents += row.absents;
    const wd = M.parseISODate(d.date).getDay();
    return h('tr', { class: wd === 0 || wd === 6 ? 'weekend' : '', onclick: () => { setView('saisie'); goTo(d.date); } },
      h('td', {}, fmtShortDate(d.date)),
      h('td', {}, h('span', { class: 'dots' }, dots)),
      h('td', {}, row.plateaux || ''), h('td', {}, row.pl || ''), h('td', {}, h('b', {}, row.plateaux + row.pl || '')),
      h('td', {}, row.nb || ''), h('td', {}, row.tonnage ? fmtTon(row.tonnage) : ''),
      h('td', {}, row.absents || ''), h('td', {}, row.obs || ''),
      h('td', {}, row.alerts ? h('span', { class: 'pill alert' }, row.alerts) : ''));
  });
  tot.entrees = tot.plateaux + tot.pl;

  const prevMonth = () => {
    const d = new Date(year, month - 2, 1);
    S.recapMonth = { year: d.getFullYear(), month: d.getMonth() + 1 };
    renderRecap();
  };
  const nextMonth = () => {
    const d = new Date(year, month, 1);
    S.recapMonth = { year: d.getFullYear(), month: d.getMonth() + 1 };
    renderRecap();
  };
  const kpi = (label, value) => h('div', { class: 'kpi' }, h('div', { class: 'k-label' }, label), h('div', { class: 'k-value' }, value));

  $('#recap').replaceChildren(
    h('div', { class: 'recap-head' },
      h('button', { class: 'icon-btn', onclick: prevMonth, 'aria-label': 'Mois précédent' }, '‹'),
      h('h2', {}, fmtMonth(year, month)),
      h('button', { class: 'icon-btn', onclick: nextMonth, 'aria-label': 'Mois suivant' }, '›'),
      h('span', { class: 'spacer', style: { flex: 1 } }),
      h('button', { class: 'btn primary', onclick: () => exportMonth(year, month) }, 'Exporter ce mois en Excel')),
    h('div', { class: 'kpis' },
      kpi('Entrées (passages)', fmtNum(tot.entrees)),
      kpi('Sorties', fmtNum(tot.nb)),
      kpi('Tonnage sorti', fmtTon(tot.tonnage)),
      kpi('Services clôturés', `${tot.clos} / ${days.length * 3}`)),
    h('div', { class: 'recap-grid' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, 'Par jour', h('span', { class: 'hint' }, 'Cliquer sur un jour pour l\'ouvrir')),
        h('div', { class: 'card-body' },
          h('table', { class: 'grid recap' },
            h('thead', {}, h('tr', {}, ['Jour', 'Services', 'Plateaux', 'PL', 'Entrées', 'Sorties', 'Tonnage', 'Absents', 'Obs.', 'Alertes'].map((x) => h('th', {}, x)))),
            h('tbody', {}, rows),
            h('tfoot', {}, h('tr', {}, h('td', {}, 'Total'), h('td', {}, `${tot.saisis} saisis`), h('td', {}, fmtNum(tot.plateaux)), h('td', {}, fmtNum(tot.pl)),
              h('td', {}, fmtNum(tot.entrees)), h('td', {}, fmtNum(tot.nb)), h('td', {}, fmtTon(tot.tonnage)), h('td', {}, tot.absents), h('td', {}), h('td', {})))),
          h('div', { class: 'legend' },
            M.SERVICES.map((def) => h('span', {}, h('span', { class: 'dot done', style: { '--c': def.couleur } }), ` ${def.label}`)),
            h('span', {}, '● clôturé · ◐ non clôturé · ○ vide')))),
      h('div', { class: 'recap-side' },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, 'Sorties par matière'),
          h('div', { class: 'card-body' }, h('table', { class: 'grid recap' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Matière'), h('th', {}, 'Nb'), h('th', {}, 'Tonnage'))),
            h('tbody', {}, M.MATIERES.map((m) => h('tr', { style: { cursor: 'default' } }, h('td', {}, m), h('td', {}, fmtNum(parMatiere[m].nb)),
              h('td', {}, M.MATIERES_EXTERNES.includes(m) ? h('span', { class: 'muted' }, 'externe') : fmtTon(parMatiere[m].tonnage)))))))),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, 'Absences par motif'),
          h('div', { class: 'card-body' }, Object.keys(parMotif).length
            ? Object.entries(parMotif).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('div', { class: 'kv' }, h('span', {}, k), h('b', {}, v)))
            : h('div', { class: 'empty' }, 'Aucune absence saisie.'))))));
}

/* ---------- Export / import / impression ---------- */

const MOIS = ['JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE'];

async function doExport(from, to, suggestedName) {
  await flush();
  try {
    const file = await call(api.exportExcel({ from, to, suggestedName }));
    if (!file) return;
    const r = await ask('Export terminé', `Le classeur a été enregistré :\n${file}`, [
      { label: 'Fermer', value: 'close' },
      { label: 'Ouvrir dans Excel', value: 'open', cls: 'primary' },
    ]);
    if (r === 'open') await call(api.openFile(file));
  } catch (err) {
    ask('Export impossible', err.message, [{ label: 'OK', value: 'ok', cls: 'primary' }]);
  }
}

function exportDay() {
  const [y, m, d] = S.date.split('-');
  return doExport(S.date, S.date, `MAIN_COURANTE_${d}-${m}-${y}.xlsx`);
}

function exportMonth(year, month) {
  if (!year) {
    const d = M.parseISODate(S.date);
    year = d.getFullYear();
    month = d.getMonth() + 1;
  }
  const days = M.daysInMonth(year, month);
  return doExport(days[0], days[days.length - 1], `${MOIS[month - 1]}_${year}.xlsx`);
}

async function doImport() {
  await flush();
  try {
    const info = await call(api.pickImport());
    if (!info) return;
    if (!info.filled) {
      await ask('Rien à importer', `Aucun service rempli n'a été trouvé dans ce classeur (${info.days} jour(s) lus).`, [{ label: 'OK', value: 'ok', cls: 'primary' }]);
      return;
    }
    const buttons = [{ label: 'Annuler', value: 'no' }];
    if (info.conflicts) buttons.push({ label: 'Tout remplacer', value: 'overwrite', cls: 'danger' });
    buttons.push({ label: info.conflicts ? 'Importer sans écraser' : 'Importer', value: 'import', cls: 'primary' });
    const r = await ask('Importer le classeur ?',
      `${info.filled} service(s) rempli(s) trouvé(s) sur ${info.days} jour(s).${info.conflicts ? `\n${info.conflicts} d'entre eux sont déjà saisis dans l'application.` : ''}`,
      buttons);
    if (r !== 'import' && r !== 'overwrite') return;
    const res = await call(api.runImport(info.file, { overwrite: r === 'overwrite' }));
    toast(`${res.written} service(s) importé(s)${res.skipped ? `, ${res.skipped} conservé(s)` : ''}.`);
    await goTo(S.date);
    if (S.view === 'recap') await renderRecap();
  } catch (err) {
    ask('Import impossible', err.message, [{ label: 'OK', value: 'ok', cls: 'primary' }]);
  }
}

// Mise en page imprimable reprenant le modèle Excel : une page A4 par service.
function buildPrint() {
  const pages = M.SERVICES.map((def) => {
    const s = S.data[def.id];
    const t = M.totals(s);
    const lines = M.layoutObservations(s);
    while (lines.length < M.NB_OBSERVATIONS) lines.push({ heure: '', texte: '' });
    const pctCell = (v) => h('td', { class: `c${v >= M.SEUIL_ALERTE ? ' red' : ''}` }, v == null ? '' : `${fmtNum(v)} %`);
    const boxRows = Array.from({ length: 8 }, (_, i) => {
      const m = M.MATIERES[i];
      const ext = M.MATIERES_EXTERNES.includes(m);
      const b = M.BENNES[i];
      const p = M.PLATEAUX[i];
      return h('tr', {},
        h('td', {}, m), h('td', { class: 'c' }, s.sorties[m].nb ?? ''),
        ext ? h('td', { class: 'ext' }, 'service externe') : h('td', { class: 'c' }, s.sorties[m].tonnage != null ? fmtTon(s.sorties[m].tonnage) : ''),
        b ? h('td', {}, b) : h('td', { style: { border: 0 } }), b ? pctCell(s.bennes[b]) : h('td', { style: { border: 0 } }),
        p ? h('td', {}, p) : h('td', { style: { border: 0 } }), p ? pctCell(s.plateaux[p]) : h('td', { style: { border: 0 } }));
    });
    return h('div', { class: 'p-page', style: { '--c': def.couleur } },
      h('div', { class: 'p-title' }, 'MAIN COURANTE  ·  TRONC PRINCIPAL'),
      h('div', { class: 'p-band' }, h('span', { style: { textTransform: 'capitalize' } }, fmtShortDate(S.date)), h('span', { class: 'p-st' }, def.titre),
        h('span', { class: 'p-rl' }, 'Responsable'), h('span', { class: 'p-resp' }, s.responsable || '')),
      h('div', { class: 'p-sec' }, 'AGENTS ABSENTS'),
      h('table', {}, h('tr', {}, h('th', {}, 'Nom'), h('th', {}, 'Motif'), h('th', {}, 'Nom'), h('th', {}, 'Motif')),
        [0, 2].map((i) => h('tr', {}, h('td', {}, s.absents[i].nom), h('td', { class: 'c' }, s.absents[i].motif), h('td', {}, s.absents[i + 1].nom), h('td', { class: 'c' }, s.absents[i + 1].motif)))),
      h('div', { class: 'p-sec' }, 'ENTRÉES  —  passages de véhicules'),
      h('table', {}, h('tr', {}, h('td', {}, 'Plateaux'), h('td', { class: 'c' }, s.entrees.plateaux ?? ''), h('td', {}, 'Poids lourds (PL)'),
        h('td', { class: 'c' }, s.entrees.pl ?? ''), h('td', { class: 'c' }, h('b', {}, 'TOTAL')), h('td', { class: 'c' }, h('b', {}, t.entrees)))),
      h('div', { class: 'p-sec' }, 'SORTIES  ·  ÉTAT DES BOXS'),
      h('table', {}, h('tr', {}, ['Matière', 'Nb sorties', 'Tonnage', 'Bennes', 'Remplissage', 'Plateaux', 'Remplissage'].map((x) => h('th', {}, x))),
        boxRows,
        h('tr', { class: 'tot' }, h('td', {}, 'TOTAL'), h('td', { class: 'c' }, t.sortiesNb), h('td', { class: 'c' }, fmtTon(t.tonnage)), h('td', { colspan: 4, style: { background: 'transparent', border: 0 } }))),
      h('div', { class: 'p-sec' }, 'N.B.  —  observations'),
      h('table', {}, h('tr', {}, h('th', {}, 'Heure'), h('th', {}, 'Observation')),
        lines.map((l) => h('tr', {}, h('td', { class: 'h' }, l.heure), h('td', {}, l.texte)))));
  });
  $('#print-area').replaceChildren(...pages);
}

async function doPrint() {
  await flush();
  buildPrint();
  try {
    await call(api.print());
  } catch (err) {
    ask('Impression impossible', err.message, [{ label: 'OK', value: 'ok', cls: 'primary' }]);
  }
}

/* ---------- Paramètres ---------- */

function openSettings() {
  const dlg = $('#settings');
  $('#set-poste').value = S.config.poste || '';
  $('#set-dir').value = S.config.dataDir;
  dlg.showModal();
}

async function initSettings() {
  $('#btn-settings').addEventListener('click', openSettings);
  $('#set-dir-btn').addEventListener('click', async () => {
    const dir = await call(api.chooseDir());
    if (dir) $('#set-dir').value = dir;
  });
  $('#set-open').addEventListener('click', () => call(api.openDataDir()));
  $('#settings').addEventListener('close', async () => {
    if ($('#settings').returnValue !== 'save') return;
    await flush();
    S.config = await call(api.setConfig({ poste: $('#set-poste').value.trim(), dataDir: $('#set-dir').value }));
    await goTo(S.date);
    toast('Paramètres enregistrés.');
  });
}

/* ---------- Démarrage ---------- */

async function init() {
  S.config = await call(api.getConfig());
  const live = M.currentService();
  S.date = live.date;
  S.service = live.service;

  const form = $('#form');
  form.addEventListener('input', onFormInput);
  form.addEventListener('focusout', onFormBlur);
  form.addEventListener('keydown', onFormKey);

  $('#prev-day').addEventListener('click', () => goTo(M.addDays(S.date, -1)));
  $('#next-day').addEventListener('click', () => goTo(M.addDays(S.date, 1)));
  $('#date-input').addEventListener('change', (e) => e.target.value && goTo(e.target.value));
  $('#btn-now').addEventListener('click', () => {
    const l = M.currentService();
    setView('saisie');
    goTo(l.date, l.service);
  });
  document.querySelectorAll('.view-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#btn-export-day').addEventListener('click', exportDay);
  $('#btn-export-month').addEventListener('click', () => exportMonth());
  $('#btn-import').addEventListener('click', doImport);
  $('#btn-print').addEventListener('click', doPrint);
  await initSettings();

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      flush();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      doPrint();
    }
  });
  window.addEventListener('beforeunload', () => {
    if (S.dirty) save();
  });

  await goTo(S.date, S.service);
  if (S.config.firstRun || !S.config.poste) openSettings();
  setInterval(poll, POLL_MS);
}

init().catch((err) => {
  document.body.replaceChildren(h('pre', { style: { padding: '20px', color: '#c00000' } }, `Erreur au démarrage : ${err.message}`));
});
