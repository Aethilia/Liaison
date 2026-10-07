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
  sites: [], // sites connus de ce poste : { dataDir, nom, responsables, superviseurs, actif }
  role: 'responsable', // ou 'superviseur'
  siteName: '',
  agents: [], // agents déjà saisis comme absents (proposés à la saisie)
  ncTypes: [], // types de déchets non conformes déjà saisis
  site: { couleurs: {} }, // réglages communs au site (couleurs des sorties)
  tasks: [], // tâches de relève du site
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
  recapDays: null,
  recapSearch: { q: '', mode: 'mois', from: null, to: null, timer: null },
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

function promptText(title, placeholder = '', { type = 'text', text = '' } = {}) {
  const dlg = $('#prompt');
  $('#prompt-title').textContent = title;
  $('#prompt-text').textContent = text;
  $('#prompt-text').hidden = !text;
  const input = $('#prompt-input');
  input.type = type;
  input.inputMode = type === 'password' ? 'numeric' : 'text';
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
// Service enregistré par une version plus récente de l'application : lecture seule.
const isTooNew = (s) => !!(s && s.appVersion && S.config && M.compareVersions(s.appVersion, S.config.appVersion) > 0);
const isLocked = (s) => isClosed(s) || isTooNew(s);
const realObs = (s) => s.observations.filter((o) => o.heure || o.texte);
const boxAlerts = (s) => M.boxAlerts(s);
const boxNames = (s) => M.boxNames(S.site, s);

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
  $('#screen-site').hidden = name !== 'site';
  $('#screen-user').hidden = name !== 'user';
  $('#screen-service').hidden = name !== 'service';
  $('#screen-app').hidden = name !== 'app';
}

// Étapes affichées en haut des écrans d'accueil (le choix du site n'apparaît
// que si ce poste connaît plusieurs sites).
function renderSteps(active) {
  const steps = [['user', 'Responsable'], ['site', 'Site'], ['service', 'Service'], ['app', 'Main courante']];
  const idx = steps.findIndex(([k]) => k === active);
  document.querySelectorAll(`[data-steps="${active}"]`).forEach((el) => el.replaceChildren(...steps.map(([, label], i) => h('span', { class: `step${i === idx ? ' active' : i < idx ? ' done' : ''}` }, `${i + 1}. ${label}`))));
}

// Tous les responsables et superviseurs des sites de ce poste.
function knownUsers() {
  const map = new Map();
  for (const site of S.sites) {
    for (const nom of site.responsables) {
      const u = map.get(nom) || { nom, sites: [], superviseur: false, supSites: [] };
      u.sites.push(site.dataDir);
      map.set(nom, u);
    }
    for (const nom of site.superviseurs) {
      const u = map.get(nom) || { nom, sites: [], superviseur: false, supSites: [] };
      u.superviseur = true;
      u.supSites.push(site.dataDir);
      map.set(nom, u);
    }
  }
  return [...map.values()];
}

async function loadSites() {
  try {
    S.sites = await call(api.sitesOverview());
  } catch {
    S.sites = [];
  }
  const actif = S.sites.find((x) => x.actif);
  S.siteName = actif ? actif.nom : '';
}

// Étape 1 : choix du responsable
function renderUserScreen() {
  let last = null;
  try {
    last = localStorage.getItem('liaison.lastUser');
  } catch { /* stockage indisponible */ }
  renderSteps('user');
  $('#welcome-sub').textContent = S.sites.length > 1 ? `${S.sites.map((x) => x.nom).join(' · ')}` : `${S.siteName || 'Main courante'} · liaison entre services`;
  const users = knownUsers();
  const multi = S.sites.length > 1;
  const cards = users.map((u) => h('button', { class: `user-card${u.nom === last ? ' last' : ''}${u.superviseur ? ' sup' : ''}`, onclick: () => chooseUser(u) },
    avatar(u.nom), h('span', {}, u.nom),
    u.superviseur ? h('span', { class: 'pill sup-pill' }, icon('lock', 12), 'Superviseur')
      : multi ? h('span', { class: 'u-hint' }, S.sites.filter((x) => u.sites.includes(x.dataDir)).map((x) => x.nom).join(' · ')) : null,
    u.nom === last ? h('span', { class: 'u-hint' }, 'Dernière connexion sur ce poste') : null));
  cards.push(h('button', { class: 'user-card add', onclick: addUserFromWelcome },
    h('span', { class: 'avatar' }, icon('plus', 24)), h('span', {}, 'Ajouter un responsable')));
  $('#user-list').replaceChildren(...(users.length ? [] : [h('div', { class: 'empty-users' }, 'Commencez par ajouter les responsables (une seule fois, la liste est partagée entre les postes).')]), ...cards);
  $('#welcome-poste').textContent = S.config.poste ? `Poste : ${S.config.poste}` : '';
  showScreen('user');
}

async function addUserFromWelcome() {
  const name = await promptText('Nouveau responsable', 'Prénom Nom', { text: S.sites.length > 1 ? `Il sera ajouté au site « ${S.siteName} ».` : '' });
  if (!name) return;
  S.users = await call(api.saveUsers([...S.users, name]));
  await loadSites();
  renderUserScreen();
}

// Sites accessibles : tous pour un superviseur, sinon ceux où la personne est responsable.
// Tout le monde peut choisir n'importe quel site du poste (on change parfois de site).
const userSites = () => S.sites;

async function chooseUser(u) {
  if (u.superviseur) {
    const pin = await promptText(`Code PIN de ${u.nom}`, '••••', { type: 'password', text: 'Le profil superviseur donne accès à tous les sites et services.' });
    if (pin == null) return;
    const ok = await call(api.verifyPin(u.supSites[0], u.nom, pin)).catch(() => false);
    if (!ok) {
      toast('Code PIN incorrect.');
      return;
    }
    S.role = 'superviseur';
  } else {
    S.role = 'responsable';
  }
  S.user = u.nom;
  S.userEntry = u;
  // Intro fun : réglage relu à neuf (autre poste, autre site du poste).
  const trouve = await call(api.funFind(u.nom)).catch(() => null);
  if (trouve) {
    const { fun, dataDir } = trouve;
    const [photo, son] = await Promise.all([
      fun.photo ? call(api.funReadPhoto(fun.photo, dataDir)).catch(() => null) : null,
      fun.son && fun.son.rel ? call(api.funReadSound(fun.son.rel, dataDir)).catch(() => null) : null,
    ]);
    await playFunIntro(fun, photo, son);
  }
  try {
    localStorage.setItem('liaison.lastUser', u.nom);
  } catch { /* stockage indisponible */ }
  S.date = M.currentService().date;
  document.querySelectorAll('[data-view="dashboard"], #btn-go-dashboard').forEach((el) => { el.hidden = S.role !== 'superviseur'; });
  await renderSiteScreen();
}

const lastSiteKey = () => `liaison.lastSite.${S.user}`;

// Choix d'un site : on retient le choix et, pour un responsable qui n'y était
// pas encore enregistré, on l'ajoute à la liste des responsables de ce site.
async function pickSite(dataDir) {
  try {
    localStorage.setItem(lastSiteKey(), dataDir);
  } catch { /* stockage indisponible */ }
  await useSite(dataDir, { thenService: false });
  if (S.role !== 'superviseur' && S.user && !S.users.includes(S.user)) {
    try {
      S.users = await call(api.saveUsers([...S.users, S.user]));
      await loadSites();
    } catch { /* dossier en lecture seule : sans conséquence */ }
  }
  await renderServiceScreen();
}

// « + Ajouter un site » : choix du dossier puis du nom (gardé s'il en a déjà un).
async function addSiteFlow() {
  const dir = await call(api.chooseDir());
  if (!dir) return false;
  if (!(S.config.sites || []).some((x) => x.dataDir === dir)) {
    const info = await call(api.siteInfo(dir)).catch(() => ({}));
    let nom = info.nom || '';
    if (!nom) {
      nom = await promptText('Nom de ce site', 'ex. CPTP', { text: dir }) || dir.split(/[\\/]/).pop();
      await call(api.renameSite(dir, nom)).catch(() => null);
    }
    S.config = await call(api.setConfig({ sites: [...(S.config.sites || []).map((x) => ({ dataDir: x.dataDir })), { dataDir: dir }] }));
    await loadSites();
    toast(`Site « ${nom} » ajouté.`);
  }
  return true;
}

// Étape 2 : choix du site (toujours affiché : on peut changer de site)
async function renderSiteScreen() {
  renderSteps('site');
  $('#site-hello').textContent = `${S.user}, sur quel site ?`;
  let last = null;
  try {
    last = localStorage.getItem(lastSiteKey());
  } catch { /* stockage indisponible */ }
  if (!last || !S.sites.some((x) => x.dataDir === last)) last = S.config.dataDir;
  const sites = userSites();
  const addCard = h('button', { class: 'site-card add', onclick: async () => { if (await addSiteFlow()) renderSiteScreen(); } },
    h('span', { class: 'site-icon' }, icon('plus', 24)),
    h('div', { class: 'site-main' }, h('div', { class: 'site-name' }, 'Ajouter un site'), h('div', { class: 'site-dir' }, 'Choisir le dossier de données de l\'autre site (ex. S:\\Liaison-CPTP)')));
  $('#site-cards').replaceChildren(addCard);
  $('#site-cards').prepend(...sites.map((site) => {
    const stats = h('div', { class: 'site-stats muted' }, 'Chargement…');
    call(api.siteDashboard(site.dataDir)).then((d) => {
      stats.replaceChildren(
        h('div', { class: 'site-dots' }, d.today.map((t) => h('span', { class: `dot ${t.etat === 'clos' ? 'done' : t.etat === 'vide' ? '' : 'draft'}`, style: { '--c': SVC[t.service].couleur }, title: `${SVC[t.service].label} : ${t.etat}` }))),
        h('span', {}, plural(d.taches.length, 'tâche'), ' en attente'),
        ...(d.importantes.length ? [h('span', { class: 'pill alert' }, icon('alert', 12), plural(d.importantes.length, 'obs. importante'))] : []),
        ...((d.stockBas || []).length ? [h('span', { class: 'pill alert' }, icon('box', 12), plural(d.stockBas.length, 'article'), ' en stock bas')] : []));
    }).catch((err) => stats.replaceChildren(h('span', { class: 'red' }, `Dossier inaccessible : ${err.message}`)));
    return h('button', { class: `site-card${site.dataDir === last ? ' actif' : ''}`, onclick: () => pickSite(site.dataDir) },
      h('span', { class: 'site-icon' }, icon('box', 24)),
      h('div', { class: 'site-main' }, h('div', { class: 'site-name' }, site.nom, site.dataDir === last ? h('span', { class: 'u-hint' }, ' · dernier choisi') : null),
        h('div', { class: 'site-dir' }, site.dataDir), stats),
      icon('arrowRight', 18));
  }));
  showScreen('site');
}

// Active un site (dossier de données) puis passe au choix du service.
async function useSite(dataDir, { thenService = true } = {}) {
  if (dataDir && dataDir !== S.config.dataDir) {
    await flush();
    S.config = await call(api.selectSite(dataDir));
    await loadSites();
    await loadSiteData();
    S.users = await call(api.loadUsers());
    S.journal.days = null;
    checkUpdate();
  }
  if (thenService) await renderServiceScreen();
}

// Étape 2 : choix du service
async function renderServiceScreen() {
  await flush();
  S.data = await call(api.loadDay(S.date));
  const live = M.currentService();
  renderSteps('service');
  $('#service-hello').textContent = `${S.user}, sur quel service travaillez-vous ?`;
  $('#service-site').textContent = S.siteName ? `Site : ${S.siteName}` : '';
  $('#btn-change-site').hidden = false;
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
  // Responsable prérempli mais pas enregistré tant que rien d'autre n'est saisi :
  // ouvrir un service (jour non travaillé) ne le marque pas comme commencé.
  if (!isClosed(s) && !s.responsable && S.user && M.isEmpty(s)) {
    s.responsable = S.user;
    renderForm();
    renderTabs();
  }
}

