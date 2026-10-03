'use strict';

/* global LiaisonModel, Icons */
// `api` est exposé par preload.js (window.api).
/* global api */
const M = window.LiaisonModel;
const { icon, decorate } = window.Icons;

const UI = {
  matin: { icon: 'sunrise', c2: '#e8843f' },
  apresmidi: { icon: 'sun', c2: '#4f9be0' },
  nuit: { icon: 'moon', c2: '#3c5480' },
};
const SVC = Object.fromEntries(M.SERVICES.map((s) => [s.id, { ...s, ...UI[s.id] }]));
const AVATAR_COLORS = ['#c55a11', '#2e75b6', '#1f2f4f', '#2f855a', '#8e44ad', '#b83280', '#0f766e', '#b7791f'];
const POLL_MS = 8000;
const SAVE_DELAY_MS = 700;

const S = {
  config: null,
  users: [],
  agents: [], // agents déjà saisis comme absents (proposés à la saisie)
  user: null,
  screen: 'user',
  view: 'saisie',
  date: null,
  service: 'matin',
  data: {}, // services du jour affiché
  prev: null, // service précédent (relève)
  dirty: false,
  saveTimer: null,
  saving: null,
  conflict: null,
  qa: { texte: '', heure: '', important: false }, // saisie rapide d'observation
  recapMonth: null,
  journal: { period: 'jour', q: '', hidden: new Set(), importantOnly: false, days: null, key: null },
  fiche: null,
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
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
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
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function initials(name) {
  const parts = String(name).trim().split(/[\s.-]+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
function avatarColor(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
const avatar = (name) => h('span', { class: 'avatar', style: { '--av': avatarColor(name) } }, initials(name));

function getPath(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, p, v) {
  const keys = p.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = v;
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
  $('#confirm-actions').replaceChildren(h('span', { class: 'spacer' }), ...buttons.map((b) => h('button', { class: `btn ${b.cls || 'ghost'}`, value: b.value }, b.label)));
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue || null), { once: true });
  });
}

function promptText(title, placeholder = '') {
  const dlg = $('#prompt');
  $('#prompt-title').textContent = title;
  const input = $('#prompt-input');
  input.value = '';
  input.placeholder = placeholder;
  dlg.returnValue = '';
  dlg.showModal();
  input.focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? input.value.trim() : null), { once: true });
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
const realObs = (s) => s.observations.filter((o) => o.heure || o.texte);
const boxAlerts = (s) => [
  ...M.BENNES.filter((b) => s.bennes[b] >= M.SEUIL_ALERTE).map((b) => ({ type: 'Benne', nom: b, v: s.bennes[b] })),
  ...M.PLATEAUX.filter((p) => s.plateaux[p] >= M.SEUIL_ALERTE).map((p) => ({ type: 'Plateau', nom: p, v: s.plateaux[p] })),
];

function serviceState(s) {
  const live = M.currentService();
  if (isClosed(s)) return { cls: 'done', label: 'Clôturé', icon: 'lock' };
  if (live.date === s.date && live.service === s.service) return { cls: 'live', label: 'En cours', icon: 'clock' };
  if (!M.isEmpty(s)) return { cls: 'draft', label: 'Non clôturé', icon: 'edit' };
  return { cls: '', label: 'Vide', icon: null };
}
const statePill = (s, extra = '') => {
  const st = serviceState(s);
  return h('span', { class: `pill ${st.cls} ${extra}` }, st.icon ? icon(st.icon, 12) : null, st.label);
};
const svcStyle = (id) => ({ '--c': SVC[id].couleur, '--c2': SVC[id].c2 });

/* ---------- Écrans ---------- */

function showScreen(name) {
  S.screen = name;
  $('#screen-user').hidden = name !== 'user';
  $('#screen-service').hidden = name !== 'service';
  $('#screen-app').hidden = name !== 'app';
}

// Étape 1 : choix du responsable
function renderUserScreen() {
  let last = null;
  try {
    last = localStorage.getItem('liaison.lastUser');
  } catch { /* stockage indisponible */ }
  const cards = S.users.map((name) => h('button', { class: `user-card${name === last ? ' last' : ''}`, onclick: () => chooseUser(name) },
    avatar(name), h('span', {}, name), name === last ? h('span', { class: 'u-hint' }, 'Dernière connexion sur ce poste') : null));
  cards.push(h('button', { class: 'user-card add', onclick: addUserFromWelcome },
    h('span', { class: 'avatar' }, icon('plus', 24)), h('span', {}, 'Ajouter un responsable')));
  $('#user-list').replaceChildren(...(S.users.length ? [] : [h('div', { class: 'empty-users' }, 'Commencez par ajouter les responsables (une seule fois, la liste est partagée entre les postes).')]), ...cards);
  $('#welcome-poste').textContent = S.config.poste ? `Poste : ${S.config.poste}` : '';
  showScreen('user');
}

async function addUserFromWelcome() {
  const name = await promptText('Nouveau responsable', 'Prénom Nom');
  if (!name) return;
  S.users = await call(api.saveUsers([...S.users, name]));
  renderUserScreen();
}

async function chooseUser(name) {
  S.user = name;
  try {
    localStorage.setItem('liaison.lastUser', name);
  } catch { /* stockage indisponible */ }
  S.date = M.currentService().date;
  await renderServiceScreen();
}

// Étape 2 : choix du service
async function renderServiceScreen() {
  await flush();
  S.data = await call(api.loadDay(S.date));
  const live = M.currentService();
  $('#service-hello').textContent = `${S.user}, sur quel service travaillez-vous ?`;
  $('#svc-date-text').textContent = fmtLongDate(S.date);
  $('#svc-date-input').value = S.date;
  const cards = M.SERVICES.map((def) => {
    const s = S.data[def.id];
    const obs = realObs(s);
    const imp = obs.filter((o) => o.important).length;
    const isLive = live.date === S.date && live.service === def.id;
    return h('div', {
      class: `svc-card${isLive ? ' live' : ''}`, style: svcStyle(def.id), role: 'button', tabIndex: 0,
      onclick: () => enterService(def.id),
      onkeydown: (e) => { if (e.key === 'Enter') enterService(def.id); },
    },
    h('span', { class: 'sc-badge' }, statePill(s, 'light')),
    h('div', { class: 'sc-top' }, h('span', { class: 'sc-icon' }, icon(SVC[def.id].icon, 26)),
      h('div', {}, h('div', { class: 'sc-name' }, def.label), h('div', { class: 'sc-hours' }, def.horaires))),
    h('div', { class: 'sc-resp' }, s.responsable ? `Responsable : ${s.responsable}` : 'Aucun responsable pour l\'instant'),
    h('div', { class: 'sc-stats' },
      h('div', { class: 'sc-stat' }, h('b', {}, obs.length), h('span', {}, obs.length > 1 ? 'observations' : 'observation')),
      h('div', { class: 'sc-stat' }, h('b', {}, imp + boxAlerts(s).length), h('span', {}, imp + boxAlerts(s).length > 1 ? 'alertes' : 'alerte'))),
    h('div', { class: 'sc-actions' },
      h('button', { class: 'sc-detail', onclick: (e) => { e.stopPropagation(); openFiche(S.date, def.id); } }, icon('eye', 15), 'Voir le détail'),
      h('span', { class: 'sc-go' }, 'Ouvrir', icon('arrowRight', 15))));
  });
  $('#service-cards').replaceChildren(...cards);
  showScreen('service');
}

// Étape 3 : main courante du service choisi
async function enterService(id, view = 'saisie') {
  showScreen('app');
  setView(view, { silent: true });
  await goTo(S.date, id);
  const s = cur();
  if (!isClosed(s) && !s.responsable && S.user) {
    s.responsable = S.user;
    renderForm();
    renderTabs();
    markDirty();
  }
}

async function backToUsers() {
  await flush();
  S.users = await call(api.loadUsers());
  renderUserScreen();
}

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
      rememberAgents(target);
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

/* ---------- En-tête et onglets ---------- */

function renderHeader() {
  $('#date-text').textContent = fmtLongDate(S.date);
  $('#date-input').value = S.date;
  $('#data-dir').textContent = `${S.config.poste ? `Poste ${S.config.poste} · ` : ''}Données : ${S.config.dataDir}`;
  const av = $('#user-avatar');
  av.textContent = initials(S.user || '?');
  av.style.setProperty('--av', avatarColor(S.user || '?'));
  $('#user-name').textContent = S.user || '';
  $('#user-service').textContent = `Service ${SVC[S.service].label.toLowerCase()}`;
  document.body.dataset.service = S.service;
}

function renderTabs() {
  const tabs = M.SERVICES.map((def) => {
    const s = S.data[def.id];
    if (!s) return null;
    const alerts = boxAlerts(s).length + realObs(s).filter((o) => o.important).length;
    return h('div', {
      class: `tab${def.id === S.service ? ' active' : ''}`, style: svcStyle(def.id), role: 'button', tabIndex: 0,
      onclick: () => switchService(def.id),
    },
    h('span', { class: 't-icon' }, icon(SVC[def.id].icon, 20)),
    h('div', {}, h('div', { class: 't-title' }, def.label), h('div', { class: 't-sub' }, def.horaires, s.responsable ? ` · ${s.responsable}` : '')),
    h('div', { class: 't-state' },
      statePill(s),
      alerts ? h('span', { class: 'pill alert', title: 'Boxs ≥ 80 % et observations importantes' }, icon('alert', 12), alerts) : null),
    h('button', { class: 't-eye', title: 'Voir la fiche détaillée', 'aria-label': `Fiche du service ${def.label}`, onclick: (e) => { e.stopPropagation(); openFiche(S.date, def.id); } }, icon('eye', 17)));
  });
  $('#service-tabs').replaceChildren(...tabs.filter(Boolean));
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
    icon('alert'),
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

/* ---------- Formulaire de saisie ---------- */

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

function card(title, iconName, body, { wide = false, hint = null, cls = '' } = {}) {
  return h('div', { class: `card${wide ? ' wide' : ''} ${cls}` },
    h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon(iconName, 16)), title, hint ? h('span', { class: 'hint' }, hint) : null),
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
    h('span', { class: 'sb-icon' }, icon(def.icon, 26)),
    h('div', {}, h('div', { class: 'sb-date' }, fmtLongDate(S.date)), h('div', { class: 'sb-title' }, def.titre)),
    h('label', { class: 'sb-resp' }, 'Responsable', field('responsable', 'text', { placeholder: 'Nom du chef de service', list: 'users-list', 'aria-label': 'Responsable' })),
    h('datalist', { id: 'users-list' }, S.users.map((u) => h('option', { value: u }))),
    h('button', { class: 'btn', title: 'Fiche détaillée du service', onclick: () => openFiche(S.date, S.service) }, icon('eye', 16)),
    closed
      ? h('button', { class: 'btn', onclick: reopenService }, icon('unlock', 16), 'Rouvrir')
      : h('button', { class: 'btn solid', onclick: closeService }, icon('lock', 16), 'Clôturer le service'));

  const closedNote = closed
    ? h('div', { class: 'closed-note' }, icon('lock'), h('span', {}, h('b', {}, 'Service clôturé'), ` le ${fmtDateTime(s.cloture.at)}`,
      s.cloture.par ? ` par ${s.cloture.par}` : '', s.cloture.poste ? ` (poste ${s.cloture.poste})` : '',
      '. Les informations sont transmises au service suivant. « Rouvrir » pour corriger.'))
    : null;

  // Observations : en premier, avec une ligne de saisie rapide.
  const quickAdd = closed ? null : h('div', { class: 'quick-add' },
    h('input', { type: 'time', id: 'qa-heure', value: S.qa.heure || nowHHMM(), 'aria-label': 'Heure', oninput: (e) => { S.qa.heure = e.target.value; } }),
    h('input', {
      type: 'text', id: 'qa-texte', value: S.qa.texte, placeholder: 'Écrire une observation puis Entrée…', autocomplete: 'off',
      oninput: (e) => { S.qa.texte = e.target.value; },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); submitQuickAdd(); } },
    }),
    h('button', {
      class: `flag-btn${S.qa.important ? ' on' : ''}`, title: 'Marquer comme importante',
      onclick: (e) => { S.qa.important = !S.qa.important; e.currentTarget.classList.toggle('on', S.qa.important); },
    }, icon('flag', 15), 'Importante'),
    h('button', { class: 'btn accent', onclick: submitQuickAdd }, icon('plus', 16), 'Ajouter'));

  const obsRows = s.observations.map((o, i) => h('div', { class: `obs${o.important ? ' important' : ''}` },
    field(`observations.${i}.heure`, 'time', { 'aria-label': 'Heure' }),
    autoGrow(h('textarea', { 'data-bind': `observations.${i}.texte`, 'data-type': 'text', rows: 1, readOnly: closed, placeholder: 'Observation', value: o.texte })),
    h('div', { class: 'o-tools' },
      o.auteur ? h('span', { class: 'o-author', title: 'Saisie par' }, o.auteur) : null,
      closed ? null : h('button', { class: `o-btn flag${o.important ? ' on' : ''}`, title: o.important ? 'Retirer « importante »' : 'Marquer comme importante', onclick: () => toggleImportant(i) }, icon('flag', 16)),
      closed ? null : h('button', { class: 'o-btn rm', title: 'Supprimer', 'aria-label': 'Supprimer l\'observation', onclick: () => removeObservation(i) }, icon('trash', 16)))));

  const obs = card('Observations', 'note', [
    quickAdd,
    h('div', { class: 'obs-list', id: 'obs-list' }, obsRows.length ? obsRows : h('div', { class: 'empty' }, 'Aucune observation pour ce service.')),
    h('div', { class: 'obs-foot' }, h('span', { class: 'usage', id: 'calc-usage' }))],
  { wide: true, cls: 'obs-card', hint: 'Ctrl+O depuis n\'importe quel écran' });

  const consignes = card('Consignes pour la relève', 'send', h('div', { class: 'consignes' },
    autoGrow(h('textarea', {
      'data-bind': 'consignes', 'data-type': 'text', readOnly: closed, value: s.consignes,
      placeholder: 'Ce que le service suivant doit savoir ou faire : rotations à prévoir, matériel en panne, consignes du chef…',
    }))), { wide: true, hint: 'Affichées en priorité au service suivant' });

  const motifs = h('datalist', { id: 'motifs' }, M.MOTIFS.map((m) => h('option', { value: m })));
  const agentsList = h('datalist', { id: 'agents-list' }, S.agents.map((a) => h('option', { value: a })));
  const prevAbsents = S.prev ? S.prev.absents.filter((a) => a.nom) : [];
  const absents = card('Agents absents', 'users', [
    h('div', { class: 'absents' },
      s.absents.map((_, i) => h('div', { class: `absent${i >= M.NB_ABSENTS ? ' extra' : ''}` },
        field(`absents.${i}.nom`, 'text', { placeholder: 'Nom de l\'agent', list: 'agents-list', autocomplete: 'off' }),
        field(`absents.${i}.motif`, 'text', { placeholder: 'Motif', list: 'motifs' }),
        i >= M.NB_ABSENTS && !closed
          ? h('button', { class: 'o-btn rm', title: 'Retirer cette ligne', 'aria-label': 'Retirer cette ligne', onclick: () => removeAbsent(i) }, icon('x', 15))
          : h('span')))),
    closed ? null : h('div', { class: 'absents-foot' },
      h('button', { class: 'btn small', onclick: addAbsent }, icon('plus', 14), 'Ajouter un agent'),
      prevAbsents.length ? h('button', { class: 'btn small ghost', title: prevAbsents.map((a) => `${a.nom}${a.motif ? ` (${a.motif})` : ''}`).join(', '), onclick: takeOverAbsents }, icon('send', 14), `Reprendre les absents du service précédent (${prevAbsents.length})`) : null),
  ], { hint: s.absents.length > M.NB_ABSENTS ? 'À partir du 5e : reportés en N.B. sur Excel' : 'Noms proposés au fil de la frappe' });

  const entrees = card('Entrées — passages de véhicules', 'truck', h('div', { class: 'entrees' },
    h('label', { class: 'field' }, h('span', {}, 'Plateaux'), field('entrees.plateaux', 'int')),
    h('label', { class: 'field' }, h('span', {}, 'Poids lourds (PL)'), field('entrees.pl', 'int')),
    h('div', { class: 'total-box' }, h('span', {}, 'TOTAL'), h('b', { id: 'calc-entrees' }, '0'))));

  const sorties = card('Sorties', 'upload', h('table', { class: 'grid' },
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
  const boxs = card('État des boxs', 'box', h('div', { class: 'boxs' },
    h('div', {}, h('h4', {}, 'Bennes'), M.BENNES.map((b) => boxRow('bennes', b))),
    h('div', {}, h('h4', {}, 'Plateaux'), M.PLATEAUX.map((p) => boxRow('plateaux', p)))),
  { hint: `Remplissage en % · alerte à ${M.SEUIL_ALERTE} %` });

  $('#form').replaceChildren(...[banner, closedNote, obs, consignes, motifs, agentsList, absents, entrees, sorties, boxs].filter(Boolean));
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
  document.querySelectorAll('#form [data-bar]').forEach((bar) => {
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
    const next = document.querySelector(`[data-bind="observations.${Number(el.dataset.bind.split('.')[1]) + 1}.texte"]`);
    (next || document.getElementById('qa-texte') || el).focus();
  }
}

// Ajoute une observation au service affiché (saisie rapide ou fenêtre Ctrl+O).
function addObservation({ heure, texte, important }) {
  const s = cur();
  if (isClosed(s) || !texte.trim()) return false;
  s.observations.push({ heure: heure || nowHHMM(), texte: texte.trim(), important: !!important, auteur: S.user || '' });
  markDirty();
  return true;
}

function submitQuickAdd() {
  const heure = ($('#qa-heure') || {}).value || nowHHMM();
  const texte = ($('#qa-texte') || {}).value || '';
  if (!texte.trim()) {
    $('#qa-texte').focus();
    return;
  }
  addObservation({ heure, texte, important: S.qa.important });
  S.qa = { texte: '', heure: '', important: false };
  renderForm();
  renderTabs();
  $('#qa-texte').focus();
}

function addAbsent() {
  const s = cur();
  // On réutilise d'abord une des 4 lignes de la feuille si elle est vide.
  let i = s.absents.findIndex((a) => !a.nom && !a.motif);
  if (i === -1) {
    s.absents.push({ nom: '', motif: '' });
    i = s.absents.length - 1;
    markDirty();
  }
  renderForm();
  const el = document.querySelector(`[data-bind="absents.${i}.nom"]`);
  if (el) el.focus();
}

function removeAbsent(i) {
  cur().absents.splice(i, 1);
  renderForm();
  markDirty();
}

// Les absences durent souvent plusieurs services (CP, maladie…).
function takeOverAbsents() {
  const s = cur();
  const known = new Set(s.absents.filter((a) => a.nom).map((a) => a.nom.toLowerCase()));
  const toAdd = S.prev.absents.filter((a) => a.nom && !known.has(a.nom.toLowerCase()));
  if (!toAdd.length) {
    toast('Ces agents sont déjà dans la liste.');
    return;
  }
  const filled = s.absents.filter((a) => a.nom || a.motif);
  s.absents = [...filled, ...toAdd.map((a) => ({ nom: a.nom, motif: a.motif }))];
  while (s.absents.length < M.NB_ABSENTS) s.absents.push({ nom: '', motif: '' });
  renderForm();
  markDirty();
  toast(`${toAdd.length} agent(s) repris du service précédent — vérifiez les motifs.`);
}

function rememberAgents(s) {
  const lower = new Set(S.agents.map((a) => a.toLowerCase()));
  const fresh = s.absents.map((a) => a.nom.trim()).filter((n) => n && !lower.has(n.toLowerCase()));
  if (!fresh.length) return;
  S.agents = [...S.agents, ...fresh].sort((a, b) => a.localeCompare(b, 'fr'));
  const list = document.getElementById('agents-list');
  if (list) list.replaceChildren(...S.agents.map((n) => h('option', { value: n })));
}

function toggleImportant(i) {
  const o = cur().observations[i];
  o.important = !o.important;
  renderForm();
  renderTabs();
  markDirty();
}

function removeObservation(i) {
  cur().observations.splice(i, 1);
  renderForm();
  renderTabs();
  markDirty();
}

function openQuickObs() {
  if (S.screen !== 'app') return;
  if (isClosed(cur())) {
    toast('Ce service est clôturé : rouvrez-le pour ajouter une observation.');
    return;
  }
  const dlg = $('#quickobs');
  $('#quickobs-target').textContent = `Service ${SVC[S.service].label.toLowerCase()} du ${fmtLongDate(S.date)} · ${S.user}`;
  $('#qo-heure').value = nowHHMM();
  $('#qo-texte').value = '';
  $('#qo-important').checked = false;
  dlg.returnValue = '';
  dlg.showModal();
  $('#qo-texte').focus();
}

function onQuickObsClose() {
  if ($('#quickobs').returnValue !== 'ok') return;
  const added = addObservation({ heure: $('#qo-heure').value, texte: $('#qo-texte').value, important: $('#qo-important').checked });
  if (!added) return;
  renderForm();
  renderTabs();
  if (S.view === 'journal') renderJournal({ reload: true });
  toast('Observation ajoutée.');
}

async function closeService() {
  const s = cur();
  const warnings = [];
  if (!s.responsable) warnings.push('• Le responsable n\'est pas renseigné.');
  if (M.BENNES.every((b) => s.bennes[b] == null) && M.PLATEAUX.every((p) => s.plateaux[p] == null)) warnings.push('• L\'état des boxs n\'est pas renseigné.');
  if (!realObs(s).length) warnings.push('• Aucune observation saisie.');
  if (!s.consignes) warnings.push('• Aucune consigne pour la relève.');
  const text = `Le service ${SVC[S.service].label.toLowerCase()} du ${fmtLongDate(S.date)} sera marqué comme terminé et transmis au service suivant.${warnings.length ? `\n\nÀ vérifier :\n${warnings.join('\n')}` : ''}`;
  const r = await ask('Clôturer le service ?', text, [
    { label: 'Annuler', value: 'no' },
    { label: 'Clôturer', value: 'yes', cls: 'primary' },
  ]);
  if (r !== 'yes') return;
  s.cloture = { at: new Date().toISOString(), par: s.responsable || S.user || null, poste: S.config.poste || null };
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

/* ---------- Relève (service précédent) ---------- */

function renderPassation() {
  const p = M.previousService(S.date, S.service);
  const prev = S.prev;
  const def = SVC[p.service];
  const style = { '--pc': def.couleur, '--pc2': def.c2 };
  const head = h('div', { class: 'pass-head' }, icon('send'),
    h('div', {}, h('div', { class: 'ph-title' }, `Relève · ${def.label}`), h('div', { class: 'ph-sub' }, fmtLongDate(p.date))),
    h('button', { class: 'btn small', onclick: () => openFiche(p.date, p.service) }, icon('eye', 14), 'Détail'));

  if (!prev || M.isEmpty(prev)) {
    $('#passation').replaceChildren(h('div', { class: 'card', style }, head,
      h('div', { class: 'pass-section' }, h('div', { class: 'empty' }, 'Le service précédent n\'a rien saisi.'))));
    return;
  }

  const t = M.totals(prev);
  const alerts = boxAlerts(prev);
  const obs = realObs(prev);
  const important = obs.filter((o) => o.important);
  const absents = prev.absents.filter((a) => a.nom);
  const obsItem = (o) => h('li', { class: o.important ? 'important' : '' }, h('b', {}, o.heure || ''), h('span', {}, o.texte));

  const cardEl = h('div', { class: 'card', style }, head,
    h('div', { class: 'pass-section' },
      h('div', { class: 'kv' }, h('span', {}, 'Responsable'), h('b', {}, prev.responsable || '—')),
      h('div', { class: 'kv' }, h('span', {}, 'État'), isClosed(prev) ? h('span', { class: 'pill done' }, icon('lock', 12), `Clôturé ${fmtDateTime(prev.cloture.at)}`) : h('span', { class: 'pill draft' }, 'Non clôturé'))),
    h('div', { class: 'pass-section' }, h('h5', {}, icon('send', 13), 'Consignes'),
      prev.consignes ? h('div', { class: 'pass-consignes' }, prev.consignes) : h('div', { class: 'empty' }, 'Aucune consigne transmise.')),
    important.length ? h('div', { class: 'pass-section' }, h('h5', {}, icon('flag', 13), `Observations importantes (${important.length})`),
      h('ul', { class: 'pass-obs' }, important.map(obsItem))) : null,
    h('div', { class: 'pass-section' }, h('h5', {}, icon('box', 13), `Boxs à ${M.SEUIL_ALERTE} % ou plus`),
      alerts.length
        ? h('div', { class: 'alert-list' }, alerts.map((a) => h('span', { class: 'pill alert' }, `${a.type} ${a.nom} : ${fmtNum(a.v)} %`)))
        : h('div', { class: 'empty' }, 'Aucun box en alerte.'),
      isClosed(cur()) ? null : h('button', { class: 'btn small', style: { marginTop: '8px' }, onclick: takeOverBoxes }, 'Reprendre l\'état des boxs')),
    h('div', { class: 'pass-section' }, h('h5', {}, icon('note', 13), `Toutes les observations (${obs.length})`),
      obs.length ? h('ul', { class: 'pass-obs' }, obs.map(obsItem)) : h('div', { class: 'empty' }, 'Aucune observation.')),
    h('div', { class: 'pass-section' }, h('h5', {}, icon('chart', 13), 'Activité'),
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

/* ---------- Fiche détaillée d'un service ---------- */

async function openFiche(date, service) {
  await flush();
  const data = date === S.date && S.data[service] ? S.data[service] : await call(api.loadService(date, service));
  S.fiche = { date, service, data };
  renderFiche();
  const dlg = $('#fiche');
  if (!dlg.open) dlg.showModal();
}

function highlight(text, q) {
  if (!q) return text;
  const out = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  for (let j = lower.indexOf(needle); j !== -1; j = lower.indexOf(needle, i)) {
    out.push(text.slice(i, j), h('mark', {}, text.slice(j, j + needle.length)));
    i = j + needle.length;
  }
  out.push(text.slice(i));
  return out;
}

function obsEntry(o, q = '') {
  return h('div', { class: `j-entry${o.important ? ' important' : ''}` },
    h('span', { class: 'je-time' }, o.heure || '—'),
    h('span', { class: 'je-text' }, o.important ? h('b', {}, '⚠ ') : null, highlight(o.texte, q)),
    o.auteur ? h('span', { class: 'je-author' }, o.auteur) : h('span'));
}

function renderFiche() {
  const { date, service, data: s } = S.fiche;
  const def = SVC[service];
  const t = M.totals(s);
  const obs = realObs(s);
  const absents = s.absents.filter((a) => a.nom || a.motif);
  const step = (dir) => {
    const n = dir < 0 ? M.previousService(date, service) : M.nextService(date, service);
    return openFiche(n.date, n.service);
  };
  const miniBar = (nom, v) => h('div', { class: 'mini-bar' }, h('span', {}, nom),
    h('div', { class: `bar${v >= M.SEUIL_ALERTE ? ' alert' : ''}` }, h('i', { style: { width: `${Math.min(100, v || 0)}%` } })),
    h('span', { class: v >= M.SEUIL_ALERTE ? 'red' : '' }, v == null ? '—' : `${fmtNum(v)} %`));
  const ficheCard = (title, iconName, body) => h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon(iconName, 16)), title), h('div', { class: 'card-body' }, body));
  const subTitle = (txt, top) => h('h4', { class: 'muted', style: { margin: `${top}px 0 6px`, fontSize: '11.5px', letterSpacing: '.6px' } }, txt);

  const body = h('div', { style: svcStyle(service) },
    h('div', { class: 'fiche-head' },
      h('span', { class: 'fh-icon' }, icon(def.icon, 26)),
      h('div', {}, h('div', { class: 'fh-title' }, `Service ${def.label.toLowerCase()} · ${def.horaires}`), h('div', { class: 'fh-sub' }, fmtLongDate(date))),
      h('div', { class: 'fh-nav' },
        statePill(s, 'light'),
        h('button', { class: 'icon-btn', title: 'Service précédent', onclick: () => step(-1) }, icon('chevronLeft')),
        h('button', { class: 'icon-btn', title: 'Service suivant', onclick: () => step(1) }, icon('chevronRight')),
        h('button', { class: 'icon-btn', title: 'Fermer', onclick: () => $('#fiche').close() }, icon('x')))),
    h('div', { class: 'fiche-tabs' }, M.SERVICES.map((d) => h('button', {
      class: d.id === service ? 'on' : '', style: { '--tc': d.couleur }, onclick: () => openFiche(date, d.id),
    }, icon(SVC[d.id].icon, 15), d.label))),
    h('div', { class: 'fiche-content' },
      h('div', { class: 'fiche-col' },
        ficheCard(`Observations (${obs.length})`, 'note', obs.length ? h('div', { class: 'fiche-obs' }, obs.map((o) => obsEntry(o))) : h('div', { class: 'empty' }, 'Aucune observation.')),
        ficheCard('Consignes pour la relève', 'send', s.consignes ? h('div', { class: 'pass-consignes' }, s.consignes) : h('div', { class: 'empty' }, 'Aucune consigne.'))),
      h('div', { class: 'fiche-col' },
        ficheCard('Service', 'user', [
          h('div', { class: 'kv' }, h('span', {}, 'Responsable'), h('b', {}, s.responsable || '—')),
          h('div', { class: 'kv' }, h('span', {}, 'État'), isClosed(s) ? h('span', {}, `Clôturé le ${fmtDateTime(s.cloture.at)}${s.cloture.par ? ` par ${s.cloture.par}` : ''}`) : h('span', {}, serviceState(s).label)),
          s.updatedAt ? h('div', { class: 'kv' }, h('span', {}, 'Dernière saisie'), h('span', {}, `${fmtDateTime(s.updatedAt)}${s.updatedBy ? ` · ${s.updatedBy}` : ''}`)) : null,
          h('div', { class: 'kv' }, h('span', {}, 'Absents'), h('span', {}, absents.length ? absents.map((a) => `${a.nom}${a.motif ? ` (${a.motif})` : ''}`).join(', ') : 'Aucun')),
        ]),
        ficheCard('Activité', 'truck', [
          h('div', { class: 'fiche-kpis' },
            h('div', {}, h('b', {}, fmtNum(t.entrees)), h('span', {}, `Entrées (${fmtNum(s.entrees.plateaux || 0)} plat. · ${fmtNum(s.entrees.pl || 0)} PL)`)),
            h('div', {}, h('b', {}, fmtNum(t.sortiesNb)), h('span', {}, 'Sorties')),
            h('div', {}, h('b', {}, fmtNum(t.tonnage)), h('span', {}, 'Tonnes'))),
          h('table', { class: 'simple', style: { marginTop: '10px' } },
            h('tbody', {}, M.MATIERES.filter((m) => s.sorties[m].nb != null || s.sorties[m].tonnage != null).map((m) => h('tr', {},
              h('td', {}, m), h('td', {}, plural(s.sorties[m].nb || 0, 'sortie')),
              h('td', {}, M.MATIERES_EXTERNES.includes(m) ? 'externe' : fmtTon(s.sorties[m].tonnage))))),
            h('tfoot', {}, h('tr', { class: 'tot' }, h('td', {}, 'Total'), h('td', {}, plural(t.sortiesNb, 'sortie')), h('td', {}, fmtTon(t.tonnage))))),
        ]),
        ficheCard('État des boxs', 'box', [
          subTitle('BENNES', 0), M.BENNES.map((b) => miniBar(b, s.bennes[b])),
          subTitle('PLATEAUX', 10), M.PLATEAUX.map((p) => miniBar(p, s.plateaux[p])),
        ]))),
    h('div', { class: 'fiche-foot' },
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost', onclick: () => $('#fiche').close() }, 'Fermer'),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          $('#fiche').close();
          if (S.screen !== 'app') {
            S.date = date;
            await enterService(service);
          } else {
            setView('saisie', { silent: true });
            await goTo(date, service);
          }
        },
      }, icon('edit', 16), 'Ouvrir en saisie')));
  $('#fiche-body').replaceChildren(body);
}