async function backToUsers() {
  await flush();
  S.users = await call(api.loadUsers());
  await loadSites();
  S.role = 'responsable';
  renderUserScreen();
}

/* ---------- Chargement / enregistrement ---------- */

async function loadDay() {
  S.data = await call(api.loadDay(S.date));
  try {
    S.site = await call(api.loadSite());
  } catch { /* on garde les couleurs déjà connues */ }
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
      if (err.code === 'VERSION') {
        S.dirty = false;
        target.appVersion = err.version;
        setStatus('Non enregistré : version plus récente sur un autre poste', 'error');
        ask('Mise à jour nécessaire', err.message, [{ label: 'OK', value: 'ok', cls: 'primary' }]);
        renderForm();
      } else if (err.code === 'CONFLICT') {
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
  $('#user-service').textContent = `${S.role === 'superviseur' ? 'Superviseur · ' : ''}${S.siteName ? `${S.siteName} · ` : ''}Service ${SVC[S.service].label.toLowerCase()}`;
  $('#brand-site').textContent = S.siteName;
  document.body.dataset.service = S.service;
}

function renderTabs() {
  const badge = document.getElementById('tasks-badge');
  if (badge) {
    const n = pendingTasks(S.tasks).length;
    badge.hidden = !n;
    badge.textContent = n;
  }
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
    readOnly: isLocked(s),
    ...attrs,
  });
  if (['int', 'dec', 'ton', 'pct', 'pesee', 'tonexpr'].includes(type)) {
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
  const closed = isLocked(s);

  const banner = h('div', { class: 'service-banner' },
    h('span', { class: 'sb-icon' }, icon(def.icon, 26)),
    h('div', {}, h('div', { class: 'sb-date' }, fmtLongDate(S.date)), h('div', { class: 'sb-title' }, def.titre)),
    h('label', { class: 'sb-resp' }, 'Responsable', field('responsable', 'text', { placeholder: 'Nom du chef de service', list: 'users-list', 'aria-label': 'Responsable' })),
    h('datalist', { id: 'users-list' }, S.users.map((u) => h('option', { value: u }))),
    h('button', { class: 'btn', title: 'Fiche détaillée du service', onclick: () => openFiche(S.date, S.service) }, icon('eye', 16)),
    isTooNew(s) ? null : closed
      ? h('button', { class: 'btn', onclick: reopenService }, icon('unlock', 16), 'Rouvrir')
      : h('button', { class: 'btn solid', onclick: closeService }, icon('lock', 16), 'Clôturer le service'),
    closed ? null
      : h('button', { class: 'btn ghost', title: 'Effacer toute la saisie de ce service (jour non travaillé, saisie par erreur)', onclick: clearService }, icon('trash', 16), 'Vider'));

  const closedNote = isTooNew(s)
    ? h('div', { class: 'closed-note warn' }, icon('alert'), h('span', {}, h('b', {}, 'Lecture seule'),
      ` : ce service a été enregistré avec la version ${s.appVersion} de Liaison, plus récente que celle de ce poste (${S.config.appVersion}). Mettez à jour l'application pour le modifier.`))
    : isClosed(s)
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

  const obsRows = s.observations.map((o, i) => {
    const row = h('div', { class: `obs${o.important ? ' important' : ''}` },
      field(`observations.${i}.heure`, 'time', { 'aria-label': 'Heure' }),
      h('div', { class: 'obs-main' },
        autoGrow(h('textarea', { 'data-bind': `observations.${i}.texte`, 'data-type': 'text', rows: 1, readOnly: closed, placeholder: 'Observation', value: o.texte })),
        photoStrip(o.photos, { editable: !closed, onRemove: (k) => removeItemPhoto(o, k) })),
      h('div', { class: 'o-tools' },
        o.auteur ? h('span', { class: 'o-author', title: 'Saisie par' }, o.auteur) : null,
        closed ? null : photoButton((rels) => addItemPhotos(o, rels)),
        closed ? null : h('button', { class: `o-btn flag${o.important ? ' on' : ''}`, title: o.important ? 'Retirer « importante »' : 'Marquer comme importante', onclick: () => toggleImportant(i) }, icon('flag', 16)),
        closed ? null : h('button', { class: 'o-btn rm', title: 'Supprimer', 'aria-label': 'Supprimer l\'observation', onclick: () => removeObservation(i) }, icon('trash', 16))));
    return closed ? row : photoTarget(row, (rels) => addItemPhotos(o, rels));
  });

  const obs = card('Observations', 'note', [
    quickAdd,
    h('div', { class: 'obs-list', id: 'obs-list' }, obsRows.length ? obsRows : h('div', { class: 'empty' }, 'Aucune observation pour ce service.'))],
  { wide: true, cls: 'obs-card', hint: 'Ctrl+O depuis n\'importe quel écran · photos : bouton, glisser-déposer ou Ctrl+V' });

  const taches = tasksCard();

  const motifs = h('datalist', { id: 'motifs' }, M.MOTIFS.map((m) => h('option', { value: m })));
  const prevAbsents = S.prev ? S.prev.absents.filter((a) => a.nom) : [];
  const absents = card('Agents absents', 'users', [
    h('div', { class: 'absents' },
      s.absents.map((_, i) => h('div', { class: `absent${i >= M.NB_ABSENTS ? ' extra' : ''}` },
        field(`absents.${i}.nom`, 'text', { placeholder: 'Nom de l\'agent', 'data-agent': '1' }),
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
    h('div', { class: 'total-box' }, h('span', {}, 'TOTAL'), h('b', { id: 'calc-entrees' }, '0')),
    M.entreesTonnage(S.site) || s.entrees.tonnage != null
      ? h('label', { class: 'field' }, h('span', {}, 'Tonnage (T)'), field('entrees.tonnage', 'ton', { placeholder: 'ex. 12,540' })) : null));

  const sortieRows = [];
  for (const row of M.allSorties(s)) {
    const base = row.extra ? `sortiesExtra.${row.index}` : `sorties.${row.nom}`;
    const col = sortieColor(row);
    sortieRows.push(h('tr', { class: `${col && col.mode === 'ligne' ? 'row-colored' : ''}${row.extra ? ' extra' : ''}`, style: col ? { '--mc': col.couleur } : null },
      h('td', { class: `label${col ? ' colored' : ''}` },
        h('div', { class: 'mat-name' },
          h('button', {
            class: 'swatch-btn', title: 'Couleur de la ligne', 'aria-label': `Couleur de ${row.nom || 'la sortie'}`, disabled: closed && row.extra,
            style: { '--sw': col ? col.couleur : 'transparent' }, onclick: (e) => openColorPicker(e.currentTarget, row),
          }),
          row.extra ? field(`${base}.nom`, 'text', { placeholder: 'Matière ponctuelle', class: 'extra-name' }) : h('span', {}, row.nom),
          row.extra && !closed ? h('button', { class: 'o-btn rm', title: 'Supprimer cette sortie', 'aria-label': 'Supprimer cette sortie', onclick: () => removeExtraSortie(row.index) }, icon('x', 14)) : null)),
      h('td', {}, field(`${base}.nb`, 'int', { 'data-nb': base })),
      row.externe ? h('td', { class: 'ext' }, 'service externe') : h('td', {}, tonField(base, row.data))));
    const n = peseeCount(row);
    if (n >= 2) {
      sortieRows.push(h('tr', { class: 'pesees-row' }, h('td', { colspan: 3 },
        h('div', { class: 'pesees' }, h('span', { class: 'muted' }, 'Pesées'),
          Array.from({ length: n }, (_, k) => h('label', { class: 'pesee' }, h('span', {}, `${k + 1}`), field(`${base}.pesees.${k}`, 'pesee', { placeholder: 'T' }))),
          h('b', { class: 'pesee-total', 'data-ptotal': base })))));
    }
  }
  const sorties = card('Sorties', 'upload', [
    h('table', { class: 'grid sorties-grid' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Matière'), h('th', {}, 'Nb sorties'), h('th', {}, 'Tonnage (T)'))),
      h('tbody', {}, sortieRows),
      h('tfoot', {}, h('tr', { class: 'total' }, h('td', {}, 'TOTAL'), h('td', { id: 'calc-nb' }), h('td', { id: 'calc-ton' })))),
    closed ? null : h('div', { class: 'absents-foot' }, h('button', { class: 'btn small', onclick: addExtraSortie }, icon('plus', 14), 'Sortie ponctuelle')),
  ], { hint: 'Plusieurs bennes : 5,54+4,74' });

  const boxRow = (group, nom) => h('div', { class: 'box-row' },
    h('span', {}, nom),
    h('div', { class: 'bar', 'data-bar': `${group}.${nom}` }, h('i')),
    h('div', { class: 'pct' }, field(`${group}.${nom}`, 'pct', { 'aria-label': `${group === 'bennes' ? 'Benne' : 'Plateau'} ${nom}` })),
    closed ? null : h('button', { class: 'o-btn rm box-rm', title: 'Retirer cette ligne pour le site', 'aria-label': `Retirer ${nom}`, onclick: () => removeBox(group, nom) }, icon('x', 13)));
  const noms = boxNames(s);
  const boxGroup = (group, titre) => h('div', {}, h('h4', {}, titre), noms[group].map((n) => boxRow(group, n)),
    closed ? null : h('button', { class: 'btn small ghost box-add', onclick: () => addBox(group) }, icon('plus', 13), group === 'bennes' ? 'Benne' : 'Plateau'));
  const boxs = card('État des boxs', 'box', h('div', { class: 'boxs' }, boxGroup('bennes', 'Bennes'), boxGroup('plateaux', 'Plateaux')),
  { hint: `Remplissage en % · alerte à ${M.SEUIL_ALERTE} %` });

  const ncRows = s.nonConformes.map((x, i) => {
    const base = `nonConformes.${i}`;
    const row = h('div', { class: 'nc-row' },
      h('div', { class: 'nc-main' },
        field(`${base}.type`, 'text', { placeholder: 'Déchet (ex. Frigo, Pneus…)', 'data-nc-type': String(i) }),
        field(`${base}.quantite`, 'dec', { placeholder: 'Qté' }),
        h('select', { 'data-bind': `${base}.unite`, 'data-type': 'text', disabled: closed, 'aria-label': 'Unité' },
          M.UNITES.map((u) => h('option', { value: u, selected: x.unite === u }, u))),
        field(`${base}.provenance`, 'text', { placeholder: 'Provenance' }),
        closed ? h('span') : photoButton((rels) => addItemPhotos(x, rels)),
        closed ? h('span') : h('button', { class: 'o-btn rm', title: 'Supprimer ce déchet', 'aria-label': 'Supprimer ce déchet', onclick: () => removeNonConforme(i) }, icon('trash', 15))),
      field(`${base}.commentaire`, 'text', { placeholder: 'Commentaire (facultatif)', class: 'nc-comment' }),
      photoStrip(x.photos, { editable: !closed, onRemove: (k) => removeItemPhoto(x, k) }));
    return closed ? row : photoTarget(row, (rels) => addItemPhotos(x, rels));
  });
  const nonConformes = card('Déchets non conformes', 'recycle', [
    ncRows.length ? h('div', { class: 'nc-list' }, ncRows) : h('div', { class: 'empty' }, 'Aucun déchet non conforme.'),
    closed ? null : h('div', { class: 'absents-foot' }, h('button', { class: 'btn small', onclick: addNonConforme }, icon('plus', 14), 'Ajouter un déchet')),
  ], { wide: true, hint: 'Ex. Frigo = 1, Pneus = 20 · en pièces, kg ou T' });

  // Stockage : bennes stockées sur site (type, nombre, vide / pleine / en cours).
  const stkTypes = [...new Set([...boxNames(s).bennes, ...boxNames(s).plateaux, ...((S.prev && S.prev.stockage) || []).map((x) => x.type), ...s.stockage.map((x) => x.type)].filter(Boolean))];
  const stkRows = s.stockage.map((x, i) => {
    const base = `stockage.${i}`;
    return h('div', { class: `stk-row etat-${x.etat}` },
      field(`${base}.type`, 'text', { placeholder: 'Type (ex. Benne Fer)', list: 'stk-types', 'data-stk-type': String(i) }),
      field(`${base}.nombre`, 'int', { placeholder: 'Nb', 'aria-label': 'Nombre' }),
      h('div', { class: 'seg stk-etat', role: 'radiogroup' }, M.ETATS_STOCKAGE.map((e) => h('button', {
        type: 'button', class: `${x.etat === e.id ? 'on' : ''} e-${e.id}`, disabled: closed, role: 'radio', 'aria-checked': String(x.etat === e.id),
        onclick: () => { x.etat = e.id; markDirty(); renderForm(); },
      }, e.label))),
      closed ? h('span') : h('button', { class: 'o-btn rm', title: 'Supprimer cette ligne', 'aria-label': 'Supprimer cette ligne', onclick: () => removeStockage(i) }, icon('trash', 15)));
  });
  const stkTotal = M.ETATS_STOCKAGE.map((e) => [e, s.stockage.filter((x) => x.etat === e.id).reduce((a, x) => a + (x.nombre || 0), 0)]).filter(([, n]) => n);
  const stockage = card('Stockage', 'truck', [
    h('datalist', { id: 'stk-types' }, stkTypes.map((t) => h('option', { value: t }))),
    stkRows.length ? h('div', { class: 'stk-list' }, stkRows) : h('div', { class: 'empty' }, 'Aucune benne en stockage renseignée.'),
    stkTotal.length ? h('div', { class: 'stk-total muted' }, stkTotal.map(([e, n]) => `${n} ${e.label.toLowerCase()}${n > 1 && e.id !== 'en-cours' ? 's' : ''}`).join(' · ')) : null,
    closed ? null : h('div', { class: 'absents-foot' },
      h('button', { class: 'btn small', onclick: addStockage }, icon('plus', 14), 'Ajouter une ligne'),
      S.prev && S.prev.stockage.length ? h('button', { class: 'btn small ghost', onclick: takeOverStockage }, 'Reprendre le service précédent') : null),
  ], { hint: 'Ex. Benne Fer · 2 · Vide' });

  // Commandes : saisies par le matin, affichées en information aux autres services.
  let commandes;
  if (s.service === M.SERVICE_COMMANDES) {
    const cmdRows = s.commandes.map((x, i) => {
      const base = `commandes.${i}`;
      return h('div', { class: `cmd-row${x.recue ? ' recue' : ''}` },
        field(`${base}.quoi`, 'text', { placeholder: 'Quoi (article, benne…)', 'data-cmd': String(i) }),
        field(`${base}.quantite`, 'text', { placeholder: 'Qté' }),
        field(`${base}.fournisseur`, 'text', { placeholder: 'Fournisseur' }),
        field(`${base}.date`, 'text', { type: 'date', 'aria-label': 'Date prévue' }),
        h('label', { class: 'cmd-recue', title: 'Commande reçue' }, h('input', { type: 'checkbox', checked: x.recue, disabled: closed, onchange: (e) => { x.recue = e.target.checked; markDirty(); renderForm(); } }), 'Reçue'),
        closed ? h('span') : h('button', { class: 'o-btn rm', title: 'Supprimer cette commande', 'aria-label': 'Supprimer cette commande', onclick: () => removeCommande(i) }, icon('trash', 15)));
    });
    commandes = card('Commandes', 'send', [
      cmdRows.length ? h('div', { class: 'cmd-list' }, cmdRows) : h('div', { class: 'empty' }, 'Aucune commande.'),
      closed ? null : h('div', { class: 'absents-foot' }, h('button', { class: 'btn small', onclick: addCommande }, icon('plus', 14), 'Ajouter une commande')),
    ], { wide: true, hint: 'Affichées en information à l\'après-midi et à la nuit' });
  } else {
    const m = S.data[M.SERVICE_COMMANDES];
    const list = m ? m.commandes.filter((x) => x.quoi || x.quantite || x.fournisseur) : [];
    commandes = list.length ? card(`Commandes du jour (${list.length})`, 'send', commandesView(list), { wide: true, cls: 'info-card', hint: `Saisies par le ${SVC[M.SERVICE_COMMANDES].label.toLowerCase()}` }) : null;
  }

  $('#form').replaceChildren(...[banner, closedNote, obs, taches, s.service === M.SERVICE_COMMANDES ? null : commandes, motifs, absents, entrees, sorties, boxs, nonConformes, stockage, s.service === M.SERVICE_COMMANDES ? commandes : null].filter(Boolean));
  $('#form').querySelectorAll('textarea').forEach(fitTextarea);
  $('#form').querySelectorAll('[data-agent]').forEach((input) => Suggest.attach(input, {
    items: () => S.agents.map((a) => ({ label: a })),
    onDelete: forgetAgent,
  }));
  $('#form').querySelectorAll('[data-nc-type]').forEach((input) => Suggest.attach(input, {
    items: () => S.ncTypes.map((t) => ({ label: t.nom, meta: t.unite, data: t })),
    onPick: (it, el) => {
      const x = cur().nonConformes[Number(el.dataset.ncType)];
      if (x && it.data.unite) {
        x.unite = it.data.unite;
        const sel = el.closest('.nc-main').querySelector('select');
        if (sel) sel.value = x.unite;
        markDirty();
      }
    },
    onDelete: forgetNcType,
  }));
  updateComputed();
}

// Re-dessine le formulaire en gardant le champ actif (ex. après un changement du nombre de bennes).
function rerenderKeepFocus() {
  const a = document.activeElement;
  const bind = a && a.dataset ? a.dataset.bind : null;
  renderForm();
  if (bind) {
    const el = document.querySelector(`#form [data-bind="${bind}"]`);
    if (el) el.focus();
  }
}

/* ---------- Sorties : bennes multiples, sorties ponctuelles, couleurs ---------- */

function peseeCount(row) {
  if (row.externe) return 0;
  const nb = row.data.nb || 0;
  const p = (row.data.pesees || []).length;
  if (nb >= 2) return Math.max(nb, p);
  return p >= 2 ? p : 0;
}

// Le détail des bennes s'affiche sur la ligne « Pesées » : la case montre le total.
const tonDisplay = (d) => display('dec', d.tonnage);

function tonField(base, data) {
  const el = field(`${base}.tonnage`, 'tonexpr', { title: 'En tonnes : 5,54 ou 5T540 ; plusieurs bennes : 5,54+4,74' });
  el.value = tonDisplay(data);
  return el;
}

function sortieColor(row) {
  if (row.extra) return row.data.couleur ? { couleur: row.data.couleur, mode: 'nom' } : null;
  const c = Object.prototype.hasOwnProperty.call(S.site.couleurs || {}, row.nom) ? S.site.couleurs[row.nom] : M.COULEURS_DEFAUT[row.nom];
  return c && c.couleur ? c : null;
}

function addExtraSortie() {
  cur().sortiesExtra.push({ nom: '', nb: null, tonnage: null, pesees: [], couleur: '' });
  renderForm();
  markDirty();
  const inputs = document.querySelectorAll('#form .extra-name');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

// Lignes de l'état des boxs : liste permanente du site (site.json), commune à tous les services.
async function saveBoxList(group, update) {
  let site;
  try {
    site = await call(api.loadSite()); // version la plus récente (autre poste)
  } catch {
    site = { ...S.site };
  }
  const current = M.boxNames(site, null);
  site.boxs = { ...current, [group]: update(current[group]) };
  try {
    S.site = await call(api.saveSite(site));
  } catch (err) {
    toast(`Non enregistré : ${err.message}`);
  }
}

async function addBox(group) {
  const label = group === 'bennes' ? 'benne' : 'plateau';
  const nom = (await promptText(`Ajouter ${label === 'benne' ? 'une benne' : 'un plateau'}`, 'Nom (ex. Gravats)', { text: 'La ligne sera ajoutée pour tous les services du site.' }) || '').trim().replace(/\./g, ' ');
  if (!nom) return;
  if (boxNames(cur())[group].some((n) => n.toLowerCase() === nom.toLowerCase())) {
    toast(`« ${nom} » existe déjà.`);
    return;
  }
  await saveBoxList(group, (list) => [...list, nom]);
  renderForm();
}

async function removeBox(group, nom) {
  if (await ask('Retirer cette ligne ?', `« ${nom} » ne sera plus proposé dans l'état des boxs du site (les services déjà saisis gardent leurs chiffres).`,
    [{ label: 'Annuler', value: 'no' }, { label: 'Retirer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
  await saveBoxList(group, (list) => list.filter((n) => n !== nom));
  const s = cur();
  if (s[group][nom] != null && !isLocked(s)) {
    s[group][nom] = null;
    markDirty();
  }
  delete s[group][nom];
  renderForm();
}

async function removeExtraSortie(i) {
  const x = cur().sortiesExtra[i];
  if ((x.nb != null || x.tonnage != null) && await ask('Supprimer cette sortie ?', `« ${x.nom || 'Sortie ponctuelle'} » et ses chiffres seront retirés de ce service.`,
    [{ label: 'Annuler', value: 'no' }, { label: 'Supprimer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
  cur().sortiesExtra.splice(i, 1);
  renderForm();
  markDirty();
}

let colorPop = null;
function closeColorPicker() {
  if (colorPop) colorPop.remove();
  colorPop = null;
}

function openColorPicker(anchor, row) {
  closeColorPicker();
  const current = sortieColor(row);
  let mode = current ? current.mode : 'nom';
  const apply = async (couleur) => {
    if (row.extra) {
      cur().sortiesExtra[row.index].couleur = couleur;
      markDirty();
    } else {
      S.site = { ...S.site, couleurs: { ...(S.site.couleurs || {}), [row.nom]: { couleur, mode } } };
      try {
        S.site = await call(api.saveSite(S.site));
      } catch (err) {
        toast(`Couleur non enregistrée : ${err.message}`);
      }
    }
    closeColorPicker();
    renderForm();
  };
  const modeSeg = row.extra ? null : h('div', { class: 'seg' }, [['nom', 'Nom seul'], ['ligne', 'Ligne entière']].map(([m, label]) => h('button', {
    class: m === mode ? 'on' : '', onclick: (e) => {
      mode = m;
      e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
      if (current) apply(current.couleur);
    },
  }, label)));
  colorPop = h('div', { class: 'color-pop' },
    h('div', { class: 'cp-title' }, `Couleur : ${row.nom || 'sortie ponctuelle'}`),
    h('div', { class: 'cp-swatches' },
      M.PALETTE.map((c) => h('button', { class: `cp-sw${current && current.couleur === c ? ' on' : ''}`, style: { '--sw': c }, title: c, onclick: () => apply(c) })),
      h('label', { class: 'cp-sw cp-custom', title: 'Autre couleur' }, '+', h('input', { type: 'color', value: current ? current.couleur : '#2f9e44', onchange: (e) => apply(e.target.value) }))),
    modeSeg,
    h('button', { class: 'btn small ghost', onclick: () => apply('') }, 'Aucune couleur'),
    row.extra ? null : h('div', { class: 'cp-hint' }, 'Couleur commune à tous les postes du site.'));
  document.body.append(colorPop);
  const r = anchor.getBoundingClientRect();
  colorPop.style.left = `${r.left + window.scrollX}px`;
  colorPop.style.top = `${r.bottom + window.scrollY + 6}px`;
  setTimeout(() => document.addEventListener('mousedown', function outside(e) {
    if (colorPop && !colorPop.contains(e.target)) {
      closeColorPicker();
      document.removeEventListener('mousedown', outside);
    }
  }), 0);
}

/* ---------- Stockage et commandes ---------- */

function addStockage() {
  cur().stockage.push({ type: '', nombre: null, etat: 'vide' });
  renderForm();
  markDirty();
  const inputs = document.querySelectorAll('#form [data-stk-type]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeStockage(i) {
  cur().stockage.splice(i, 1);
  renderForm();
  markDirty();
}

async function takeOverStockage() {
  const s = cur();
  if (s.stockage.some((x) => x.type || x.nombre != null) && await ask('Remplacer le stockage ?', 'Les lignes de stockage de ce service seront remplacées par celles du service précédent.',
    [{ label: 'Annuler', value: 'no' }, { label: 'Remplacer', value: 'yes', cls: 'primary' }]) !== 'yes') return;
  s.stockage = S.prev.stockage.map((x) => ({ ...x }));
  renderForm();
  markDirty();
}

function addCommande() {
  cur().commandes.push({ quoi: '', quantite: '', fournisseur: '', date: S.date, recue: false });
  renderForm();
  markDirty();
  const inputs = document.querySelectorAll('#form [data-cmd]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

async function removeCommande(i) {
  const x = cur().commandes[i];
  if (x.quoi && await ask('Supprimer cette commande ?', `« ${x.quoi} » sera retirée.`,
    [{ label: 'Annuler', value: 'no' }, { label: 'Supprimer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
  cur().commandes.splice(i, 1);
  renderForm();
  markDirty();
}

const fmtCmdDate = (d) => (d ? M.parseISODate(d).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '');
const cmdText = (x) => [x.quantite, x.quoi].filter(Boolean).join(' × ') + (x.fournisseur ? ` — ${x.fournisseur}` : '') + (x.date ? ` (${fmtCmdDate(x.date)})` : '');
const stkText = (x) => `${x.nombre ?? '?'} × ${x.type || 'benne'} — ${(M.ETATS_STOCKAGE.find((e) => e.id === x.etat) || {}).label || ''}`;

function commandesView(list) {
  return h('ul', { class: 'cmd-view' }, list.map((x) => h('li', { class: x.recue ? 'recue' : '' },
    h('span', { class: `pill ${x.recue ? 'live' : 'draft'}` }, x.recue ? 'Reçue' : 'Attendue'),
    h('b', {}, [x.quantite, x.quoi].filter(Boolean).join(' × ')),
    x.fournisseur ? h('span', { class: 'muted' }, ` — ${x.fournisseur}`) : null,
    x.date ? h('span', { class: 'muted' }, ` · ${fmtCmdDate(x.date)}`) : null)));
}

/* ---------- Déchets non conformes et photos ---------- */

function addNonConforme() {
  cur().nonConformes.push({ type: '', quantite: null, unite: M.UNITES[0], provenance: '', commentaire: '', photos: [] });
  renderForm();
  markDirty();
  const inputs = document.querySelectorAll('#form [data-nc-type]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

async function removeNonConforme(i) {
  const x = cur().nonConformes[i];
  if ((x.type || x.quantite != null) && await ask('Supprimer ce déchet ?', `« ${x.type || 'Déchet non conforme'} » sera retiré de ce service.`,
    [{ label: 'Annuler', value: 'no' }, { label: 'Supprimer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
  cur().nonConformes.splice(i, 1);
  renderForm();
  markDirty();
}

function addItemPhotos(item, rels) {
  item.photos = [...(item.photos || []), ...rels];
  rerenderKeepFocus();
  markDirty();
  toast(rels.length > 1 ? `${rels.length} photos ajoutées.` : 'Photo ajoutée.');
}

function removeItemPhoto(item, k) {
  item.photos.splice(k, 1);
  rerenderKeepFocus();
  markDirty();
}

async function forgetAgent(it) {
  S.agents = S.agents.filter((a) => a !== it.label);
  try {
    S.agents = await call(api.saveAgents(S.agents));
  } catch (err) {
    toast(`Liste non enregistrée : ${err.message}`);
  }
  toast(`« ${it.label} » retiré des agents mémorisés.`);
}

async function forgetNcType(it) {
  S.ncTypes = S.ncTypes.filter((t) => t.nom !== it.label);
  try {
    S.ncTypes = await call(api.saveNcTypes(S.ncTypes));
  } catch (err) {
    toast(`Liste non enregistrée : ${err.message}`);
  }
  toast(`« ${it.label} » retiré des déchets mémorisés.`);
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
    bar.firstChild.style.background = v == null ? '' : M.fillColor(v);
    bar.classList.toggle('alert', alert);
    const input = bar.parentElement.querySelector('input');
    if (input) input.classList.toggle('alert', alert);
  });
  document.querySelectorAll('#form [data-ptotal]').forEach((el) => {
    el.textContent = `= ${fmtTon(getPath(s, el.dataset.ptotal).tonnage)}`;
  });
  document.querySelectorAll('#form [data-type="tonexpr"]').forEach((el) => {
    if (el !== document.activeElement) el.value = tonDisplay(getPath(s, el.dataset.bind.replace(/\.tonnage$/, '')));
  });
}

function onFormInput(e) {
  const el = e.target;
  const bind = el.dataset && el.dataset.bind;
  if (!bind || el.readOnly || el.disabled) return;
  if (el.dataset.type === 'tonexpr' || el.dataset.type === 'pesee') {
    onTonnageInput(el);
    return;
  }
  const r = parseValue(el.dataset.type, el.value);
  el.classList.toggle('invalid', !r.ok);
  if (!r.ok) return;
  setPath(cur(), bind, r.v);
  updateComputed();
  if (bind.startsWith('bennes') || bind.startsWith('plateaux') || bind === 'responsable') renderTabs();
  markDirty();
}

// Tonnage d'une sortie : expression « 5,54+4,74 » ou pesées benne par benne.
function onTonnageInput(el) {
  const bind = el.dataset.bind;
  if (el.dataset.type === 'tonexpr') {
    const r = M.parseTonnage(el.value);
    el.classList.toggle('invalid', !r.ok);
    if (!r.ok) return;
    const obj = getPath(cur(), bind.replace(/\.tonnage$/, ''));
    obj.tonnage = r.total;
    obj.pesees = r.pesees;
  } else {
    const v = el.value.trim() === '' ? null : M.parsePoids(el.value);
    const bad = el.value.trim() !== '' && v == null;
    el.classList.toggle('invalid', bad);
    if (bad) return;
    const parts = bind.split('.');
    const k = Number(parts.pop());
    parts.pop();
    const obj = getPath(cur(), parts.join('.'));
    const pesees = [...(obj.pesees || [])];
    while (pesees.length <= k) pesees.push(null);
    pesees[k] = v;
    obj.pesees = pesees;
    const vals = pesees.filter((x) => x != null);
    obj.tonnage = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 1000) / 1000 : null;
  }
  updateComputed();
  markDirty();
}

// Après saisie du nombre de sorties ou d'un tonnage à plusieurs bennes, on
// affiche (ou retire) les cases de pesées.
function onFormChange(e) {
  const el = e.target;
  if (!el.dataset || !(el.dataset.nb || el.dataset.type === 'tonexpr')) return;
  const base = el.dataset.nb || el.dataset.bind.replace(/\.tonnage$/, '');
  if (base.startsWith('sorties.') && M.MATIERES_EXTERNES.includes(base.split('.')[1])) return;
  const wanted = peseeCount({ externe: false, data: getPath(cur(), base) });
  const shown = document.querySelectorAll(`#form [data-bind^="${base}.pesees."]`).length;
  // Différé : on laisse le focus arriver sur le champ cliqué avant de redessiner.
  if (wanted !== shown) setTimeout(rerenderKeepFocus, 0);
}

function onFormBlur(e) {
  const el = e.target;
  if (!el.dataset || !el.dataset.bind || el.classList.contains('invalid')) return;
  const type = el.dataset.type;
  if (type === 'tonexpr') el.value = tonDisplay(getPath(cur(), el.dataset.bind.replace(/\.tonnage$/, '')));
  else if (type === 'pesee') el.value = display('dec', getPath(cur(), el.dataset.bind));
  else if (type !== 'text' && type !== 'time') el.value = display(type, getPath(cur(), el.dataset.bind));
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
  if (isLocked(s) || !texte.trim()) return false;
  s.observations.push({ heure: heure || nowHHMM(), texte: texte.trim(), important: !!important, auteur: S.user || '', photos: [] });
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
  if (isLocked(cur())) {
    toast(isTooNew(cur()) ? 'Ce service vient d\'une version plus récente : mettez à jour l\'application.' : 'Ce service est clôturé : rouvrez-le pour ajouter une observation.');
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
  if (Object.values(s.bennes).every((v) => v == null) && Object.values(s.plateaux).every((v) => v == null)) warnings.push('• L\'état des boxs n\'est pas renseigné.');
  if (!realObs(s).length) warnings.push('• Aucune observation saisie.');
  const pending = tasksForService(S.tasks, S.date, S.service).filter((t) => !t.faite).length;
  if (pending) warnings.push(`• ${plural(pending, 'tâche')} encore en attente (elles restent affichées au service suivant).`);
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

// Remet le service à zéro, comme si rien n'avait été saisi (case vide dans le récap).
async function clearService() {
  const def = SVC[S.service];
  const r = await ask('Vider ce service ?', `Toute la saisie du service ${def.label.toLowerCase()} du ${fmtLongDate(S.date)} sera effacée (responsable, observations, chiffres…), comme si rien n'avait été fait. Cette action ne peut pas être annulée.`, [
    { label: 'Annuler', value: 'no' },
    { label: 'Vider le service', value: 'yes', cls: 'danger' },
  ]);
  if (r !== 'yes') return;
  const s = cur();
  S.data[S.service] = { ...M.emptyService(S.date, S.service), rev: s.rev };
  S.dirty = true;
  await save();
  renderSaisie();
  toast('Service vidé.');
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

  // Les tâches en attente s'affichent même si le service précédent n'a rien saisi.
  const pend = tasksForService(S.tasks, S.date, S.service).filter((t) => !t.faite && !(t.origine.date === S.date && t.origine.service === S.service));
  const tasksSection = h('div', { class: 'pass-section' }, h('h5', {}, icon('checkSquare', 13), `Tâches en attente (${pend.length})`),
    pend.length
      ? h('div', { class: 'task-list' }, pend.map((t) => taskItem(t, { date: S.date, service: S.service, compact: true })))
      : h('div', { class: 'empty' }, 'Aucune tâche en attente.'),
    prev && prev.consignes ? h('div', { class: 'pass-consignes', style: { marginTop: '8px' } }, prev.consignes) : null);

  if (!prev || M.isEmpty(prev)) {
    $('#passation').replaceChildren(h('div', { class: 'card', style }, head, tasksSection,
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
    tasksSection,
    important.length ? h('div', { class: 'pass-section' }, h('h5', {}, icon('flag', 13), `Observations importantes (${important.length})`),
      h('ul', { class: 'pass-obs' }, important.map(obsItem))) : null,
    h('div', { class: 'pass-section' }, h('h5', {}, icon('box', 13), `Boxs à ${M.SEUIL_ALERTE} % ou plus`),
      alerts.length
        ? h('div', { class: 'alert-list' }, alerts.map((a) => h('span', { class: 'pill alert' }, `${a.type} ${a.nom} : ${fmtNum(a.v)} %`)))
        : h('div', { class: 'empty' }, 'Aucun box en alerte.'),
      isClosed(cur()) ? null : h('button', { class: 'btn small', style: { marginTop: '8px' }, onclick: takeOverBoxes }, 'Reprendre l\'état des boxs')),
    prev.nonConformes.length ? h('div', { class: 'pass-section' }, h('h5', {}, icon('recycle', 13), `Déchets non conformes (${prev.nonConformes.length})`),
      h('ul', { class: 'pass-obs nc' }, prev.nonConformes.map((x) => h('li', {}, h('b', {}, fmtQte(x)), h('span', {}, x.type, x.provenance ? ` — ${x.provenance}` : ''))))) : null,
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
  const hasValues = Object.values(s.bennes).some((v) => v != null) || Object.values(s.plateaux).some((v) => v != null);
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

const fmtQte = (x) => (x.quantite == null ? '?' : `${fmtNum(x.quantite)} ${x.unite === 'pièce(s)' ? (x.quantite > 1 ? 'pièces' : 'pièce') : x.unite}`);

function obsEntry(o, q = '') {
  return h('div', { class: `j-entry${o.important ? ' important' : ''}` },
    h('span', { class: 'je-time' }, o.heure || '—'),
    h('span', { class: 'je-text' }, o.important ? h('b', {}, '⚠ ') : null, highlight(o.texte, q), photoStrip(o.photos)),
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
    h('div', { class: 'bar' }, h('i', { style: { width: `${Math.min(100, v || 0)}%`, background: v == null ? '' : M.fillColor(v) } })),
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
        ficheCard('Tâches pour la relève', 'checkSquare', [
          ...(() => {
            const list = tasksForService(S.tasks, date, service);
            return list.length ? [h('div', { class: 'task-list' }, list.map((tk) => taskItem(tk, { date, service, compact: true })))] : [h('div', { class: 'empty' }, 'Aucune tâche.')];
          })(),
          s.consignes ? h('div', { class: 'pass-consignes', style: { marginTop: '8px' } }, s.consignes) : null]),
        s.nonConformes.length ? ficheCard(`Déchets non conformes (${s.nonConformes.length})`, 'recycle', h('div', { class: 'nc-view' }, s.nonConformes.map((x) => h('div', { class: 'ncv-row' },
          h('div', {}, h('b', {}, x.type || '?'), ` : ${fmtQte(x)}`, x.provenance ? h('span', { class: 'muted' }, ` — ${x.provenance}`) : null),
          x.commentaire ? h('div', { class: 'muted' }, x.commentaire) : null,
          photoStrip(x.photos))))) : null,
        s.stockage.some((x) => x.type || x.nombre != null) ? ficheCard('Stockage', 'truck', h('ul', { class: 'cmd-view' }, s.stockage.filter((x) => x.type || x.nombre != null).map((x) => h('li', {},
          h('span', { class: `pill ${x.etat === 'pleine' ? 'alert' : x.etat === 'vide' ? 'live' : 'draft'}` }, (M.ETATS_STOCKAGE.find((e) => e.id === x.etat) || {}).label), h('b', {}, `${x.nombre ?? '?'} × ${x.type || 'benne'}`))))) : null,
        s.commandes.some((x) => x.quoi) ? ficheCard('Commandes', 'send', commandesView(s.commandes.filter((x) => x.quoi))) : null),
      h('div', { class: 'fiche-col' },
        ficheCard('Service', 'user', [
          h('div', { class: 'kv' }, h('span', {}, 'Responsable'), h('b', {}, s.responsable || '—')),
          h('div', { class: 'kv' }, h('span', {}, 'État'), isClosed(s) ? h('span', {}, `Clôturé le ${fmtDateTime(s.cloture.at)}${s.cloture.par ? ` par ${s.cloture.par}` : ''}`) : h('span', {}, serviceState(s).label)),
          s.updatedAt ? h('div', { class: 'kv' }, h('span', {}, 'Dernière saisie'), h('span', {}, `${fmtDateTime(s.updatedAt)}${s.updatedBy ? ` · ${s.updatedBy}` : ''}`)) : null,
          h('div', { class: 'kv' }, h('span', {}, 'Absents'), h('span', {}, absents.length ? absents.map((a) => `${a.nom}${a.motif ? ` (${a.motif})` : ''}`).join(', ') : 'Aucun')),
        ]),
        ficheCard('Activité', 'truck', [
          h('div', { class: 'fiche-kpis' },
            h('div', {}, h('b', {}, fmtNum(t.entrees)), h('span', {}, `Entrées (${fmtNum(s.entrees.plateaux || 0)} plat. · ${fmtNum(s.entrees.pl || 0)} PL${s.entrees.tonnage != null ? ` · ${fmtTon(s.entrees.tonnage)}` : ''})`)),
            h('div', {}, h('b', {}, fmtNum(t.sortiesNb)), h('span', {}, 'Sorties')),
            h('div', {}, h('b', {}, fmtNum(t.tonnage)), h('span', {}, 'Tonnes'))),
          h('table', { class: 'simple', style: { marginTop: '10px' } },
            h('tbody', {}, M.allSorties(s).filter((r) => r.data.nb != null || r.data.tonnage != null).map((r) => h('tr', {},
              h('td', {}, r.nom || 'Sortie ponctuelle', r.extra ? h('span', { class: 'muted' }, ' (ponctuelle)') : null), h('td', {}, plural(r.data.nb || 0, 'sortie')),
              h('td', { title: (r.data.pesees || []).length > 1 ? r.data.pesees.map((v) => fmtNum(v)).join(' + ') : '' }, r.externe ? 'externe' : fmtTon(r.data.tonnage))))),
            h('tfoot', {}, h('tr', { class: 'tot' }, h('td', {}, 'Total'), h('td', {}, plural(t.sortiesNb, 'sortie')), h('td', {}, fmtTon(t.tonnage))))),
        ]),
        ficheCard('État des boxs', 'box', [
          subTitle('BENNES', 0), boxNames(s).bennes.map((b) => miniBar(b, s.bennes[b])),
          subTitle('PLATEAUX', 10), boxNames(s).plateaux.map((p) => miniBar(p, s.plateaux[p])),
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
      const tasks = J.importantOnly ? [] : S.tasks.filter((t) => t.origine.date === day.date && t.origine.service === d.id && (!ql || t.texte.toLowerCase().includes(ql)));
      if (!obs.length && !showConsignes && !tasks.length) return null;
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
        tasks.length ? h('div', { class: 'j-consignes task-list' }, tasks.map((t) => taskItem(t, { date: day.date, service: d.id, compact: true }))) : null,
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
      h('input', { type: 'text', id: 'j-search', placeholder: 'Rechercher dans les observations et tâches…', value: J.q, oninput: (e) => { J.q = e.target.value; renderJournal(); } })),
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
  $('#view-dashboard').hidden = view !== 'dashboard';
  $('#view-inventaire').hidden = view !== 'inventaire';
  document.querySelector('.toolbar').hidden = view === 'inventaire'; // dates et exports sans objet
  if (silent) return;
  if (view === 'inventaire') renderInventaire();
  if (view === 'dashboard') renderDashboard();
  if (view === 'recap') {
    const d = M.parseISODate(S.date);
    S.recapMonth = { year: d.getFullYear(), month: d.getMonth() + 1 };
    flush().then(renderRecap);
  }
  if (view === 'journal') renderJournal({ reload: true }).then(() => $('#j-search').focus());
}

// Recharge les services modifiés depuis un autre poste.
async function poll() {
  if (document.hidden || S.screen !== 'app') return;
  // Tâches : alerte discrète quand un autre poste en ajoute ou en valide une.
  if (await loadTasks({ notify: true })) {
    renderTasksCard();
    renderPassation();
    renderTabs();
    if ($('#fiche').open && S.fiche) renderFiche();
  }
  if (S.view === 'dashboard' && Date.now() - (S.dashAt || 0) > 60000 && !$('#fiche').open) renderDashboard();
  // Inventaire : rafraîchi en continu quand il est affiché, sinon le badge toutes les minutes.
  if (S.view === 'inventaire') {
    if (!document.querySelector('dialog[open]')) renderInventaire();
    return;
  }
  if (Date.now() - invState.loadedAt > 60000) loadInventaire();
  if (S.view !== 'saisie' || S.saving || $('#fiche').open) return;
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
    if (id === S.service || id === M.SERVICE_COMMANDES) {
      const active = document.activeElement;
      const focused = active && active.dataset && active.dataset.bind ? `[data-bind="${active.dataset.bind}"]` : active && active.id ? `#${active.id}` : null;
      renderForm();
      if (focused) {
        const el = document.querySelector(focused);
        if (el) el.focus();
      }
      if (id === S.service) toast(`Service mis à jour depuis le poste ${S.data[id].updatedBy || 'distant'}.`);
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
  const ponctuelles = new Set();
  const parNc = {};
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
      tot.entTon = (tot.entTon || 0) + n(s.entrees.tonnage);
      for (const r of M.allSorties(s)) {
        const nom = r.nom || 'Sortie ponctuelle';
        if (r.extra) ponctuelles.add(nom);
        if (!parMatiere[nom]) parMatiere[nom] = { nb: 0, tonnage: 0 };
        row.nb += n(r.data.nb);
        row.tonnage += n(r.data.tonnage);
        parMatiere[nom].nb += n(r.data.nb);
        parMatiere[nom].tonnage += n(r.data.tonnage);
      }
      for (const x of s.nonConformes) {
        if (!x.type) continue;
        const k = `${x.type}|${x.unite}`;
        parNc[k] = (parNc[k] || 0) + n(x.quantite);
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
  const matieres = Object.keys(parMatiere);
  const maxTon = Math.max(1, ...matieres.map((m) => parMatiere[m].tonnage));
  const maxNb = Math.max(1, ...matieres.map((m) => parMatiere[m].nb));

  if (!$('#recap-search')) buildRecapSearch();
  S.recapDays = days;
  $('#recap-body').replaceChildren(
    h('div', { class: 'recap-head' },
      h('button', { class: 'icon-btn', onclick: () => moveMonth(-1), 'aria-label': 'Mois précédent' }, icon('chevronLeft')),
      h('h2', {}, fmtMonth(year, month)),
      h('button', { class: 'icon-btn', onclick: () => moveMonth(1), 'aria-label': 'Mois suivant' }, icon('chevronRight')),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => exportMonth(year, month) }, icon('download', 16), 'Exporter ce mois en Excel')),
    h('div', { class: 'kpis' },
      kpi('Entrées (passages)', `${fmtNum(tot.entrees)}${tot.entTon ? ` · ${fmtNum(Math.round(tot.entTon * 10) / 10)} T` : ''}`, 'truck', '#2e75b6', '#e7f1fb'),
      kpi('Sorties · tonnage', `${fmtNum(tot.nb)} · ${fmtNum(Math.round(tot.tonnage * 10) / 10)} T`, 'upload', '#c55a11', '#fdf0e6'),
      kpi('Observations', fmtNum(tot.obs), 'note', '#8e44ad', '#f3e8fa'),
      kpi('Services clôturés', `${tot.clos} / ${days.length * 3}`, 'lock', '#1f8a4c', '#e5f6ec')),
    recapCharts(days),
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
          h('div', { class: 'card-body' }, matieres.map((m) => {
            const ext = M.MATIERES_EXTERNES.includes(m);
            const ratio = ext ? parMatiere[m].nb / maxNb : parMatiere[m].tonnage / maxTon;
            return h('div', { class: 'matiere-row' }, h('span', { title: ponctuelles.has(m) ? 'Sortie ponctuelle' : '' }, m, ponctuelles.has(m) ? '*' : ''),
              h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(ratio * 100)}%` } })),
              h('b', {}, fmtNum(parMatiere[m].nb)),
              h('span', {}, ext ? 'externe' : fmtTon(parMatiere[m].tonnage)));
          }))),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('recycle', 16)), 'Déchets non conformes'),
          h('div', { class: 'card-body' }, Object.keys(parNc).length
            ? Object.entries(parNc).sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([k, v]) => {
              const [type, unite] = k.split('|');
              return h('div', { class: 'kv' }, h('span', {}, type), h('b', {}, fmtQte({ quantite: v, unite })));
            })
            : h('div', { class: 'empty' }, 'Aucun déchet non conforme.'))),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('users', 16)), 'Absences par motif'),
          h('div', { class: 'card-body' }, Object.keys(parMotif).length
            ? Object.entries(parMotif).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('div', { class: 'kv' }, h('span', {}, k), h('b', {}, v)))
            : h('div', { class: 'empty' }, 'Aucune absence saisie.'))))));
  if (S.recapSearch.q.trim()) runRecapSearch();
}

/* ---------- Graphiques du récap ---------- */

// Histogramme SVG (une série, couleur unique) avec info-bulle au survol.
function columnChart(points, { color = '#2a78d6', unit = '', format = (v) => fmtNum(v) } = {}) {
  const W = 1000;
  const H = 230;
  const pad = { l: 46, r: 10, t: 12, b: 28 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / points.length;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': points.map((p) => `${p.label} : ${format(p.value)}${unit}`).join(', ') });
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = pad.t + ih - (v / top) * ih;
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: v === 0 ? 'axis' : 'grid' }));
    svg.append(el('text', { x: pad.l - 8, y: y + 4, class: 'tick', 'text-anchor': 'end' }, fmtNum(v, 1)));
  }
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const labelEvery = Math.ceil(points.length / 16);
  points.forEach((p, i) => {
    const x = pad.l + i * bw;
    const bh = (p.value / top) * ih;
    const w = Math.max(2, bw - Math.min(8, bw * 0.3));
    const bx = x + (bw - w) / 2;
    const y = pad.t + ih - bh;
    if (bh > 0) {
      const r = Math.min(4, w / 2, bh);
      svg.append(el('path', { class: 'bar-mark', fill: color, d: `M${bx},${pad.t + ih} V${y + r} Q${bx},${y} ${bx + r},${y} H${bx + w - r} Q${bx + w},${y} ${bx + w},${y + r} V${pad.t + ih} Z` }));
    }
    if (i % labelEvery === 0) svg.append(el('text', { x: x + bw / 2, y: H - 8, class: 'tick', 'text-anchor': 'middle' }, p.short));
    const hit = el('rect', { x, y: pad.t, width: bw, height: ih, class: 'hit' });
    hit.addEventListener('mouseenter', () => {
      tip.replaceChildren(h('b', {}, p.label), h('span', {}, `${format(p.value)}${unit}`));
      tip.hidden = false;
      tip.style.left = `${((x + bw / 2) / W) * 100}%`;
    });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; });
    svg.append(hit);
  });
  return h('div', { class: 'chart-box' }, svg, tip);
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function recapCharts(days) {
  const st = M.stats(days);
  const totalEnt = st.entrees.reduce((a, e) => a + e.plateaux + e.pl, 0) || 1;
  return h('div', { class: 'recap-charts' },
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('chart', 16)), 'Tonnage sorti par jour',
      h('span', { class: 'hint' }, `Total ${fmtTon(st.kpis.tonnage)} · survoler une barre pour le détail`)),
    h('div', { class: 'card-body' }, columnChart(st.parJour.map((j) => ({
      value: j.tonnage, label: fmtLongDate(j.date), short: String(Number(j.date.slice(8, 10))),
    })), { unit: ' T', format: (v) => fmtNum(v) }))),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('truck', 16)), 'Entrées par service'),
      h('div', { class: 'card-body' }, st.entrees.map((e) => {
        const t = e.plateaux + e.pl;
        return h('div', { class: 'svc-share', style: svcStyle(e.service) },
          h('div', { class: 'ss-top' }, h('span', { class: 'ss-name' }, SVC[e.service].label), h('b', {}, fmtNum(t)), h('span', { class: 'muted' }, ` · ${Math.round((t / totalEnt) * 100)} %`)),
          h('div', { class: 'bar' }, h('i', { style: { width: `${(t / totalEnt) * 100}%`, background: SVC[e.service].couleur } })),
          h('div', { class: 'ss-sub muted' }, `${fmtNum(e.plateaux)} plateaux · ${fmtNum(e.pl)} PL`));
      }))));
}

/* ---------- Tableau de bord du superviseur ---------- */

async function renderDashboard() {
  const box = $('#dashboard');
  S.dashAt = Date.now();
  if (!box.childElementCount) box.replaceChildren(h('div', { class: 'empty' }, 'Chargement…'));
  await loadSites();
  const cards = await Promise.all(S.sites.map(async (site) => {
    try {
      return dashSiteCard(site, await call(api.siteDashboard(site.dataDir)));
    } catch (err) {
      return h('div', { class: 'card dash-site' }, h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('alert', 16)), site.nom),
        h('div', { class: 'card-body' }, h('div', { class: 'empty' }, `Dossier inaccessible : ${err.message}`)));
    }
  }));
  box.replaceChildren(
    h('div', { class: 'recap-head' }, h('h2', {}, 'Tableau de bord'), h('span', { class: 'muted' }, `Mis à jour à ${nowHHMM()}`),
      h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: renderDashboard }, icon('clock', 15), 'Actualiser')),
    h('div', { class: `dash-grid${cards.length > 1 ? ' multi' : ''}` }, cards));
}

function dashSiteCard(site, d) {
  const open = async (date, service) => {
    if (!site.actif) {
      await useSite(site.dataDir, { thenService: false });
      await goTo(date, service);
      setView('dashboard');
    }
    openFiche(date, service);
  };
  const section = (title, iconName, count, content) => h('div', { class: 'pass-section' },
    h('h5', {}, icon(iconName, 13), `${title}${count != null ? ` (${count})` : ''}`), content);
  const line = (date, service, text, extra = null) => h('button', { class: 'dash-line', style: svcStyle(service), onclick: () => open(date, service) },
    h('span', { class: 'dl-when' }, h('span', { class: 'dl-date' }, fmtShortDate(date)), ` · ${SVC[service].label}`), h('span', { class: 'dl-text' }, text), extra);
  const empty = (t) => h('div', { class: 'empty' }, t);
  return h('div', { class: 'card dash-site' },
    h('div', { class: 'dash-head' }, h('span', { class: 'site-icon' }, icon('box', 20)), h('div', {}, h('div', { class: 'site-name' }, site.nom), h('div', { class: 'site-dir' }, site.dataDir)),
      h('span', { class: 'spacer' }),
      site.actif ? h('span', { class: 'pill live' }, 'Site affiché') : h('button', { class: 'btn small', onclick: () => useSite(site.dataDir, { thenService: false }).then(() => goTo(S.date)).then(renderDashboard) }, 'Ouvrir ce site')),
    h('div', { class: 'dash-today' }, d.today.map((t) => h('button', { class: `dash-svc etat-${t.etat}`, style: svcStyle(t.service), onclick: () => open(d.live.date, t.service) },
      h('div', { class: 'ds-top' }, icon(SVC[t.service].icon, 16), h('b', {}, SVC[t.service].label),
        h('span', { class: `pill ${t.etat === 'clos' ? 'done' : t.etat === 'en-cours' ? 'live' : t.etat === 'ouvert' ? 'draft' : ''}` }, { clos: 'Clôturé', 'en-cours': 'En cours', ouvert: 'Non clôturé', vide: 'Vide' }[t.etat])),
      h('div', { class: 'ds-resp' }, t.responsable || '—'),
      h('div', { class: 'ds-nums' }, `${t.observations} obs.`, t.importantes ? h('span', { class: 'red' }, ` · ${t.importantes} ⚠`) : null,
        t.alertes ? h('span', { class: 'red' }, ` · ${plural(t.alertes, 'box')} ≥ ${M.SEUIL_ALERTE} %`) : null)))),
    section('Tâches en attente', 'checkSquare', d.taches.length, d.taches.length
      ? h('div', { class: 'dash-list' }, d.taches.slice(0, 8).map((t) => line(t.origine.date, t.origine.service, t.texte, h('span', { class: 'muted' }, ` — ${t.creePar || ''}`))))
      : empty('Aucune tâche en attente.')),
    section('Services saisis non clôturés (7 jours)', 'lock', d.nonClotures.length, [
      d.nonClotures.length
        ? h('div', { class: 'dash-list' }, d.nonClotures.slice(0, 8).map((x) => line(x.date, x.service, `Responsable : ${x.responsable || '—'}`)))
        : empty('Tous les services saisis sont clôturés.'),
      d.vides ? h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } }, `${plural(d.vides, 'service')} passé${d.vides > 1 ? 's' : ''} sans aucune saisie.`) : null]),
    section('Observations importantes (7 jours)', 'flag', d.importantes.length, d.importantes.length
      ? h('div', { class: 'dash-list' }, d.importantes.slice(0, 8).map((o) => line(o.date, o.service, `${o.heure ? `${o.heure} · ` : ''}${o.texte}`)))
      : empty('Aucune observation importante.')),
    section('Boxs à 80 % ou plus', 'box', null, d.boxs && d.boxs.alertes.length
      ? h('div', { class: 'alert-list' }, d.boxs.alertes.map((a) => h('span', { class: 'pill alert' }, `${a.type} ${a.nom} : ${fmtNum(a.v)} %`)),
        h('span', { class: 'muted', style: { fontSize: '12px' } }, `(${SVC[d.boxs.service].label} ${fmtShortDate(d.boxs.date)})`))
      : empty('Aucun box en alerte au dernier service saisi.')),
    section('Déchets non conformes (7 jours)', 'recycle', d.nonConformes.length, d.nonConformes.length
      ? h('div', { class: 'dash-list' }, d.nonConformes.slice(0, 8).map((x) => line(x.date, x.service, `${x.type} : ${fmtQte(x)}${x.provenance ? ` — ${x.provenance}` : ''}`)))
      : empty('Aucun déchet non conforme.')),
    section('Stock bas (inventaire)', 'box', (d.stockBas || []).length, (d.stockBas || []).length
      ? h('div', { class: 'alert-list' }, d.stockBas.map((a) => h('span', { class: 'pill alert' }, `${a.nom} : ${fmtNum(a.stock)}${a.unite ? ` ${a.unite}` : ''} (seuil ${fmtNum(a.seuil)})`)))
      : empty('Aucun article sous son seuil.')));
}

/* ---------- Recherche dans le récap ---------- */

const normTxt = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Tout ce qui est cherchable dans un service : une entrée par élément.
function searchItems(date, svcId, s) {
  const items = [];
  const add = (type, text, extra = '') => { if (text) items.push({ date, service: svcId, type, text, extra }); };
  add('Responsable', s.responsable);
  for (const o of realObs(s)) add(o.important ? 'Observation importante' : 'Observation', o.texte, [o.heure, o.auteur].filter(Boolean).join(' · '));
  for (const a of s.absents) if (a.nom) add('Absent', `${a.nom}${a.motif ? ` (${a.motif})` : ''}`);
  for (const x of s.stockage || []) if (x.type) add('Stockage', stkText(x));
  for (const x of s.commandes || []) if (x.quoi) add('Commande', `${cmdText(x)}${x.recue ? ' — reçue' : ''}`);
  for (const x of s.nonConformes) if (x.type) add('Non conforme', `${x.type} : ${fmtQte(x)}${x.provenance ? ` — ${x.provenance}` : ''}${x.commentaire ? ` — ${x.commentaire}` : ''}`);
  for (const x of s.sortiesExtra) if (x.nom) add('Sortie ponctuelle', `${x.nom}${x.nb ? ` · ${plural(x.nb, 'sortie')}` : ''}${x.tonnage ? ` · ${fmtTon(x.tonnage)}` : ''}`);
  if (s.consignes) add('Consigne', s.consignes);
  for (const t of S.tasks) {
    if (t.origine.date === date && t.origine.service === svcId) add(t.faite ? 'Tâche faite' : 'Tâche en attente', t.texte, `créée par ${t.creePar || '?'}${t.faite ? ` · faite par ${t.faite.par || '?'}` : ''}`);
  }
  return items;
}

function buildRecapSearch() {
  const R = S.recapSearch;
  const range = () => {
    const { year, month } = S.recapMonth;
    const days = M.daysInMonth(year, month);
    return [days[0], days[days.length - 1]];
  };
  const [d0, d1] = range();
  if (!R.from) { R.from = d0; R.to = d1; }
  const run = () => {
    clearTimeout(R.timer);
    R.timer = setTimeout(runRecapSearch, 200);
  };
  const periodInputs = h('span', { class: 'rs-period', hidden: R.mode !== 'periode' },
    'du', h('input', { type: 'date', value: R.from, onchange: (e) => { R.from = e.target.value; run(); } }),
    'au', h('input', { type: 'date', value: R.to, onchange: (e) => { R.to = e.target.value; run(); } }));
  $('#recap').replaceChildren(
    h('div', { class: 'journal-bar', id: 'recap-search' },
      h('div', { class: 'search' }, icon('search', 16),
        h('input', { type: 'text', id: 'rs-q', value: R.q, placeholder: 'Rechercher par mots-clés : observations, tâches, absents, déchets, responsables…', oninput: (e) => { R.q = e.target.value; run(); } })),
      h('div', { class: 'seg' }, [['mois', 'Mois affiché'], ['periode', 'Période']].map(([m, label]) => h('button', {
        class: R.mode === m ? 'on' : '', onclick: (e) => {
          R.mode = m;
          e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
          periodInputs.hidden = m !== 'periode';
          run();
        },
      }, label))),
      periodInputs),
    h('div', { id: 'recap-results' }),
    h('div', { id: 'recap-body' }));
}

async function runRecapSearch() {
  const R = S.recapSearch;
  const box = $('#recap-results');
  if (!box) return;
  const words = normTxt(R.q).split(/\s+/).filter(Boolean);
  if (!words.length) {
    box.replaceChildren();
    return;
  }
  let days = S.recapDays || [];
  if (R.mode === 'periode' && R.from && R.to && R.from <= R.to) {
    days = await call(api.loadRange(R.from, R.to));
  }
  const results = [];
  for (const d of days) {
    for (const def of M.SERVICES) {
      for (const it of searchItems(d.date, def.id, d.services[def.id])) {
        const hay = normTxt(`${it.type} ${it.text} ${it.extra}`);
        if (words.every((w) => hay.includes(w))) results.push(it);
      }
    }
  }
  const first = normTxt(R.q).split(/\s+/).filter(Boolean)[0];
  box.replaceChildren(h('div', { class: 'card rs-card' },
    h('div', { class: 'card-head' }, h('span', { class: 'ch-icon' }, icon('search', 16)), `Résultats (${results.length})`,
      h('span', { class: 'hint' }, results.length ? 'Cliquer sur un résultat pour ouvrir la fiche du service' : '')),
    h('div', { class: 'card-body' }, results.length
      ? h('div', { class: 'rs-list' }, results.slice(0, 300).map((it) => h('button', { class: 'rs-item', style: svcStyle(it.service), onclick: () => openFiche(it.date, it.service) },
        h('span', { class: 'rs-when' }, h('b', {}, fmtShortDate(it.date)), h('span', {}, SVC[it.service].label)),
        h('span', { class: `rs-type${/important|attente/i.test(it.type) ? ' hot' : ''}` }, it.type),
        h('span', { class: 'rs-text' }, highlightNorm(it.text, words), it.extra ? h('span', { class: 'muted' }, ` · ${it.extra}`) : null))))
      : h('div', { class: 'empty' }, `Aucun résultat pour « ${R.q.trim()} »${first ? '' : ''}.`))));
}

// Surligne les mots recherchés sans tenir compte des accents ni des majuscules.
function highlightNorm(text, words) {
  const n = normTxt(text);
  const marks = new Array(text.length).fill(false);
  for (const w of words) {
    for (let i = n.indexOf(w); i !== -1; i = n.indexOf(w, i + 1)) for (let k = i; k < i + w.length; k++) marks[k] = true;
  }
  const out = [];
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && marks[j] === marks[i]) j++;
    out.push(marks[i] ? h('mark', {}, text.slice(i, j)) : text.slice(i, j));
    i = j;
  }
  return out;
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
    const obs = realObs(s);
    const lines = obs.map((o) => ({ heure: o.heure, texte: `${o.important ? '⚠ ' : ''}${o.texte}${o.photos.length ? ` (📷 ${o.photos.length})` : ''}` }));
    while (lines.length < M.NB_OBSERVATIONS) lines.push({ heure: '', texte: '' });
    const pctCell = (v) => h('td', { class: `c${v >= M.SEUIL_ALERTE ? ' red' : ''}`, style: v == null ? null : { background: M.fillColor(v), color: '#fff' } }, v == null ? '' : `${fmtNum(v)} %`);
    const noBorder = () => h('td', { style: { border: 0 } });
    const rowsSorties = M.allSorties(s);
    const noms = boxNames(s);
    const boxRows = Array.from({ length: Math.max(rowsSorties.length, noms.bennes.length, noms.plateaux.length) }, (_, i) => {
      const r = rowsSorties[i];
      const b = noms.bennes[i];
      const p = noms.plateaux[i];
      const col = r ? sortieColor(r) : null;
      const ton = r && r.data.tonnage != null ? `${fmtTon(r.data.tonnage)}${(r.data.pesees || []).length > 1 ? ` (${r.data.pesees.map((v) => fmtNum(v)).join('+')})` : ''}` : '';
      return h('tr', {},
        r ? h('td', { style: col ? { color: col.couleur, fontWeight: '700' } : null }, r.nom || 'Ponctuelle') : noBorder(),
        r ? h('td', { class: 'c' }, r.data.nb ?? '') : noBorder(),
        !r ? noBorder() : r.externe ? h('td', { class: 'ext' }, 'service externe') : h('td', { class: 'c' }, ton),
        b ? h('td', {}, b) : noBorder(), b ? pctCell(s.bennes[b]) : noBorder(),
        p ? h('td', {}, p) : noBorder(), p ? pctCell(s.plateaux[p]) : noBorder());
    });
    const tasks = tasksForService(S.tasks, S.date, def.id);
    return h('div', { class: 'p-page', style: { '--c': def.couleur } },
      h('div', { class: 'p-title' }, `MAIN COURANTE  ·  ${(S.siteName || 'Tronc principal').toUpperCase()}`),
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
        h('td', { class: 'c' }, s.entrees.pl ?? ''), h('td', { class: 'c' }, h('b', {}, 'TOTAL')), h('td', { class: 'c' }, h('b', {}, t.entrees)),
        ...(s.entrees.tonnage != null ? [h('td', {}, 'Tonnage'), h('td', { class: 'c' }, fmtTon(s.entrees.tonnage))] : []))),
      h('div', { class: 'p-sec' }, 'SORTIES  ·  ÉTAT DES BOXS'),
      h('table', {}, h('tr', {}, ['Matière', 'Nb sorties', 'Tonnage', 'Bennes', 'Remplissage', 'Plateaux', 'Remplissage'].map((x) => h('th', {}, x))),
        boxRows,
        h('tr', { class: 'tot' }, h('td', {}, 'TOTAL'), h('td', { class: 'c' }, t.sortiesNb), h('td', { class: 'c' }, fmtTon(t.tonnage)), h('td', { colspan: 4, style: { background: 'transparent', border: 0 } }))),
      s.nonConformes.length ? h('div', { class: 'p-sec' }, 'DÉCHETS NON CONFORMES') : null,
      s.nonConformes.length ? h('table', {}, h('tr', {}, ['Déchet', 'Quantité', 'Provenance', 'Commentaire'].map((x) => h('th', {}, x))),
        s.nonConformes.map((x) => h('tr', {}, h('td', {}, x.type), h('td', { class: 'c' }, fmtQte(x)), h('td', {}, x.provenance), h('td', {}, x.commentaire, x.photos.length ? ` (📷 ${x.photos.length})` : '')))) : null,
      s.stockage.some((x) => x.type) ? h('div', { class: 'p-sec' }, 'STOCKAGE') : null,
      s.stockage.some((x) => x.type) ? h('table', {}, h('tr', {}, ['Type', 'Nombre', 'État'].map((x) => h('th', {}, x))),
        s.stockage.filter((x) => x.type).map((x) => h('tr', {}, h('td', {}, x.type), h('td', { class: 'c' }, x.nombre ?? ''), h('td', { class: 'c' }, (M.ETATS_STOCKAGE.find((e) => e.id === x.etat) || {}).label)))) : null,
      s.commandes.some((x) => x.quoi) ? h('div', { class: 'p-sec' }, 'COMMANDES') : null,
      s.commandes.some((x) => x.quoi) ? h('table', {}, h('tr', {}, ['Quoi', 'Quantité', 'Fournisseur', 'Date prévue', 'Reçue'].map((x) => h('th', {}, x))),
        s.commandes.filter((x) => x.quoi).map((x) => h('tr', {}, h('td', {}, x.quoi), h('td', { class: 'c' }, x.quantite), h('td', {}, x.fournisseur), h('td', { class: 'c' }, fmtCmdDate(x.date)), h('td', { class: 'c' }, x.recue ? '☑' : '☐')))) : null,
      tasks.length ? h('div', { class: 'p-sec' }, 'TÂCHES POUR LA RELÈVE') : null,
      tasks.length ? h('table', {}, tasks.map((tk) => h('tr', {}, h('td', { class: 'c', style: { width: '6%' } }, tk.faite ? '☑' : '☐'),
        h('td', {}, tk.texte, h('span', { style: { color: '#888', fontSize: '8pt' } }, ` — ${tk.creePar || ''}${tk.faite ? ` · fait par ${tk.faite.par || ''} ${fmtDateTime(tk.faite.le)}` : ''}`))))) : null,
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
  const newer = updateInfo.newer;
  if (!u && newer && updateDismissed !== `n${newer.version}`) {
    // Un autre poste est plus à jour mais l'installateur n'est pas dans le dossier commun.
    $('#update-title').textContent = `Le poste « ${newer.poste} » utilise la version ${newer.version}`;
    $('#update-sub').textContent = `Ce poste est en ${updateInfo.current}. Déposez Liaison-Installation-${newer.version}.exe dans le dossier mises-a-jour pour l'installer ici.`;
    $('#update-install').hidden = true;
    banner.hidden = false;
    return;
  }
  $('#update-install').hidden = false;
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
    updateDismissed = updateInfo && updateInfo.update ? updateInfo.update.version : updateInfo && updateInfo.newer ? `n${updateInfo.newer.version}` : null;
    $('#update-banner').hidden = true;
  });
  $('#set-update-dir').addEventListener('click', () => call(api.openUpdateDir()));
  checkUpdate().then(autoUpdateAtLaunch);
  setInterval(checkUpdate, UPDATE_CHECK_MS);
}

// Au lancement (rien n'est encore saisi), une nouvelle version trouvée dans le
// dossier mises-a-jour s'installe toute seule. Après deux essais ratés pour la
// même version, on revient au bandeau « Installer ».
async function autoUpdateAtLaunch() {
  const u = updateInfo && updateInfo.update;
  if (!u || updateInfo.kind === 'portable' || S.screen === 'app') return;
  const KEY = 'liaison.autoUpdate';
  let tries = {};
  try {
    tries = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch { /* stockage indisponible */ }
  if ((tries[u.version] || 0) >= 2) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ [u.version]: (tries[u.version] || 0) + 1 }));
  } catch { /* stockage indisponible */ }
  $('#update-banner').hidden = true;
  document.body.append(h('div', { class: 'auto-update' }, h('div', {},
    h('div', { class: 'spinner' }), h('h2', {}, `Mise à jour vers la version ${u.version}…`),
    h('p', {}, 'L\'application va se fermer et se relancer toute seule dans quelques secondes.'))));
  try {
    await call(api.installUpdate());
  } catch (err) {
    document.querySelector('.auto-update').remove();
    checkUpdate();
    toast(`Mise à jour automatique impossible : ${err.message}`, 8000);
  }
}

/* ---------- Paramètres ---------- */

let settingsUsers = [];
let settingsAgents = [];

// Intro fun : un seul responsable, photo et textes facultatifs (null = désactivée).
let settingsFunPhoto = null;
let settingsFunBouche = null;
let settingsFunSon = null;
function funSettings() {
  const user = $('#set-fun-user').value;
  if (!user) return null;
  return {
    user, photo: settingsFunPhoto, bouche: settingsFunBouche, son: settingsFunSon, ruban: $('#set-fun-ruban').value.trim(),
    titre: $('#set-fun-titre').value.trim(), soustitre: $('#set-fun-sous').value.trim(), bulle: $('#set-fun-bulle').value.trim(),
  };
}

const funSonUrl = (son) => (son && son.rel ? call(api.funReadSound(son.rel)).catch(() => null) : Promise.resolve(null));
const funPhotoUrl = (rel) => (rel ? call(api.readPhoto(rel)).catch(() => null) : Promise.resolve(null));

async function renderFunPhoto() {
  const url = await funPhotoUrl(settingsFunPhoto);
  $('#set-fun-photo-box').hidden = !url;
  if (url) $('#set-fun-photo-img').src = url;
  const b = settingsFunBouche || FUN_BOUCHE;
  $('#set-fun-bouche').style.left = `${b.x * 100}%`;
  $('#set-fun-bouche').style.top = `${b.y * 100}%`;
  $('#set-fun-photo-rm').hidden = !settingsFunPhoto;
  $('#set-fun-son-nom').textContent = settingsFunSon ? settingsFunSon.nom : 'Rugissement synthétisé';
  $('#set-fun-son-rm').hidden = !settingsFunSon;
}

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

let settingsSites = [];

function renderSettingsSites() {
  $('#set-sites').replaceChildren(...settingsSites.map((site, i) => h('div', { class: 'site-row' },
    h('span', { class: 'site-row-main' }, h('b', {}, site.nom || 'Nouveau site'), h('span', { class: 'muted' }, site.dataDir)),
    site.dataDir === S.config.dataDir ? h('span', { class: 'pill live' }, 'Actif')
      : h('button', { type: 'button', class: 'o-btn rm', title: 'Retirer ce site de ce poste (ses données ne sont pas supprimées)', onclick: () => { settingsSites.splice(i, 1); renderSettingsSites(); } }, icon('x', 14)))));
}

async function renderSettingsSups() {
  let sups = [];
  try {
    sups = await call(api.listSupervisors());
  } catch { /* dossier inaccessible */ }
  $('#set-sups').replaceChildren(...(sups.length
    ? sups.map((nom) => h('span', { class: 'chip' }, icon('lock', 12), nom,
      h('button', {
        type: 'button', title: `Retirer ${nom}`, onclick: async () => {
          if (await ask('Retirer le superviseur ?', `${nom} ne pourra plus se connecter comme superviseur sur ce site.`, [{ label: 'Annuler', value: 'no' }, { label: 'Retirer', value: 'yes', cls: 'danger' }]) !== 'yes') return;
          await call(api.removeSupervisor(nom));
          renderSettingsSups();
        },
      }, icon('x', 14))))
    : [h('span', { class: 'muted' }, 'Aucun superviseur sur ce site.')]));
}

function openSettings() {
  $('#set-poste').value = S.config.poste || '';
  $('#set-dir').value = S.config.dataDir;
  $('#set-site-nom').value = (S.site && S.site.nom) || S.siteName || '';
  $('#set-entrees-ton').checked = M.entreesTonnage(S.site);
  settingsSites = (S.config.sites || []).map((x) => ({ dataDir: x.dataDir, nom: (S.sites.find((y) => y.dataDir === x.dataDir) || {}).nom }));
  renderSettingsSites();
  renderSettingsSups();
  settingsUsers = [...S.users];
  renderSettingsUsers();
  const fun = (S.site && S.site.fun) || {};
  $('#set-fun-user').replaceChildren(h('option', { value: '' }, 'Personne'),
    ...[...new Set([...S.users, fun.user].filter(Boolean))].map((u) => h('option', { value: u, selected: u === fun.user }, u)));
  $('#set-fun-ruban').value = fun.ruban || '';
  settingsFunPhoto = fun.photo || null;
  settingsFunBouche = fun.bouche || null;
  settingsFunSon = fun.son || null;
  renderFunPhoto();
  $('#set-fun-titre').value = fun.titre || '';
  $('#set-fun-sous').value = fun.soustitre || '';
  $('#set-fun-bulle').value = fun.bulle || '';
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
  $('#set-site-add').addEventListener('click', async () => {
    const dir = await call(api.chooseDir());
    if (!dir || settingsSites.some((x) => x.dataDir === dir)) return;
    // Le site garde son nom s'il en a déjà un (dossier déjà utilisé par un autre poste).
    const info = await call(api.siteInfo(dir)).catch(() => ({}));
    let nom = info.nom || '';
    if (!nom) {
      nom = await promptText('Nom de ce site', 'ex. Site Nord', { text: dir }) || dir.split(/[\\/]/).pop();
      await call(api.renameSite(dir, nom)).catch(() => null);
    }
    settingsSites.push({ dataDir: dir, nom });
    renderSettingsSites();
  });
  $('#set-sup-add').addEventListener('click', async () => {
    try {
      await call(api.saveSupervisor($('#set-sup-nom').value, $('#set-sup-pin').value));
      toast(`Superviseur ${$('#set-sup-nom').value.trim()} enregistré.`);
      $('#set-sup-nom').value = '';
      $('#set-sup-pin').value = '';
      renderSettingsSups();
    } catch (err) {
      toast(err.message);
    }
  });
  $('#set-fun-test').addEventListener('click', async () => playFunIntro(funSettings() || {}, await funPhotoUrl(settingsFunPhoto), await funSonUrl(settingsFunSon)));
  $('#set-fun-son').addEventListener('click', async () => {
    const son = await call(api.funPickSound()).catch((err) => { toast(err.message); return null; });
    if (!son) return;
    settingsFunSon = son;
    renderFunPhoto();
  });
  $('#set-fun-son-rm').addEventListener('click', () => {
    settingsFunSon = null;
    renderFunPhoto();
  });
  $('#set-fun-photo').addEventListener('click', async () => {
    const rels = await call(api.pickPhotos(S.date)).catch((err) => { toast(err.message); return []; });
    if (!rels.length) return;
    settingsFunPhoto = rels[0];
    settingsFunBouche = null;
    renderFunPhoto();
  });
  $('#set-fun-photo-img').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    settingsFunBouche = { x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000 };
    renderFunPhoto();
  });
  $('#set-fun-photo-rm').addEventListener('click', () => {
    settingsFunPhoto = null;
    renderFunPhoto();
  });
  $('#settings').addEventListener('close', async () => {
    if ($('#settings').returnValue !== 'save') return;
    await flush();
    const dirChanged = $('#set-dir').value !== S.config.dataDir;
    const nom = $('#set-site-nom').value.trim();
    const entTon = $('#set-entrees-ton').checked;
    const fun = funSettings();
    if (!dirChanged && (nom !== ((S.site && S.site.nom) || '') || entTon !== M.entreesTonnage(S.site))) {
      S.site = await call(api.saveSite({ ...S.site, nom, entreesTonnage: entTon }));
    }
    // Intro fun : recopiée dans tous les sites du poste (photo et son compris).
    if (!dirChanged && JSON.stringify(fun) !== JSON.stringify((S.site && S.site.fun) || null)) {
      try {
        const r = await call(api.funSaveAll(fun));
        S.site = { ...S.site, fun };
        if (r.echecs.length) toast(`Intro non enregistrée sur : ${r.echecs.join(', ')}`, 6000);
      } catch (err) {
        toast(`Intro non enregistrée : ${err.message}`);
      }
    }
    S.config = await call(api.setConfig({
      poste: $('#set-poste').value.trim(), dataDir: $('#set-dir').value, sites: settingsSites.map((x) => ({ dataDir: x.dataDir })),
    }));
    // Un dossier partagé qui a déjà sa liste de responsables la garde.
    const existing = dirChanged ? await call(api.loadUsers()) : [];
    S.users = await call(api.saveUsers(dirChanged && existing.length ? existing : settingsUsers));
    if (dirChanged) {
      await loadSiteData();
      if (nom && !S.site.nom) S.site = await call(api.saveSite({ ...S.site, nom }));
    } else {
      S.agents = await call(api.saveAgents(settingsAgents));
    }
    await loadSites();
    toast('Paramètres enregistrés.');
    checkUpdate();
    if (S.screen === 'user') renderUserScreen();
    else if (S.screen === 'site') renderSiteScreen();
    else if (S.screen === 'service') renderServiceScreen();
    else await goTo(S.date);
  });
}

// Listes et réglages communs au site (dossier des données).
async function loadSiteData() {
  const safe = async (p, fallback) => {
    try {
      return await call(p);
    } catch {
      return fallback;
    }
  };
  S.agents = await safe(api.loadAgents(), []);
  S.ncTypes = await safe(api.loadNcTypes(), []);
  S.site = await safe(api.loadSite(), { couleurs: {} });
  await loadTasks();
  await loadInventaire();
  if (S.view === 'inventaire' && S.screen === 'app') renderInventaire({ reload: false });
}

/* ---------- Démarrage ---------- */

async function init() {
  decorate();
  S.config = await call(api.getConfig());
  S.users = await call(api.loadUsers());
  await loadSiteData();
  await loadSites();
  const live = M.currentService();
  S.date = live.date;
  S.service = live.service;

  const form = $('#form');
  form.addEventListener('input', onFormInput);
  form.addEventListener('focusout', onFormBlur);
  form.addEventListener('change', onFormChange);
  form.addEventListener('keydown', onFormKey);

  // Écran de choix du service
  const liveFor = () => (M.currentService().date === S.date ? M.currentService().service : 'matin');
  $('#btn-back-user').addEventListener('click', backToUsers);
  $('#btn-site-back').addEventListener('click', backToUsers);
  $('#btn-change-site').addEventListener('click', () => renderSiteScreen());
  $('#btn-site-manage').addEventListener('click', openSettings);
  $('#btn-go-dashboard').addEventListener('click', async () => {
    await enterService(liveFor(), 'dashboard');
    setView('dashboard');
  });
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