/* ---------- Journal des observations ---------- */

function journalRange() {
  const p = S.journal.period;
  if (p === 'jour') return [S.date, S.date];
  if (p === 'semaine') return [M.addDays(S.date, -6), S.date];
  const d = M.parseISODate(S.date);
  const days = M.daysInMonth(d.getFullYear(), d.getMonth() + 1);
  return [days[0], days[days.length - 1]];
}

async function renderJournal({ reload = false } = {}) {
  const J = S.journal;
  const [from, to] = journalRange();
  const key = `${from}_${to}`;
  if (reload || J.key !== key || !J.days) {
    await flush();
    J.days = await call(api.loadRange(from, to));
    J.key = key;
  }
  if (!$('#journal-bar')) buildJournalBar();
  $('#journal-bar').querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.period === J.period));
  $('#journal-bar').querySelectorAll('.chip[data-svc]').forEach((c) => c.classList.toggle('off', J.hidden.has(c.dataset.svc)));
  $('#j-imp').classList.toggle('on-red', J.importantOnly);

  const q = J.q.trim();
  const ql = q.toLowerCase();
  let count = 0;
  const groups = [...J.days].reverse().map((day) => {
    const svcs = M.SERVICES.filter((d) => !J.hidden.has(d.id)).map((d) => {
      const s = day.services[d.id];
      let obs = realObs(s);
      if (J.importantOnly) obs = obs.filter((o) => o.important);
      if (ql) obs = obs.filter((o) => o.texte.toLowerCase().includes(ql) || (o.auteur || '').toLowerCase().includes(ql));
      const showConsignes = s.consignes && !J.importantOnly && (!ql || s.consignes.toLowerCase().includes(ql));
      if (!obs.length && !showConsignes) return null;
      count += obs.length;
      return h('div', { class: 'j-svc', style: svcStyle(d.id) },
        h('div', { class: 'j-svc-head' },
          h('span', { class: 'js-ico' }, icon(SVC[d.id].icon, 18)),
          h('span', { class: 'js-name' }, `${d.label} · ${d.horaires}`),
          h('span', { class: 'js-resp' }, s.responsable ? `Responsable : ${s.responsable}` : ''),
          statePill(s),
          h('button', { class: 'btn small ghost', onclick: () => openFiche(day.date, d.id) }, icon('eye', 14), 'Fiche'),
          h('button', { class: 'btn small ghost', onclick: () => { setView('saisie', { silent: true }); goTo(day.date, d.id); } }, icon('edit', 14), 'Saisie')),
        obs.map((o) => obsEntry(o, q)),
        showConsignes ? h('div', { class: 'j-consignes' }, h('div', { class: 'pass-consignes' }, h('b', {}, 'Consignes relève : '), highlight(s.consignes, q))) : null);
    }).filter(Boolean);
    if (!svcs.length) return null;
    return h('div', { class: 'j-day' }, h('h3', { class: 'j-day-title' }, fmtLongDate(day.date)), svcs);
  }).filter(Boolean);

  $('#j-count').textContent = plural(count, 'observation');
  $('#journal-list').replaceChildren(...(groups.length ? groups : [h('div', { class: 'j-empty' }, icon('note', 32),
    h('p', {}, ql || J.importantOnly ? 'Aucune observation ne correspond à la recherche.' : 'Aucune observation sur cette période.'))]));
}

function buildJournalBar() {
  const J = S.journal;
  const bar = h('div', { class: 'journal-bar', id: 'journal-bar' },
    h('div', { class: 'search' }, icon('search', 16),
      h('input', { type: 'text', id: 'j-search', placeholder: 'Rechercher dans les observations et consignes…', value: J.q, oninput: (e) => { J.q = e.target.value; renderJournal(); } })),
    h('div', { class: 'seg' }, [['jour', 'Journée'], ['semaine', '7 jours'], ['mois', 'Mois']].map(([p, label]) => h('button', {
      'data-period': p, onclick: () => { J.period = p; renderJournal(); },
    }, label))),
    M.SERVICES.map((d) => h('button', {
      class: 'chip', 'data-svc': d.id, style: { '--c': d.couleur },
      onclick: () => { if (J.hidden.has(d.id)) J.hidden.delete(d.id); else J.hidden.add(d.id); renderJournal(); },
    }, h('span', { class: 'sw' }), d.label)),
    h('button', { class: 'chip', id: 'j-imp', onclick: () => { J.importantOnly = !J.importantOnly; renderJournal(); } }, icon('flag', 13), 'Importantes'),
    h('span', { class: 'muted', id: 'j-count' }),
    h('button', { class: 'btn accent small', onclick: openQuickObs }, icon('plus', 15), 'Observation'));
  $('#journal').replaceChildren(bar, h('div', { id: 'journal-list' }));
}

/* ---------- Navigation ---------- */

async function goTo(date, service = S.service) {
  await flush();
  S.date = date;
  S.service = service;
  S.conflict = null;
  await loadDay();
  renderSaisie();
  if (S.view === 'recap') {
    const d = M.parseISODate(date);
    S.recapMonth = { year: d.getFullYear(), month: d.getMonth() + 1 };
    await renderRecap();
  }
  if (S.view === 'journal') await renderJournal();
  const c = cur();
  setStatus(c.updatedAt ? `Dernier enregistrement ${fmtDateTime(c.updatedAt)}${c.updatedBy ? ` · ${c.updatedBy}` : ''}` : 'Aucune saisie pour ce service');
}

async function switchService(id) {
  if (id === S.service) return;
  await flush();
  S.service = id;
  await loadPrev();
  renderSaisie();
}

function setView(view, { silent = false } = {}) {
  S.view = view;
  document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#view-saisie').hidden = view !== 'saisie';
  $('#view-journal').hidden = view !== 'journal';
  $('#view-recap').hidden = view !== 'recap';
  if (silent) return;
  if (view === 'recap') {
    const d = M.parseISODate(S.date);
    S.recapMonth = { year: d.getFullYear(), month: d.getMonth() + 1 };
    flush().then(renderRecap);
  }
  if (view === 'journal') renderJournal({ reload: true }).then(() => $('#j-search').focus());
}

// Recharge les services modifiés depuis un autre poste.
async function poll() {
  if (document.hidden || S.screen !== 'app' || S.view !== 'saisie' || S.saving || $('#fiche').open) return;
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
      const active = document.activeElement;
      const focused = active && active.dataset && active.dataset.bind ? `[data-bind="${active.dataset.bind}"]` : active && active.id ? `#${active.id}` : null;
      renderForm();
      if (focused) {
        const el = document.querySelector(focused);
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
  const tot = { plateaux: 0, pl: 0, entrees: 0, nb: 0, tonnage: 0, absents: 0, clos: 0, saisis: 0, obs: 0 };
  const n = (v) => (typeof v === 'number' ? v : 0);
  const today = M.toISODate(new Date());

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
      const obs = realObs(s);
      row.obs += obs.length;
      row.alerts += boxAlerts(s).length + obs.filter((o) => o.important).length;
      const cls = isClosed(s) ? 'done' : empty ? '' : 'draft';
      return h('button', {
        class: `dot ${cls}`, style: { '--c': def.couleur },
        title: `${def.label} : ${isClosed(s) ? 'clôturé' : empty ? 'vide' : 'non clôturé'}${s.responsable ? ` — ${s.responsable}` : ''} (voir la fiche)`,
        onclick: (e) => { e.stopPropagation(); openFiche(d.date, def.id); },
      });
    });
    tot.plateaux += row.plateaux;
    tot.pl += row.pl;
    tot.nb += row.nb;
    tot.tonnage += row.tonnage;
    tot.absents += row.absents;
    tot.obs += row.obs;
    const wd = M.parseISODate(d.date).getDay();
    const firstFilled = M.SERVICES.find((def) => !M.isEmpty(d.services[def.id]));
    return h('tr', {
      class: `${wd === 0 || wd === 6 ? 'weekend' : ''}${d.date === today ? ' today' : ''}`,
      title: 'Voir le détail de la journée',
      onclick: () => openFiche(d.date, firstFilled ? firstFilled.id : 'matin'),
    },
    h('td', {}, fmtShortDate(d.date)),
    h('td', {}, h('span', { class: 'dots' }, dots)),
    h('td', {}, row.plateaux || ''), h('td', {}, row.pl || ''), h('td', {}, h('b', {}, row.plateaux + row.pl || '')),
    h('td', {}, row.nb || ''), h('td', {}, row.tonnage ? fmtTon(row.tonnage) : ''),
    h('td', {}, row.absents || ''), h('td', {}, row.obs || ''),
    h('td', {}, row.alerts ? h('span', { class: 'pill alert' }, row.alerts) : ''));
  });
  tot.entrees = tot.plateaux + tot.pl;

  const moveMonth = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    S.recapMonth = { year: d.getFullYear(), month: d.getMonth() + 1 };
    renderRecap();
  };
  const kpi = (label, value, iconName, color, soft) => h('div', { class: 'kpi', style: { '--k': color, '--k-soft': soft } },
    h('span', { class: 'k-icon' }, icon(iconName, 20)), h('div', {}, h('div', { class: 'k-label' }, label), h('div', { class: 'k-value' }, value)));
  const maxTon = Math.max(1, ...M.MATIERES.map((m) => parMatiere[m].tonnage));
  const maxNb = Math.max(1, ...M.MATIERES.map((m) => parMatiere[m].nb));

  $('#recap').replaceChildren(
    h('div', { class: 'recap-head' },
      h('button', { class: 'icon-btn', onclick: () => moveMonth(-1), 'aria-label': 'Mois précédent' }, icon('chevronLeft')),
      h('h2', {}, fmtMonth(year, month)),
      h('button', { class: 'icon-btn', onclick: () => moveMonth(1), 'aria-label': 'Mois suivant' }, icon('chevronRight')),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => exportMonth(year, month) }, icon('download', 16), 'Exporter ce mois en Excel')),
    h('div', { class: 'kpis' },
      kpi('Entrées (passages)', fmtNum(tot.entrees), 'truck', '#2e75b6', '#e7f1fb'),
      kpi('Sorties · tonnage', `${fmtNum(tot.nb)} · ${fmtNum(Math.round(tot.tonnage * 10) / 10)} T`, 'upload', '#c55a11', '#fdf0e6'),
      kpi('Observations', fmtNum(tot.obs), 'note', '#8e44ad', '#f3e8fa'),
      kpi('Services clôturés', `${tot.clos} / ${days.length * 3}`, 'lock', '#1f8a4c', '#e5f6ec')),
    h('div', { class: 'recap-grid' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('list', 16)), 'Par jour', h('span', { class: 'hint' }, 'Cliquer sur un jour ou une pastille pour voir le détail')),
        h('div', { class: 'card-body' },
          h('table', { class: 'grid recap' },
            h('thead', {}, h('tr', {}, ['Jour', 'Services', 'Plateaux', 'PL', 'Entrées', 'Sorties', 'Tonnage', 'Absents', 'Obs.', 'Alertes'].map((x) => h('th', {}, x)))),
            h('tbody', {}, rows),
            h('tfoot', {}, h('tr', {}, h('td', {}, 'Total'), h('td', {}, `${tot.saisis} saisis`), h('td', {}, fmtNum(tot.plateaux)), h('td', {}, fmtNum(tot.pl)),
              h('td', {}, fmtNum(tot.entrees)), h('td', {}, fmtNum(tot.nb)), h('td', {}, fmtTon(tot.tonnage)), h('td', {}, tot.absents), h('td', {}, tot.obs), h('td', {})))),
          h('div', { class: 'legend' },
            M.SERVICES.map((def) => h('span', {}, h('span', { class: 'dot done', style: { '--c': def.couleur } }), ` ${def.label}`)),
            h('span', {}, '● clôturé · ◐ non clôturé · ○ vide')))),
      h('div', { class: 'recap-side' },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('upload', 16)), 'Sorties par matière'),
          h('div', { class: 'card-body' }, M.MATIERES.map((m) => {
            const ext = M.MATIERES_EXTERNES.includes(m);
            const ratio = ext ? parMatiere[m].nb / maxNb : parMatiere[m].tonnage / maxTon;
            return h('div', { class: 'matiere-row' }, h('span', {}, m),
              h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(ratio * 100)}%` } })),
              h('b', {}, fmtNum(parMatiere[m].nb)),
              h('span', {}, ext ? 'externe' : fmtTon(parMatiere[m].tonnage)));
          }))),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('users', 16)), 'Absences par motif'),
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
    const noBorder = () => h('td', { style: { border: 0 } });
    const boxRows = M.MATIERES.map((m, i) => {
      const b = M.BENNES[i];
      const p = M.PLATEAUX[i];
      return h('tr', {},
        h('td', {}, m), h('td', { class: 'c' }, s.sorties[m].nb ?? ''),
        M.MATIERES_EXTERNES.includes(m) ? h('td', { class: 'ext' }, 'service externe') : h('td', { class: 'c' }, s.sorties[m].tonnage != null ? fmtTon(s.sorties[m].tonnage) : ''),
        b ? h('td', {}, b) : noBorder(), b ? pctCell(s.bennes[b]) : noBorder(),
        p ? h('td', {}, p) : noBorder(), p ? pctCell(s.plateaux[p]) : noBorder());
    });
    return h('div', { class: 'p-page', style: { '--c': def.couleur } },
      h('div', { class: 'p-title' }, 'MAIN COURANTE  ·  TRONC PRINCIPAL'),
      h('div', { class: 'p-band' }, h('span', { style: { textTransform: 'capitalize' } }, fmtShortDate(S.date)), h('span', { class: 'p-st' }, def.titre),
        h('span', { class: 'p-rl' }, 'Responsable'), h('span', { class: 'p-resp' }, s.responsable || '')),
      h('div', { class: 'p-sec' }, 'AGENTS ABSENTS'),
      h('table', {}, h('tr', {}, h('th', {}, 'Nom'), h('th', {}, 'Motif'), h('th', {}, 'Nom'), h('th', {}, 'Motif')),
        Array.from({ length: Math.ceil(s.absents.length / 2) }, (_, r) => {
          const a = s.absents[2 * r];
          const b = s.absents[2 * r + 1] || { nom: '', motif: '' };
          return h('tr', {}, h('td', {}, a.nom), h('td', { class: 'c' }, a.motif), h('td', {}, b.nom), h('td', { class: 'c' }, b.motif));
        })),
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

/* ---------- Mises à jour ---------- */

const UPDATE_CHECK_MS = 30 * 60 * 1000;
let updateInfo = null;
let updateDismissed = null;

async function checkUpdate() {
  try {
    updateInfo = await call(api.checkUpdate());
  } catch {
    return;
  }
  const u = updateInfo.update;
  const banner = $('#update-banner');
  if (!u || updateDismissed === u.version) {
    banner.hidden = true;
    return;
  }
  $('#update-title').textContent = `Nouvelle version ${u.version} disponible`;
  $('#update-sub').textContent = `Version actuelle : ${updateInfo.current}. L'installation prend environ 30 secondes.`;
  banner.hidden = false;
}

async function installUpdate() {
  const u = updateInfo && updateInfo.update;
  if (!u) return;
  const portable = updateInfo.kind === 'portable';
  const r = await ask(`Installer la version ${u.version} ?`,
    portable
      ? 'Les saisies sont enregistrées, puis la nouvelle version est copiée à côté de celle-ci et lancée. Vous pourrez supprimer l\'ancien fichier.'
      : 'Les saisies sont enregistrées, puis l\'application se ferme, s\'installe et se relance toute seule. Vos données ne sont pas modifiées.',
    [{ label: 'Annuler', value: 'no' }, { label: 'Installer maintenant', value: 'yes', cls: 'primary' }]);
  if (r !== 'yes') return;
  await flush();
  try {
    await call(api.installUpdate());
    toast('Installation en cours… l\'application va redémarrer.', 10000);
  } catch (err) {
    ask('Mise à jour impossible', err.message, [{ label: 'OK', value: 'ok', cls: 'primary' }]);
  }
}

function initUpdates() {
  $('#update-install').addEventListener('click', installUpdate);
  $('#update-later').addEventListener('click', () => {
    updateDismissed = updateInfo && updateInfo.update ? updateInfo.update.version : null;
    $('#update-banner').hidden = true;
  });
  $('#set-update-dir').addEventListener('click', () => call(api.openUpdateDir()));
  checkUpdate();
  setInterval(checkUpdate, UPDATE_CHECK_MS);
}

/* ---------- Paramètres ---------- */

let settingsUsers = [];
let settingsAgents = [];

function renderSettingsAgents() {
  $('#set-agents').replaceChildren(...(settingsAgents.length
    ? settingsAgents.map((u, i) => h('span', { class: 'chip' }, u,
      h('button', { type: 'button', title: `Retirer ${u}`, onclick: () => { settingsAgents.splice(i, 1); renderSettingsAgents(); } }, icon('x', 14))))
    : [h('span', { class: 'muted' }, 'Aucun agent mémorisé pour l\'instant : ils s\'ajoutent tout seuls à la saisie des absents.')]));
}

function renderSettingsUsers() {
  $('#set-users').replaceChildren(...(settingsUsers.length
    ? settingsUsers.map((u, i) => h('span', { class: 'chip' }, u,
      h('button', { type: 'button', title: `Retirer ${u}`, onclick: () => { settingsUsers.splice(i, 1); renderSettingsUsers(); } }, icon('x', 14))))
    : [h('span', { class: 'muted' }, 'Aucun responsable.')]));
}

function openSettings() {
  $('#set-poste').value = S.config.poste || '';
  $('#set-dir').value = S.config.dataDir;
  settingsUsers = [...S.users];
  renderSettingsUsers();
  settingsAgents = [...S.agents];
  renderSettingsAgents();
  $('#set-version').textContent = updateInfo ? `Liaison ${updateInfo.current}${updateInfo.update ? ` — version ${updateInfo.update.version} disponible` : ' — à jour'}` : '';
  $('#settings').showModal();
}

function initSettings() {
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-settings-welcome').addEventListener('click', openSettings);
  $('#set-dir-btn').addEventListener('click', async () => {
    const dir = await call(api.chooseDir());
    if (dir) $('#set-dir').value = dir;
  });
  const addUser = () => {
    const v = $('#set-user-new').value.trim();
    if (v && !settingsUsers.includes(v)) settingsUsers.push(v);
    $('#set-user-new').value = '';
    renderSettingsUsers();
  };
  $('#set-user-add').addEventListener('click', addUser);
  const addAgent = () => {
    const v = $('#set-agent-new').value.trim();
    if (v && !settingsAgents.some((a) => a.toLowerCase() === v.toLowerCase())) settingsAgents.push(v);
    settingsAgents.sort((a, b) => a.localeCompare(b, 'fr'));
    $('#set-agent-new').value = '';
    renderSettingsAgents();
  };
  $('#set-agent-add').addEventListener('click', addAgent);
  $('#set-agent-new').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addAgent();
    }
  });
  $('#set-user-new').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addUser();
    }
  });
  $('#set-open').addEventListener('click', () => call(api.openDataDir()));
  $('#settings').addEventListener('close', async () => {
    if ($('#settings').returnValue !== 'save') return;
    await flush();
    const dirChanged = $('#set-dir').value !== S.config.dataDir;
    S.config = await call(api.setConfig({ poste: $('#set-poste').value.trim(), dataDir: $('#set-dir').value }));
    // Un dossier partagé qui a déjà sa liste de responsables la garde.
    const existing = dirChanged ? await call(api.loadUsers()) : [];
    S.users = await call(api.saveUsers(dirChanged && existing.length ? existing : settingsUsers));
    S.agents = dirChanged ? await call(api.loadAgents()) : await call(api.saveAgents(settingsAgents));
    toast('Paramètres enregistrés.');
    checkUpdate();
    if (S.screen === 'user') renderUserScreen();
    else if (S.screen === 'service') renderServiceScreen();
    else await goTo(S.date);
  });
}

/* ---------- Démarrage ---------- */

async function init() {
  decorate();
  S.config = await call(api.getConfig());
  S.users = await call(api.loadUsers());
  S.agents = await call(api.loadAgents());
  const live = M.currentService();
  S.date = live.date;
  S.service = live.service;

  const form = $('#form');
  form.addEventListener('input', onFormInput);
  form.addEventListener('focusout', onFormBlur);
  form.addEventListener('keydown', onFormKey);

  // Écran de choix du service
  const liveFor = () => (M.currentService().date === S.date ? M.currentService().service : 'matin');
  $('#btn-back-user').addEventListener('click', backToUsers);
  $('#svc-prev-day').addEventListener('click', () => { S.date = M.addDays(S.date, -1); renderServiceScreen(); });
  $('#svc-next-day').addEventListener('click', () => { S.date = M.addDays(S.date, 1); renderServiceScreen(); });
  $('#svc-today').addEventListener('click', () => { S.date = M.currentService().date; renderServiceScreen(); });
  $('#svc-date-input').addEventListener('change', (e) => { if (e.target.value) { S.date = e.target.value; renderServiceScreen(); } });
  $('#btn-go-journal').addEventListener('click', async () => {
    await enterService(liveFor(), 'journal');
    setView('journal');
  });
  $('#btn-go-recap').addEventListener('click', async () => {
    await enterService(liveFor(), 'recap');
    setView('recap');
  });

  // Main courante
  $('#prev-day').addEventListener('click', () => goTo(M.addDays(S.date, -1)));
  $('#next-day').addEventListener('click', () => goTo(M.addDays(S.date, 1)));
  $('#date-input').addEventListener('change', (e) => e.target.value && goTo(e.target.value));
  $('#btn-now').addEventListener('click', () => {
    const l = M.currentService();
    setView('saisie', { silent: true });
    goTo(l.date, l.service);
  });
  document.querySelectorAll('.view-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#btn-user').addEventListener('click', async () => {
    await flush();
    renderServiceScreen();
  });
  $('#btn-quick-obs').addEventListener('click', openQuickObs);
  $('#quickobs').addEventListener('close', onQuickObsClose);
  $('#qo-texte').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $('#quickobs').close('ok');
    }
  });
  $('#btn-export-day').addEventListener('click', exportDay);
  $('#btn-export-month').addEventListener('click', () => exportMonth());
  $('#btn-import').addEventListener('click', doImport);
  $('#btn-print').addEventListener('click', doPrint);
  $('#fiche').addEventListener('click', (e) => {
    if (e.target === $('#fiche')) $('#fiche').close(); // clic en dehors de la fiche
  });
  initSettings();
  initUpdates();

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      flush();
    } else if (k === 'p' && S.screen === 'app') {
      e.preventDefault();
      doPrint();
    } else if (k === 'o' && S.screen === 'app') {
      e.preventDefault();
      openQuickObs();
    }
  });
  window.addEventListener('beforeunload', () => {
    if (S.dirty) save();
  });

  renderUserScreen();
  if (S.config.firstRun) openSettings();
  setInterval(poll, POLL_MS);
}

init().catch((err) => {
  document.body.replaceChildren(h('pre', { style: { padding: '20px', color: '#c00000' } }, `Erreur au démarrage : ${err.message}`));
});
